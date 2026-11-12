import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/tenant";
import {
  addMonths,
  dayStart,
  employeeName,
  requireAnyPermission,
  requireHrPermission,
} from "./lib/hr";
import { getSystemAccount } from "./lib/accounts";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
} from "./lib/finance";
import { optionalString, requireInt } from "./lib/validation";
import { financialAccountTypeValidator } from "./schema";

const accountType = financialAccountTypeValidator;

async function employeeForBusiness(
  ctx: Parameters<typeof requireAnyPermission>[0],
  businessId: Id<"businesses">,
  employeeId: Id<"employees">,
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee || employee.businessId !== businessId) {
    throw new ConvexError("پرسنل در این کسب‌وکار یافت نشد.");
  }
  return employee;
}

async function loanForBusiness(
  ctx: Parameters<typeof requireAnyPermission>[0],
  businessId: Id<"businesses">,
  loanId: Id<"employeeLoans">,
) {
  const loan = await ctx.db.get(loanId);
  if (!loan || loan.businessId !== businessId) {
    throw new ConvexError("وام در این کسب‌وکار یافت نشد.");
  }
  return loan;
}

async function outstandingForLoan(
  ctx: Parameters<typeof requireAnyPermission>[0],
  loanId: Id<"employeeLoans">,
) {
  const rows = await ctx.db
    .query("loanInstallments")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();
  return {
    outstanding: rows
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + row.amount, 0),
    pendingCount: rows.filter((row) => row.status === "pending").length,
    paidAmount: rows
      .filter((row) => row.status !== "pending")
      .reduce((sum, row) => sum + row.amount, 0),
    installments: rows.sort((a, b) => a.number - b.number),
  };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("settled"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAnyPermission(ctx, args.businessId, [
      "loans.manage",
      "payroll.view",
      "hr.sensitive",
    ]);
    const rows = args.employeeId
      ? await ctx.db
          .query("employeeLoans")
          .withIndex("by_business_employee", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("employeeId", args.employeeId as Id<"employees">),
          )
          .take(1000)
      : await ctx.db
          .query("employeeLoans")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(2000);
    const filtered = rows.filter(
      (row) => !args.status || row.status === args.status,
    );
    const employeeIds = [...new Set(filtered.map((row) => row.employeeId))];
    const employees = await Promise.all(
      employeeIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      employees
        .filter((row): row is Doc<"employees"> => Boolean(row))
        .map((row) => [row._id as string, employeeName(row)]),
    );
    return await Promise.all(
      filtered
        .sort((a, b) => b.paidAt - a.paidAt)
        .map(async (loan) => {
          const state = await outstandingForLoan(ctx, loan._id);
          return {
            ...loan,
            employeeName: names.get(loan.employeeId as string) ?? "—",
            outstanding: state.outstanding,
            pendingCount: state.pendingCount,
            paidAmount: state.paidAmount,
          };
        }),
    );
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    loanId: v.id("employeeLoans"),
  },
  handler: async (ctx, args) => {
    await requireAnyPermission(ctx, args.businessId, [
      "loans.manage",
      "payroll.view",
      "hr.sensitive",
    ]);
    const loan = await loanForBusiness(ctx, args.businessId, args.loanId);
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      loan.employeeId,
    );
    const state = await outstandingForLoan(ctx, loan._id);
    return {
      ...loan,
      employeeName: employeeName(employee),
      employeeCode: employee.code,
      ...state,
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    employeeId: v.id("employees"),
    type: v.union(v.literal("loan"), v.literal("advance")),
    amount: v.number(),
    paidAt: v.number(),
    installments: v.number(),
    sourceType: accountType,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "loans.manage",
      { write: true },
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      args.employeeId,
    );
    const amount = requireInt(args.amount, "مبلغ وام", { min: 1 });
    const paidAt = dayStart(args.paidAt);
    const installments = requireInt(
      args.installments,
      "تعداد اقساط",
      { min: 1, max: 120 },
    );
    const count = args.type === "advance" ? 1 : installments;
    const account = await resolveFinancialAccount(ctx, args.businessId, {
      type: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
    });
    const receivable = await getSystemAccount(
      ctx,
      args.businessId,
      "employeeReceivable",
    );
    if (!receivable) {
      throw new ConvexError("حساب مطالبات پرسنل در کدینگ یافت نشد.");
    }
    const description =
      optionalString(args.description, "توضیح", 500) ??
      `${args.type === "loan" ? "پرداخت وام" : "پرداخت مساعده"} به ${employeeName(employee)}`;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: paidAt,
      description,
      branchId: employee.branchId,
      sourceType: args.type === "loan" ? "employee-loan" : "employee-advance",
      sourceId: `${employee._id}:${paidAt}:${amount}`,
      lines: [
        {
          accountId: receivable._id,
          description,
          debit: amount,
          credit: 0,
        },
        {
          accountId: account.accountId,
          description: `پرداخت از ${account.name}`,
          debit: 0,
          credit: amount,
        },
      ],
    });
    const now = Date.now();
    const base = Math.floor(amount / count);
    const loanId = await ctx.db.insert("employeeLoans", {
      businessId: args.businessId,
      employeeId: employee._id,
      type: args.type,
      amount,
      paidAt,
      installments: count,
      installmentAmount: base,
      status: "active",
      sourceType: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
      description,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < count; index += 1) {
      const isLast = index === count - 1;
      await ctx.db.insert("loanInstallments", {
        businessId: args.businessId,
        loanId,
        employeeId: employee._id,
        number: index + 1,
        dueDate: addMonths(paidAt, index + 1),
        amount: isLast ? amount - base * (count - 1) : base,
        status: "pending",
        createdAt: now,
      });
    }
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account,
      direction: "out",
      amount,
      occurredAt: paidAt,
      operationType: args.type === "loan" ? "employee-loan" : "employee-advance",
      operationId: loanId,
      description,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "loan.create",
      entity: "employeeLoans",
      entityId: loanId,
      summary: `${description} — ${count} قسط`,
    });
    return {
      loanId,
      accountingDocumentId: journal.documentId,
      installmentAmount: base,
      count,
    };
  },
});

