import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./lib/tenant";
import { periodKey, permissionsFor } from "./lib/hr";

export type NotificationItem = {
  key: string;
  type:
    | "invoice-overdue"
    | "invoice-due-soon"
    | "invoice-draft"
    | "fiscal-year"
    | "contract-expiring"
    | "leave-pending"
    | "payroll-unpaid"
    | "loan-installment"
    | "tax-due"
    | "depreciation-due"
    | "employee-docs";
  title: string;
  description: string;
  href: string;
  severity: "danger" | "warning" | "info";
  date: number;
  read: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Notifications are derived from real invoices and fiscal periods. Modules
 * that do not exist yet (stock, cheques, supplier debts, journals) simply
 * produce no notifications instead of invented alerts.
 */
export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireMembership(ctx, args.businessId);
    const permissions = permissionsFor(membership);
    const now = Date.now();

    const [invoices, fiscalYears, reads, branches] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2000),
      ctx.db
        .query("fiscalYears")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect(),
      ctx.db
        .query("notificationReads")
        .withIndex("by_business_user", (q) =>
          q.eq("businessId", args.businessId).eq("userId", user._id),
        )
        .collect(),
      ctx.db
        .query("branches")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect(),
    ]);

    const primaryBranch = branches.find((branch) => branch.isPrimary);
    const activeFiscalYear =
      fiscalYears.find((year) => year._id === args.fiscalYearId) ??
      fiscalYears.find(
        (year) =>
          year.status === "open" &&
          year.startAt <= now &&
          year.endAt >= now,
      );

    const matchesBranch = (branchId?: Id<"branches">) => {
      if (!args.branchId) return true;
      if (branchId) return branchId === args.branchId;
      return primaryBranch?._id === args.branchId;
    };

    const selectedFiscalYear = fiscalYears.find(
      (year) => year._id === args.fiscalYearId,
    );
    const matchesFiscalYear = (
      fiscalYearId: Id<"fiscalYears"> | undefined,
      timestamp: number,
    ) => {
      if (!args.fiscalYearId) return true;
      if (fiscalYearId) return fiscalYearId === args.fiscalYearId;
      return Boolean(
        selectedFiscalYear &&
          timestamp >= selectedFiscalYear.startAt &&
          timestamp <= selectedFiscalYear.endAt,
      );
    };

    const scoped = invoices.filter(
      (invoice) =>
        matchesBranch(invoice.branchId) &&
        matchesFiscalYear(invoice.fiscalYearId, invoice.issueDate),
    );

    const items: NotificationItem[] = [];

    for (const invoice of scoped) {
      if (
        invoice.status === "issued" &&
        invoice.dueDate &&
        invoice.dueDate < now
      ) {
        const daysLate = Math.max(
          1,
          Math.floor((now - invoice.dueDate) / DAY_MS),
        );
        items.push({
          key: `invoice-overdue:${invoice._id}`,
          type: "invoice-overdue",
          title: `فاکتور ${invoice.number} سررسید گذشته`,
          description: `${daysLate.toLocaleString("fa-IR")} روز از سررسید گذشته و مانده آن هنوز تسویه نشده است.`,
          href: `/dashboard/invoices?invoice=${invoice._id}`,
          severity: "danger",
          date: invoice.dueDate,
          read: false,
        });
      } else if (
        invoice.status === "issued" &&
        invoice.dueDate &&
        invoice.dueDate >= now &&
        invoice.dueDate <= now + 7 * DAY_MS
      ) {
        const daysLeft = Math.max(
          1,
          Math.ceil((invoice.dueDate - now) / DAY_MS),
        );
        items.push({
          key: `invoice-due-soon:${invoice._id}`,
          type: "invoice-due-soon",
          title: `سررسید نزدیک فاکتور ${invoice.number}`,
          description: `تا ${daysLeft.toLocaleString("fa-IR")} روز دیگر سررسید می‌شود.`,
          href: `/dashboard/invoices?invoice=${invoice._id}`,
          severity: "warning",
          date: invoice.dueDate,
          read: false,
        });
      }

      if (invoice.status === "draft") {
        items.push({
          key: `invoice-draft:${invoice._id}`,
          type: "invoice-draft",
          title: `پیش‌نویس فاکتور ${invoice.number}`,
          description: "این سند هنوز قطعی نشده و در گزارش فروش محاسبه نمی‌شود.",
          href: `/dashboard/invoices?invoice=${invoice._id}`,
          severity: "info",
          date: invoice.issueDate,
          read: false,
        });
      }
    }

    const canHr = permissions.includes("hr.view");
    const canApproveLeave = permissions.includes("leave.approve");
    const canPayroll = permissions.includes("payroll.view");
    const canTax = permissions.includes("tax.view");
    const canAssets = permissions.includes("assets.view");
    const canLoans = permissions.includes("loans.manage");

    if (canHr || canApproveLeave) {
      const [contracts, leaves] = await Promise.all([
        canHr
          ? ctx.db
              .query("employmentContracts")
              .withIndex("by_business_status", (q) =>
                q.eq("businessId", args.businessId).eq("status", "active"),
              )
              .take(1000)
          : [],
        canApproveLeave
          ? ctx.db
              .query("leaveRequests")
              .withIndex("by_business_status", (q) =>
                q.eq("businessId", args.businessId).eq("status", "pending"),
              )
              .take(1000)
          : [],
      ]);
      if (canHr) {
        const employeeIds = [...new Set(contracts.map((row) => row.employeeId))];
        const employees = await Promise.all(
          employeeIds.map((id) => ctx.db.get(id)),
        );
        const employeeMap = new Map(
          employees
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .map((row) => [row._id as string, row]),
        );
        for (const contract of contracts) {
          if (!contract.endDate) continue;
          const employee = employeeMap.get(contract.employeeId as string);
          if (!employee) continue;
          if (args.branchId && employee.branchId !== args.branchId) continue;
          const days = Math.ceil((contract.endDate - now) / DAY_MS);
          if (days < 0 || days > 30) continue;
          items.push({
            key: `contract-expiring:${contract._id}`,
            type: "contract-expiring",
            title: `قرارداد ${employee.firstName} ${employee.lastName} در حال پایان است`,
            description: `قرارداد ${contract.number} تا ${days.toLocaleString("fa-IR")} روز دیگر پایان می‌یابد.`,
            href: "/dashboard/hr/employees",
            severity: days <= 7 ? "danger" : "warning",
            date: contract.endDate,
            read: false,
          });
        }
      }
      for (const request of leaves) {
        if (args.branchId && request.branchId !== args.branchId) continue;
        const employee = await ctx.db.get(request.employeeId);
        items.push({
          key: `leave-pending:${request._id}`,
          type: "leave-pending",
          title: "درخواست مرخصی در انتظار تأیید",
          description: `${employee ? `${employee.firstName} ${employee.lastName}` : "یک پرسنل"} برای ${request.days.toLocaleString("fa-IR")} روز مرخصی درخواست داده است.`,
          href: "/dashboard/hr/attendance",
          severity: "info",
          date: request.startDate,
          read: false,
        });
      }
    }

    if (canPayroll) {
      const periods = await ctx.db
        .query("payrollPeriods")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect();
      for (const period of periods.filter((row) => row.status === "approved")) {
        items.push({
          key: `payroll-unpaid:${period._id}`,
          type: "payroll-unpaid",
          title: `${period.title} تأیید شده اما پرداخت نشده است`,
          description: `خالص قابل پرداخت ${period.netTotal.toLocaleString("fa-IR")} واحد پول است.`,
          href: "/dashboard/hr/payroll",
          severity: "warning",
          date: period.approvedAt ?? period.endAt,
          read: false,
        });
      }
    }

    if (canLoans) {
      const installments = await ctx.db
        .query("loanInstallments")
        .withIndex("by_business_status_due", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("status", "pending")
            .lte("dueDate", now + 7 * DAY_MS),
        )
        .take(500);
      for (const installment of installments) {
        if (installment.dueDate < now - 30 * DAY_MS) continue;
        const employee = await ctx.db.get(installment.employeeId);
        items.push({
          key: `loan-installment:${installment._id}`,
          type: "loan-installment",
          title: `سررسید قسط ${installment.number.toLocaleString("fa-IR")}`,
          description: `قسط ${installment.amount.toLocaleString("fa-IR")} واحدی ${employee ? `${employee.firstName} ${employee.lastName}` : "پرسنل"} نزدیک است.`,
          href: "/dashboard/hr/payroll",
          severity: installment.dueDate < now ? "danger" : "warning",
          date: installment.dueDate,
          read: false,
        });
      }
    }

    if (canTax) {
      const taxPeriods = await ctx.db
        .query("taxPeriods")
        .withIndex("by_business_due", (q) =>
          q
            .eq("businessId", args.businessId)
            .lte("dueDate", now + 30 * DAY_MS),
        )
        .take(500);
      for (const period of taxPeriods) {
        if (period.status === "paid" || period.status === "closed") continue;
        const days = Math.ceil((period.dueDate - now) / DAY_MS);
        if (days < -30) continue;
        items.push({
          key: `tax-due:${period._id}`,
          type: "tax-due",
          title: `مهلت مالیاتی ${period.title}`,
          description:
            days < 0
              ? `${Math.abs(days).toLocaleString("fa-IR")} روز از مهلت گذشته است.`
              : `${days.toLocaleString("fa-IR")} روز تا مهلت باقی مانده است.`,
          href: "/dashboard/hr/tax",
          severity: days < 0 ? "danger" : "warning",
          date: period.dueDate,
          read: false,
        });
      }
    }

    if (canAssets) {
      const [assets, depreciations] = await Promise.all([
        ctx.db
          .query("fixedAssets")
          .withIndex("by_business_status", (q) =>
            q.eq("businessId", args.businessId).eq("status", "active"),
          )
          .take(1000),
        ctx.db
          .query("assetDepreciations")
          .withIndex("by_business_period", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("periodKey", periodKey(now)),
          )
          .take(1000),
      ]);
      const done = new Set(depreciations.map((row) => row.assetId as string));
      const pendingAssets = assets.filter(
        (asset) =>
          !done.has(asset._id as string) &&
          (!args.branchId || asset.branchId === args.branchId),
      );
      if (pendingAssets.length > 0) {
        items.push({
          key: `depreciation-due:${periodKey(now)}`,
          type: "depreciation-due",
          title: "استهلاک ماه جاری ثبت نشده است",
          description: `${pendingAssets.length.toLocaleString("fa-IR")} دارایی فعال هنوز استهلاک این ماه را ندارند.`,
          href: "/dashboard/hr/assets",
          severity: "info",
          date: now,
          read: false,
        });
      }
    }

    if (permissions.includes("hr.edit")) {
      const [activeEmployees, documents] = await Promise.all([
        ctx.db
          .query("employees")
          .withIndex("by_business_status", (q) =>
            q.eq("businessId", args.businessId).eq("status", "active"),
          )
          .take(2000),
        ctx.db
          .query("employeeDocuments")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(3000),
      ]);
      const withDocs = new Set(documents.map((row) => row.employeeId as string));
      const missing = activeEmployees.filter(
        (employee) =>
          !withDocs.has(employee._id as string) &&
          (!args.branchId || employee.branchId === args.branchId),
      ).length;
      if (missing > 0) {
        items.push({
          key: "employee-docs-missing",
          type: "employee-docs",
          title: "مدارک پرسنلی ناقص است",
          description: `${missing.toLocaleString("fa-IR")} پرسنل فعال هنوز مدرکی در پرونده ندارند.`,
          href: "/dashboard/hr/employees",
          severity: "info",
          date: now,
          read: false,
        });
      }
    }

    if (activeFiscalYear) {
      const remaining = activeFiscalYear.endAt - now;
      if (remaining >= 0 && remaining <= 30 * DAY_MS) {
        items.push({
          key: `fiscal-year-ending:${activeFiscalYear._id}`,
          type: "fiscal-year",
          title: `${activeFiscalYear.name} در حال پایان است`,
          description:
            "کمتر از ۳۰ روز تا پایان دوره مالی باقی مانده؛ اسناد باز را بررسی کنید.",
          href: "/dashboard#accounting-status",
          severity: "warning",
          date: activeFiscalYear.endAt,
          read: false,
        });
      }
    }

    const severityOrder = { danger: 0, warning: 1, info: 2 } as const;
    items.sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        b.date - a.date,
    );

    const readKeys = new Set(reads.map((row) => row.key));
    const withRead = items.map((item) => ({
      ...item,
      read: readKeys.has(item.key),
    }));
    const unreadCount = withRead.filter((item) => !item.read).length;

    return {
      items: withRead.slice(0, 30),
      unreadCount,
      counts: {
        overdue: scoped.filter(
          (invoice) =>
            invoice.status === "issued" &&
            Boolean(invoice.dueDate) &&
            (invoice.dueDate as number) < now,
        ).length,
        dueSoon: scoped.filter(
          (invoice) =>
            invoice.status === "issued" &&
            Boolean(invoice.dueDate) &&
            (invoice.dueDate as number) >= now &&
            (invoice.dueDate as number) <= now + 7 * DAY_MS,
        ).length,
        drafts: scoped.filter((invoice) => invoice.status === "draft").length,
      },
      modules: {
        inventory: false,
        cheques: false,
        supplierDebts: false,
        journal: false,
      },
    };
  },
});

export const markRead = mutation({
  args: {
    businessId: v.id("businesses"),
    keys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const keys = [...new Set(args.keys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) return { marked: 0 };
    if (keys.length > 100) {
      throw new Error("تعداد اعلان‌های انتخابی بیش از حد مجاز است.");
    }

    const existing = await ctx.db
      .query("notificationReads")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", user._id),
      )
      .collect();
    const existingKeys = new Set(existing.map((row) => row.key));
    const now = Date.now();
    let marked = 0;

    for (const key of keys) {
      if (existingKeys.has(key)) continue;
      await ctx.db.insert("notificationReads", {
        businessId: args.businessId,
        userId: user._id,
        key,
        readAt: now,
      });
      marked += 1;
    }

    return { marked };
  },
});
