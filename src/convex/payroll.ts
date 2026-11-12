import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/tenant";
import {
  employeeName,
  monthBounds,
  requireHrPermission,
} from "./lib/hr";
import { getSystemAccount } from "./lib/accounts";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
} from "./lib/finance";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { financialAccountTypeValidator } from "./schema";
import type { DocumentLineInput } from "./lib/accounting";

const accountType = financialAccountTypeValidator;
const taxBracket = v.object({ upTo: v.number(), rateBps: v.number() });

function validateBrackets(brackets: { upTo: number; rateBps: number }[]) {
  if (brackets.length === 0) {
    throw new ConvexError("حداقل یک پله مالیات حقوق لازم است.");
  }
  let previous = 0;
  for (const [index, bracket] of brackets.entries()) {
    if (
      !Number.isSafeInteger(bracket.upTo) ||
      bracket.upTo <= previous ||
      bracket.upTo > 9_000_000_000_000_000
    ) {
      throw new ConvexError(
        `سقف پله ${index + 1} باید عدد صحیح و بزرگ‌تر از پله قبل باشد.`,
      );
    }
    if (
      !Number.isInteger(bracket.rateBps) ||
      bracket.rateBps < 0 ||
      bracket.rateBps > 10_000
    ) {
      throw new ConvexError(`نرخ پله ${index + 1} معتبر نیست.`);
    }
    previous = bracket.upTo;
  }
  return brackets;
}

function progressiveTax(
  taxable: number,
  brackets: { upTo: number; rateBps: number }[],
) {
  let tax = 0;
  let previous = 0;
  for (const bracket of brackets) {
    if (taxable <= previous) break;
    const portion = Math.min(taxable, bracket.upTo) - previous;
    if (portion > 0) {
      tax += Math.round((portion * bracket.rateBps) / 10_000);
    }
    previous = bracket.upTo;
  }
  return Math.max(0, tax);
}

async function periodFor(
  ctx: Parameters<typeof requireHrPermission>[0],
  businessId: Id<"businesses">,
  periodId: Id<"payrollPeriods">,
) {
  const period = await ctx.db.get(periodId);
  if (!period || period.businessId !== businessId) {
    throw new ConvexError("دوره حقوق در این کسب‌وکار یافت نشد.");
  }
  return period;
}

export const settings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.view");
    const rows = await ctx.db
      .query("payrollSettings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    return rows.sort((a, b) => b.year - a.year || b.updatedAt - a.updatedAt);
  },
});

export const createSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    year: v.number(),
    jurisdiction: v.string(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    employeeInsuranceBps: v.number(),
    employerInsuranceBps: v.number(),
    taxExemption: v.number(),
    taxBrackets: v.array(taxBracket),
    housingAllowance: v.number(),
    foodAllowance: v.number(),
    overtimeMultiplierBps: v.number(),
    monthlyWorkDays: v.number(),
    sourceTitle: v.string(),
    sourceUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "payroll.calculate",
      { write: true },
    );
    const now = Date.now();
    const year = requireInt(args.year, "سال", { min: 1200, max: 1700 });
    const effectiveFrom = requireInt(args.effectiveFrom, "شروع اعتبار", {
      min: 0,
    });
    if (args.effectiveTo !== undefined && args.effectiveTo < effectiveFrom) {
      throw new ConvexError("پایان اعتبار باید بعد از شروع باشد.");
    }
    const brackets = validateBrackets(args.taxBrackets);
    const sourceTitle = requireString(args.sourceTitle, "منبع قانونی", {
      max: 300,
    }) as string;
    const settingsId = await ctx.db.insert("payrollSettings", {
      businessId: args.businessId,
      year,
      jurisdiction: requireString(args.jurisdiction, "حوزه قضایی", {
        max: 120,
      }) as string,
      effectiveFrom,
      effectiveTo: args.effectiveTo,
      employeeInsuranceBps: requireInt(
        args.employeeInsuranceBps,
        "نرخ بیمه سهم کارمند",
        { min: 0, max: 10_000 },
      ),
      employerInsuranceBps: requireInt(
        args.employerInsuranceBps,
        "نرخ بیمه سهم کارفرما",
        { min: 0, max: 10_000 },
      ),
      taxExemption: requireInt(args.taxExemption, "معافیت مالیات", { min: 0 }),
      taxBrackets: brackets,
      housingAllowance: requireInt(args.housingAllowance, "حق مسکن", { min: 0 }),
      foodAllowance: requireInt(args.foodAllowance, "کمک‌هزینه غذا", { min: 0 }),
      overtimeMultiplierBps: requireInt(
        args.overtimeMultiplierBps,
        "ضریب اضافه‌کاری",
        { min: 10_000, max: 50_000 },
      ),
      monthlyWorkDays: requireInt(args.monthlyWorkDays, "روزهای کاری ماه", {
        min: 1,
        max: 31,
      }),
      sourceTitle,
      sourceUrl: optionalString(args.sourceUrl, "نشانی منبع", 500),
      notes: optionalString(args.notes, "یادداشت", 1000),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payroll.settings.create",
      entity: "payrollSettings",
      entityId: settingsId,
      summary: `ثبت تنظیمات حقوق ${year} — ${sourceTitle}`,
    });
    return { settingsId };
  },
});

