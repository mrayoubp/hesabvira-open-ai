import type { Id } from "../_generated/dataModel";
import type { Doc } from "../_generated/dataModel";

export type ReportRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ReportColumn = {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "date" | "percent" | "doc";
};
export type ReportSummaryItem = {
  key: string;
  label: string;
  value: number | string;
  kind: "money" | "number" | "percent" | "text";
  hint?: string;
};
export type ReportSection = {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow;
  note?: string;
};
export type ReportChartPoint = {
  label: string;
  [key: string]: string | number;
};
export type ReportEvidence = {
  label: string;
  detail: string;
  reportKey?: string;
};
export type ReportPayload = {
  key: string;
  title: string;
  category: string;
  generatedAt: number;
  meta: {
    businessName: string;
    legalName?: string;
    currency: string;
    fiscalYear: string;
    branchName?: string;
    from: number;
    to: number;
    rowCount: number;
    permissions: string[];
  };
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart?: {
    title: string;
    type: "bar" | "line";
    xKey: string;
    series: { key: string; label: string }[];
    data: ReportChartPoint[];
  };
  evidence: ReportEvidence[];
  note?: string;
};

export function moneySection(
  key: string,
  title: string,
  rows: ReportRow[],
  options: { note?: string; extraColumns?: ReportColumn[] } = {},
): ReportSection {
  const columns: ReportColumn[] = [
    { key: "code", label: "کد", kind: "text" },
    { key: "name", label: "عنوان", kind: "text" },
    { key: "amount", label: "مبلغ", kind: "money" },
    ...(options.extraColumns ?? []),
  ];
  return {
    key,
    title,
    columns,
    rows,
    totals: { amount: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) },
    note: options.note,
  };
}

export function emptyTotals(columns: ReportColumn[]): ReportRow {
  const totals: ReportRow = {};
  for (const column of columns) {
    if (column.kind === "money" || column.kind === "number") totals[column.key] = 0;
  }
  return totals;
}

export function sumRows(rows: ReportRow[], keys: string[]): ReportRow {
  const totals: ReportRow = {};
  for (const key of keys) {
    totals[key] = rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  }
  return totals;
}

export function sortRows(
  rows: ReportRow[],
  key: string,
  direction: "asc" | "desc" = "desc",
) {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    return String(left ?? "").localeCompare(String(right ?? ""), "fa") * factor;
  });
}

export function percentage(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export function growth(current: number, previous: number) {
  if (!previous) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

export function normaliseSearch(value: string | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("fa");
}

export function rankMap<T extends Doc<any>>(
  rows: T[],
  id: (row: T) => string,
) {
  return new Map(rows.map((row) => [id(row), row]));
}

export function branchScoped<T extends { branchId?: Id<"branches"> }>(
  rows: T[],
  branchId?: Id<"branches">,
): T[] {
  return branchId ? rows.filter((row) => row.branchId === branchId) : rows;
}

export function scopedInvoices(
  invoices: Doc<"invoices">[],
  from: number,
  to: number,
  branchId?: Id<"branches">,
) {
  return invoices.filter(
    (row) =>
      row.status !== "draft" &&
      row.status !== "void" &&
      row.issueDate >= from &&
      row.issueDate <= to &&
      (!branchId || row.branchId === branchId),
  );
}

export function outstandingInvoice(row: Doc<"invoices">) {
  return Math.max(
    0,
    row.total - (row.returnedAmount ?? 0) - (row.paidAmount ?? 0),
  );
}

export function outstandingPurchase(row: Doc<"purchaseInvoices">) {
  return Math.max(0, row.total - row.paidAmount);
}
