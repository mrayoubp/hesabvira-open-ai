import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * These tests execute the real Convex functions against convex-test's in-memory
 * database and authenticated identities. No UI or mocked business logic.
 */
const modules = {
  "../src/convex/_generated/api.ts": () =>
    import("../src/convex/_generated/api"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/accountingDocuments.ts": () =>
    import("../src/convex/accountingDocuments"),
  "../src/convex/accountingReports.ts": () =>
    import("../src/convex/accountingReports"),
  "../src/convex/fiscalClosing.ts": () =>
    import("../src/convex/fiscalClosing"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/dashboard.ts": () => import("../src/convex/dashboard"),
  "../src/convex/invoices.ts": () => import("../src/convex/invoices"),
  "../src/convex/payments.ts": () => import("../src/convex/payments"),
  "../src/convex/transactions.ts": () => import("../src/convex/transactions"),
  "../src/convex/notifications.ts": () =>
    import("../src/convex/notifications"),
  "../src/convex/search.ts": () => import("../src/convex/search"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "مالک تست", email: "owner@test.local" }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { businessId } = await owner.mutation(internal.businesses.seedWorkspace, {});
  const context = await owner.query(api.businesses.context);
  const fiscalYear = context.fiscalYears.find(
    (year) => year.businessId === businessId && year.status === "open",
  );
  const branch = context.branches.find(
    (row) => row.businessId === businessId,
  );
  if (!fiscalYear || !branch) {
    throw new Error("Workspace defaults were not provisioned");
  }
  const accounts = await owner.query(api.accounts.list, {
    businessId,
    includeInactive: true,
  });
  const cash = accounts.find((account) => account.code === "110101");
  const bank = accounts.find((account) => account.code === "110102");
  const capital = accounts.find((account) => account.code === "310101");
  const sales = accounts.find((account) => account.code === "410101");
  const expense = accounts.find((account) => account.code === "520101");
  const ledger = accounts.find((account) => account.code === "11");
  if (!cash || !bank || !capital || !sales || !expense || !ledger) {
    throw new Error("Default chart was not seeded");
  }

  return {
    t,
    owner,
    ownerId,
    businessId: businessId as Id<"businesses">,
    fiscalYearId: fiscalYear._id as Id<"fiscalYears">,
    branchId: branch._id as Id<"branches">,
    accounts,
    cash,
    bank,
    capital,
    sales,
    expense,
    ledger,
  };
}

function line(
  accountId: string,
  debit: number,
  credit: number,
  description = "ردیف تست",
) {
  return {
    accountId: accountId as Id<"accounts">,
    description,
    debit,
    credit,
  };
}

describe("Phase 5 double-entry core", () => {
  test("provisions default chart and rejects duplicate account codes", async () => {
    const s = await setup();
    expect(s.accounts.length).toBeGreaterThan(20);
    expect(s.cash.postable).toBe(true);
    expect(s.ledger.postable).toBe(false);

    await expect(
      s.owner.mutation(api.accounts.create, {
        businessId: s.businessId,
        code: "110101",
        name: "کد تکراری",
        type: "asset",
        nature: "debit",
      }),
    ).rejects.toThrow(/کد حساب/);

    const result = await s.owner.mutation(api.accounts.create, {
      businessId: s.businessId,
      code: "1105",
      name: "صندوق شعبه دوم",
      parentId: s.ledger._id as Id<"accounts">,
      type: "asset",
      nature: "debit",
    });
    expect(result.level).toBe("subsidiary");
    const detail = await s.owner.mutation(api.accounts.create, {
      businessId: s.businessId,
      code: "110501",
      name: "صندوق شعبه دوم - تفصیلی",
      parentId: result.accountId,
      type: "asset",
      nature: "debit",
    });
    expect(detail.level).toBe("detail");
    const accounts = await s.owner.query(api.accounts.list, {
      businessId: s.businessId,
      includeInactive: true,
    });
    expect(accounts.find((row) => row.code === "1105")?.postable).toBe(false);
    expect(accounts.find((row) => row.code === "110501")?.postable).toBe(true);
  });

  test("posts a balanced document and calculates ledger and trial balance", async () => {
    const s = await setup();
    const draft = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "افزایش سرمایه نقدی",
      status: "draft",
      lines: [
        line(s.cash._id, 1_000_000, 0, "ورود نقد"),
        line(s.capital._id, 0, 1_000_000, "سرمایه"),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: draft.documentId,
    });

    const document = await s.owner.query(api.accountingDocuments.get, {
      businessId: s.businessId,
      documentId: draft.documentId,
    });
    expect(document.status).toBe("posted");
    expect(document.totalDebit).toBe(1_000_000);
    expect(document.totalCredit).toBe(1_000_000);

    const ledger = await s.owner.query(api.accountingReports.ledger, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      accountId: s.cash._id as Id<"accounts">,
      from: Date.now() - 24 * 60 * 60 * 1000,
      to: Date.now() + 24 * 60 * 60 * 1000,
    });
    expect(ledger.debit).toBe(1_000_000);
    expect(ledger.credit).toBe(0);
    expect(ledger.closingNet).toBe(1_000_000);
    expect(ledger.rows).toHaveLength(1);

    const trial = await s.owner.query(
      api.accountingReports.trialBalanceReport,
      {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        level: "detail",
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now() + 24 * 60 * 60 * 1000,
      },
    );
    expect(trial.balanced).toBe(true);
    expect(trial.difference).toBe(0);
    expect(trial.totalDebit).toBe(1_000_000);
    expect(trial.totalCredit).toBe(1_000_000);
  });

  test("rejects unbalanced, negative, zero, and non-postable lines", async () => {
    const s = await setup();
    const base = {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "سند نامعتبر",
      status: "draft" as const,
    };

    const unbalanced = await s.owner.mutation(
      api.accountingDocuments.create,
      {
        ...base,
        lines: [
          line(s.cash._id, 100, 0),
          line(s.capital._id, 0, 90),
        ],
      },
    );
    await expect(
      s.owner.mutation(api.accountingDocuments.post, {
        businessId: s.businessId,
        documentId: unbalanced.documentId,
      }),
    ).rejects.toThrow(/متوازن/);
    await expect(
      s.owner.mutation(api.accountingDocuments.submit, {
        businessId: s.businessId,
        documentId: unbalanced.documentId,
      }),
    ).rejects.toThrow(/متوازن/);

    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        ...base,
        lines: [
          line(s.cash._id, -10, 0),
          line(s.capital._id, 0, -10),
        ],
      }),
    ).rejects.toThrow(/منفی/);

    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        ...base,
        lines: [
          line(s.cash._id, 0, 0),
          line(s.capital._id, 0, 0),
        ],
      }),
    ).rejects.toThrow(/بزرگ‌تر از صفر/);

    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        ...base,
        lines: [
          line(s.ledger._id as string, 10, 0),
          line(s.capital._id, 0, 10),
        ],
      }),
    ).rejects.toThrow(/اجازه ثبت مستقیم/);

    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        ...base,
        lines: [line(s.cash._id, 10, 10), line(s.capital._id, 0, 0)],
      }),
    ).rejects.toThrow(/هم‌زمان/);

    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        ...base,
        lines: [],
      }),
    ).rejects.toThrow(/حداقل یک ردیف/);
  });

  test("calculates subsidiary ledger balances and detail breakdown", async () => {
    const s = await setup();
    const subsidiary = s.accounts.find((row) => row.code === "1101");
    if (!subsidiary) throw new Error("subsidiary account missing");
    const created = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "واریز نقدی به صندوق",
      status: "draft",
      lines: [
        line(s.cash._id, 300_000, 0),
        line(s.bank._id, 0, 300_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: created.documentId,
    });

    const report = await s.owner.query(api.accountingReports.subsidiary, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      accountId: subsidiary._id as Id<"accounts">,
      from: Date.now() - 24 * 60 * 60 * 1000,
      to: Date.now() + 24 * 60 * 60 * 1000,
    });
    expect(report.debit).toBe(300_000);
    expect(report.credit).toBe(300_000);
    expect(report.closingNet).toBe(0);
    expect(report.details.find((row) => row._id === s.cash._id)?.debit).toBe(
      300_000,
    );
    expect(report.details.find((row) => row._id === s.bank._id)?.credit).toBe(
      300_000,
    );

    const detail = await s.owner.query(api.accountingReports.subsidiary, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      accountId: subsidiary._id as Id<"accounts">,
      detailAccountId: s.cash._id as Id<"accounts">,
      from: Date.now() - 24 * 60 * 60 * 1000,
      to: Date.now() + 24 * 60 * 60 * 1000,
    });
    expect(detail.selected._id).toBe(s.cash._id as string);
    expect(detail.rows).toHaveLength(1);
    expect(detail.closingNet).toBe(300_000);
  });

  test("posted documents are immutable and reversal preserves history", async () => {
    const s = await setup();
    const created = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "هزینه تست",
      status: "draft",
      lines: [
        line(s.expense._id, 50_000, 0),
        line(s.cash._id, 0, 50_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: created.documentId,
    });

    await expect(
      s.owner.mutation(api.accountingDocuments.updateDraft, {
        businessId: s.businessId,
        documentId: created.documentId,
        branchId: s.branchId,
        documentDate: Date.now(),
        description: "تلاش برای ویرایش قطعی",
        lines: [
          line(s.expense._id, 60_000, 0),
          line(s.cash._id, 0, 60_000),
        ],
      }),
    ).rejects.toThrow(/پیش‌نویس/);
    await expect(
      s.owner.mutation(api.accountingDocuments.removeDraft, {
        businessId: s.businessId,
        documentId: created.documentId,
      }),
    ).rejects.toThrow(/پیش‌نویس/);

    const reversal = await s.owner.mutation(
      api.accountingDocuments.reverse,
      {
        businessId: s.businessId,
        documentId: created.documentId,
        reversalDate: Date.now(),
      },
    );
    const original = await s.owner.query(api.accountingDocuments.get, {
      businessId: s.businessId,
      documentId: created.documentId,
    });
    expect(original.status).toBe("reversed");
    expect(original.linked.reversal?.number).toBe(reversal.number);

    const reversalDoc = await s.owner.query(api.accountingDocuments.get, {
      businessId: s.businessId,
      documentId: reversal.reversalId,
    });
    expect(reversalDoc.status).toBe("posted");
    expect(reversalDoc.totalDebit).toBe(50_000);
    expect(reversalDoc.lines[0]?.credit).toBe(50_000);

    const trial = await s.owner.query(
      api.accountingReports.trialBalanceReport,
      {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        level: "detail",
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now() + 24 * 60 * 60 * 1000,
      },
    );
    expect(trial.difference).toBe(0);
    const expenseRow = trial.rows.find(
      (row) => row.accountId === (s.expense._id as string),
    );
    expect(expenseRow?.closingNet).toBe(0);
  });

  test("posts a correction and reverses the original in one transaction", async () => {
    const s = await setup();
    const original = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "سرمایه اولیه اشتباه",
      status: "draft",
      lines: [
        line(s.cash._id, 100_000, 0),
        line(s.capital._id, 0, 100_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: original.documentId,
    });
    const correction = await s.owner.mutation(
      api.accountingDocuments.createCorrection,
      {
        businessId: s.businessId,
        documentId: original.documentId,
        correctionDate: Date.now(),
        description: "اصلاح مبلغ سرمایه",
      },
    );
    const stillPosted = await s.owner.query(api.accountingDocuments.get, {
      businessId: s.businessId,
      documentId: original.documentId,
    });
    expect(stillPosted.status).toBe("posted");

    await s.owner.mutation(api.accountingDocuments.updateDraft, {
      businessId: s.businessId,
      documentId: correction.correctionId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "اصلاح مبلغ سرمایه",
      lines: [
        line(s.cash._id, 80_000, 0),
        line(s.capital._id, 0, 80_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: correction.correctionId,
    });

    const afterCorrection = await s.owner.query(
      api.accountingDocuments.get,
      { businessId: s.businessId, documentId: original.documentId },
    );
    expect(afterCorrection.status).toBe("reversed");
    expect(afterCorrection.linked.reversal).toBeTruthy();
    const postedCorrection = await s.owner.query(
      api.accountingDocuments.get,
      { businessId: s.businessId, documentId: correction.correctionId },
    );
    expect(postedCorrection.status).toBe("posted");

    const trial = await s.owner.query(
      api.accountingReports.trialBalanceReport,
      {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        level: "detail",
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now() + 24 * 60 * 60 * 1000,
      },
    );
    expect(trial.difference).toBe(0);
    expect(
      trial.rows.find((row) => row.accountId === (s.cash._id as string))
        ?.closingNet,
    ).toBe(80_000);
    expect(
      trial.rows.find((row) => row.accountId === (s.capital._id as string))
        ?.closingNet,
    ).toBe(-80_000);
  });

  test("locks the structure of used accounts and keeps inactive history", async () => {
    const s = await setup();
    const created = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "ثبت نقد برای قفل حساب",
      status: "draft",
      lines: [
        line(s.cash._id, 75_000, 0),
        line(s.capital._id, 0, 75_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: created.documentId,
    });

    await expect(
      s.owner.mutation(api.accounts.update, {
        businessId: s.businessId,
        accountId: s.cash._id as Id<"accounts">,
        code: "110199",
        name: s.cash.name,
        parentId: s.cash.parentId as Id<"accounts">,
        type: s.cash.type,
        nature: s.cash.nature,
      }),
    ).rejects.toThrow(/قابل تغییر نیست/);

    await s.owner.mutation(api.accounts.setActive, {
      businessId: s.businessId,
      accountId: s.cash._id as Id<"accounts">,
      active: false,
    });
    const list = await s.owner.query(api.accounts.list, {
      businessId: s.businessId,
      includeInactive: true,
    });
    expect(list.find((row) => row._id === s.cash._id)?.active).toBe(false);

    const ledger = await s.owner.query(api.accountingReports.ledger, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      accountId: s.cash._id as Id<"accounts">,
      from: Date.now() - 24 * 60 * 60 * 1000,
      to: Date.now() + 24 * 60 * 60 * 1000,
    });
    expect(ledger.closingNet).toBe(75_000);
    expect(ledger.rows).toHaveLength(1);
  });

  test("rejects unauthorized roles and cross-business access", async () => {
    const s = await setup();
    const viewerId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", { name: "بیننده", email: "viewer@test.local" }),
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
    await expect(
      viewer.mutation(api.accountingDocuments.create, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        branchId: s.branchId,
        documentDate: Date.now(),
        description: "تلاش بیننده",
        status: "draft",
        lines: [
          line(s.cash._id, 100, 0),
          line(s.capital._id, 0, 100),
        ],
      }),
    ).rejects.toThrow(/اجازه/);
    await expect(
      viewer.mutation(api.fiscalClosing.close, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
      }),
    ).rejects.toThrow(/مدیر/);

    const outsiderId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", { name: "غریبه", email: "outsider@test.local" }),
    );
    const outsider = s.t.withIdentity({ subject: outsiderId });
    await expect(
      outsider.query(api.accounts.list, { businessId: s.businessId }),
    ).rejects.toThrow(/دسترسی/);

    const outsiderBusiness = await outsider.mutation(
      internal.businesses.seedWorkspace,
      {},
    );
    await expect(
      outsider.query(api.accountingDocuments.list, {
        businessId: s.businessId,
      }),
    ).rejects.toThrow(/دسترسی/);
    expect(outsiderBusiness.businessId).not.toBe(s.businessId);
  });

  test("allocates unique numbers for concurrent document requests", async () => {
    const s = await setup();
    const create = (description: string) =>
      s.owner.mutation(api.accountingDocuments.create, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        branchId: s.branchId,
        documentDate: Date.now(),
        description,
        status: "draft",
        lines: [
          line(s.cash._id, 1000, 0),
          line(s.capital._id, 0, 1000),
        ],
      });
    const [first, second] = await Promise.all([
      create("هم‌زمان ۱"),
      create("هم‌زمان ۲"),
    ]);
    expect(first.number).not.toBe(second.number);
  });

  test("blocks closing with open documents, then closes and opens next year", async () => {
    const s = await setup();
    await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "پیش‌نویس باز",
      status: "draft",
      lines: [
        line(s.cash._id, 100, 0),
        line(s.capital._id, 0, 100),
      ],
    });
    const preview = await s.owner.query(api.fiscalClosing.preview, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
    });
    expect(preview.canClose).toBe(false);
    await expect(
      s.owner.mutation(api.fiscalClosing.close, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
      }),
    ).rejects.toThrow(/پیش‌نویس/);

    const revenue = await s.owner.mutation(api.accountingDocuments.create, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      branchId: s.branchId,
      documentDate: Date.now(),
      description: "فروش نقدی",
      status: "draft",
      lines: [
        line(s.cash._id, 200_000, 0),
        line(s.sales._id, 0, 200_000),
      ],
    });
    await s.owner.mutation(api.accountingDocuments.post, {
      businessId: s.businessId,
      documentId: revenue.documentId,
    });
    const profitable = await s.owner.query(api.fiscalClosing.preview, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
    });
    expect(profitable.netProfitImpact).toBe(200_000);

    const draftDoc = await s.owner.query(api.accountingDocuments.list, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      status: "draft",
    });
    for (const item of draftDoc.items) {
      // Clear the intentional open draft through a balanced correction: post it.
      await s.owner.mutation(api.accountingDocuments.post, {
        businessId: s.businessId,
        documentId: item._id as Id<"accountingDocuments">,
      });
    }

    const closed = await s.owner.mutation(api.fiscalClosing.close, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
    });
    expect(closed.closingNumber).toBeTruthy();
    expect(closed.closingDocumentId).toBeTruthy();

    const afterClose = await s.owner.query(api.fiscalClosing.preview, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
    });
    expect(afterClose.fiscalYear.status).toBe("closed");
    await expect(
      s.owner.mutation(api.accountingDocuments.create, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        branchId: s.branchId,
        documentDate: Date.now(),
        description: "سند در دوره بسته",
        status: "draft",
        lines: [
          line(s.cash._id, 10, 0),
          line(s.capital._id, 0, 10),
        ],
      }),
    ).rejects.toThrow(/بسته/);

    const current = s.t.run(async (ctx) =>
      ctx.db
        .query("fiscalYears")
        .withIndex("by_business", (q) =>
          q.eq("businessId", s.businessId),
        )
        .collect(),
    );
    const prior = (await current).find(
      (year) => year._id === s.fiscalYearId,
    );
    if (!prior) throw new Error("prior fiscal year missing");
    const nextFiscalYearId = await s.t.run(async (ctx) =>
      ctx.db.insert("fiscalYears", {
        businessId: s.businessId,
        name: "سال مالی تست بعدی",
        startAt: prior.endAt + 1,
        endAt: prior.endAt + 365 * 24 * 60 * 60 * 1000,
        status: "open",
        createdAt: Date.now(),
      }),
    );
    const opening = await s.owner.mutation(api.fiscalClosing.createOpening, {
      businessId: s.businessId,
      fiscalYearId: nextFiscalYearId,
    });
    expect(opening.number).toBeTruthy();
    const openingDoc = await s.owner.query(api.accountingDocuments.get, {
      businessId: s.businessId,
      documentId: opening.openingDocumentId,
    });
    expect(openingDoc.kind).toBe("opening");
    expect(openingDoc.status).toBe("posted");
    expect(openingDoc.totalDebit).toBe(openingDoc.totalCredit);
  });
});