export const updateSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    settingsId: v.id("payrollSettings"),
    active: v.optional(v.boolean()),
    taxExemption: v.optional(v.number()),
    housingAllowance: v.optional(v.number()),
    foodAllowance: v.optional(v.number()),
    notes: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.calculate", {
      write: true,
    });
    const row = await ctx.db.get(args.settingsId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("تنظیمات حقوق یافت نشد.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.active !== undefined) patch.active = args.active;
    if (args.taxExemption !== undefined)
      patch.taxExemption = requireInt(args.taxExemption, "معافیت مالیات", {
        min: 0,
      });
    if (args.housingAllowance !== undefined)
      patch.housingAllowance = requireInt(args.housingAllowance, "حق مسکن", {
        min: 0,
      });
    if (args.foodAllowance !== undefined)
      patch.foodAllowance = requireInt(args.foodAllowance, "کمک‌هزینه غذا", {
        min: 0,
      });
    if (args.notes !== undefined)
      patch.notes = optionalString(args.notes, "یادداشت", 1000);
    if (args.sourceTitle !== undefined)
      patch.sourceTitle = requireString(args.sourceTitle, "منبع قانونی", {
        max: 300,
      });
    if (args.sourceUrl !== undefined)
      patch.sourceUrl = optionalString(args.sourceUrl, "نشانی منبع", 500);
    await ctx.db.patch(row._id, patch);
    return { settingsId: row._id };
  },
});

export const periods = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.view");
    return await ctx.db
      .query("payrollPeriods")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect()
      .then((rows) =>
        rows.sort((a, b) => b.year - a.year || b.month - a.month),
      );
  },
});

export const createPeriod = mutation({
  args: {
    businessId: v.id("businesses"),
    year: v.number(),
    month: v.number(),
    title: v.optional(v.string()),
    settingsId: v.id("payrollSettings"),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "payroll.calculate",
      { write: true },
    );
    const settings = await ctx.db.get(args.settingsId);
    if (!settings || settings.businessId !== args.businessId) {
      throw new ConvexError("تنظیمات حقوق انتخاب‌شده یافت نشد.");
    }
    if (!settings.active) {
      throw new ConvexError("تنظیمات حقوق غیرفعال است.");
    }
    const bounds = monthBounds(args.year, args.month);
    const startAt = args.startAt ?? bounds.startAt;
    const endAt = args.endAt ?? bounds.endAt;
    if (endAt <= startAt) {
      throw new ConvexError("بازه دوره حقوق معتبر نیست.");
    }
    const duplicate = await ctx.db
      .query("payrollPeriods")
      .withIndex("by_business_year_month", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("year", args.year)
          .eq("month", args.month),
      )
      .unique();
    if (duplicate) {
      throw new ConvexError("برای این سال و ماه قبلاً دوره حقوق ساخته شده است.");
    }
    const now = Date.now();
    const periodId = await ctx.db.insert("payrollPeriods", {
      businessId: args.businessId,
      year: args.year,
      month: args.month,
      title:
        optionalString(args.title, "عنوان دوره", 120) ??
        `حقوق ${args.year}-${String(args.month).padStart(2, "0")}`,
      startAt,
      endAt,
      settingsId: settings._id,
      status: "draft",
      employeeCount: 0,
      grossTotal: 0,
      employeeInsuranceTotal: 0,
      employerInsuranceTotal: 0,
      taxTotal: 0,
      loanDeductionTotal: 0,
      otherDeductionTotal: 0,
      netTotal: 0,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payroll.period.create",
      entity: "payrollPeriods",
      entityId: periodId,
      summary: `ایجاد دوره حقوق ${args.year}-${args.month}`,
    });
    return { periodId };
  },
});

