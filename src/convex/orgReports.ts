import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  dayStart,
  employeeName,
  requireAnyPermission,
  requireHrPermission,
} from "./lib/hr";

export const REPORT_KINDS = [
  "personnel",
  "payroll",
  "payroll-by-branch",
  "overtime",
  "leave",
  "attendance",
  "expiring-contracts",
  "tax",
  "fixed-assets",
  "depreciation",
  "employee-loans",
  "branch-performance",
] as const;

type ReportKind = (typeof REPORT_KINDS)[number];

const kind = v.union(
  v.literal("personnel"),
  v.literal("payroll"),
  v.literal("payroll-by-branch"),
  v.literal("overtime"),
  v.literal("leave"),
  v.literal("attendance"),
  v.literal("expiring-contracts"),
  v.literal("tax"),
  v.literal("fixed-assets"),
  v.literal("depreciation"),
  v.literal("employee-loans"),
  v.literal("branch-performance"),
);

type Column = {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "date";
};

const money = (key: string, label: string): Column => ({
  key,
  label,
  kind: "money",
});
const number = (key: string, label: string): Column => ({
  key,
  label,
  kind: "number",
});
const date = (key: string, label: string): Column => ({
  key,
  label,
  kind: "date",
});
const text = (key: string, label: string): Column => ({
  key,
  label,
  kind: "text",
});

function matchesSearch(values: (string | undefined)[], search?: string) {
  if (!search?.trim()) return true;
  const needle = search.trim().toLowerCase();
  return values.join(" ").toLowerCase().includes(needle);
}

