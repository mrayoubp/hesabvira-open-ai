import type {
  AccountingDocumentKind,
  AccountingDocumentStatus,
  AccountLevel,
  AccountNature,
  AccountType,
} from "@/convex/schema";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "دارایی",
  liability: "بدهی",
  equity: "سرمایه",
  income: "درآمد",
  expense: "هزینه",
};

export const ACCOUNT_LEVEL_LABELS: Record<AccountLevel, string> = {
  group: "گروه حساب",
  ledger: "حساب کل",
  subsidiary: "حساب معین",
  detail: "حساب تفصیلی",
};

export const ACCOUNT_NATURE_LABELS: Record<AccountNature, string> = {
  debit: "بدهکار",
  credit: "بستانکار",
};

export const DOCUMENT_STATUS_META: Record<
  AccountingDocumentStatus,
  { label: string; hint: string; badge: string; dot: string }
> = {
  draft: {
    label: "پیش‌نویس",
    hint: "قابل ویرایش، خارج از دفتر کل",
    badge: "border-hairline bg-muted text-ink-soft",
    dot: "bg-ink-soft/60",
  },
  pending: {
    label: "در انتظار تأیید",
    hint: "متوازن است اما هنوز قطعی نشده",
    badge: "border-gold/40 bg-gold-soft text-[#7a6122] dark:text-gold",
    dot: "bg-gold",
  },
  posted: {
    label: "قطعی",
    hint: "ثبت‌شده در دفتر کل",
    badge: "border-brand/25 bg-brand-soft text-brand",
    dot: "bg-brand",
  },
  reversed: {
    label: "معکوس‌شده",
    hint: "سند اصلی حفظ شده و سند معکوس ثبت شده است",
    badge: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive/70",
  },
};

export const DOCUMENT_KIND_LABELS: Record<AccountingDocumentKind, string> = {
  normal: "سند عادی",
  opening: "سند افتتاحیه",
  closing: "سند اختتامیه",
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

export function documentStatusMeta(status: AccountingDocumentStatus) {
  return DOCUMENT_STATUS_META[status];
}

export function balanceSide(net: number) {
  return {
    amount: Math.abs(net),
    side: net > 0 ? ("debit" as const) : net < 0 ? ("credit" as const) : null,
  };
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = String(value);
  // Spreadsheet formula injection guard for user-provided text.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Excel-compatible CSV with a UTF-8 BOM. Excel opens it directly and keeps
 * Persian text readable. This is deliberately a CSV, not a binary .xlsx.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const content = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Uses the browser's print dialog, where "Save as PDF" produces a real PDF.
 * There is no server-side PDF renderer in this app.
 */
export function printAccountingView(title: string) {
  const previous = document.title;
  document.title = title;
  window.print();
  window.setTimeout(() => {
    document.title = previous;
  }, 500);
}

export function isoDateValue(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timestampFromDateInput(value: string, endOfDay = false) {
  if (!value) return NaN;
  const timestamp = Date.parse(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  return Number.isFinite(timestamp) ? timestamp : NaN;
}