export const calculate = mutation({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("payrollPeriods"),
    adjustments: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          bonus: v.number(),
          commission: v.number(),
          otherEarnings: v.number(),
          otherDeductions: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "payroll.calculate",
      { write: true },
    );
    const period = await periodFor(ctx, args.businessId, args.periodId);
    if (period.status !== "draft" && period.status !== "calculated") {
      throw new ConvexError("دوره تأییدشده یا پرداخت‌شده قابل محاسبه مجدد نیست.");
    }
    const settings = await ctx.db.get(period.settingsId);
    if (!settings || settings.businessId !== args.businessId) {
      throw new ConvexError("تنظیمات این دوره حقوق در دسترس نیست.");
    }
    const adjustments = args.adjustments ?? [];
    if (adjustments.length > 2000) {
      throw new ConvexError("تعداد تعدیلات بیش از حد مجاز است.");
    }
    const adjustmentMap = new Map<
      string,
      {
        bonus: number;
        commission: number;
        otherEarnings: number;
        otherDeductions: number;
      }
    >();
    for (const row of adjustments) {
      if (adjustmentMap.has(row.employeeId)) {
        throw new ConvexError("برای یک پرسنل بیش از یک ردیف تعدیل ثبت شده است.");
      }
      adjustmentMap.set(row.employeeId as string, {
        bonus: requireInt(row.bonus, "پاداش", { min: 0 }),
        commission: requireInt(row.commission, "پورسانت", { min: 0 }),
        otherEarnings: requireInt(row.otherEarnings, "سایر مزایا", { min: 0 }),
        otherDeductions: requireInt(row.otherDeductions, "سایر کسورات", {
          min: 0,
        }),
      });
    }

    const [employees, contracts, attendanceRows, attendanceSetting, allLoans, allInstallments] =
      await Promise.all([
        ctx.db
          .query("employees")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(2000),
        ctx.db
          .query("employmentContracts")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(4000),
        ctx.db
          .query("attendanceRecords")
          .withIndex("by_business_date", (q) =>
            q
              .eq("businessId", args.businessId)
              .gte("date", period.startAt)
              .lte("date", period.endAt),
          )
          .take(10_000),
        ctx.db
          .query("attendanceSettings")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .unique(),
        ctx.db
          .query("employeeLoans")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(4000),
        ctx.db
          .query("loanInstallments")
          .withIndex("by_business_employee", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(20_000),
      ]);

    for (const key of adjustmentMap.keys()) {
      if (!employees.some((row) => (row._id as string) === key)) {
        throw new ConvexError("یکی از پرسنل تعدیلات در این کسب‌وکار یافت نشد.");
      }
    }

    const eligible = employees.filter(
      (row) => row.status === "active" || row.status === "on_leave",
    );
    const activeContracts = contracts.filter(
      (contract) =>
        contract.startDate <= period.endAt &&
        (!contract.endDate || contract.endDate >= period.startAt) &&
        contract.status !== "cancelled",
    );
    const loanMap = new Map(allLoans.map((loan) => [loan._id as string, loan]));
    const attendanceMap = new Map<string, number>();
    for (const row of attendanceRows) {
      const key = row.employeeId as string;
      attendanceMap.set(key, (attendanceMap.get(key) ?? 0) + row.overtimeMinutes);
    }
    const expectedMinutes = attendanceSetting?.expectedDailyMinutes ?? 480;

    const oldRecords = await ctx.db
      .query("payrollRecords")
      .withIndex("by_period", (q) => q.eq("periodId", period._id))
      .collect();
    for (const record of oldRecords) {
      const components = await ctx.db
        .query("payrollComponents")
        .withIndex("by_record", (q) => q.eq("recordId", record._id))
        .collect();
      for (const component of components) await ctx.db.delete(component._id);
      await ctx.db.delete(record._id);
    }

    const now = Date.now();
    let employeeCount = 0;
    let grossTotal = 0;
    let employeeInsuranceTotal = 0;
    let employerInsuranceTotal = 0;
    let taxTotal = 0;
    let loanDeductionTotal = 0;
    let otherDeductionTotal = 0;
    let netTotal = 0;

    for (const employee of eligible) {
      const contract = activeContracts
        .filter((row) => row.employeeId === employee._id)
        .sort((a, b) => b.startDate - a.startDate)[0];
      if (!contract) continue;
      const adjustment = adjustmentMap.get(employee._id as string) ?? {
        bonus: 0,
        commission: 0,
        otherEarnings: 0,
        otherDeductions: 0,
      };
      const overtimeMinutes = attendanceMap.get(employee._id as string) ?? 0;
      const overtimePay = Math.round(
        (contract.baseSalary *
          overtimeMinutes *
          settings.overtimeMultiplierBps) /
          (settings.monthlyWorkDays * expectedMinutes * 10_000),
      );
      const gross =
        contract.baseSalary +
        settings.housingAllowance +
        settings.foodAllowance +
        overtimePay +
        adjustment.bonus +
        adjustment.commission +
        adjustment.otherEarnings;
      const insuranceEmployee = Math.round(
        (gross * settings.employeeInsuranceBps) / 10_000,
      );
      const taxable = Math.max(
        0,
        gross - insuranceEmployee - settings.taxExemption,
      );
      const tax = progressiveTax(taxable, settings.taxBrackets);
      const pending = allInstallments
        .filter(
          (row) =>
            row.employeeId === employee._id &&
            row.status === "pending" &&
            row.dueDate <= period.endAt,
        )
        .sort((a, b) => a.dueDate - b.dueDate || a.number - b.number);
      let loanDeduction = 0;
      let advanceDeduction = 0;
      const loanInstallmentIds: Id<"loanInstallments">[] = [];
      for (const installment of pending) {
        const loan = loanMap.get(installment.loanId as string);
        if (!loan || loan.status !== "active") continue;
        if (loan.type === "advance") advanceDeduction += installment.amount;
        else loanDeduction += installment.amount;
        loanInstallmentIds.push(installment._id);
      }
      const net =
        gross -
        insuranceEmployee -
        tax -
        loanDeduction -
        advanceDeduction -
        adjustment.otherDeductions;
      if (net < 0) {
        throw new ConvexError(
          `کسورات ${employeeName(employee)} از حقوق بیشتر است؛ تعدیلات را بررسی کنید.`,
        );
      }
      const employerInsurance = Math.round(
        (gross * settings.employerInsuranceBps) / 10_000,
      );
      const recordId = await ctx.db.insert("payrollRecords", {
        businessId: args.businessId,
        periodId: period._id,
        employeeId: employee._id,
        contractId: contract._id,
        branchId: employee.branchId,
        orgUnitId: employee.orgUnitId,
        baseSalary: contract.baseSalary,
        housingAllowance: settings.housingAllowance,
        foodAllowance: settings.foodAllowance,
        overtimeMinutes,
        overtimePay,
        bonus: adjustment.bonus,
        commission: adjustment.commission,
        otherEarnings: adjustment.otherEarnings,
        gross,
        insuranceEmployee,
        tax,
        advanceDeduction,
        loanDeduction,
        otherDeductions: adjustment.otherDeductions,
        net,
        employerInsurance,
        loanInstallmentIds,
        createdAt: now,
      });

      const components: {
        label: string;
        kind: "earning" | "deduction" | "employer";
        amount: number;
        taxable: boolean;
        insurable: boolean;
      }[] = [
        {
          label: "حقوق پایه",
          kind: "earning",
          amount: contract.baseSalary,
          taxable: true,
          insurable: true,
        },
        {
          label: "حق مسکن",
          kind: "earning",
          amount: settings.housingAllowance,
          taxable: true,
          insurable: true,
        },
        {
          label: "کمک‌هزینه غذا",
          kind: "earning",
          amount: settings.foodAllowance,
          taxable: true,
          insurable: true,
        },
        {
          label: "اضافه‌کاری",
          kind: "earning",
          amount: overtimePay,
          taxable: true,
          insurable: true,
        },
        {
          label: "پاداش",
          kind: "earning",
          amount: adjustment.bonus,
          taxable: true,
          insurable: true,
        },
        {
          label: "پورسانت",
          kind: "earning",
          amount: adjustment.commission,
          taxable: true,
          insurable: true,
        },
        {
          label: "سایر مزایا",
          kind: "earning",
          amount: adjustment.otherEarnings,
          taxable: true,
          insurable: true,
        },
        {
          label: "بیمه سهم کارمند",
          kind: "deduction",
          amount: insuranceEmployee,
          taxable: false,
          insurable: false,
        },
        {
          label: "مالیات حقوق",
          kind: "deduction",
          amount: tax,
          taxable: false,
          insurable: false,
        },
        {
          label: "قسط وام",
          kind: "deduction",
          amount: loanDeduction,
          taxable: false,
          insurable: false,
        },
        {
          label: "مساعده",
          kind: "deduction",
          amount: advanceDeduction,
          taxable: false,
          insurable: false,
        },
        {
          label: "سایر کسورات",
          kind: "deduction",
          amount: adjustment.otherDeductions,
          taxable: false,
          insurable: false,
        },
        {
          label: "بیمه سهم کارفرما",
          kind: "employer",
          amount: employerInsurance,
          taxable: false,
          insurable: false,
        },
      ];
      for (const [position, component] of components.entries()) {
        if (component.amount <= 0) continue;
        await ctx.db.insert("payrollComponents", {
          businessId: args.businessId,
          periodId: period._id,
          recordId,
          employeeId: employee._id,
          label: component.label,
          kind: component.kind,
          amount: component.amount,
          taxable: component.taxable,
          insurable: component.insurable,
          position,
        });
      }
      employeeCount += 1;
      grossTotal += gross;
      employeeInsuranceTotal += insuranceEmployee;
      employerInsuranceTotal += employerInsurance;
      taxTotal += tax;
      loanDeductionTotal += loanDeduction + advanceDeduction;
      otherDeductionTotal += adjustment.otherDeductions;
      netTotal += net;
    }

    if (employeeCount === 0) {
      throw new ConvexError("هیچ پرسنل فعالی با قرارداد معتبر در این دوره یافت نشد.");
    }
    await ctx.db.patch(period._id, {
      employeeCount,
      grossTotal,
      employeeInsuranceTotal,
      employerInsuranceTotal,
      taxTotal,
      loanDeductionTotal,
      otherDeductionTotal,
      netTotal,
      status: "calculated",
      calculatedAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payroll.calculate",
      entity: "payrollPeriods",
      entityId: period._id,
      summary: `محاسبه حقوق ${employeeCount} پرسنل؛ خالص ${netTotal}`,
    });
    return {
      periodId: period._id,
      employeeCount,
      grossTotal,
      employeeInsuranceTotal,
      employerInsuranceTotal,
      taxTotal,
      loanDeductionTotal,
      otherDeductionTotal,
      netTotal,
    };
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("payrollPeriods"),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.view");
    const period = await periodFor(ctx, args.businessId, args.periodId);
    const records = await ctx.db
      .query("payrollRecords")
      .withIndex("by_period", (q) => q.eq("periodId", period._id))
      .collect();
    const employees = await Promise.all(
      records.map((record) => ctx.db.get(record.employeeId)),
    );
    const employeeMap = new Map(
      employees
        .filter((row): row is Doc<"employees"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const rows = await Promise.all(
      records
        .sort((a, b) => {
          const left = employeeMap.get(a.employeeId as string);
          const right = employeeMap.get(b.employeeId as string);
          return (left ? employeeName(left) : "").localeCompare(
            right ? employeeName(right) : "",
            "fa",
          );
        })
        .map(async (record) => {
          const components = await ctx.db
            .query("payrollComponents")
            .withIndex("by_record", (q) => q.eq("recordId", record._id))
            .collect();
          const employee = employeeMap.get(record.employeeId as string);
          return {
            ...record,
            employeeName: employee ? employeeName(employee) : "—",
            employeeCode: employee?.code ?? "—",
            jobTitle: employee?.jobTitle ?? "—",
            components: components.sort((a, b) => a.position - b.position),
          };
        }),
    );
    const setting = await ctx.db.get(period.settingsId);
    return { period, records: rows, settings: setting };
  },
});

export const approve = mutation({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("payrollPeriods"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "payroll.approve",
      { write: true },
    );
    const period = await periodFor(ctx, args.businessId, args.periodId);
    if (period.status !== "calculated") {
      throw new ConvexError("فقط دوره محاسبه‌شده قابل تأیید نهایی است.");
    }
    const records = await ctx.db
      .query("payrollRecords")
      .withIndex("by_period", (q) => q.eq("periodId", period._id))
      .collect();
    if (records.length === 0) {
      throw new ConvexError("دوره حقوق ردیف قابل تأیید ندارد.");
    }
    const salaryExpense = await getSystemAccount(
      ctx,
      args.businessId,
      "salaryExpense",
    );
    const employerInsuranceExpense = await getSystemAccount(
      ctx,
      args.businessId,
      "employerInsuranceExpense",
    );
    const salaryPayable = await getSystemAccount(
      ctx,
      args.businessId,
      "salaryPayable",
    );
    const insurancePayable = await getSystemAccount(
      ctx,
      args.businessId,
      "insurancePayable",
    );
    const payrollTaxPayable = await getSystemAccount(
      ctx,
      args.businessId,
      "payrollTaxPayable",
    );
    const employeeReceivable = await getSystemAccount(
      ctx,
      args.businessId,
      "employeeReceivable",
    );
    for (const account of [
      salaryExpense,
      employerInsuranceExpense,
      salaryPayable,
      insurancePayable,
      payrollTaxPayable,
      employeeReceivable,
    ]) {
      if (!account) {
        throw new ConvexError("یکی از حساب‌های سیستمی حقوق در کدینگ یافت نشد.");
      }
    }
    const lines: DocumentLineInput[] = [];
    if (period.grossTotal > 0) {
      lines.push({
        accountId: salaryExpense!._id,
        description: "هزینه حقوق و مزایای دوره",
        debit: period.grossTotal,
        credit: 0,
      });
    }
    if (period.employerInsuranceTotal > 0) {
      lines.push({
        accountId: employerInsuranceExpense!._id,
        description: "بیمه سهم کارفرما",
        debit: period.employerInsuranceTotal,
        credit: 0,
      });
    }
    if (period.netTotal > 0) {
      lines.push({
        accountId: salaryPayable!._id,
        description: "خالص حقوق پرداختنی",
        debit: 0,
        credit: period.netTotal,
      });
    }
    const insuranceTotal =
      period.employeeInsuranceTotal + period.employerInsuranceTotal;
    if (insuranceTotal > 0) {
      lines.push({
        accountId: insurancePayable!._id,
        description: "بیمه پرداختنی سهم کارمند و کارفرما",
        debit: 0,
        credit: insuranceTotal,
      });
    }
    if (period.taxTotal > 0) {
      lines.push({
        accountId: payrollTaxPayable!._id,
        description: "مالیات حقوق پرداختنی",
        debit: 0,
        credit: period.taxTotal,
      });
    }
    if (period.loanDeductionTotal > 0) {
      lines.push({
        accountId: employeeReceivable!._id,
        description: "کسر اقساط وام و مساعده از حقوق",
        debit: 0,
        credit: period.loanDeductionTotal,
      });
    }
    const debit = lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (debit !== credit) {
      throw new ConvexError(
        "جمع اجزای حقوق متوازن نیست؛ تنظیمات کسورات را بررسی کنید.",
      );
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: period.endAt,
      description: `سند تأیید ${period.title}`,
      sourceType: "payroll-period",
      sourceId: period._id,
      lines,
    });
    const now = Date.now();
    for (const record of records) {
      for (const installmentId of record.loanInstallmentIds) {
        const installment = await ctx.db.get(installmentId);
        if (!installment || installment.status !== "pending") continue;
        await ctx.db.patch(installmentId, {
          status: "deducted",
          payrollPeriodId: period._id,
        });
      }
    }
    await ctx.db.patch(period._id, {
      status: "approved",
      accountingDocumentId: journal.documentId,
      approvedAt: now,
      approvedBy: user._id,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payroll.approve",
      entity: "payrollPeriods",
      entityId: period._id,
      summary: `تأیید نهایی ${period.title} با سند ${journal.number}`,
    });
    return {
      periodId: period._id,
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
    };
  },
});