export const report = query({
  args: {
    businessId: v.id("businesses"),
    kind,
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
    orgUnitId: v.optional(v.id("organizationalUnits")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const permissionsByKind: Record<
      ReportKind,
      ("hr.view" | "payroll.view" | "tax.view" | "assets.view" | "org.reports.view" | "loans.manage" | "hr.sensitive")[]
    > = {
      personnel: ["hr.view", "org.reports.view"],
      payroll: ["payroll.view", "org.reports.view"],
      "payroll-by-branch": ["payroll.view", "org.reports.view"],
      overtime: ["hr.view", "org.reports.view"],
      leave: ["hr.view", "org.reports.view"],
      attendance: ["hr.view", "org.reports.view"],
      "expiring-contracts": ["hr.view", "org.reports.view"],
      tax: ["tax.view", "org.reports.view"],
      "fixed-assets": ["assets.view", "org.reports.view"],
      depreciation: ["assets.view", "org.reports.view"],
      "employee-loans": ["loans.manage", "payroll.view", "hr.sensitive"],
      "branch-performance": ["org.reports.view"],
    };
    const { permissions } = await requireAnyPermission(
      ctx,
      args.businessId,
      permissionsByKind[args.kind],
    );
    const from = dayStart(args.from);
    const to = dayStart(args.to) + 86_400_000 - 1;

    const [employees, branches, units] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(3000),
      ctx.db
        .query("branches")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect(),
      ctx.db
        .query("organizationalUnits")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect(),
    ]);
    const branchMap = new Map(branches.map((row) => [row._id as string, row]));
    const unitMap = new Map(units.map((row) => [row._id as string, row]));
    const scopedEmployees = employees.filter((employee) => {
      if (args.branchId && employee.branchId !== args.branchId) return false;
      if (args.orgUnitId && employee.orgUnitId !== args.orgUnitId) return false;
      return true;
    });
    const employeeMap = new Map(
      employees.map((employee) => [employee._id as string, employee]),
    );

    if (args.kind === "personnel") {
      const canSensitive = permissions.includes("hr.sensitive");
      const columns: Column[] = [
        text("code", "کد پرسنلی"),
        text("name", "نام"),
        text("jobTitle", "عنوان شغلی"),
        text("branch", "شعبه"),
        text("unit", "واحد"),
        text("employmentType", "نوع قرارداد"),
        text("status", "وضعیت"),
        date("hireDate", "تاریخ استخدام"),
      ];
      if (canSensitive) {
        columns.push(
          text("nationalId", "کد ملی"),
          text("phone", "تلفن"),
          text("bankAccount", "شماره حساب"),
        );
      }
      const rows = scopedEmployees
        .filter((employee) =>
          matchesSearch(
            [
              employee.code,
              employeeName(employee),
              employee.jobTitle,
              employee.nationalId,
              employee.phone,
            ],
            args.search,
          ),
        )
        .map((employee) => {
          const branch = branchMap.get(employee.branchId as string);
          const unit = employee.orgUnitId
            ? unitMap.get(employee.orgUnitId as string)
            : null;
          return {
            code: employee.code,
            name: employeeName(employee),
            jobTitle: employee.jobTitle,
            branch: branch?.name ?? "—",
            unit: unit?.name ?? "—",
            employmentType: employee.employmentType,
            status: employee.status,
            hireDate: employee.hireDate,
            ...(canSensitive
              ? {
                  nationalId: employee.nationalId,
                  phone: employee.phone,
                  bankAccount: employee.bankAccount ?? "—",
                }
              : {}),
          };
        });
      return {
        columns,
        rows,
        totals: { code: `${rows.length} پرسنل` },
      };
    }

    if (args.kind === "payroll" || args.kind === "payroll-by-branch") {
      const periods = await ctx.db
        .query("payrollPeriods")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect();
      const inRange = periods.filter(
        (period) =>
          (period.status === "approved" || period.status === "paid") &&
          period.startAt >= from &&
          period.endAt <= to,
      );
      const periodMap = new Map(inRange.map((period) => [period._id as string, period]));
      const records = (
        await Promise.all(
          inRange.map((period) =>
            ctx.db
              .query("payrollRecords")
              .withIndex("by_period", (q) => q.eq("periodId", period._id))
              .collect(),
          ),
        )
      ).flat();
      const filtered = records.filter((record) => {
        const employee = employeeMap.get(record.employeeId as string);
        if (!employee) return false;
        if (args.branchId && record.branchId !== args.branchId) return false;
        if (args.orgUnitId && record.orgUnitId !== args.orgUnitId) return false;
        return matchesSearch(
          [employee.code, employeeName(employee), employee.jobTitle],
          args.search,
        );
      });
      if (args.kind === "payroll") {
        const columns = [
          text("period", "دوره"),
          text("code", "کد پرسنلی"),
          text("name", "نام"),
          text("branch", "شعبه"),
          money("baseSalary", "حقوق پایه"),
          money("overtimePay", "اضافه‌کاری"),
          money("bonus", "پاداش/پورسانت"),
          money("gross", "جمع حقوق"),
          money("insuranceEmployee", "بیمه کارمند"),
          money("tax", "مالیات"),
          money("loanDeduction", "وام/مساعده"),
          money("otherDeductions", "سایر کسورات"),
          money("net", "خالص پرداختی"),
          money("employerInsurance", "بیمه کارفرما"),
        ];
        const rows = filtered.map((record) => {
          const employee = employeeMap.get(record.employeeId as string)!;
          const period = periodMap.get(record.periodId as string);
          return {
            period: period?.title ?? "—",
            code: employee.code,
            name: employeeName(employee),
            branch: branchMap.get(record.branchId as string)?.name ?? "—",
            baseSalary: record.baseSalary,
            overtimePay: record.overtimePay,
            bonus: record.bonus + record.commission + record.otherEarnings,
            gross: record.gross,
            insuranceEmployee: record.insuranceEmployee,
            tax: record.tax,
            loanDeduction: record.loanDeduction + record.advanceDeduction,
            otherDeductions: record.otherDeductions,
            net: record.net,
            employerInsurance: record.employerInsurance,
          };
        });
        return {
          columns,
          rows,
          totals: {
            gross: rows.reduce((sum, row) => sum + row.gross, 0),
            net: rows.reduce((sum, row) => sum + row.net, 0),
            tax: rows.reduce((sum, row) => sum + row.tax, 0),
            employerInsurance: rows.reduce(
              (sum, row) => sum + row.employerInsurance,
              0,
            ),
          },
        };
      }
      const grouped = new Map<
        string,
        {
          branch: string;
          employeeCount: number;
          gross: number;
          net: number;
          insurance: number;
          tax: number;
        }
      >();
      for (const record of filtered) {
        const branchName =
          branchMap.get(record.branchId as string)?.name ?? "—";
        const entry =
          grouped.get(record.branchId as string) ?? {
            branch: branchName,
            employeeCount: 0,
            gross: 0,
            net: 0,
            insurance: 0,
            tax: 0,
          };
        entry.employeeCount += 1;
        entry.gross += record.gross + record.employerInsurance;
        entry.net += record.net;
        entry.insurance +=
          record.insuranceEmployee + record.employerInsurance;
        entry.tax += record.tax;
        grouped.set(record.branchId as string, entry);
      }
      const rows = [...grouped.values()];
      return {
        columns: [
          text("branch", "شعبه"),
          number("employeeCount", "تعداد فیش"),
          money("gross", "هزینه کل حقوق"),
          money("net", "خالص پرداختی"),
          money("insurance", "بیمه"),
          money("tax", "مالیات"),
        ],
        rows,
        totals: {
          gross: rows.reduce((sum, row) => sum + row.gross, 0),
          net: rows.reduce((sum, row) => sum + row.net, 0),
          tax: rows.reduce((sum, row) => sum + row.tax, 0),
        },
      };
    }

    if (args.kind === "overtime" || args.kind === "attendance") {
      const attendance = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_business_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("date", from)
            .lte("date", to),
        )
        .take(10_000);
      const grouped = new Map<
        string,
        {
          employee: Doc<"employees">;
          days: number;
          work: number;
          overtime: number;
          late: number;
          absence: number;
        }
      >();
      for (const record of attendance) {
        const employee = employeeMap.get(record.employeeId as string);
        if (!employee) continue;
        if (args.branchId && record.branchId !== args.branchId) continue;
        if (args.orgUnitId && employee.orgUnitId !== args.orgUnitId) continue;
        if (
          !matchesSearch(
            [employee.code, employeeName(employee), employee.jobTitle],
            args.search,
          )
        )
          continue;
        const entry =
          grouped.get(employee._id as string) ?? {
            employee,
            days: 0,
            work: 0,
            overtime: 0,
            late: 0,
            absence: 0,
          };
        entry.days += 1;
        entry.work += record.workMinutes;
        entry.overtime += record.overtimeMinutes;
        entry.late += record.lateMinutes;
        entry.absence += record.absenceMinutes;
        grouped.set(employee._id as string, entry);
      }
      const rows = [...grouped.values()]
        .sort((a, b) =>
          employeeName(a.employee).localeCompare(employeeName(b.employee), "fa"),
        )
        .map((row) => ({
          code: row.employee.code,
          name: employeeName(row.employee),
          branch: branchMap.get(row.employee.branchId as string)?.name ?? "—",
          days: row.days,
          hours: Math.round((row.work / 60) * 10) / 10,
          overtimeHours: Math.round((row.overtime / 60) * 10) / 10,
          lateMinutes: row.late,
          absenceHours: Math.round((row.absence / 60) * 10) / 10,
        }));
      const columns =
        args.kind === "overtime"
          ? [
              text("code", "کد پرسنلی"),
              text("name", "نام"),
              text("branch", "شعبه"),
              number("days", "روز ثبت‌شده"),
              number("hours", "ساعت کارکرد"),
              number("overtimeHours", "ساعت اضافه‌کاری"),
              number("lateMinutes", "دقیقه تأخیر"),
              number("absenceHours", "ساعت غیبت"),
            ]
          : [
              text("code", "کد پرسنلی"),
              text("name", "نام"),
              text("branch", "شعبه"),
              number("days", "روز"),
              number("hours", "ساعت کارکرد"),
              number("overtimeHours", "اضافه‌کاری"),
              number("lateMinutes", "تأخیر (دقیقه)"),
              number("absenceHours", "غیبت (ساعت)"),
            ];
      return {
        columns,
        rows,
        totals: {
          days: rows.reduce((sum, row) => sum + row.days, 0),
          hours: rows.reduce((sum, row) => sum + row.hours, 0),
          overtimeHours: rows.reduce((sum, row) => sum + row.overtimeHours, 0),
        },
      };
    }

    if (args.kind === "leave") {
      const requests = await ctx.db
        .query("leaveRequests")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(5000);
      const rows = requests
        .filter(
          (request) =>
            request.endDate >= from &&
            request.startDate <= to &&
            (!args.branchId || request.branchId === args.branchId) &&
            (!args.orgUnitId ||
              employeeMap.get(request.employeeId as string)?.orgUnitId ===
                args.orgUnitId),
        )
        .filter((request) => {
          const employee = employeeMap.get(request.employeeId as string);
          return (
            employee &&
            matchesSearch(
              [employee.code, employeeName(employee), request.reason],
              args.search,
            )
          );
        })
        .map((request) => {
          const employee = employeeMap.get(request.employeeId as string)!;
          return {
            code: employee.code,
            name: employeeName(employee),
            type: request.type,
            startDate: request.startDate,
            endDate: request.endDate,
            days: request.days,
            status: request.status,
            reason: request.reason,
          };
        });
      return {
        columns: [
          text("code", "کد پرسنلی"),
          text("name", "نام"),
          text("type", "نوع مرخصی"),
          date("startDate", "شروع"),
          date("endDate", "پایان"),
          number("days", "روز"),
          text("status", "وضعیت"),
          text("reason", "علت"),
        ],
        rows,
        totals: {
          days: rows.reduce((sum, row) => sum + row.days, 0),
        },
      };
    }

    if (args.kind === "expiring-contracts") {
      const contracts = await ctx.db
        .query("employmentContracts")
        .withIndex("by_business_status", (q) =>
          q.eq("businessId", args.businessId).eq("status", "active"),
        )
        .take(3000);
      const rows = contracts
        .filter(
          (contract) =>
            contract.endDate !== undefined &&
            contract.endDate >= from &&
            contract.endDate <= to &&
            (!args.branchId ||
              employeeMap.get(contract.employeeId as string)?.branchId ===
                args.branchId) &&
            (!args.orgUnitId ||
              employeeMap.get(contract.employeeId as string)?.orgUnitId ===
                args.orgUnitId),
        )
        .filter((contract) => {
          const employee = employeeMap.get(contract.employeeId as string);
          return (
            employee &&
            matchesSearch(
              [employee.code, employeeName(employee), contract.number],
              args.search,
            )
          );
        })
        .map((contract) => {
          const employee = employeeMap.get(contract.employeeId as string)!;
          return {
            number: contract.number,
            code: employee.code,
            name: employeeName(employee),
            branch: branchMap.get(employee.branchId as string)?.name ?? "—",
            startDate: contract.startDate,
            endDate: contract.endDate ?? 0,
            daysLeft: contract.endDate
              ? Math.ceil((contract.endDate - Date.now()) / 86_400_000)
              : 0,
          };
        })
        .sort((a, b) => a.endDate - b.endDate);
      return {
        columns: [
          text("number", "شماره قرارداد"),
          text("code", "کد پرسنلی"),
          text("name", "نام"),
          text("branch", "شعبه"),
          date("endDate", "پایان قرارداد"),
          number("daysLeft", "روز مانده"),
        ],
        rows,
        totals: { daysLeft: rows.length },
      };
    }

    if (args.kind === "tax") {
      const periods = await ctx.db
        .query("taxPeriods")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect();
      const rows = [];
      for (const period of periods) {
        if (period.endAt < from || period.startAt > to) continue;
        const records = await ctx.db
          .query("taxRecords")
          .withIndex("by_business_period", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("periodId", period._id),
          )
          .collect();
        rows.push({
          title: period.title,
          startAt: period.startAt,
          endAt: period.endAt,
          dueDate: period.dueDate,
          status: period.status,
          taxableBase: records.reduce((sum, row) => sum + row.taxableBase, 0),
          tax: records.reduce((sum, row) => sum + row.taxAmount, 0),
          recordCount: records.length,
        });
      }
      return {
        columns: [
          text("title", "دوره مالیاتی"),
          date("startAt", "شروع"),
          date("endAt", "پایان"),
          date("dueDate", "مهلت"),
          text("status", "وضعیت"),
          number("recordCount", "ردیف"),
          money("taxableBase", "مأخذ"),
          money("tax", "مالیات"),
        ],
        rows,
        totals: {
          tax: rows.reduce((sum, row) => sum + row.tax, 0),
          taxableBase: rows.reduce((sum, row) => sum + row.taxableBase, 0),
        },
      };
    }

    if (args.kind === "fixed-assets" || args.kind === "depreciation") {
      const assets = await ctx.db
        .query("fixedAssets")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(3000);
      if (args.kind === "fixed-assets") {
        const rows = [];
        for (const asset of assets) {
          if (args.branchId && asset.branchId !== args.branchId) continue;
          if (
            !matchesSearch(
              [asset.code, asset.name, asset.group, asset.location],
              args.search,
            )
          )
            continue;
          const depreciations = await ctx.db
            .query("assetDepreciations")
            .withIndex("by_business_asset", (q) =>
              q.eq("businessId", args.businessId).eq("assetId", asset._id),
            )
            .collect();
          const accumulated = depreciations.reduce(
            (sum, row) => sum + row.amount,
            0,
          );
          rows.push({
            code: asset.code,
            name: asset.name,
            group: asset.group,
            branch: branchMap.get(asset.branchId as string)?.name ?? "—",
            purchaseDate: asset.purchaseDate,
            cost: asset.cost,
            accumulated,
            bookValue: Math.max(0, asset.cost - accumulated),
            status: asset.status,
          });
        }
        return {
          columns: [
            text("code", "کد دارایی"),
            text("name", "نام"),
            text("group", "گروه"),
            text("branch", "شعبه"),
            date("purchaseDate", "خرید"),
            money("cost", "بهای تمام‌شده"),
            money("accumulated", "استهلاک انباشته"),
            money("bookValue", "ارزش دفتری"),
            text("status", "وضعیت"),
          ],
          rows,
          totals: {
            cost: rows.reduce((sum, row) => sum + row.cost, 0),
            accumulated: rows.reduce((sum, row) => sum + row.accumulated, 0),
            bookValue: rows.reduce((sum, row) => sum + row.bookValue, 0),
          },
        };
      }
      const rows = await ctx.db
        .query("assetDepreciations")
        .withIndex("by_business_asset", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000)
        .then((items) =>
          items.filter(
            (row) =>
              row.periodEnd >= from &&
              row.periodStart <= to &&
              (!args.branchId || row.branchId === args.branchId),
          ),
        );
      const assetMap = new Map(assets.map((asset) => [asset._id as string, asset]));
      const mapped = rows.map((row) => {
        const asset = assetMap.get(row.assetId as string);
        return {
          assetCode: asset?.code ?? "—",
          assetName: asset?.name ?? "—",
          branch: branchMap.get(row.branchId as string)?.name ?? "—",
          periodKey: row.periodKey,
          periodEnd: row.periodEnd,
          amount: row.amount,
          accumulatedAfter: row.accumulatedAfter,
          bookValueAfter: row.bookValueAfter,
        };
      });
      return {
        columns: [
          text("assetCode", "کد دارایی"),
          text("assetName", "نام دارایی"),
          text("branch", "شعبه"),
          text("periodKey", "دوره"),
          date("periodEnd", "تا تاریخ"),
          money("amount", "استهلاک دوره"),
          money("accumulatedAfter", "استهلاک انباشته"),
          money("bookValueAfter", "ارزش دفتری"),
        ],
        rows: mapped,
        totals: {
          amount: mapped.reduce((sum, row) => sum + row.amount, 0),
        },
      };
    }

    if (args.kind === "employee-loans") {
      const loans = await ctx.db
        .query("employeeLoans")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(3000);
      const rows = [];
      for (const loan of loans) {
        const employee = employeeMap.get(loan.employeeId as string);
        if (!employee) continue;
        if (args.branchId && employee.branchId !== args.branchId) continue;
        if (args.orgUnitId && employee.orgUnitId !== args.orgUnitId) continue;
        if (
          !matchesSearch(
            [employee.code, employeeName(employee), loan.description],
            args.search,
          )
        )
          continue;
        const installments = await ctx.db
          .query("loanInstallments")
          .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
          .collect();
        rows.push({
          code: employee.code,
          name: employeeName(employee),
          type: loan.type,
          amount: loan.amount,
          paidAmount: installments
            .filter((row) => row.status !== "pending")
            .reduce((sum, row) => sum + row.amount, 0),
          outstanding: installments
            .filter((row) => row.status === "pending")
            .reduce((sum, row) => sum + row.amount, 0),
          installments: installments.length,
          paidAt: loan.paidAt,
          status: loan.status,
        });
      }
      return {
        columns: [
          text("code", "کد پرسنلی"),
          text("name", "نام"),
          text("type", "نوع"),
          money("amount", "مبلغ"),
          money("paidAmount", "تسویه‌شده"),
          money("outstanding", "مانده"),
          number("installments", "اقساط"),
          date("paidAt", "تاریخ پرداخت"),
          text("status", "وضعیت"),
        ],
        rows,
        totals: {
          amount: rows.reduce((sum, row) => sum + row.amount, 0),
          paidAmount: rows.reduce((sum, row) => sum + row.paidAmount, 0),
          outstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
        },
      };
    }

    const [invoices, purchases, payrollPeriods] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_business_issue", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("issueDate", from)
            .lte("issueDate", to),
        )
        .take(5000),
      ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("issueDate", from)
            .lte("issueDate", to),
        )
        .take(5000),
      ctx.db
        .query("payrollPeriods")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect(),
    ]);
    const payrollRecords = (
      await Promise.all(
        payrollPeriods
          .filter(
            (period) =>
              (period.status === "approved" || period.status === "paid") &&
              period.startAt >= from &&
              period.endAt <= to,
          )
          .map((period) =>
            ctx.db
              .query("payrollRecords")
              .withIndex("by_period", (q) => q.eq("periodId", period._id))
              .collect(),
          ),
      )
    ).flat();
    const branchRows = branches
      .filter((branch) => !branch.archivedAt)
      .filter((branch) => !args.branchId || branch._id === args.branchId)
      .map((branch) => {
        const sales = invoices
          .filter(
            (row) =>
              row.branchId === branch._id &&
              (row.status === "issued" || row.status === "paid"),
          )
          .reduce((sum, row) => sum + row.total - (row.returnedAmount ?? 0), 0);
        const purchase = purchases
          .filter(
            (row) =>
              row.branchId === branch._id &&
              row.kind === "purchase" &&
              row.status !== "draft" &&
              row.status !== "cancelled",
          )
          .reduce((sum, row) => sum + row.total, 0);
        const payrollCost = payrollRecords
          .filter((row) => row.branchId === branch._id)
          .reduce((sum, row) => sum + row.gross + row.employerInsurance, 0);
        return {
          branch: branch.name,
          code: branch.code,
          employeeCount: employees.filter(
            (employee) =>
              employee.branchId === branch._id &&
              employee.status !== "terminated",
          ).length,
          invoiceCount: invoices.filter(
            (row) =>
              row.branchId === branch._id &&
              (row.status === "issued" || row.status === "paid"),
          ).length,
          sales,
          purchase,
          payrollCost,
        };
      })
      .filter((row) => (!args.search ? true : row.branch.includes(args.search)));
    return {
      columns: [
        text("branch", "شعبه"),
        text("code", "کد"),
        number("employeeCount", "پرسنل"),
        number("invoiceCount", "فاکتور فروش"),
        money("sales", "فروش"),
        money("purchase", "خرید"),
        money("payrollCost", "هزینه حقوق"),
      ],
      rows: branchRows,
      totals: {
        sales: branchRows.reduce((sum, row) => sum + row.sales, 0),
        purchase: branchRows.reduce((sum, row) => sum + row.purchase, 0),
        payrollCost: branchRows.reduce((sum, row) => sum + row.payrollCost, 0),
      },
    };
  },
});
