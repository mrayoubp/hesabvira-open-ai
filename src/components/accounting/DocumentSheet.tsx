import type {
  AccountingDocumentKind,
  AccountingDocumentStatus,
} from "@/convex/schema";
import {
  DOCUMENT_KIND_LABELS,
  documentStatusMeta,
} from "@/lib/accounting";
import {
  currencyUnit,
  formatJalali,
  formatJalaliLong,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useState } from "react";

export interface SheetLine {
  key: string;
  accountCode: string;
  accountName: string;
  linkedEntityName?: string | null;
  description: string;
  debit: number;
  credit: number;
}

export function DocumentSheet({
  businessName,
  number,
  documentDate,
  description,
  status,
  kind,
  branchName,
  fiscalYearName,
  createdByName,
  lines,
  currency,
}: {
  businessName: string;
  number: string;
  documentDate: number;
  description: string;
  status: AccountingDocumentStatus;
  kind: AccountingDocumentKind;
  branchName: string;
  fiscalYearName: string;
  createdByName: string;
  lines: SheetLine[];
  currency: string;
}) {
  const [printedAt] = useState(() => Date.now());
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  const meta = documentStatusMeta(status);

  return (
    <div className="print-sheet overflow-hidden rounded-[24px] border border-hairline/70 bg-white text-ink shadow-sm dark:border-white/10 dark:bg-card print:rounded-none print:border-0 print:shadow-none">
      <div className="flex flex-col gap-4 border-b-2 border-brand/20 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-deep text-lg font-black text-cream">
            و
          </span>
          <div>
            <p className="text-sm font-black text-ink">حساب ویرا</p>
            <p className="mt-0.5 text-[10px] text-ink-soft">{businessName}</p>
            <p className="mt-1 text-[9px] text-ink-soft">
              {fiscalYearName} · {branchName}
            </p>
          </div>
        </div>
        <div className="text-start sm:text-end">
          <p className="text-[10px] font-semibold text-gold">
            {DOCUMENT_KIND_LABELS[kind]}
          </p>
          <p className="num mt-1 font-mono text-lg font-bold tracking-wide text-ink" dir="ltr">
            {number}
          </p>
          <p className="num mt-1 text-[10px] text-ink-soft">
            {formatJalaliLong(documentDate)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-b border-hairline/60 bg-[#F7F6F0]/60 px-5 py-3 text-[9px] dark:bg-background/40 sm:grid-cols-4">
        <div>
          <p className="text-ink-soft">وضعیت</p>
          <p className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 font-semibold", meta.badge)}>
            {meta.label}
          </p>
        </div>
        <div>
          <p className="text-ink-soft">شعبه</p>
          <p className="mt-1 font-semibold text-ink">{branchName}</p>
        </div>
        <div>
          <p className="text-ink-soft">تاریخ چاپ</p>
          <p className="num mt-1 font-semibold text-ink">
            {formatJalali(printedAt)}
          </p>
        </div>
        <div>
          <p className="text-ink-soft">ثبت‌کننده</p>
          <p className="mt-1 font-semibold text-ink">{createdByName}</p>
        </div>
      </div>

      <div className="border-b border-hairline/50 px-5 py-3">
        <p className="text-[8px] text-ink-soft">شرح سند</p>
        <p className="mt-1 text-[12px] font-semibold leading-7 text-ink">
          {description}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-[9px]">
          <thead>
            <tr className="bg-brand-deep text-cream">
              <th className="px-2 py-2.5 text-center font-semibold">ردیف</th>
              <th className="px-2 py-2.5 text-start font-semibold">کد حساب</th>
              <th className="px-2 py-2.5 text-start font-semibold">عنوان حساب</th>
              <th className="px-2 py-2.5 text-start font-semibold">تفصیلی</th>
              <th className="px-2 py-2.5 text-start font-semibold">شرح ردیف</th>
              <th className="px-2 py-2.5 text-end font-semibold">
                بدهکار ({currencyUnit(currency)})
              </th>
              <th className="px-2 py-2.5 text-end font-semibold">
                بستانکار ({currencyUnit(currency)})
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={line.key}
                className={cn(
                  "border-b border-hairline/40",
                  index % 2 === 1 && "bg-[#F7F6F0]/40 dark:bg-white/[0.02]",
                )}
              >
                <td className="num px-2 py-2 text-center text-ink-soft">
                  {index + 1}
                </td>
                <td className="num px-2 py-2 font-mono text-ink-soft">
                  {line.accountCode}
                </td>
                <td className="px-2 py-2 font-semibold text-ink">
                  {line.accountName}
                </td>
                <td className="px-2 py-2 text-ink-soft">
                  {line.linkedEntityName ?? "—"}
                </td>
                <td className="px-2 py-2 text-ink-soft">
                  {line.description || "—"}
                </td>
                <td className="num px-2 py-2 text-end font-semibold text-ink">
                  {line.debit ? formatNumber(line.debit) : "—"}
                </td>
                <td className="num px-2 py-2 text-end font-semibold text-ink">
                  {line.credit ? formatNumber(line.credit) : "—"}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-soft">
                  هنوز ردیفی اضافه نشده است.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-brand/30 bg-brand-soft/40 font-bold dark:bg-brand-soft/10">
              <td colSpan={5} className="px-3 py-2.5 text-start text-[10px] text-ink">
                جمع کل
              </td>
              <td className="num px-2 py-2.5 text-end text-[11px] text-ink">
                {formatNumber(totalDebit)}
              </td>
              <td className="num px-2 py-2.5 text-end text-[11px] text-ink">
                {formatNumber(totalCredit)}
              </td>
            </tr>
            <tr className={cn(totalDebit === totalCredit ? "text-brand" : "text-destructive")}>
              <td colSpan={7} className="px-3 py-1.5 text-end text-[8px]">
                {totalDebit === totalCredit
                  ? "سند متوازن است؛ جمع بدهکار و بستانکار برابر است."
                  : `اختلاف: ${formatNumber(Math.abs(totalDebit - totalCredit))} ${currencyUnit(
                      currency,
                    )}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-6 px-5 py-6 text-[9px] text-ink-soft sm:grid-cols-3">
        <div>
          <p className="mb-8 font-semibold">تهیه‌کننده</p>
          <p className="border-t border-dashed border-hairline pt-1">
            {createdByName}
          </p>
        </div>
        <div>
          <p className="mb-8 font-semibold">تأییدکننده</p>
          <p className="border-t border-dashed border-hairline pt-1">—</p>
        </div>
        <div>
          <p className="mb-8 font-semibold">مهر و امضا</p>
          <p className="border-t border-dashed border-hairline pt-1">—</p>
        </div>
      </div>
    </div>
  );
}
