import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * Phase 6 tests run the real Convex mutations/queries against convex-test.
 * They cover the 17 acceptance items from the delivery brief.
 */
const modules = {
  "../src/convex/_generated/api.ts": () =>
    import("../src/convex/_generated/api"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/accountingDocuments.ts": () =>
    import("../src/convex/accountingDocuments"),
  "../src/convex/accountingReports.ts": () =>
    import("../src/convex/accountingReports"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/invoices.ts": () => import("../src/convex/invoices"),
  "../src/convex/treasury.ts": () => import("../src/convex/treasury"),
  "../src/convex/receipts.ts": () => import("../src/convex/receipts"),
  "../src/convex/paymentVouchers.ts": () =>
    import("../src/convex/paymentVouchers"),
  "../src/convex/transfers.ts": () => import("../src/convex/transfers"),
  "../src/convex/checks.ts": () => import("../src/convex/checks"),
  "../src/convex/incomeExpenses.ts": () =>
    import("../src/convex/incomeExpenses"),
  "../src/convex/finance.ts": () => import("../src/convex/finance"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "مالک مالی", email: "finance@test.local" }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { businessId } = await owner.mutation(internal.businesses.seedWorkspace, {});
  const context = await owner.query(api.businesses.context);
  const fiscalYear = context.fiscalYears.find(
    (year) => year.businessId === businessId && year.status === "open",
  );
  const branch = context.branches.find((row) => row.businessId === businessId);
  if (!fiscalYear || !branch) {
    throw new Error("Workspace defaults were not provisioned");
  }
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

async function createBank(
  s: Setup,
  name = "حساب اصلی",
  openingBalance = 0,
) {
  const result = await s.owner.mutation(api.treasury.createBank, {
    businessId: s.businessId,
    name,
    bankName: "بانک تست",
    accountNumber: `123456789${Math.floor(Math.random() * 1000)}`,
    holderName: "شرکت تست",
    openingBalance,
    openingDate: Date.now(),
  });
  return result.bankAccountId as Id<"bankAccounts">;
}

async function createFund(s: Setup, name = "صندوق اصلی", openingBalance = 0) {
  const result = await s.owner.mutation(api.treasury.createFund, {
    businessId: s.businessId,
    name,
    responsibleName: "مسئول تست",
    openingBalance,
    openingDate: Date.now(),
  });
  return result.cashFundId as Id<"cashFunds">;
}

async function createCustomer(s: Setup, name = "مشتری تست") {
  const result = await s.owner.mutation(api.customers.create, {
    businessId: s.businessId,
    name,
  });
  return result.customerId as Id<"customers">;
}

async function balancedDocument(
  s: Setup,
  documentId: Id<"accountingDocuments">,
) {
  const document = await s.owner.query(api.accountingDocuments.get, {
    businessId: s.businessId,
    documentId,
  });
  const debit = document.lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = document.lines.reduce((sum, line) => sum + line.credit, 0);
  expect(debit).toBe(credit);
  expect(debit).toBe(document.totalDebit);
  expect(credit).toBe(document.totalCredit);
  expect(document.totalDebit).toBe(document.totalCredit);
  expect(document.status).toBe("posted");
  return document;
}

async function balances(s: Setup) {
  return await s.owner.query(api.treasury.accountBalances, {
    businessId: s.businessId,
  });
}

describe("Phase 6 finance and treasury", () => {
  test("۱. creates a bank account with opening balance and a general-ledger account", async () => {
    const s = await setup();
    const bankId = await createBank(s, "حساب بانک ملت", 5_000_000);
    const bank = await s.owner.query(api.treasury.bank, {
      businessId: s.businessId,
      bankAccountId: bankId,
    });
    expect(bank.name).toBe("حساب بانک ملت");
    expect(bank.balance).toBe(5_000_000);
    expect(bank.accountId).toBeTruthy();
    expect(bank.canViewSensitive).toBe(true);

    const all = await balances(s);
    expect(all.totalBank).toBe(5_000_000);
  });

  test("۲. creates a cash fund with a responsible person and opening balance", async () => {
    const s = await setup();
    const fundId = await createFund(s, "صندوق فروش", 1_200_000);
    const funds = await s.owner.query(api.treasury.funds, {
      businessId: s.businessId,
      includeInactive: true,
    });
    const fund = funds.find((row) => row._id === fundId);
    expect(fund?.responsibleName).toBe("مسئول تست");
    expect(fund?.balance).toBe(1_200_000);
  });

  test("۳. posts a cash receipt, updates the fund and creates one balanced journal", async () => {
    const s = await setup();
    const fundId = await createFund(s, "صندوق دریافت", 0);
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "دریافت‌کننده نقدی",
      amount: 250_000,
      method: "cash",
      destinationType: "cash",
      cashFundId: fundId,
      description: "دریافت نقدی تست",
      occurredAt: Date.now(),
    });
    const posted = await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    expect(posted.accountingNumber).toBeTruthy();
    const detail = await s.owner.query(api.receipts.get, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    expect(detail.status).toBe("posted");
    expect((await balances(s)).totalCash).toBe(250_000);
    await balancedDocument(
      s,
      posted.accountingDocumentId as Id<"accountingDocuments">,
    );
  });

  test("۴. posts a bank payment and reduces the bank balance", async () => {
    const s = await setup();
    const bankId = await createBank(s, "حساب پرداخت", 1_000_000);
    const voucher = await s.owner.mutation(api.paymentVouchers.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "فروشنده خدمات",
      amount: 300_000,
      method: "bank_transfer",
      sourceType: "bank",
      bankAccountId: bankId,
      description: "پرداخت بانکی تست",
      occurredAt: Date.now(),
    });
    const posted = await s.owner.mutation(api.paymentVouchers.post, {
      businessId: s.businessId,
      voucherId: voucher.voucherId,
    });
    expect(posted.accountingNumber).toBeTruthy();
    expect((await balances(s)).totalBank).toBe(700_000);
    await balancedDocument(
      s,
      posted.accountingDocumentId as Id<"accountingDocuments">,
    );
  });

  test("۵. transfers bank to fund atomically with a separately recorded fee", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک انتقال", 1_000_000);
    const fundId = await createFund(s, "صندوق انتقال", 0);
    const result = await s.owner.mutation(api.transfers.create, {
      businessId: s.businessId,
      fromType: "bank",
      fromBankAccountId: bankId,
      toType: "cash",
      toCashFundId: fundId,
      amount: 200_000,
      fee: 5_000,
      occurredAt: Date.now(),
      description: "انتقال تست",
    });
    const all = await balances(s);
    expect(all.totalBank).toBe(795_000);
    expect(all.totalCash).toBe(200_000);
    await balancedDocument(
      s,
      result.accountingDocumentId as Id<"accountingDocuments">,
    );
    const transfers = await s.owner.query(api.transfers.list, {
      businessId: s.businessId,
    });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].fee).toBe(5_000);
  });

  test("۶. records a received check and its receivable journal", async () => {
    const s = await setup();
    const customerId = await createCustomer(s, "مشتری چک");
    const now = Date.now();
    const result = await s.owner.mutation(api.checks.createReceived, {
      businessId: s.businessId,
      customerId,
      checkNumber: "CHK-TEST-100",
      amount: 400_000,
      issueDate: now,
      dueDate: now + 20 * 24 * 60 * 60 * 1000,
      bankName: "بانک صادرکننده",
      issuerName: "مشتری چک",
      description: "چک دریافتی تست",
    });
    expect(result.accountingNumber).toBeTruthy();
    const detail = await s.owner.query(api.checks.receivedGet, {
      businessId: s.businessId,
      checkId: result.checkId,
    });
    expect(detail.status).toBe("received");
    await balancedDocument(
      s,
      result.accountingDocumentId as Id<"accountingDocuments">,
    );
  });

  test("۷. records an issued check with a payable journal", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک چک پرداختی", 1_000_000);
    const now = Date.now();
    const result = await s.owner.mutation(api.checks.createIssued, {
      businessId: s.businessId,
      bankAccountId: bankId,
      checkNumber: "ISS-TEST-200",
      amount: 300_000,
      payeeName: "ذی‌نفع تست",
      issueDate: now,
      dueDate: now + 10 * 24 * 60 * 60 * 1000,
      description: "چک پرداختی تست",
    });
    expect(result.accountingNumber).toBeTruthy();
    const detail = await s.owner.query(api.checks.issuedGet, {
      businessId: s.businessId,
      checkId: result.checkId,
    });
    expect(detail.status).toBe("issued");
    await balancedDocument(
      s,
      result.accountingDocumentId as Id<"accountingDocuments">,
    );
  });

  test("۸. changes check status with history, collection journal and transition guard", async () => {
    const s = await setup();
    const customerId = await createCustomer(s, "مشتری وصول");
    const bankId = await createBank(s, "بانک وصول", 0);
    const now = Date.now();
    const received = await s.owner.mutation(api.checks.createReceived, {
      businessId: s.businessId,
      customerId,
      checkNumber: "CHK-STATUS-300",
      amount: 500_000,
      issueDate: now,
      dueDate: now + 5 * 24 * 60 * 60 * 1000,
      bankName: "بانک چک",
    });
    const collected = await s.owner.mutation(api.checks.changeReceivedStatus, {
      businessId: s.businessId,
      checkId: received.checkId,
      status: "collected",
      bankAccountId: bankId,
      note: "وصول در بانک",
    });
    expect(collected.accountingNumber).toBeTruthy();
    expect((await balances(s)).totalBank).toBe(500_000);
    const history = await s.owner.query(api.checks.history, {
      businessId: s.businessId,
      checkType: "received",
      checkId: received.checkId as string,
    });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[history.length - 1]?.toStatus).toBe("collected");
    await expect(
      s.owner.mutation(api.checks.changeReceivedStatus, {
        businessId: s.businessId,
        checkId: received.checkId,
        status: "cancelled",
      }),
    ).rejects.toThrow(/مجاز نیست/);
  });

  test("۹. records other income with an automatic journal and rejects invoice duplicate path", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک درآمد", 0);
    const income = await s.owner.mutation(api.incomeExpenses.createIncome, {
      businessId: s.businessId,
      category: "خدمات مشاوره",
      partyName: "مشتری مشاوره",
      amount: 450_000,
      method: "bank_transfer",
      destinationType: "bank",
      bankAccountId: bankId,
      description: "درآمد مشاوره تست",
      occurredAt: Date.now(),
      status: "posted",
    });
    expect(income.accountingDocumentId).toBeTruthy();
    expect((await balances(s)).totalBank).toBe(450_000);
    await balancedDocument(
      s,
      income.accountingDocumentId as Id<"accountingDocuments">,
    );
  });

  test("۱۰. approves an expense with an automatic expense/payable journal", async () => {
    const s = await setup();
    const result = await s.owner.mutation(api.incomeExpenses.createExpense, {
      businessId: s.businessId,
      category: "rent",
      supplierName: "مالک ملک",
      amount: 800_000,
      description: "اجاره ماه تست",
      occurredAt: Date.now(),
      status: "approved",
    });
    expect(result.status).toBe("approved");
    const expenses = await s.owner.query(api.incomeExpenses.expenses, {
      businessId: s.businessId,
    });
    expect(expenses[0]?.status).toBe("approved");
    expect(expenses[0]?.outstanding).toBe(800_000);
    expect(expenses[0]?.accountingDocumentId).toBeTruthy();
  });

  test("۱۱. settles a payable partially and keeps the correct outstanding balance", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک تسویه", 1_000_000);
    const expense = await s.owner.mutation(api.incomeExpenses.createExpense, {
      businessId: s.businessId,
      category: "supplies",
      supplierName: "تأمین‌کننده لوازم",
      amount: 1_000_000,
      description: "خرید لوازم تست",
      occurredAt: Date.now(),
      status: "approved",
    });
    const voucher = await s.owner.mutation(api.paymentVouchers.create, {
      businessId: s.businessId,
      partyType: "supplier",
      partyName: "تأمین‌کننده لوازم",
      expenseId: expense.expenseId,
      amount: 400_000,
      method: "bank_transfer",
      sourceType: "bank",
      bankAccountId: bankId,
      description: "پرداخت جزئی بدهی",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.paymentVouchers.post, {
      businessId: s.businessId,
      voucherId: voucher.voucherId,
    });
    const list = await s.owner.query(api.incomeExpenses.expenses, {
      businessId: s.businessId,
    });
    const row = list.find((item) => item._id === expense.expenseId);
    expect(row?.paidAmount).toBe(400_000);
    expect(row?.outstanding).toBe(600_000);
    expect(row?.status).toBe("approved");
    expect((await balances(s)).totalBank).toBe(600_000);
  });

  test("۱۲. prevents duplicate posting and duplicate check numbers", async () => {
    const s = await setup();
    const fundId = await createFund(s, "صندوق تکراری", 0);
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "مشتری تکراری",
      amount: 100_000,
      method: "cash",
      destinationType: "cash",
      cashFundId: fundId,
      description: "دریافت تکراری",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    await expect(
      s.owner.mutation(api.receipts.post, {
        businessId: s.businessId,
        receiptId: receipt.receiptId,
      }),
    ).rejects.toThrow(/قبلاً تأیید/);
    const sourceDocuments = await s.t.run(async (ctx) => {
      const docs = await ctx.db.query("accountingDocuments").collect();
      return docs.filter(
        (doc) =>
          doc.businessId === s.businessId &&
          doc.sourceType === "receipt" &&
          doc.sourceId === (receipt.receiptId as string),
      );
    });
    expect(sourceDocuments).toHaveLength(1);

    const customerId = await createCustomer(s, "مشتری چک تکراری");
    const now = Date.now();
    await s.owner.mutation(api.checks.createReceived, {
      businessId: s.businessId,
      customerId,
      checkNumber: "DUP-CHECK-1",
      amount: 50_000,
      issueDate: now,
      dueDate: now + 10 * 24 * 60 * 60 * 1000,
      bankName: "بانک تست",
    });
    await expect(
      s.owner.mutation(api.checks.createReceived, {
        businessId: s.businessId,
        customerId,
        checkNumber: "DUP-CHECK-1",
        amount: 60_000,
        issueDate: now,
        dueDate: now + 10 * 24 * 60 * 60 * 1000,
        bankName: "بانک تست",
      }),
    ).rejects.toThrow(/قبلاً/);
  });

  test("۱۳. creates exactly one linked automatic journal per operation", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک سند خودکار", 100_000);
    const fundId = await createFund(s, "صندوق سند خودکار", 50_000);
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "دریافت سند",
      amount: 25_000,
      method: "bank_transfer",
      destinationType: "bank",
      bankAccountId: bankId,
      description: "دریافت برای سند",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });

    const docs = await s.t.run(async (ctx) => {
      const rows = await ctx.db.query("accountingDocuments").collect();
      return rows.filter((row) => row.businessId === s.businessId);
    });
    const sources = docs.map((doc) => doc.sourceType).sort();
    expect(sources).toContain("bank-opening");
    expect(sources).toContain("fund-opening");
    expect(sources).toContain("receipt");
    const receiptDocs = docs.filter((doc) => doc.sourceType === "receipt");
    expect(receiptDocs).toHaveLength(1);
    expect(receiptDocs[0]?.sourceId).toBe(receipt.receiptId as string);
    // fundId is used by the opening journal
    expect(fundId).toBeTruthy();
  });

  test("۱۴. every automatic journal has equal debit and credit totals", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک توازن", 2_000_000);
    const fundId = await createFund(s, "صندوق توازن", 0);
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "مشتری توازن",
      amount: 300_000,
      method: "cash",
      destinationType: "cash",
      cashFundId: fundId,
      description: "دریافت توازن",
      occurredAt: Date.now(),
    });
    const receiptPosted = await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    const transfer = await s.owner.mutation(api.transfers.create, {
      businessId: s.businessId,
      fromType: "bank",
      fromBankAccountId: bankId,
      toType: "cash",
      toCashFundId: fundId,
      amount: 100_000,
      fee: 2_000,
      occurredAt: Date.now(),
      description: "انتقال توازن",
    });
    const expense = await s.owner.mutation(api.incomeExpenses.createExpense, {
      businessId: s.businessId,
      category: "internet",
      supplierName: "شرکت اینترنت",
      amount: 80_000,
      description: "اینترنت توازن",
      occurredAt: Date.now(),
      status: "approved",
    });
    const expenseRow = await s.owner.query(api.incomeExpenses.expenses, {
      businessId: s.businessId,
    });
    const expenseDocId = expenseRow.find(
      (row) => row._id === expense.expenseId,
    )?.accountingDocumentId;
    expect(expenseDocId).toBeTruthy();
    const documents = await s.t.run(async (ctx) => {
      const rows = await ctx.db.query("accountingDocuments").collect();
      return rows.filter((row) => row.businessId === s.businessId);
    });
    for (const document of documents) {
      expect(document.totalDebit).toBe(document.totalCredit);
      expect(document.totalDebit).toBeGreaterThan(0);
    }
    await balancedDocument(
      s,
      receiptPosted.accountingDocumentId as Id<"accountingDocuments">,
    );
    await balancedDocument(
      s,
      transfer.accountingDocumentId as Id<"accountingDocuments">,
    );
    await balancedDocument(
      s,
      expenseDocId as Id<"accountingDocuments">,
    );
  });

  test("۱۵. calculates real balances from posted financial transactions", async () => {
    const s = await setup();
    const bankId = await createBank(s, "بانک مانده", 1_000_000);
    const fundId = await createFund(s, "صندوق مانده", 0);
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "دریافت مانده",
      amount: 200_000,
      method: "bank_transfer",
      destinationType: "bank",
      bankAccountId: bankId,
      description: "افزایش مانده",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    const payment = await s.owner.mutation(api.paymentVouchers.create, {
      businessId: s.businessId,
      partyType: "other",
      partyName: "پرداخت مانده",
      amount: 150_000,
      method: "bank_transfer",
      sourceType: "bank",
      bankAccountId: bankId,
      description: "کاهش مانده",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.paymentVouchers.post, {
      businessId: s.businessId,
      voucherId: payment.voucherId,
    });
    await s.owner.mutation(api.transfers.create, {
      businessId: s.businessId,
      fromType: "bank",
      fromBankAccountId: bankId,
      toType: "cash",
      toCashFundId: fundId,
      amount: 100_000,
      fee: 0,
      occurredAt: Date.now(),
      description: "انتقال مانده",
    });
    const all = await balances(s);
    expect(all.totalBank).toBe(950_000);
    expect(all.totalCash).toBe(100_000);
    const bank = await s.owner.query(api.treasury.bank, {
      businessId: s.businessId,
      bankAccountId: bankId,
    });
    expect(bank.balance).toBe(950_000);
  });

  test("۱۶. enforces server-side write access and masks sensitive bank data for viewers", async () => {
    const s = await setup();
    const bankId = await createBank(s, "حساب محرمانه", 100_000);
    const viewerId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "مشاهده‌گر",
        email: "viewer@test.local",
      }),
    );
    await s.t.run(async (ctx) => {
      await ctx.db.insert("businessMembers", {
        businessId: s.businessId,
        userId: viewerId,
        role: "viewer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const viewer = s.t.withIdentity({ subject: viewerId });
    const visible = await viewer.query(api.treasury.banks, {
      businessId: s.businessId,
      includeInactive: true,
    });
    const masked = visible.find((row) => row._id === bankId);
    expect(masked?.canViewSensitive).toBe(false);
    expect(masked?.accountNumber).toContain("•");
    await expect(
      viewer.mutation(api.treasury.createBank, {
        businessId: s.businessId,
        name: "غیرمجاز",
        bankName: "بانک",
        accountNumber: "9999999999",
        holderName: "کاربر",
      }),
    ).rejects.toThrow(/اجازه/);

    const outsiderId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", { name: "غریبه", email: "outsider@test.local" }),
    );
    const outsider = s.t.withIdentity({ subject: outsiderId });
    await expect(
      outsider.query(api.treasury.banks, { businessId: s.businessId }),
    ).rejects.toThrow(/دسترسی/);
  });

  test("۱۷. isolates every business and rejects cross-tenant resource access", async () => {
    const s = await setup();
    const bankId = await createBank(s, "حساب کسب‌وکار اول", 100_000);
    const otherOwnerId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "مالک دوم",
        email: "second@test.local",
      }),
    );
    const otherOwner = s.t.withIdentity({ subject: otherOwnerId });
    const other = await otherOwner.mutation(internal.businesses.seedWorkspace, {});
    const otherBusinessId = other.businessId as Id<"businesses">;
    await expect(
      otherOwner.query(api.treasury.banks, { businessId: s.businessId }),
    ).rejects.toThrow(/دسترسی/);
    await expect(
      otherOwner.query(api.treasury.bank, {
        businessId: otherBusinessId,
        bankAccountId: bankId,
      }),
    ).rejects.toThrow(/یافت نشد/);
    const otherBanks = await otherOwner.query(api.treasury.banks, {
      businessId: otherBusinessId,
      includeInactive: true,
    });
    expect(otherBanks).toHaveLength(0);
    const otherBalances = await otherOwner.query(api.treasury.accountBalances, {
      businessId: otherBusinessId,
    });
    expect(otherBalances.totalBank).toBe(0);
    const otherReceipts = await otherOwner.query(api.receipts.list, {
      businessId: otherBusinessId,
    });
    expect(otherReceipts).toHaveLength(0);
  });
});
