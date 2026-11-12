import type { AccountLevel, AccountNature, AccountType } from "../schema";

/**
 * Pure double-entry math. Kept free of Convex/React so it can be unit-tested
 * directly. Money is integer minor units; no floating point is introduced.
 */

export interface AccountingLineLike {
  accountId: string;
  debit: number;
  credit: number;
}

export interface AccountLike {
  _id: string;
  code: string;
  name: string;
  level: AccountLevel;
  type: AccountType;
  nature: AccountNature;
  parentId?: string;
  active: boolean;
}

export function defaultNature(type: AccountType): AccountNature {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export function documentTotals(lines: AccountingLineLike[]) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += line.debit;
    credit += line.credit;
  }
  return {
    debit,
    credit,
    difference: debit - credit,
    balanced: debit === credit && debit > 0,
  };
}

export function accountBalance(
  lines: AccountingLineLike[],
  accountIds: Set<string>,
) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!accountIds.has(line.accountId)) continue;
    debit += line.debit;
    credit += line.credit;
  }
  return { debit, credit, net: debit - credit };
}

/** Includes the root account and every descendant at any depth. */
export function descendantAccountIds(
  accounts: AccountLike[],
  rootId: string,
): Set<string> {
  const children = new Map<string, AccountLike[]>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const list = children.get(account.parentId) ?? [];
    list.push(account);
    children.set(account.parentId, list);
  }

  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || ids.has(current)) continue;
    ids.add(current);
    for (const child of children.get(current) ?? []) {
      stack.push(child._id);
    }
  }
  return ids;
}

export function compareAccountCode(a: { code: string }, b: { code: string }) {
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  openingNet: number;
  periodDebit: number;
  periodCredit: number;
  closingNet: number;
  debitBalance: number;
  creditBalance: number;
}

/**
 * Rolls all descendant movements into accounts at the requested level.
 * `openingLines` are finalized lines before the report start, `periodLines`
 * are finalized lines inside the report range.
 */
export function trialBalance(
  accounts: AccountLike[],
  openingLines: AccountingLineLike[],
  periodLines: AccountingLineLike[],
  level: AccountLevel,
) {
  const rows: TrialBalanceRow[] = accounts
    .filter((account) => account.level === level)
    .map((account) => {
      const ids = descendantAccountIds(accounts, account._id);
      const opening = accountBalance(openingLines, ids);
      const period = accountBalance(periodLines, ids);
      const closingNet = opening.net + period.net;
      return {
        accountId: account._id,
        code: account.code,
        name: account.name,
        type: account.type,
        nature: account.nature,
        openingNet: opening.net,
        periodDebit: period.debit,
        periodCredit: period.credit,
        closingNet,
        debitBalance: closingNet > 0 ? closingNet : 0,
        creditBalance: closingNet < 0 ? -closingNet : 0,
      };
    })
    .filter(
      (row) =>
        row.periodDebit !== 0 ||
        row.periodCredit !== 0 ||
        row.openingNet !== 0 ||
        row.debitBalance !== 0 ||
        row.creditBalance !== 0 ||
        row.type === "asset" ||
        row.type === "liability" ||
        row.type === "equity",
    )
    .sort(compareAccountCode);

  const totalDebit = rows.reduce((sum, row) => sum + row.periodDebit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.periodCredit, 0);
  const totalDebitBalance = rows.reduce(
    (sum, row) => sum + row.debitBalance,
    0,
  );
  const totalCreditBalance = rows.reduce(
    (sum, row) => sum + row.creditBalance,
    0,
  );

  return {
    rows,
    totalDebit,
    totalCredit,
    totalDebitBalance,
    totalCreditBalance,
    difference: totalDebit - totalCredit,
    closingDifference: totalDebitBalance - totalCreditBalance,
    balanced:
      totalDebit === totalCredit &&
      totalDebitBalance === totalCreditBalance,
  };
}

export interface GeneratedLine {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
}

/**
 * Closing entry: reverse every income/expense detail balance and move the net
 * result to retained earnings. The returned lines are already balanced.
 */
export function buildClosingLines(
  accounts: AccountLike[],
  lines: AccountingLineLike[],
  retainedAccountId: string,
  description = "بستن حساب‌های دوره",
) {
  const result: GeneratedLine[] = [];
  for (const account of accounts) {
    if (account.level !== "detail") continue;
    if (account.type !== "income" && account.type !== "expense") continue;
    const balance = accountBalance(lines, new Set([account._id]));
    if (balance.net === 0) continue;
    if (balance.net > 0) {
      result.push({
        accountId: account._id,
        description,
        debit: 0,
        credit: balance.net,
      });
    } else {
      result.push({
        accountId: account._id,
        description,
        debit: -balance.net,
        credit: 0,
      });
    }
  }

  const movement = documentTotals(result);
  if (movement.debit > movement.credit) {
    result.push({
      accountId: retainedAccountId,
      description: "انتقال سود دوره به سود و زیان انباشته",
      debit: 0,
      credit: movement.debit - movement.credit,
    });
  } else if (movement.credit > movement.debit) {
    result.push({
      accountId: retainedAccountId,
      description: "انتقال زیان دوره به سود و زیان انباشته",
      debit: movement.credit - movement.debit,
      credit: 0,
    });
  }

  return result;
}

/**
 * Opening entry: carry every balance-sheet detail balance into the new fiscal
 * year. Profit/loss accounts are already zeroed by the closing entry.
 */
export function buildOpeningLines(
  accounts: AccountLike[],
  lines: AccountingLineLike[],
  description = "انتقال مانده‌های افتتاحیه",
) {
  const result: GeneratedLine[] = [];
  for (const account of accounts) {
    if (account.level !== "detail") continue;
    if (account.type === "income" || account.type === "expense") continue;
    const balance = accountBalance(lines, new Set([account._id]));
    if (balance.net === 0) continue;
    result.push({
      accountId: account._id,
      description,
      debit: balance.net > 0 ? balance.net : 0,
      credit: balance.net < 0 ? -balance.net : 0,
    });
  }
  return { lines: result, ...documentTotals(result) };
}

export function sanitizeNumberPrefix(input: string | undefined) {
  const value = (input ?? "").trim();
  if (!value) return "JV";
  return value.slice(0, 12);
}

export function formatDocumentNumber(
  prefix: string,
  fiscalYear: number,
  sequence: number,
  padding: number,
) {
  return `${sanitizeNumberPrefix(prefix)}-${fiscalYear}-${String(sequence).padStart(
    Math.min(10, Math.max(3, Math.round(padding))),
    "0",
  )}`;
}
