import { describe, expect, test } from "bun:test";
import {
  buildClosingLines,
  buildOpeningLines,
  documentTotals,
  formatDocumentNumber,
  trialBalance,
  type AccountLike,
} from "../src/convex/lib/accountingMath";

const accounts: AccountLike[] = [
  {
    _id: "group-asset",
    code: "1",
    name: "دارایی",
    level: "group",
    type: "asset",
    nature: "debit",
    active: true,
  },
  {
    _id: "cash",
    code: "110101",
    name: "صندوق",
    level: "detail",
    type: "asset",
    nature: "debit",
    parentId: "group-asset",
    active: true,
  },
  {
    _id: "equity",
    code: "3",
    name: "سرمایه",
    level: "group",
    type: "equity",
    nature: "credit",
    active: true,
  },
  {
    _id: "capital",
    code: "310101",
    name: "سرمایه اولیه",
    level: "detail",
    type: "equity",
    nature: "credit",
    parentId: "equity",
    active: true,
  },
  {
    _id: "retained",
    code: "320101",
    name: "سود و زیان انباشته",
    level: "detail",
    type: "equity",
    nature: "credit",
    parentId: "equity",
    active: true,
  },
  {
    _id: "income",
    code: "4",
    name: "درآمد",
    level: "group",
    type: "income",
    nature: "credit",
    active: true,
  },
  {
    _id: "sales",
    code: "410101",
    name: "فروش",
    level: "detail",
    type: "income",
    nature: "credit",
    parentId: "income",
    active: true,
  },
  {
    _id: "expense",
    code: "5",
    name: "هزینه",
    level: "group",
    type: "expense",
    nature: "debit",
    active: true,
  },
  {
    _id: "rent",
    code: "520101",
    name: "اجاره",
    level: "detail",
    type: "expense",
    nature: "debit",
    parentId: "expense",
    active: true,
  },
];

describe("accounting math", () => {
  test("detects balanced and unbalanced totals", () => {
    expect(
      documentTotals([
        { accountId: "cash", debit: 100, credit: 0 },
        { accountId: "capital", debit: 0, credit: 100 },
      ]),
    ).toEqual({
      debit: 100,
      credit: 100,
      difference: 0,
      balanced: true,
    });
    const unbalanced = documentTotals([
      { accountId: "cash", debit: 100, credit: 0 },
      { accountId: "capital", debit: 0, credit: 90 },
    ]);
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.difference).toBe(10);
  });

  test("trial balance carries opening, period and closing and shows a difference", () => {
    const opening = [
      { accountId: "cash", debit: 100, credit: 0 },
      { accountId: "capital", debit: 0, credit: 100 },
    ];
    const period = [
      { accountId: "cash", debit: 100, credit: 0 },
      { accountId: "sales", debit: 0, credit: 100 },
      { accountId: "rent", debit: 30, credit: 0 },
      { accountId: "cash", debit: 0, credit: 30 },
    ];
    const report = trialBalance(accounts, opening, period, "detail");
    expect(report.balanced).toBe(true);
    expect(report.difference).toBe(0);
    expect(report.rows.find((row) => row.accountId === "cash")).toMatchObject({
      openingNet: 100,
      periodDebit: 100,
      periodCredit: 30,
      closingNet: 170,
    });
    expect(report.rows.find((row) => row.accountId === "sales")).toMatchObject({
      periodCredit: 100,
      closingNet: -100,
    });
    expect(report.rows.find((row) => row.accountId === "rent")).toMatchObject({
      periodDebit: 30,
      closingNet: 30,
    });

    const broken = trialBalance(
      accounts,
      [...opening, { accountId: "cash", debit: 10, credit: 0 }],
      period,
      "detail",
    );
    expect(broken.balanced).toBe(false);
    expect(broken.closingDifference).toBe(10);
  });

  test("closing zeroes profit/loss and transfers net result to retained earnings", () => {
    const lines = [
      { accountId: "cash", debit: 100, credit: 0 },
      { accountId: "sales", debit: 0, credit: 100 },
      { accountId: "rent", debit: 30, credit: 0 },
      { accountId: "cash", debit: 0, credit: 30 },
    ];
    const closing = buildClosingLines(accounts, lines, "retained");
    expect(documentTotals(closing).balanced).toBe(true);
    expect(
      closing.find((row) => row.accountId === "sales")?.debit,
    ).toBe(100);
    expect(closing.find((row) => row.accountId === "rent")?.credit).toBe(30);
    expect(closing.find((row) => row.accountId === "retained")?.credit).toBe(
      70,
    );

    const afterClosing = buildOpeningLines(accounts, [
      { accountId: "cash", debit: 170, credit: 0 },
      { accountId: "capital", debit: 0, credit: 100 },
      { accountId: "retained", debit: 0, credit: 70 },
    ]);
    expect(afterClosing.balanced).toBe(true);
    expect(afterClosing.debit).toBe(170);
    expect(afterClosing.credit).toBe(170);
  });

  test("formats document numbers with a bounded unique padding", () => {
    expect(formatDocumentNumber("JV", 1405, 7, 4)).toBe("JV-1405-0007");
    expect(formatDocumentNumber("", 1404, 1, 99)).toBe("JV-1404-0000000001");
  });
});
