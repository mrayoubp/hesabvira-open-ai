import { StatusBadge } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { printPage } from "@/components/commerce/shared";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { InvoiceStatus } from "@/convex/schema";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatJalaliLong,
  formatMoney,
  formatNumber,
  formatQuantity,
  INVOICE_STATUS_META,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  Ban,
  CheckCircle2,
  HandCoins,
  Loader2,
  Printer,
  ReceiptText,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

export function InvoiceDetailDialog({
  open,
  onOpenChange,
  businessId,
  invoiceId,
  currency,
  businessName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  invoiceId: string | null;
  currency: string;
  businessName?: string;
}) {
  const invoice = useQuery(
    api.invoices.get,
    businessId && invoiceId
      ? {
          businessId,
          invoiceId: invoiceId as Id<"invoices">,
        }
      : "skip",
  );
  const setStatus = useMutation(api.invoices.setStatus);
  const [pending, setPending] = useState<InvoiceStatus | null>(null);
  const unit = currencyUnit(currency);

  const changeStatus = async (status: InvoiceStatus) => {
    if (!businessId || !invoiceId) return;
    setPending(status);
    try {
      await setStatus({
        businessId,
        invoiceId: invoiceId as Id<"invoices">,
        status,
      });
      toast.success(
        status === "issued"
          ? "فاکتور صادر شد و در مطالبات ثبت شد."
          : status === "paid"
            ? "فاکتور به‌عنوان پرداخت‌شده ثبت شد."
            : "فاکتور ابطال شد. ردپای سند حفظ می‌شود.",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl print:max-h-none print:overflow-visible">
        <DialogHeader className="border-b border-hairline/60 pb-4 text-start">
          <span className="text-[8px] font-semibold tracking-[0.15em] text-gold">
            فاکتور فروش · سند رسمی
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="font-mono text-[18px]" dir="ltr">
              {invoice?.number ?? "…"}
            </DialogTitle>
            {invoice ? <StatusBadge status={invoice.status} /> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto h-8 gap-1.5"
              onClick={() =>
                printPage(
                  invoice?.number
                    ? `فاکتور فروش ${invoice.number}`
                    : "فاکتور فروش",
                )
              }
              disabled={!invoice}
            >
              <Printer className="size-3.5" />
              چاپ / PDF
            </Button>
          </div>
          <DialogDescription className="text-[10px] leading-5">
            {invoice
              ? `صادرشده در ${formatJalaliLong(invoice.issueDate)} برای ${invoice.customerName}`
              : "در حال بارگذاری سند…"}
          </DialogDescription>
        </DialogHeader>

        {!invoice ? (
          <div className="space-y-2">
            <Skeleton className="h-24 rounded-[16px]" />
            <Skeleton className="h-40 rounded-[16px]" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="print-sheet overflow-hidden rounded-[18px] border border-hairline/80 bg-[#fffdf8] shadow-[0_1px_2px_rgba(24,34,44,0.03)] dark:bg-card print:rounded-none print:border-0 print:shadow-none">
              <div className="h-1 bg-gradient-to-l from-gold via-brand to-brand-deep" />
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline/60 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-[12px] bg-gradient-to-br from-brand to-brand-deep font-sans text-lg font-black text-cream shadow-[0_10px_25px_-15px_rgba(15,81,63,0.9)]">
                    و
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-ink">
                      {businessName ?? "صورتحساب فروش"}
                    </p>
                    <p className="mt-1 text-[8px] tracking-[0.04em] text-ink-soft/70">
                      صورتحساب رسمی فروش کالا و خدمات
                    </p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="text-[8px] text-ink-soft/60">شماره فاکتور</p>
                  <p
                    className="mt-1 font-mono text-[13px] font-bold text-ink"
                    dir="ltr"
                  >
                    {invoice.number}
                  </p>
                  <p className="num mt-1 text-[8.5px] text-ink-soft">
                    {formatJalali(invoice.issueDate)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 bg-cream/25 px-5 py-4 text-[10px] sm:grid-cols-3 dark:bg-white/[0.02]">
                <div>
                  <p className="text-[7.5px] font-medium text-ink-soft/60">
                    خریدار
                  </p>
                  <p className="mt-1.5 font-bold text-ink">
                    {invoice.customerName}
                  </p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-ink-soft">
                    {invoice.customerCode ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[7.5px] font-medium text-ink-soft/60">
                    اطلاعات تماس
                  </p>
                  <p className="num mt-1.5 text-ink" dir="ltr">
                    {invoice.customerPhone ?? "—"}
                  </p>
                  {invoice.dueDate ? (
                    <p className="num mt-0.5 text-[8px] text-ink-soft">
                      سررسید: {formatJalali(invoice.dueDate)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="text-[7.5px] font-medium text-ink-soft/60">
                    وضعیت سند
                  </p>
                  <p className="mt-1.5 text-ink">
                    {INVOICE_STATUS_META[invoice.status].hint}
                  </p>
                  <p className="mt-0.5 text-[8px] text-ink-soft">
                    واحد: {unit}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-right">
                  <thead className="border-y border-hairline/60 bg-[#f8f5ed]/70 dark:bg-white/[0.03]">
                    <tr className="text-[8.5px] text-ink-soft">
                      <th className="w-9 px-3 py-2.5 font-semibold">#</th>
                      <th className="px-3 py-2.5 font-semibold">
                        شرح کالا / خدمت
                      </th>
                      <th className="px-3 py-2.5 font-semibold">تعداد</th>
                      <th className="px-3 py-2.5 font-semibold">مبلغ واحد</th>
                      <th className="px-3 py-2.5 font-semibold">جمع ردیف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline/50">
                    {invoice.items.map((item, index) => (
                      <tr key={item._id} className="text-[10px]">
                        <td className="num px-3 py-2.5 text-[8.5px] text-ink-soft/60">
                          {formatNumber(index + 1)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-ink">
                          {item.description}
                        </td>
                        <td className="num px-3 py-2.5 text-ink-soft">
                          {formatQuantity(item.quantityMilli)}
                        </td>
                        <td className="num px-3 py-2.5 text-ink-soft">
                          {formatNumber(item.unitPrice)}
                        </td>
                        <td className="num px-3 py-2.5 font-semibold text-ink">
                          {formatNumber(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-hairline/60 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-2 text-[9px] text-ink-soft">
                  <p className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-brand" />
                    این سند از اسناد واقعی فضای کاری تولید شده است.
                  </p>
                  {invoice.paidAmount > 0 ? (
                    <p>
                      دریافت‌شده:{" "}
                      <span className="num font-semibold text-brand">
                        {formatMoney(invoice.paidAmount, currency)}
                      </span>
                    </p>
                  ) : null}
                  {invoice.status === "issued" && invoice.outstanding > 0 ? (
                    <p>
                      مانده باز:{" "}
                      <span className="num font-semibold text-[#8a6a20] dark:text-gold">
                        {formatMoney(invoice.outstanding, currency)}
                      </span>
                    </p>
                  ) : null}
                </div>

                <div className="w-full max-w-[300px] space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">جمع ردیف‌ها</span>
                    <span className="num text-ink">
                      {formatMoney(invoice.subtotal, currency)}
                    </span>
                  </div>
                  {invoice.discount > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="text-ink-soft">تخفیف</span>
                      <span className="num text-ink">
                        − {formatMoney(invoice.discount, currency)}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">
                      مالیات ({invoice.taxRateBps / 100}٪)
                    </span>
                    <span className="num text-ink">
                      {formatMoney(invoice.taxAmount, currency)}
                    </span>
                  </div>
                  <div className="relative mt-2 overflow-hidden rounded-[12px] border border-[#1d5645] bg-[linear-gradient(135deg,#0d3b2e,#0a3127)] px-3.5 py-3 text-cream">
                    <span
                      className="absolute inset-x-3 top-0 h-px bg-gradient-to-l from-transparent via-gold/50 to-transparent"
                      aria-hidden
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-cream/55">
                        مبلغ نهایی
                      </span>
                      <span className="num text-[14px] font-bold text-gold">
                        {formatMoney(invoice.total, currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {invoice.notes ? (
                <div className="border-t border-dashed border-hairline/70 px-5 py-3">
                  <p className="text-[7.5px] font-medium text-ink-soft/60">
                    توضیحات
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[9.5px] leading-5 text-ink-soft">
                    {invoice.notes}
                  </p>
                </div>
              ) : null}
            </div>

            <DialogFooter className="flex-wrap items-center gap-2">
              {invoice.status === "draft" ? (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={pending !== null}
                  onClick={() => changeStatus("issued")}
                >
                  {pending === "issued" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  صدور نهایی
                </Button>
              ) : null}
              {invoice.status === "issued" ? (
                <>
                  <Button asChild size="sm" className="gap-1.5">
                    <Link to={`/dashboard/payments/new?invoice=${invoice._id}`}>
                      <HandCoins className="size-4" />
                      ثبت دریافت
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={pending !== null}
                    onClick={() => changeStatus("paid")}
                  >
                    {pending === "paid" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ReceiptText className="size-4" />
                    )}
                    تسویه نقدی کامل
                  </Button>
                </>
              ) : null}
              {invoice.status === "draft" || invoice.status === "issued" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  disabled={pending !== null}
                  onClick={() => changeStatus("void")}
                >
                  {pending === "void" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Ban className="size-4" />
                  )}
                  ابطال فاکتور
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-ink-soft sm:ms-auto"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-3.5" />
                بستن
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