export const payInstallment = mutation({
  args: {
    businessId: v.id("businesses"),
    installmentId: v.id("loanInstallments"),
    paidAt: v.number(),
    sourceType: accountType,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "loans.manage",
      { write: true },
    );
    const installment = await ctx.db.get(args.installmentId);
    if (!installment || installment.businessId !== args.businessId) {
      throw new ConvexError("قسط وام یافت نشد.");
    }
    if (installment.status !== "pending") {
      throw new ConvexError("این قسط قبلاً پرداخت یا از حقوق کسر شده است.");
    }
    const loan = await loanForBusiness(
      ctx,
      args.businessId,
      installment.loanId,
    );
    const employee = await employeeForBusiness(
      ctx,
      args.businessId,
      installment.employeeId,
    );
    const account = await resolveFinancialAccount(ctx, args.businessId, {
      type: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
    });
    const receivable = await getSystemAccount(
      ctx,
      args.businessId,
      "employeeReceivable",
    );
    if (!receivable) {
      throw new ConvexError("حساب مطالبات پرسنل در کدینگ یافت نشد.");
    }
    const paidAt = dayStart(args.paidAt);
    const description = `پرداخت قسط ${installment.number} وام ${employeeName(employee)}`;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: paidAt,
      description,
      branchId: employee.branchId,
      sourceType: "loan-installment",
      sourceId: installment._id,
      lines: [
        {
          accountId: account.accountId,
          description: `دریافت از ${account.name}`,
          debit: installment.amount,
          credit: 0,
        },
        {
          accountId: receivable._id,
          description,
          debit: 0,
          credit: installment.amount,
        },
      ],
    });
    await ctx.db.patch(installment._id, {
      status: "paid",
      paidAt,
      accountingDocumentId: journal.documentId,
    });
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account,
      direction: "in",
      amount: installment.amount,
      occurredAt: paidAt,
      operationType: "loan-installment",
      operationId: installment._id,
      description,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    const state = await outstandingForLoan(ctx, loan._id);
    if (state.outstanding === 0) {
      await ctx.db.patch(loan._id, { status: "settled", updatedAt: Date.now() });
    }
    return {
      installmentId: installment._id,
      accountingDocumentId: journal.documentId,
      outstanding: state.outstanding,
    };
  },
});

export const debtReport = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireAnyPermission(ctx, args.businessId, [
      "loans.manage",
      "payroll.view",
      "hr.sensitive",
    ]);
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    const loans = await ctx.db
      .query("employeeLoans")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    const rows = await Promise.all(
      employees.map(async (employee) => {
        const employeeLoans = loans.filter(
          (loan) =>
            loan.employeeId === employee._id && loan.status === "active",
        );
        let outstanding = 0;
        let nextDue: number | null = null;
        for (const loan of employeeLoans) {
          const state = await outstandingForLoan(ctx, loan._id);
          outstanding += state.outstanding;
          const next = state.installments.find((row) => row.status === "pending");
          if (next && (!nextDue || next.dueDate < nextDue)) {
            nextDue = next.dueDate;
          }
        }
        return {
          employeeId: employee._id as string,
          code: employee.code,
          name: employeeName(employee),
          branchId: employee.branchId as string,
          outstanding,
          loanCount: employeeLoans.length,
          nextDueDate: nextDue,
        };
      }),
    );
    return rows.filter((row) => row.outstanding > 0);
  },
});

