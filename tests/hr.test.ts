import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import type { Id } from "../src/convex/_generated/dataModel";
import { api, internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";
import { timestampToJalali } from "../src/convex/lib/calendar";

const modules = {
  "../src/convex/_generated/api.ts": () => import("../src/convex/_generated/api"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/accountingDocuments.ts": () => import("../src/convex/accountingDocuments"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/finance.ts": () => import("../src/convex/finance"),
  "../src/convex/treasury.ts": () => import("../src/convex/treasury"),
  "../src/convex/hr.ts": () => import("../src/convex/hr"),
  "../src/convex/loans.ts": () => import("../src/convex/loans"),
  "../src/convex/payroll.ts": () => import("../src/convex/payroll"),
  "../src/convex/tax.ts": () => import("../src/convex/tax"),
  "../src/convex/assets.ts": () => import("../src/convex/assets"),
  "../src/convex/orgReports.ts": () => import("../src/convex/orgReports"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/products.ts": () => import("../src/convex/products"),
  "../src/convex/inventory.ts": () => import("../src/convex/inventory"),
  "../src/convex/sales.ts": () => import("../src/convex/sales"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "مدیر سازمان",
      email: `org-${Math.random()}@test.local`,
    }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { businessId } = await owner.mutation(internal.businesses.seedWorkspace, {});
  const context = await owner.query(api.businesses.context);
  const fiscalYear = context.fiscalYears.find(
    (year) => year.businessId === businessId && year.status === "open",
  );
  const branch = context.branches.find((row) => row.businessId === businessId);
  if (!fiscalYear || !branch) throw new Error("Workspace defaults missing");
  return {
    t,
    owner,
    ownerId,
    businessId: businessId as Id<"businesses">,
    fiscalYearId: fiscalYear._id as Id<"fiscalYears">,
    branchId: branch._id as Id<"branches">,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
let nationalSequence = 1000000000;

async function employee(
  s: Setup,
  firstName = "سارا",
  lastName = "احمدی",
  options: { branchId?: Id<"branches">; nationalId?: string } = {},
) {
  nationalSequence += 1;
  const result = await s.owner.mutation(api.hr.createEmployee, {
    businessId: s.businessId,
    firstName,
    lastName,
    nationalId: options.nationalId ?? String(nationalSequence),
    phone: "09121234567",
    email: "employee@test.local",
    hireDate: Date.now() - 90 * 86_400_000,
    jobTitle: "کارشناس",
    branchId: options.branchId ?? s.branchId,
    employmentType: "full_time",
    leaveEntitlementDays: 26,
    bankName: "بانک ملی",
    bankAccount: "1234567890",
    insuranceNumber: "INS-1",
  });
  return result.employeeId as Id<"employees">;
}

async function contract(
  s: Setup,
  employeeId: Id<"employees">,
  baseSalary = 30_000_000,
) {
  const result = await s.owner.mutation(api.hr.createContract, {
    businessId: s.businessId,
    employeeId,
    type: "full_time",
    startDate: Date.now() - 60 * 86_400_000,
    endDate: Date.now() + 180 * 86_400_000,
    baseSalary,
    benefits: 0,
    paymentTerms: "پایان ماه",
  });
  return result.contractId as Id<"employmentContracts">;
}

async function fund(s: Setup, openingBalance = 100_000_000) {
  const result = await s.owner.mutation(api.treasury.createFund, {
    businessId: s.businessId,
    name: "صندوق سازمان",
    openingBalance,
    openingDate: Date.now(),
  });
  return result.cashFundId as Id<"cashFunds">;
}

async function payrollSettings(s: Setup) {
  const jalali = timestampToJalali(Date.now());
  const result = await s.owner.mutation(api.payroll.createSettings, {
    businessId: s.businessId,
    year: jalali.jy,
    jurisdiction: "ایران",
    effectiveFrom: Date.now() - 365 * 86_400_000,
    employeeInsuranceBps: 700,
    employerInsuranceBps: 2300,
    taxExemption: 10_000_000,
    taxBrackets: [
      { upTo: 50_000_000, rateBps: 1000 },
      { upTo: 9_000_000_000_000_000, rateBps: 1500 },
    ],
    housingAllowance: 0,
    foodAllowance: 0,
    overtimeMultiplierBps: 14_000,
    monthlyWorkDays: 30,
    sourceTitle: "تنظیمات آزمایشی با منبع مشخص",
  });
  const settingsId = result.settingsId as Id<"payrollSettings">;
  const periodResult = await s.owner.mutation(api.payroll.createPeriod, {
    businessId: s.businessId,
    year: jalali.jy,
    month: jalali.jm,
    settingsId,
  });
  return {
    settingsId,
    periodId: periodResult.periodId as Id<"payrollPeriods">,
  };
}

async function payrollSetup(s: Setup, baseSalary = 30_000_000) {
  const employeeId = await employee(s);
  await contract(s, employeeId, baseSalary);
  const settings = await payrollSettings(s);
  return { employeeId, ...settings };
}

async function balanced(s: Setup, documentId: Id<"accountingDocuments">) {
  const document = await s.owner.query(api.accountingDocuments.get, {
    businessId: s.businessId,
    documentId,
  });
  const debit = document.lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = document.lines.reduce((sum, line) => sum + line.credit, 0);
  expect(debit).toBe(credit);
  expect(document.totalDebit).toBe(debit);
  return document;
}

async function createAsset(
  s: Setup,
  fundId: Id<"cashFunds">,
  branchId = s.branchId,
  cost = 12_000_000,
) {
  return await s.owner.mutation(api.assets.create, {
    businessId: s.businessId,
    name: "لپ‌تاپ مدیریتی",
    group: "تجهیزات رایانه‌ای",
    branchId,
    location: "دفتر مرکزی",
    purchaseDate: Date.now() - 2 * 86_400_000,
    cost,
    usefulLifeMonths: 12,
    salvageValue: 0,
    method: "straight_line",
    funding: "cash",
    cashFundId: fundId,
  });
}

describe("Phase 8 organisation, payroll, tax and fixed assets", () => {
  test("۱. creates an employee with a unique code and real personnel file", async () => {
    const s = await setup();
    const employeeId = await employee(s, "علی", "رضایی");
    const detail = await s.owner.query(api.hr.employee, {
      businessId: s.businessId,
      employeeId,
    });
    expect(detail.fullName).toBe("علی رضایی");
    expect(detail.code).toStartWith("EMP-");
    expect(detail.nationalId).toHaveLength(10);
    expect(detail.sensitiveVisible).toBe(true);
    expect(detail.jobHistory).toHaveLength(1);
  });

  test("۲. records an employment contract and renews it with history", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const contractId = await contract(s, employeeId, 20_000_000);
    const renewed = await s.owner.mutation(api.hr.renewContract, {
      businessId: s.businessId,
      contractId,
      startDate: Date.now() + 200 * 86_400_000,
      endDate: Date.now() + 500 * 86_400_000,
      baseSalary: 25_000_000,
      benefits: 1_000_000,
      paymentTerms: "ماهانه",
    });
    const rows = await s.owner.query(api.hr.contracts, {
      businessId: s.businessId,
      employeeId,
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "renewed")).toHaveLength(1);
    expect(renewed.contractId).toBeTruthy();
  });

  test("۳. records attendance with real late and overtime minutes", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const date = Date.now() - 86_400_000;
    const result = await s.owner.mutation(api.hr.recordAttendance, {
      businessId: s.businessId,
      employeeId,
      date,
      checkInMinute: 9 * 60,
      checkOutMinute: 18 * 60,
    });
    expect(result.workMinutes).toBe(540);
    expect(result.expectedMinutes).toBe(480);
    expect(result.lateMinutes).toBe(50);
    expect(result.overtimeMinutes).toBe(60);
    const rows = await s.owner.query(api.hr.attendance, {
      businessId: s.businessId,
      from: date,
      to: date,
    });
    expect(rows).toHaveLength(1);
  });

  test("۴. creates a leave request with a real annual balance check", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const start = Date.now() + 2 * 86_400_000;
    const request = await s.owner.mutation(api.hr.createLeaveRequest, {
      businessId: s.businessId,
      employeeId,
      type: "annual",
      startDate: start,
      endDate: start + 2 * 86_400_000,
      reason: "مرخصی خانوادگی",
    });
    expect(request.days).toBe(3);
    let failed = false;
    try {
      await s.owner.mutation(api.hr.createLeaveRequest, {
        businessId: s.businessId,
        employeeId,
        type: "annual",
        startDate: start + 86_400_000,
        endDate: start + 4 * 86_400_000,
        reason: "درخواست هم‌پوشان",
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("۵. approves leave, records history and reduces the remaining balance", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const start = Date.now() + 2 * 86_400_000;
    const request = await s.owner.mutation(api.hr.createLeaveRequest, {
      businessId: s.businessId,
      employeeId,
      type: "annual",
      startDate: start,
      endDate: start + 3 * 86_400_000,
      reason: "سفر",
    });
    await s.owner.mutation(api.hr.decideLeaveRequest, {
      businessId: s.businessId,
      requestId: request.requestId,
      decision: "approved",
      note: "تأیید مدیر",
    });
    const balance = await s.owner.query(api.hr.leaveBalance, {
      businessId: s.businessId,
      employeeId,
      year: undefined,
    });
    expect(balance.used).toBe(4);
    expect(balance.remaining).toBe(22);
    const history = await s.owner.query(api.hr.leaveHistory, {
      businessId: s.businessId,
      requestId: request.requestId,
    });
    expect(history.map((row) => row.toStatus)).toEqual([
      "pending",
      "approved",
    ]);
  });

  test("۶. calculates payroll from contracts, attendance and configurable rates", async () => {
    const s = await setup();
    const setupData = await payrollSetup(s, 30_000_000);
    await s.owner.mutation(api.hr.recordAttendance, {
      businessId: s.businessId,
      employeeId: setupData.employeeId,
      date: Date.now() - 86_400_000,
      checkInMinute: 8 * 60,
      checkOutMinute: 17 * 60,
    });
    const calculation = await s.owner.mutation(api.payroll.calculate, {
      businessId: s.businessId,
      periodId: setupData.periodId,
      adjustments: [
        {
          employeeId: setupData.employeeId,
          bonus: 1_000_000,
          commission: 0,
          otherEarnings: 0,
          otherDeductions: 0,
        },
      ],
    });
    expect(calculation.employeeCount).toBe(1);
    expect(calculation.grossTotal).toBeGreaterThan(30_000_000);
    expect(calculation.employeeInsuranceTotal).toBeGreaterThan(0);
    expect(calculation.taxTotal).toBeGreaterThan(0);
    expect(calculation.netTotal).toBe(
      calculation.grossTotal -
        calculation.employeeInsuranceTotal -
        calculation.taxTotal -
        calculation.loanDeductionTotal -
        calculation.otherDeductionTotal,
    );
  });

  test("۷. issues a payroll payslip with the real component breakdown", async () => {
    const s = await setup();
    const setupData = await payrollSetup(s);
    await s.owner.mutation(api.payroll.calculate, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    const payslip = await s.owner.query(api.payroll.payslip, {
      businessId: s.businessId,
      periodId: setupData.periodId,
      employeeId: setupData.employeeId,
    });
    expect(payslip.employee.name).toContain("سارا");
    expect(payslip.components.length).toBeGreaterThan(3);
    expect(payslip.record.net).toBeGreaterThan(0);
    expect(payslip.businessName).toBeTruthy();
  });

  test("۸. posts one balanced payroll journal and a separate payment journal", async () => {
    const s = await setup();
    const setupData = await payrollSetup(s);
    const fundId = await fund(s);
    await s.owner.mutation(api.payroll.calculate, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    const approved = await s.owner.mutation(api.payroll.approve, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    await balanced(s, approved.accountingDocumentId as Id<"accountingDocuments">);
    const paid = await s.owner.mutation(api.payroll.pay, {
      businessId: s.businessId,
      periodId: setupData.periodId,
      paidAt: Date.now(),
      sourceType: "cash",
      cashFundId: fundId,
    });
    await balanced(s, paid.accountingDocumentId as Id<"accountingDocuments">);
    const detail = await s.owner.query(api.payroll.get, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    expect(detail.period.status).toBe("paid");
    let duplicate = false;
    try {
      await s.owner.mutation(api.payroll.approve, {
        businessId: s.businessId,
        periodId: setupData.periodId,
      });
    } catch {
      duplicate = true;
    }
    expect(duplicate).toBe(true);
  });

  test("۹. records an employee loan, installment schedule and receivable journal", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const fundId = await fund(s);
    const result = await s.owner.mutation(api.loans.create, {
      businessId: s.businessId,
      employeeId,
      type: "loan",
      amount: 10_000_000,
      paidAt: Date.now(),
      installments: 4,
      sourceType: "cash",
      cashFundId: fundId,
    });
    expect(result.count).toBe(4);
    await balanced(s, result.accountingDocumentId as Id<"accountingDocuments">);
    const detail = await s.owner.query(api.loans.get, {
      businessId: s.businessId,
      loanId: result.loanId,
    });
    expect(detail.installments).toHaveLength(4);
    expect(detail.outstanding).toBe(10_000_000);
  });

  test("۱۰. pays a loan installment and reduces the real outstanding debt", async () => {
    const s = await setup();
    const employeeId = await employee(s);
    const fundId = await fund(s);
    const loan = await s.owner.mutation(api.loans.create, {
      businessId: s.businessId,
      employeeId,
      type: "loan",
      amount: 6_000_000,
      paidAt: Date.now(),
      installments: 3,
      sourceType: "cash",
      cashFundId: fundId,
    });
    const detail = await s.owner.query(api.loans.get, {
      businessId: s.businessId,
      loanId: loan.loanId,
    });
    const first = detail.installments[0];
    const payment = await s.owner.mutation(api.loans.payInstallment, {
      businessId: s.businessId,
      installmentId: first._id,
      paidAt: Date.now(),
      sourceType: "cash",
      cashFundId: fundId,
    });
    expect(payment.outstanding).toBe(4_000_000);
    const after = await s.owner.query(api.loans.get, {
      businessId: s.businessId,
      loanId: loan.loanId,
    });
    expect(after.installments[0].status).toBe("paid");
  });

  test("۱۱. creates a fixed asset and posts its balanced purchase journal", async () => {
    const s = await setup();
    const fundId = await fund(s);
    const asset = await createAsset(s, fundId);
    expect(asset.code).toStartWith("FA-");
    await balanced(s, asset.accountingDocumentId as Id<"accountingDocuments">);
    const detail = await s.owner.query(api.assets.get, {
      businessId: s.businessId,
      assetId: asset.assetId,
    });
    expect(detail.cost).toBe(12_000_000);
    expect(detail.bookValue).toBe(12_000_000);
    expect(detail.movements[0].type).toBe("purchase");
  });

  test("۱۲. calculates straight-line depreciation and reduces book value", async () => {
    const s = await setup();
    const fundId = await fund(s);
    const asset = await createAsset(s, fundId);
    const preview = await s.owner.query(api.assets.depreciationPreview, {
      businessId: s.businessId,
      asOf: Date.now(),
    });
    expect(preview.rows[0].amount).toBe(1_000_000);
    const run = await s.owner.mutation(api.assets.runDepreciation, {
      businessId: s.businessId,
      asOf: Date.now(),
    });
    expect(run.count).toBe(1);
    const detail = await s.owner.query(api.assets.get, {
      businessId: s.businessId,
      assetId: asset.assetId,
    });
    expect(detail.accumulated).toBe(1_000_000);
    expect(detail.bookValue).toBe(11_000_000);
    await balanced(s, run.documents[0].accountingDocumentId);
  });

  test("۱۳. creates a branch with manager profile and live assignments", async () => {
    const s = await setup();
    const branch = await s.owner.mutation(api.hr.createBranch, {
      businessId: s.businessId,
      name: "شعبه غرب",
      code: "BR-WEST",
      address: "تهران، غرب",
      phone: "02188776655",
    });
    const managerId = await employee(s, "مدیر", "شعبه", {
      branchId: branch.branchId,
    });
    await s.owner.mutation(api.hr.updateBranch, {
      businessId: s.businessId,
      branchId: branch.branchId,
      managerEmployeeId: managerId,
    });
    const rows = await s.owner.query(api.hr.branches, {
      businessId: s.businessId,
    });
    const created = rows.find((row) => row._id === branch.branchId);
    expect(created?.name).toBe("شعبه غرب");
    expect(created?.employeeCount).toBe(1);
    expect(created?.managerEmployeeId).toBe(managerId);
  });

  test("۱۴. transfers an asset between branches and preserves movement history", async () => {
    const s = await setup();
    const fundId = await fund(s);
    const branch = await s.owner.mutation(api.hr.createBranch, {
      businessId: s.businessId,
      name: "شعبه شرق",
      code: "BR-EAST",
    });
    const asset = await createAsset(s, fundId);
    await s.owner.mutation(api.assets.transfer, {
      businessId: s.businessId,
      assetId: asset.assetId,
      toBranchId: branch.branchId,
      occurredAt: Date.now(),
      description: "انتقال تجهیزات",
    });
    const detail = await s.owner.query(api.assets.get, {
      businessId: s.businessId,
      assetId: asset.assetId,
    });
    expect(detail.branchId).toBe(branch.branchId);
    expect(detail.branchName).toBe("شعبه شرق");
    expect(detail.movements.some((row) => row.type === "transfer")).toBe(true);
  });

  test("۱۵. returns real monthly payroll and branch cost reports", async () => {
    const s = await setup();
    const setupData = await payrollSetup(s, 20_000_000);
    await s.owner.mutation(api.payroll.calculate, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    await s.owner.mutation(api.payroll.approve, {
      businessId: s.businessId,
      periodId: setupData.periodId,
    });
    const report = await s.owner.query(api.orgReports.report, {
      businessId: s.businessId,
      kind: "payroll",
      from: Date.now() - 60 * 86_400_000,
      to: Date.now() + 60 * 86_400_000,
    });
    expect(report.rows).toHaveLength(1);
    expect(Number(report.totals.net)).toBeGreaterThan(0);
    const byBranch = await s.owner.query(api.orgReports.report, {
      businessId: s.businessId,
      kind: "payroll-by-branch",
      from: Date.now() - 60 * 86_400_000,
      to: Date.now() + 60 * 86_400_000,
    });
    expect(byBranch.rows).toHaveLength(1);
    expect(byBranch.rows[0].branch).toBeTruthy();
  });

  test("۱۶. produces a reviewed tax report and blocks unfiled unverified periods", async () => {
    const s = await setup();
    const setting = await s.owner.mutation(api.tax.createSettings, {
      businessId: s.businessId,
      name: "مالیات آزمایشی",
      taxType: "sales",
      jurisdiction: "ایران",
      rateBps: 1000,
      effectiveFrom: Date.now() - 365 * 86_400_000,
      sourceTitle: "منبع رسمی آزمایشی",
    });
    expect(setting.settingsId).toBeTruthy();
    const period = await s.owner.mutation(api.tax.createPeriod, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      title: "دوره مالیاتی آزمایشی",
      startAt: Date.now() - 10 * 86_400_000,
      endAt: Date.now(),
      dueDate: Date.now() + 10 * 86_400_000,
    });
    const record = await s.owner.mutation(api.tax.createRecord, {
      businessId: s.businessId,
      periodId: period.periodId,
      taxType: "sales",
      taxableBase: 100_000_000,
      taxAmount: 10_000_000,
      description: "خلاصه بازبینی‌شده فروش",
      reviewed: true,
    });
    let blocked = false;
    try {
      await s.owner.mutation(api.tax.updatePeriodStatus, {
        businessId: s.businessId,
        periodId: period.periodId,
        status: "filed",
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    await s.owner.mutation(api.tax.updatePeriodStatus, {
      businessId: s.businessId,
      periodId: period.periodId,
      status: "filed",
      confirmReviewed: true,
    });
    const report = await s.owner.query(api.orgReports.report, {
      businessId: s.businessId,
      kind: "tax",
      from: Date.now() - 30 * 86_400_000,
      to: Date.now() + 30 * 86_400_000,
    });
    expect(report.rows).toHaveLength(1);
    expect(Number(report.totals.tax)).toBe(10_000_000);
    void record;
  });

  test("۱۷. hides sensitive personnel data and blocks unauthorized modules", async () => {
    const s = await setup();
    const employeeId = await employee(s, "مریم", "کریمی");
    const accountantId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "حسابدار",
        email: "accountant@test.local",
      }),
    );
    const accountant = s.t.withIdentity({ subject: accountantId });
    await s.t.run(async (ctx) =>
      ctx.db.insert("businessMembers", {
        businessId: s.businessId,
        userId: accountantId,
        role: "accountant",
        permissions: ["hr.view"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const list = await accountant.query(api.hr.employees, {
      businessId: s.businessId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].nationalId).toBeNull();
    expect(list[0].bankAccount).toBeNull();
    let payrollBlocked = false;
    try {
      await accountant.query(api.payroll.settings, {
        businessId: s.businessId,
      });
    } catch {
      payrollBlocked = true;
    }
    expect(payrollBlocked).toBe(true);

    const viewerId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "ناظر",
        email: "viewer@test.local",
      }),
    );
    const viewer = s.t.withIdentity({ subject: viewerId });
    await s.t.run(async (ctx) =>
      ctx.db.insert("businessMembers", {
        businessId: s.businessId,
        userId: viewerId,
        role: "viewer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    let viewerBlocked = false;
    try {
      await viewer.query(api.hr.employee, {
        businessId: s.businessId,
        employeeId,
      });
    } catch {
      viewerBlocked = true;
    }
    expect(viewerBlocked).toBe(true);
  });

  test("۱۸. isolates personnel and payroll data between businesses", async () => {
    const s = await setup();
    const employeeId = await employee(s, "پرسنل کسب‌وکار اول");
    const otherUserId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "مدیر دوم",
        email: "other-org@test.local",
      }),
    );
    const other = s.t.withIdentity({ subject: otherUserId });
    const otherBusiness = await other.mutation(internal.businesses.seedWorkspace, {
      name: "کسب‌وکار دوم",
    });
    const employees = await other.query(api.hr.employees, {
      businessId: otherBusiness.businessId,
    });
    expect(employees).toHaveLength(0);
    let blocked = false;
    try {
      await other.query(api.hr.employee, {
        businessId: otherBusiness.businessId,
        employeeId,
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    let payrollBlocked = false;
    try {
      await other.query(api.payroll.periods, {
        businessId: s.businessId,
      });
    } catch {
      payrollBlocked = true;
    }
    expect(payrollBlocked).toBe(true);
  });
});