export const pay = mutation({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("payrollPeriods"),
    paidAt: v.number(),
    sourceType: accountType,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "payroll.approve",
      { write: true },
    );
    const period = await periodFor(ctx, args.businessId, args.periodId);
    if (period.status !== "approved") {
      throw new ConvexError("ابتدا باید دوره حقوق تأیید نهایی شود.");
    }
    if (period.netTotal <= 0) {
      await ctx.db.patch(period._id, {
        status: "paid",
        paidAt: args.paidAt,
        updatedAt: Date.now(),
      });
      return { periodId: period._id, paid: true, accountingDocumentId: null };
    }
    const account = await resolveFinancialAccount(ctx, args.businessId, {
      type: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
    });
    const salaryPayable = await getSystemAccount(
      ctx,
      args.businessId,
      "salaryPayable",
    );
    if (!salaryPayable) {
      throw new ConvexError("حساب خالص حقوق پرداختنی در کدینگ یافت نشد.");
    }
    const description = `پرداخت خالص ${period.title}`;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: args.paidAt,
      description,
      sourceType: "payroll-payment",
      sourceId: period._id,
      lines: [
        {
          accountId: salaryPayable._id,
          description,
          debit: period.netTotal,
          credit: 0,
        },
        {
          accountId: account.accountId,
          description: `پرداخت از ${account.name}`,
          debit: 0,
          credit: period.netTotal,
        },
      ],
    });
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account,
      direction: "out",
      amount: period.netTotal,
      occurredAt: args.paidAt,
      operationType: "payroll-payment",
      operationId: period._id,
      description,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    await ctx.db.patch(period._id, {
      status: "paid",
      paidAt: args.paidAt,
      paymentDocumentId: journal.documentId,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payroll.pay",
      entity: "payrollPeriods",
      entityId: period._id,
      summary: `پرداخت ${period.title} با سند ${journal.number}`,
    });
    return {
      periodId: period._id,
      paid: true,
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
    };
  },
});

