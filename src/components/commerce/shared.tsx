import type {
  InventoryDocumentStatus,
  InventoryDocumentType,
  PurchaseStatus,
} from "@/convex/schema";
import { formatQuantity, formatJalali, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const INVENTORY_TYPE_LABELS: Record<InventoryDocumentType, string> = {
  receipt: "رسید ورود",
  issue: "حواله خروج",
  transfer: "انتقال انبار",
  return_from_customer: "برگشت از مشتری",
  return_to_supplier: "برگشت به تأمین‌کننده",
  adjustment: "اصلاح موجودی",
  count: "انبارگردانی",
};

export const INVENTORY_STATUS_LABELS: Record<InventoryDocumentStatus, string> = {
  draft: "پیش‌نویس",
  posted: "ثبت‌شده",
  cancelled: "لغوشده",
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "پیش‌نویس",
  posted: "ثبت‌شده",
  paid: "تسویه‌شده",
  cancelled: "لغوشده",
};

export function CommercePill({
  label,
  tone = "brand",
}: {
  label: string;
  tone?: "brand" | "gold" | "muted" | "danger" | "mist";
}) {
  const tones = {
    brand: "border-brand/25 bg-brand-soft text-brand",
    gold: "border-gold/35 bg-gold-soft text-[#7a6122] dark:text-gold",
    muted: "border-hairline bg-muted text-ink-soft",
    danger: "border-destructive/25 bg-destructive/5 text-destructive",
    mist: "border-mist bg-mist/50 text-[#2d6470] dark:text-[#a9d5e2]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function printPage(title: string) {
  const previous = document.title;
  document.title = title;
  window.print();
  window.setTimeout(() => {
    document.title = previous;
  }, 500);
}

export function Metric({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "brand" | "gold" | "danger";
}) {
  return (
    <div className="group relative overflow-hidden rounded-[17px] border border-hairline/80 bg-surface p-4 shadow-[0_1px_2px_rgba(24,34,44,0.03),0_16px_38px_-36px_rgba(15,81,63,0.3)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 dark:border-white/[0.08] dark:bg-card">
      <span
        className={cn(
          "absolute inset-x-4 top-0 h-px bg-gradient-to-l from-transparent to-transparent",
          tone === "brand" && "via-brand/40",
          tone === "gold" && "via-gold/50",
          tone === "danger" && "via-destructive/35",
          tone === "ink" && "via-ink/20",
        )}
        aria-hidden
      />
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "brand" && "bg-brand",
            tone === "gold" && "bg-gold",
            tone === "danger" && "bg-destructive",
            tone === "ink" && "bg-ink-soft/50",
          )}
          aria-hidden
        />
        <p className="text-[9px] font-medium text-ink-soft">{label}</p>
      </div>
      <p
        className={cn(
          "num mt-2 truncate text-[18px] font-bold leading-none tracking-[-0.01em]",
          tone === "brand" && "text-brand",
          tone === "gold" && "text-[#9a7a36] dark:text-gold",
          tone === "danger" && "text-destructive",
          tone === "ink" && "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 truncate text-[8px] text-ink-soft/70">{hint}</p>
      ) : null}
    </div>
  );
}

export function Money({ value, currency }: { value: number; currency: string }) {
  return <span className="num">{formatMoney(value, currency)}</span>;
}

export function Qty({ value }: { value: number }) {
  return <span className="num">{formatQuantity(value)}</span>;
}

export function DateText({ value }: { value?: number | null }) {
  return <span className="num">{value ? formatJalali(value) : "—"}</span>;
}

export function NumberText({ value }: { value: number }) {
  return <span className="num">{formatNumber(value)}</span>;
}
