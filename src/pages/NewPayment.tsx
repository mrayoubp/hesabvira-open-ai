import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatMoney,
  formatNumber,
} from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  HandCoins,
  Info,
  Landmark,
  Loader2,
  ReceiptText,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

export default function NewPayment() {
  const {
    businessId,
    branchId,
    fiscalYearId,
    currency,
    canWrite,
    isLoading,
  } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedInvoice = searchParams.get("invoice");

  const createReceipt = useMutation(api.payments.recordReceipt);
  const invoices = useQuery(
    api.invoices.list,
    businessId
      ? { businessId, branchId, fiscalYearId, status: "issued" }
      : "skip",
  );

  const openInvoices = useMemo(
    () =>
      (invoices ?? []).filter(
        (invoice) => invoice.status === "issued" && invoice.outstanding > 0,
      ),
    [invoices],
  );

  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const requestedOpenInvoice = requestedInvoice
    ? openInvoices.find((invoice) => invoice._id === requestedInvoice)
    : undefined;
  const selected =
    openInvoices.find((invoice) => invoice._id === invoiceId) ??
    requestedOpenInvoice ??
    openInvoices[0];
  const amountText = amount ?? (selected ? String(selected.outstanding) : "");

  const selectInvoice = (id: string) => {
    setInvoiceId(id);
    const invoice = openInvoices.find((item) => item._id === id);
    if (invoice) setAmount(String(invoice.outstanding));
  };

  const amountValue = parseAmount(amountText);
  const unit = currencyUnit(currency);
  const isPartial = Boolean(
    selected && amountValue > 0 && amountValue < selected.outstanding,
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !selected) {
      toast.error("یک فاکتور باز را انتخاب کنید.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ دریافت باید بزرگ‌تر از صفر باشد.");
      return;
    }
    if (amountValue > selected.outstanding) {
      toast.error("مبلغ دریافت از مانده فاکتور بیشتر است.");
      return;
    }
    const occurredAt = Date.parse(`${date}T12:00:00Z`);
    if (!Number.isFinite(occurredAt)) {
      toast.error("تاریخ دریافت معتبر نیست.");
      return;
    }

    setSaving(true);
    try {
      const result = await createReceipt({
        businessId,
        invoiceId: selected._id as Id<"invoices">,
        amount: amountValue,
        method,
        occurredAt,
        notes: notes.trim() || undefined,
      });
      toast.success(
        result.fullyPaid
          ? `فاکتور ${selected.number} تسویه شد.`
          : `دریافت جزئی ثبت شد؛ مانده فاکتور ${selected.number} باقی است.`,
      );
      navigate("/dashboard/payments");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[10px] text-ink-soft">
        <Loader2 className="me-2 size-4 animate-spin text-brand" />
        در حال آماده‌سازی…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="ثبت دریافت واقعی"
        title="ثبت دریافت از مشتری"
        description="مبلغ دریافت را روی یک فاکتور صادرشده ثبت کنید. امکان دریافت جزئی وجود دارد و مانده فاکتور در سرور بازمحاسبه می‌شود."
        actions={
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3.5"
          >
            <Link to="/dashboard/payments">
              <ArrowRight className="size-4" />
              بازگشت به دریافت‌ها
            </Link>
          </Button>
        }
      />

      {!canWrite ? (
        <Panel>
          <EmptyState
            icon={<Info className="size-5" />}
            title="نقش شما اجازه ثبت دریافت ندارد"
            description="این عملیات در سرور هم بررسی می‌شود. برای ثبت دریافت با مدیر کسب‌وکار هماهنگ کنید."
            action={
              <Button asChild variant="outline" className="rounded-xl">
                <Link to="/dashboard/payments">مشاهده دریافت‌ها</Link>
              </Button>
            }
          />
        </Panel>
      ) : !invoices ? (
        <Panel className="space-y-2 p-4">
          <div className="h-16 animate-pulse rounded-xl bg-cream/50 dark:bg-white/[0.04]" />
          <div className="h-16 animate-pulse rounded-xl bg-cream/50 dark:bg-white/[0.04]" />
        </Panel>
      ) : openInvoices.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ReceiptText className="size-5" />}
            title="فاکتور بازی برای دریافت وجود ندارد"
            description="ابتدا یک فاکتور فروش را صادر کنید؛ سپس دریافت کامل یا جزئی را روی آن ثبت کنید."
            action={
              <Button asChild className="rounded-xl">
                <Link to="/dashboard/invoices/new">ساخت فاکتور فروش</Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Panel>
            <PanelHeader
              eyebrow="اطلاعات دریافت"
              title="مبلغ، روش و فاکتور مرتبط"
              description="جمع‌ها و وضعیت فاکتور پس از ثبت روی سرور به‌روزرسانی می‌شود."
            />
            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="payment-invoice" className="text-xs">
                  فاکتور باز <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selected?._id ?? ""}
                  onValueChange={selectInvoice}
                >
                  <SelectTrigger
                    id="payment-invoice"
                    className="h-10 w-full rounded-xl border-hairline bg-background text-xs"
                  >
                    <SelectValue placeholder="انتخاب فاکتور" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {openInvoices.map((invoice) => (
                      <SelectItem key={invoice._id} value={invoice._id}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px]">
                            {invoice.number}
                          </span>
                          <span>{invoice.customerName}</span>
                          <span className="num text-[9px] text-ink-soft">
                            مانده {formatNumber(invoice.outstanding)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-ink-soft">
                  فقط فاکتورهای صادرشده و دارای مانده در این لیست هستند.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-amount" className="text-xs">
                    مبلغ دریافت ({unit}) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="payment-amount"
                    value={amountText}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    className="num h-10 rounded-xl border-hairline bg-background text-start text-sm"
                  />
                  {selected ? (
                    <p className="text-[9px] text-ink-soft">
                      مانده فاکتور:{" "}
                      <span className="num font-semibold text-ink">
                        {formatMoney(selected.outstanding, currency)}
                      </span>
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payment-date" className="text-xs">
                    تاریخ دریافت
                  </Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    dir="ltr"
                    className="num h-10 rounded-xl border-hairline bg-background text-start text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">روش دریافت</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMethod("cash")}
                    aria-pressed={method === "cash"}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 text-start transition-colors",
                      method === "cash"
                        ? "border-brand bg-brand-soft/70 text-brand"
                        : "border-hairline bg-background text-ink-soft hover:text-ink",
                    )}
                  >
                    <HandCoins className="size-4" />
                    <span>
                      <span className="block text-[10px] font-semibold">نقدی</span>
                      <span className="mt-0.5 block text-[8px] opacity-75">
                        افزایش موجودی صندوق
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("bank")}
                    aria-pressed={method === "bank"}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 text-start transition-colors",
                      method === "bank"
                        ? "border-brand bg-brand-soft/70 text-brand"
                        : "border-hairline bg-background text-ink-soft hover:text-ink",
                    )}
                  >
                    <Landmark className="size-4" />
                    <span>
                      <span className="block text-[10px] font-semibold">بانکی</span>
                      <span className="mt-0.5 block text-[8px] opacity-75">
                        افزایش موجودی بانک
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-notes" className="text-xs">
                  توضیحات
                </Label>
                <Textarea
                  id="payment-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="مثلاً واریز به حساب بانکی، شماره پیگیری…"
                  rows={3}
                  className="resize-none rounded-xl border-hairline bg-background text-xs"
                  maxLength={500}
                />
              </div>

              {isPartial && selected ? (
                <div className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold-soft/40 p-3 text-[9px] leading-5 text-[#7a6122] dark:text-gold">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  این یک دریافت جزئی است؛ فاکتور باز می‌ماند و مانده{" "}
                  <span className="num font-semibold">
                    {formatMoney(selected.outstanding - amountValue, currency)}
                  </span>{" "}
                  در مطالبات ثبت خواهد شد.
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-hairline/60 pt-4">
                <Button
                  type="submit"
                  disabled={saving || !selected || amountValue <= 0}
                  className="gap-2 rounded-xl"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  ثبت دریافت
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  className="rounded-xl border-hairline bg-card"
                >
                  <Link to="/dashboard/payments">انصراف</Link>
                </Button>
                {selected ? (
                  <span className="num ms-auto text-[9px] text-ink-soft">
                    {formatMoney(amountValue || 0, currency)}
                  </span>
                ) : null}
              </div>
            </form>
          </Panel>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title="فاکتور انتخاب‌شده" />
              {selected ? (
                <dl className="space-y-2 px-4 pb-4 text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-soft">شماره</dt>
                    <dd className="font-mono text-[10px] text-ink">
                      {selected.number}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-soft">مشتری</dt>
                    <dd className="font-semibold text-ink">
                      {selected.customerName}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-soft">تاریخ صدور</dt>
                    <dd className="num text-ink">
                      {formatJalali(selected.issueDate)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-soft">مبلغ فاکتور</dt>
                    <dd className="num text-ink">
                      {formatMoney(selected.total, currency)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-soft">دریافت‌شده</dt>
                    <dd className="num text-brand">
                      {formatMoney(selected.paidAmount, currency)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-hairline/60 pt-2">
                    <dt className="font-semibold text-ink">مانده</dt>
                    <dd className="num font-bold text-[#8a6a20] dark:text-gold">
                      {formatMoney(selected.outstanding, currency)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="px-4 pb-4 text-[10px] text-ink-soft">
                  برای دیدن جزئیات، یک فاکتور انتخاب کنید.
                </p>
              )}
            </Panel>

            <Panel className="border-gold/20 bg-gold-soft/20 dark:bg-gold-soft/5">
              <div className="flex items-start gap-2 p-4">
                <Truck className="mt-0.5 size-4 shrink-0 text-gold" />
                <div>
                  <p className="text-[10px] font-bold text-ink">
                    پرداخت به تأمین‌کننده
                  </p>
                  <p className="mt-1 text-[9px] leading-5 text-ink-soft">
                    پرداخت نقدی یا بانکی و اتصال آن به فاکتور خرید از بخش
                    پرداخت‌های مالی انجام می‌شود.
                  </p>
                  <Link
                    to="/dashboard/finance/payments"
                    className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-brand hover:underline"
                  >
                    ثبت پرداخت به تأمین‌کننده
                    <ArrowRight className="size-3 rotate-180" />
                  </Link>
                </div>
              </div>
            </Panel>

            <div className="flex items-start gap-2 rounded-[18px] border border-dashed border-hairline/70 p-3 text-[8px] leading-5 text-ink-soft">
              <Banknote className="mt-0.5 size-3.5 shrink-0 text-brand" />
              فقط دریافت‌های واقعی ثبت‌شده در مانده نقد و مطالبات لحاظ
              می‌شوند؛ هیچ عدد نمایشی به کار نمی‌رود.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
