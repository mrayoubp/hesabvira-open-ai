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
  formatMoney,
  formatQuantity,
  formatNumber,
  TAX_RATE_OPTIONS,
} from "@/lib/format";
import {
  invoiceTotals,
  lineTotal,
  MAX_LINES,
  parseAmount,
  parseQuantityMilli,
} from "@/lib/money";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  Info,
  Loader2,
  Phone,
  Plus,
  ReceiptText,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

interface LineDraft {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function newLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
  };
}

export default function NewInvoice() {
  const { businessId, workspace, currency, canWrite, isLoading } = useWorkspace();
  const navigate = useNavigate();
  const createInvoice = useMutation(api.invoices.create);

  const customers = useQuery(
    api.customers.list,
    businessId ? { businessId } : "skip",
  );

  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [discount, setDiscount] = useState("");
  const [taxRateBps, setTaxRateBps] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"draft" | "issued" | null>(null);

  useEffect(() => {
    if (workspace && taxRateBps === null) {
      setTaxRateBps(workspace.business.taxRateBps);
    }
  }, [workspace, taxRateBps]);

  useEffect(() => {
    if (!customerId && customers && customers.length > 0) {
      setCustomerId(customers[0]._id);
    }
  }, [customerId, customers]);

  const unit = currencyUnit(currency);
  const selectedCustomer = customers?.find(
    (customer) => customer._id === customerId,
  );

  const computed = useMemo(() => {
    const rows = lines.map((line) => {
      const quantityMilli = parseQuantityMilli(line.quantity);
      const unitPrice = parseAmount(line.unitPrice);
      return {
        ...line,
        quantityMilli,
        unitPrice,
        total: lineTotal(quantityMilli, unitPrice),
      };
    });
    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const totals = invoiceTotals({
      subtotal,
      discount: parseAmount(discount),
      taxRateBps: taxRateBps ?? 0,
    });
    return { rows, subtotal, ...totals };
  }, [lines, discount, taxRateBps]);

  const updateLine = (id: string, field: keyof LineDraft, value: string) => {
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [field]: value } : line,
      ),
    );
  };

  const removeLine = (id: string) => {
    setLines((current) =>
      current.length === 1
        ? current
        : current.filter((line) => line.id !== id),
    );
  };

  const validate = () => {
    if (!customerId) {
      toast.error("ابتدا مشتری فاکتور را انتخاب کنید.");
      return false;
    }
    if (parseAmount(discount) > computed.subtotal) {
      toast.error("تخفیف نمی‌تواند از جمع ردیف‌ها بیشتر باشد.");
      return false;
    }
    for (const [index, row] of computed.rows.entries()) {
      if (!row.description.trim()) {
        toast.error(`شرح ردیف ${index + 1} را وارد کنید.`);
        return false;
      }
      if (row.quantityMilli <= 0) {
        toast.error(`تعداد ردیف ${index + 1} باید بزرگ‌تر از صفر باشد.`);
        return false;
      }
      if (row.unitPrice < 0) {
        toast.error(`مبلغ ردیف ${index + 1} معتبر نیست.`);
        return false;
      }
    }
    return true;
  };

  const submit = async (status: "draft" | "issued") => {
    if (!businessId || !validate()) return;
    setSaving(status);
    try {
      const result = await createInvoice({
        businessId,
        customerId: customerId as Id<"customers">,
        lines: computed.rows.map((row) => ({
          description: row.description,
          quantityMilli: row.quantityMilli,
          unitPrice: row.unitPrice,
        })),
        discount: computed.discount,
        taxRateBps: taxRateBps ?? 0,
        notes: notes.trim() || undefined,
        status,
      });
      toast.success(
        status === "issued"
          ? `فاکتور ${result.number} صادر شد.`
          : `پیش‌نویس ${result.number} ذخیره شد.`,
      );
      navigate("/dashboard/invoices");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  const hasNoCustomers = customers !== undefined && customers.length === 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="فروش · صدور سند رسمی"
        title="فاکتور فروش جدید"
        description="طرف حساب و اقلام را ثبت کنید؛ جمع ردیف‌ها، تخفیف و مالیات پیش از ذخیره روی سرور اعتبارسنجی و بازمحاسبه می‌شوند."
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/dashboard/invoices">
              <ArrowRight className="size-4" />
              بازگشت به فهرست
            </Link>
          </Button>
        }
      />

      {!canWrite ? (
        <Panel>
          <EmptyState
            icon={<Info className="size-5" />}
            title="نقش شما اجازه ثبت فاکتور ندارد"
            description="دسترسی مشاهده فعال است؛ برای صدور یا تغییر اسناد با مالک یا مدیر کسب‌وکار تماس بگیرید."
            action={
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/dashboard/invoices">
                  <ArrowRight className="size-4" />
                  مشاهده فهرست اسناد
                </Link>
              </Button>
            }
          />
        </Panel>
      ) : hasNoCustomers ? (
        <Panel>
          <EmptyState
            icon={<Users className="size-5" />}
            title="برای صدور فاکتور، ابتدا مشتری بسازید"
            description="هر فاکتور باید به یک پرونده مشتری متصل باشد تا فروش و مطالبات قابل پیگیری بماند."
            action={
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/dashboard/customers">
                  <UserPlus className="size-4" />
                  ثبت مشتری
                </Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="۱ · مشخصات خریدار"
                title="مشتری و تنظیمات مالی"
                description="فاکتور فقط برای مشتریان فعال همین فضای کاری قابل ثبت است."
              />
              <div className="grid gap-4 border-t border-hairline/60 p-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-[11px]">
                    <Building2 className="size-3.5 text-brand/70" />
                    مشتری
                    <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={customerId}
                    onValueChange={setCustomerId}
                    disabled={!customers}
                  >
                    <SelectTrigger className="h-11 w-full bg-surface">
                      <SelectValue placeholder="انتخاب مشتری" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers?.map((customer) => (
                        <SelectItem key={customer._id} value={customer._id}>
                          {customer.name}{" "}
                          <span className="font-mono text-[10px] text-ink-soft">
                            {customer.code}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[9px] leading-4 text-ink-soft">
                    مشتری جدید نیست؟{" "}
                    <Link
                      to="/dashboard/customers"
                      className="font-semibold text-brand hover:underline"
                    >
                      افزودن مشتری
                    </Link>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-[11px]">
                    <ReceiptText className="size-3.5 text-brand/70" />
                    نرخ مالیات
                  </Label>
                  <Select
                    value={String(taxRateBps ?? 0)}
                    onValueChange={(value) => setTaxRateBps(Number(value))}
                  >
                    <SelectTrigger className="h-11 w-full bg-surface">
                      <SelectValue placeholder="انتخاب نرخ" />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_RATE_OPTIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={String(option.value)}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[9px] leading-4 text-ink-soft">
                    نرخ پیش‌فرض از تنظیمات کسب‌وکار خوانده می‌شود.
                  </p>
                </div>

                {selectedCustomer ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-brand/10 bg-cream/30 p-3 sm:col-span-2 dark:bg-white/[0.025]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-brand-soft text-brand">
                      <Building2 className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-bold text-ink">
                        {selectedCustomer.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[8.5px] text-ink-soft">
                        <span className="font-mono" dir="ltr">
                          {selectedCustomer.code}
                        </span>
                        {selectedCustomer.mobile || selectedCustomer.phone ? (
                          <span className="flex items-center gap-1" dir="ltr">
                            <Phone className="size-2.5" />
                            {selectedCustomer.mobile ?? selectedCustomer.phone}
                          </span>
                        ) : null}
                        <span>
                          {formatNumber(selectedCustomer.invoiceCount)} فاکتور
                          قبلی
                        </span>
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-hairline/70 bg-surface px-3 py-1.5">
                      <p className="flex items-center gap-1 text-[7.5px] text-ink-soft">
                        <Wallet className="size-2.5" />
                        مانده حساب
                      </p>
                      <p className="num mt-0.5 text-[11px] font-bold text-ink">
                        {formatMoney(selectedCustomer.outstanding, currency)}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="۲ · اقلام سند"
                title="ردیف‌های فاکتور"
                description={`هر فاکتور حداکثر ${formatNumber(MAX_LINES)} ردیف دارد. مقدار تعداد می‌تواند اعشاری باشد.`}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      setLines((current) =>
                        current.length >= MAX_LINES
                          ? current
                          : [...current, newLine()],
                      )
                    }
                    disabled={lines.length >= MAX_LINES}
                  >
                    <Plus className="size-3.5" />
                    ردیف جدید
                  </Button>
                }
              />

              <div className="hidden grid-cols-[28px_minmax(0,1fr)_86px_145px_120px_32px] items-center gap-2 border-y border-hairline/60 bg-cream/25 px-4 py-2.5 md:grid dark:bg-white/[0.025]">
                <span className="text-[8px] font-semibold text-ink-soft/70">
                  #
                </span>
                <span className="text-[9px] font-semibold text-ink-soft">
                  شرح کالا / خدمت
                </span>
                <span className="text-[9px] font-semibold text-ink-soft">
                  تعداد
                </span>
                <span className="text-[9px] font-semibold text-ink-soft">
                  مبلغ واحد ({unit})
                </span>
                <span className="text-[9px] font-semibold text-ink-soft">
                  جمع
                </span>
                <span />
              </div>

              <div className="divide-y divide-hairline/55">
                {lines.map((line, index) => {
                  const row = computed.rows[index];
                  return (
                    <div
                      key={line.id}
                      className="px-4 py-3 transition-colors hover:bg-cream/15 dark:hover:bg-white/[0.015]"
                    >
                      <div className="grid gap-2 md:grid-cols-[28px_minmax(0,1fr)_86px_145px_120px_32px] md:items-center">
                        <div className="flex items-center gap-2 md:hidden">
                          <span className="num flex size-5 items-center justify-center rounded-md bg-cream/60 text-[8px] font-bold text-ink-soft dark:bg-white/[0.05]">
                            {formatNumber(index + 1)}
                          </span>
                          <span className="text-[10px] font-semibold text-ink">
                            ردیف {formatNumber(index + 1)}
                          </span>
                        </div>
                        <span className="num hidden size-6 items-center justify-center rounded-md bg-cream/50 text-[8px] font-bold text-ink-soft/70 md:flex dark:bg-white/[0.04]">
                          {formatNumber(index + 1)}
                        </span>
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            updateLine(
                              line.id,
                              "description",
                              event.target.value,
                            )
                          }
                          placeholder="مثلاً چای بسته ۵۰۰ گرمی"
                          maxLength={200}
                          aria-label={`شرح ردیف ${index + 1}`}
                          className="h-10 text-[11px]"
                        />
                        <Input
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.id, "quantity", event.target.value)
                          }
                          inputMode="decimal"
                          dir="ltr"
                          aria-label={`تعداد ردیف ${index + 1}`}
                          className="num h-10 text-start text-[11px]"
                        />
                        <Input
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.id, "unitPrice", event.target.value)
                          }
                          inputMode="numeric"
                          dir="ltr"
                          placeholder="0"
                          aria-label={`مبلغ واحد ردیف ${index + 1}`}
                          className="num h-10 text-start text-[11px]"
                        />
                        <div className="flex items-center justify-between gap-2 md:justify-end">
                          <span className="text-[9px] text-ink-soft md:hidden">
                            جمع ردیف
                          </span>
                          <span className="num text-[11px] font-bold text-ink">
                            {formatNumber(row?.total ?? 0)}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length === 1}
                          aria-label={`حذف ردیف ${index + 1}`}
                          className="size-8 justify-self-end text-ink-soft/60 hover:bg-destructive/5 hover:text-destructive md:justify-self-auto"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <p className="mt-1.5 ps-7 text-[9px] text-ink-soft/75 md:hidden">
                        {formatQuantity(row?.quantityMilli ?? 0)} ×{" "}
                        {formatNumber(row?.unitPrice ?? 0)} {unit}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 bg-cream/15 px-4 py-3 dark:bg-white/[0.015]">
                <span className="num text-[9px] text-ink-soft" dir="ltr">
                  rows {formatNumber(lines.length)} / {formatNumber(MAX_LINES)}
                </span>
                <span className="text-[10px] text-ink-soft">
                  جمع ردیف‌ها:{" "}
                  <span className="num ms-1 font-bold text-ink">
                    {formatMoney(computed.subtotal, currency)}
                  </span>
                </span>
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="۳ · یادداشت سند"
                title="توضیحات فاکتور"
                description="اختیاری — شرایط تسویه، شماره سفارش یا یادداشت داخلی."
              />
              <div className="border-t border-hairline/60 p-5">
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="مثلاً تسویه نقدی هنگام تحویل"
                  className="resize-none text-[11px]"
                />
                <p className="num mt-2 text-[8.5px] text-ink-soft/70">
                  {formatNumber(notes.length)} / 1000
                </p>
              </div>
            </Panel>
          </div>

          <aside className="xl:sticky xl:top-[88px] xl:self-start">
            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="۴ · تسویه"
                title="خلاصه فاکتور"
                description="محاسبه نهایی روی سرور انجام می‌شود."
              />
              <div className="space-y-4 border-t border-hairline/60 p-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="invoice-discount"
                    className="flex items-center justify-between text-[10px]"
                  >
                    <span>تخفیف ({unit})</span>
                    <span className="font-mono text-[8px] text-ink-soft/60">
                      OPTIONAL
                    </span>
                  </Label>
                  <Input
                    id="invoice-discount"
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    className="num h-10 text-start text-[11px]"
                  />
                  {computed.discount > 0 &&
                  parseAmount(discount) > computed.subtotal ? (
                    <p className="text-[9px] text-destructive">
                      تخفیف بیش از جمع ردیف‌ها است.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2 border-t border-dashed border-hairline/70 pt-3 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">جمع ردیف‌ها</span>
                    <span className="num text-ink">
                      {formatMoney(computed.subtotal, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">تخفیف</span>
                    <span className="num text-ink">
                      − {formatMoney(computed.discount, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">
                      مالیات ({(taxRateBps ?? 0) / 100}٪)
                    </span>
                    <span className="num text-ink">
                      {formatMoney(computed.taxAmount, currency)}
                    </span>
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-[16px] border border-[#1d5645] bg-[linear-gradient(135deg,#0d3b2e,#0a3127)] p-4 text-cream">
                  <span
                    className="pointer-events-none absolute -left-8 -top-10 size-28 rounded-full bg-[#3f8b74]/25 blur-3xl"
                    aria-hidden
                  />
                  <span
                    className="absolute inset-x-4 top-0 h-px bg-gradient-to-l from-transparent via-gold/50 to-transparent"
                    aria-hidden
                  />
                  <p className="relative text-[8.5px] text-cream/55">
                    مبلغ قابل پرداخت
                  </p>
                  <p className="num relative mt-2 text-[23px] font-bold leading-none text-gold">
                    {formatMoney(computed.total, currency)}
                  </p>
                  <p className="relative mt-2 text-[8px] text-cream/35">
                    {formatNumber(lines.length)} ردیف ·{" "}
                    {(taxRateBps ?? 0) / 100}٪ مالیات
                  </p>
                </div>

                <div className="flex items-start gap-2 rounded-[12px] border border-brand/10 bg-brand-soft/30 p-3 text-[9px] leading-5 text-ink-soft">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
                  <p>
                    پیش‌نویس در گزارش فروش و مطالبات محاسبه نمی‌شود. پس از
                    صدور، دریافت وجه را از بخش دریافت‌ها ثبت کنید.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    className="h-11 gap-1.5 rounded-[11px]"
                    onClick={() => submit("issued")}
                    disabled={saving !== null || isLoading || hasNoCustomers}
                    aria-busy={saving === "issued"}
                  >
                    {saving === "issued" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    صدور و تأیید فاکتور
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-[11px]"
                    onClick={() => submit("draft")}
                    disabled={saving !== null || isLoading || hasNoCustomers}
                    aria-busy={saving === "draft"}
                  >
                    {saving === "draft" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    ذخیره پیش‌نویس
                  </Button>
                </div>
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}