export const payslip = query({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("payrollPeriods"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.view");
    const period = await periodFor(ctx, args.businessId, args.periodId);
    const record = await ctx.db
      .query("payrollRecords")
      .withIndex("by_business_employee", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("employeeId", args.employeeId),
      )
      .filter((q) => q.eq(q.field("periodId"), period._id))
      .unique();
    if (!record) throw new ConvexError("فیش حقوقی برای این پرسنل یافت نشد.");
    const [employee, components, business, branch, settings] =
      await Promise.all([
        ctx.db.get(record.employeeId),
        ctx.db
          .query("payrollComponents")
          .withIndex("by_record", (q) => q.eq("recordId", record._id))
          .collect(),
        ctx.db.get(args.businessId),
        ctx.db.get(record.branchId),
        ctx.db.get(period.settingsId),
      ]);
    if (!employee) throw new ConvexError("پرسنل فیش حقوقی یافت نشد.");
    return {
      period,
      record,
      employee: {
        _id: employee._id as string,
        code: employee.code,
        name: employeeName(employee),
        jobTitle: employee.jobTitle,
        branchName: branch?.name ?? "—",
        bankName: employee.bankName ?? null,
        bankAccount: employee.bankAccount ?? null,
      },
      components: components.sort((a, b) => a.position - b.position),
      settings,
      businessName: business?.name ?? "حساب ویرا",
      currency: business?.currency ?? "IRT",
    };
  },
});

export const summary = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "payroll.view");
    const periods = await ctx.db
      .query("payrollPeriods")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const paid = periods.filter((row) => row.status === "paid");
    return {
      periodCount: periods.length,
      pending: periods.filter(
        (row) => row.status === "draft" || row.status === "calculated",
      ).length,
      approvedUnpaid: periods.filter((row) => row.status === "approved").length,
      lastPaid: paid.sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0] ?? null,
      totalCost: periods
        .filter((row) => row.status === "approved" || row.status === "paid")
        .reduce(
          (sum, row) => sum + row.grossTotal + row.employerInsuranceTotal,
          0,
        ),
      totalNet: periods
        .filter((row) => row.status === "approved" || row.status === "paid")
        .reduce((sum, row) => sum + row.netTotal, 0),
    };
  },
});
