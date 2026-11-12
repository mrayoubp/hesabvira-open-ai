import { PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalaliLong, formatNumber } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Check,
  CreditCard,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const STATUS_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  active: {
    label: "فعال",
    className: "border-brand/25 bg-brand-soft text-brand",
    dot: "bg-brand",
  },
  pending_payment: {
    label: "در انتظار پرداخت",
    className: "border-gold/40 bg-gold-soft text-[#7a6122]",
    dot: "bg-gold",
  },
  grace: {
    label: "در مهلت تمدید",
    className: "border-gold/40 bg-gold-soft text-[#7a6122]",
    dot: "bg-gold",
  },
  expired: {
    label: "منقضی‌شده",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
  cancelled: {
    label: "لغوشده",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
  legacy: {
    label: "فضای کاری قدیمی",
    className: "border-hairline bg-muted text-ink-soft",
    dot: "bg-ink-soft/60",
  },
};

const INVOICE_STATUS: Record<string, string> = {
  paid: "پرداخت‌شده",
  unpaid: "پرداخت‌نشده",
  failed: "ناموفق",
  cancelled: "لغوشده",
  refunded: "بازپرداخت‌شده",
};

const EVENT_LABELS: Record<string, string> = {
  created: "ایجاد اشتراک",
  payment_initiated: "شروع پرداخت",
  payment_failed: "پرداخت ناموفق",
  activated: "فعال‌سازی اشتراک",
  renewed: "تمدید اشتراک",
  expired: "پایان اعتبار",
  grace_started: "ورود به مهلت تمدید",
  cancelled: "لغو اشتراک",
  reactivated: "فعال‌سازی دوباره",
  manual_renewal: "تمدید دستی مدیر",
};

const LIMIT_LABELS: Record<string, string> = {
  maxUsers: "کاربر مجاز",
  maxBranches: "شعبه",
  maxWarehouses: "انبار",
  maxStorageMb: "فضای فایل (مگابایت)",
};

export default function SubscriptionPage() {
  const { businessId, canManage, workspace } = useWorkspace();
  const data = useQuery(
    api.subscription.mySubscription,
    businessId ? { businessId } : "skip",
  );
  const plans = useQuery(api.subscription.plans);
  const checkout = useMutation(api.subscription.checkout);
  const confirmTest = useMutation(api.subscription.confirmTestPayment);
  const renew = useMutation(api.subscription.renew);
  const cancel = useMutation(api.subscription.cancel);

  const [busy, setBusy] = useState<string | null>(null);
  const [testPayment, setTestPayment] = useState<{
    paymentId: string;
    invoiceId: string;
    number: string;
    amountToman: number;
  } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (!businessId || data === undefined) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-ink-soft">
        <Loader2 className="size-4 animate-spin" /> در حال خواندن اشتراک…
      </div>
    );
  }

  const plan = data.plan;
  const currentSubscription = data.subscription;
  const status = data.access.status;
  const paymentAvailable = data.access.testMode;
  const meta = STATUS_META[status] ?? STATUS_META.pending_payment;
  const unpaidInvoice = data.invoices.find(
    (invoice) => invoice.status === "unpaid" || invoice.status === "failed",
  );

  async function startPayment(invoiceId: string) {
    if (!paymentAvailable) {
      toast.error(
        "درگاه پرداخت واقعی هنوز متصل و آزمایش نشده است؛ پرداخت در دسترس نیست.",
      );
      return;
    }
    setBusy("checkout");
    try {
      const result = await checkout({
        invoiceId: invoiceId as never,
      });
      if (result.mode === "already_paid") {
        toast.success("این فاکتور قبلاً پرداخت شده است.");
        return;
      }
      setTestPayment({
        paymentId: result.paymentId,
        invoiceId: result.invoiceId,
        number: result.number,
        amountToman: result.amountToman,
      });
    } catch (reason) {
      toast.error(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function startRenewal(planId?: string) {
    if (!businessId) return;
    if (!paymentAvailable) {
      toast.error(
        "درگاه پرداخت واقعی هنوز متصل و آزمایش نشده است؛ صدور فاکتور تمدید متوقف شد.",
      );
      return;
    }
    setBusy("renew");
    try {
      const invoice = await renew({
        businessId,
        planId: planId as never,
      });
      await startPayment(invoice.invoiceId);
    } catch (reason) {
      toast.error(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function finishTestPayment(outcome: "success" | "failed") {
    if (!testPayment) return;
    setBusy("test");
    try {
      const result = await confirmTest(
        {
          paymentId: testPayment.paymentId as never,
          outcome,
        },
      );
      if (outcome === "success") {
        toast.success(
          result.alreadyProcessed
            ? "این پرداخت قبلاً ثبت شده بود."
            : "پرداخت آزمایشی تأیید و اشتراک فعال شد.",
        );
      } else {
        toast.error("پرداخت آزمایشی ناموفق ثبت شد؛ اشتراک فعال نشد.");
      }
      setTestPayment(null);
    } catch (reason) {
      toast.error(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function submitCancel() {
    if (!businessId) return;
    setBusy("cancel");
    try {
      await cancel({ businessId, reason: cancelReason });
      toast.success("اشتراک لغو شد. اطلاعات مالی شما حفظ می‌شود.");
      setCancelOpen(false);
      setCancelReason("");
    } catch (reason) {
      toast.error(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حساب ویرا · اشتراک"
        title="اشتراک و صورت‌حساب"
        description="پلن، اعتبار، فاکتورها و تاریخچه پرداخت‌های فضای کاری شما. تعرفه‌ها از تنظیمات رسمی حساب ویرا خوانده می‌شوند."
        actions={
          canManage ? (
            <Button
              className="h-9 gap-1.5 rounded-xl text-[11px]"
              onClick={() => startRenewal()}
              disabled={
                Boolean(busy) || !plans?.length || !paymentAvailable
              }
            >
              {busy === "renew" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {!currentSubscription
                ? "خرید اشتراک"
                : status === "pending_payment"
                  ? "فعال‌سازی اشتراک"
                  : "تمدید اشتراک"}
            </Button>
          ) : null
        }
      />

      {data.access.testMode ? (
        <div className="flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold-soft/45 px-4 py-3 text-[11px] leading-6 text-[#6f551d]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
          <p>
            <strong>محیط پرداخت آزمایشی است.</strong> هیچ تراکنش بانکی واقعی
            انجام نمی‌شود. پرداخت واقعی تا اتصال و آزمایش درگاه معتبر فعال
            نشده است.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold-soft/45 px-4 py-3 text-[11px] leading-6 text-[#6f551d]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
          <p>
            <strong>درگاه پرداخت واقعی فعال نیست.</strong> مشاهده اطلاعات و
            فاکتورها در دسترس است، اما پرداخت و تمدید تا اتصال و آزمایش درگاه
            معتبر غیرفعال می‌شود.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Panel className="overflow-hidden">
          <div className="relative overflow-hidden bg-gradient-to-br from-[#1d4d3c] via-brand to-[#12352a] p-6 text-cream sm:p-8">
            <div className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-gold/15 blur-3xl" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/10 px-3 py-1 text-[10px] font-semibold text-cream/75">
                  <Sparkles className="size-3 text-gold" />
                  {workspace?.business.name}
                </span>
                <h2 className="mt-4 text-2xl font-black text-cream sm:text-3xl">
                  {plan?.name ?? "پلن در انتظار انتخاب"}
                </h2>
                <p className="mt-2 text-xs leading-6 text-cream/65">
                  {plan
                    ? `${formatNumber(plan.priceToman)} تومان برای ${formatNumber(plan.durationMonths)} ماه`
                    : "برای فعال‌سازی، یک پلن را انتخاب و پرداخت را کامل کنید."}
                </p>
                <span
                  className={`mt-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${meta.className}`}
                >
                  <span className={`size-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[10px] sm:min-w-52">
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.07] p-3">
                  <p className="text-cream/50">شروع</p>
                  <p className="num mt-1 font-semibold text-cream">
                    {currentSubscription?.startAt
                      ? formatJalaliLong(currentSubscription.startAt)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.07] p-3">
                  <p className="text-cream/50">پایان</p>
                  <p className="num mt-1 font-semibold text-cream">
                    {currentSubscription?.endAt
                      ? formatJalaliLong(currentSubscription.endAt)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.07] p-3">
                  <p className="text-cream/50">روز باقی‌مانده</p>
                  <p className="num mt-1 font-semibold text-gold">
                    {data.access.daysRemaining === null
                      ? "—"
                      : formatNumber(Math.max(0, data.access.daysRemaining))}
                  </p>
                </div>
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.07] p-3">
                  <p className="text-cream/50">صورت‌حساب</p>
                  <p className="mt-1 font-semibold text-cream/80">
                    {currentSubscription?.paymentStatus === "paid"
                      ? "تسویه‌شده"
                      : "در انتظار پرداخت"}
                  </p>
                </div>
              </div>
            </div>
            {status !== "active" && status !== "legacy" ? (
              <p className="relative mt-6 rounded-xl border border-gold/20 bg-gold/[0.08] px-3 py-2 text-[10px] leading-5 text-cream/75">
                {data.access.message} مشاهده، گزارش و خروجی اطلاعات همچنان فعال
                است.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {data.limits
              ? Object.entries(LIMIT_LABELS).map(([key, label]) => (
                  <div
                    key={key}
                    className="rounded-2xl border border-hairline/70 bg-background/60 p-3"
                  >
                    <p className="text-[10px] text-ink-soft">{label}</p>
                    <p className="num mt-1 text-lg font-bold text-ink">
                      {formatNumber(
                        data.limits?.[key as keyof typeof data.limits] as number,
                      )}
                    </p>
                  </div>
                ))
              : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="وضعیت حساب"
            title="چه چیزی در دسترس است؟"
            description="محدودیت‌ها از پلن فعال خوانده می‌شوند."
          />
          <div className="space-y-2.5 px-5 pb-5">
            {[
              {
                icon: ShieldCheck,
                label: "مشاهده و خروجی اطلاعات",
                value: "همیشه فعال",
              },
              {
                icon: BadgeCheck,
                label: "ثبت اسناد و اطلاعات جدید",
                value: data.access.canWrite ? "فعال" : "نیازمند تمدید",
              },
              {
                icon: CreditCard,
                label: "وضعیت پرداخت",
                value:
                  currentSubscription?.paymentStatus === "paid"
                    ? "پرداخت‌شده"
                    : "پرداخت‌نشده",
              },
              {
                icon: CalendarClock,
                label: "مهلت تمدید",
                value: `${formatNumber(data.access.graceDays)} روز`,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border border-hairline/60 bg-background/50 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-[11px] text-ink-soft">
                  <row.icon className="size-3.5 text-brand" />
                  {row.label}
                </span>
                <span className="text-[10px] font-bold text-ink">
                  {row.value}
                </span>
              </div>
            ))}
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-9 w-full rounded-xl text-[11px]"
                onClick={() => setCancelOpen(true)}
                disabled={status === "cancelled" || busy !== null}
              >
                <XCircle className="size-3.5" />
                لغو اشتراک
              </Button>
            ) : null}
          </div>
        </Panel>
      </div>

      {unpaidInvoice && canManage ? (
        <Panel className="border-gold/30 bg-gold-soft/25">
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold text-ink">
                فاکتور {unpaidInvoice.number} در انتظار پرداخت است
              </p>
              <p className="mt-1 text-[10px] leading-5 text-ink-soft">
                مبلغ {formatNumber(unpaidInvoice.amountToman)} تومان — سررسید{" "}
                {formatJalaliLong(unpaidInvoice.dueAt)}
              </p>
            </div>
            <Button
              className="h-9 shrink-0 gap-1.5 rounded-xl text-[11px]"
              onClick={() => startPayment(unpaidInvoice._id)}
              disabled={busy !== null || !paymentAvailable}
            >
              {busy === "checkout" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CreditCard className="size-3.5" />
              )}
              پرداخت فاکتور
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader
            eyebrow="فاکتورهای اشتراک"
            title="تاریخچه صورت‌حساب"
            description="هر فاکتور با شماره یکتا و وضعیت پرداخت ثبت می‌شود."
          />
          <div className="overflow-x-auto px-2 pb-3">
            {data.invoices.length === 0 ? (
              <p className="px-3 py-8 text-center text-[11px] text-ink-soft">
                هنوز فاکتوری صادر نشده است.
              </p>
            ) : (
              <table className="w-full min-w-[560px] text-start text-[10px]">
                <thead className="text-ink-soft">
                  <tr className="border-b border-hairline/60">
                    <th className="px-3 py-2 text-start font-medium">شماره</th>
                    <th className="px-3 py-2 text-start font-medium">دوره</th>
                    <th className="px-3 py-2 text-start font-medium">
                      مبلغ (تومان)
                    </th>
                    <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <tr
                      key={invoice._id}
                      className="border-b border-hairline/40 last:border-0"
                    >
                      <td className="num px-3 py-2.5 font-mono text-[9px]">
                        {invoice.number}
                      </td>
                      <td className="num px-3 py-2.5 text-ink-soft">
                        {formatJalaliLong(invoice.periodStart)}
                      </td>
                      <td className="num px-3 py-2.5 font-bold text-ink">
                        {formatNumber(invoice.amountToman)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={
                            invoice.status === "paid"
                              ? "border-brand/25 bg-brand-soft text-brand"
                              : "border-gold/35 bg-gold-soft text-[#7a6122]"
                          }
                        >
                          {INVOICE_STATUS[invoice.status] ?? invoice.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="تاریخچه"
            title="رویدادهای اشتراک"
            description="شروع، پرداخت، تمدید، لغو و پایان اعتبار با زمان ثبت."
          />
          <div className="space-y-2 px-5 pb-5">
            {data.events.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-ink-soft">
                رویدادی ثبت نشده است.
              </p>
            ) : (
              data.events.map((event) => (
                <div
                  key={event._id}
                  className="flex items-start gap-3 rounded-xl border border-hairline/50 bg-background/40 px-3 py-2.5"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <History className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-ink">
                        {EVENT_LABELS[event.type] ?? event.type}
                      </p>
                      <span className="num shrink-0 text-[9px] text-ink-soft">
                        {formatJalaliLong(event.createdAt)}
                      </span>
                    </div>
                    {event.amountToman ? (
                      <p className="num mt-1 text-[10px] text-ink-soft">
                        {formatNumber(event.amountToman)} تومان
                      </p>
                    ) : null}
                    {event.reason ? (
                      <p className="mt-1 text-[9px] leading-5 text-ink-soft">
                        {event.reason}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="تعرفه‌های رسمی"
          title="تغییر یا تمدید پلن"
          description="قیمت و مدت از دیتابیس تعرفه‌ها خوانده می‌شود؛ تغییر آن فقط توسط مدیر سامانه امکان‌پذیر است."
        />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
          {(plans ?? []).map((item) => (
            <div
              key={item._id}
              className="rounded-2xl border border-hairline/70 bg-background/50 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-ink">{item.name}</p>
                  <p className="mt-1 text-[10px] text-ink-soft">
                    {formatNumber(item.durationMonths)} ماه اعتبار
                  </p>
                </div>
                {item._id === plan?._id ? (
                  <Badge
                    variant="outline"
                    className="border-brand/25 bg-brand-soft text-brand"
                  >
                    پلن فعلی
                  </Badge>
                ) : null}
              </div>
              <p className="num mt-4 text-xl font-black text-ink">
                {formatNumber(item.priceToman)}
                <span className="ms-1 font-sans text-[10px] font-normal text-ink-soft">
                  تومان
                </span>
              </p>
              <ul className="mt-3 space-y-1.5">
                {item.features.slice(0, 4).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-1.5 text-[10px] leading-5 text-ink-soft"
                  >
                    <Check className="mt-0.5 size-3 text-brand" />
                    {feature}
                  </li>
                ))}
              </ul>
              {canManage ? (
                <Button
                  variant={item._id === plan?._id ? "default" : "outline"}
                  size="sm"
                  className="mt-4 h-8 w-full rounded-xl text-[10px]"
                  onClick={() => startRenewal(item._id)}
                  disabled={busy !== null || !paymentAvailable}
                >
                  {item._id === plan?._id
                    ? status === "pending_payment"
                      ? "فعال‌سازی این پلن"
                      : "تمدید این پلن"
                    : "انتخاب این پلن"}
                  <ArrowLeft className="size-3" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="border-t border-hairline/60 px-5 py-3 text-[10px] text-ink-soft">
          <Link to="/legal/renewal" className="hover:text-ink">
            شرایط تمدید و لغو
          </Link>
          <span className="mx-2 text-hairline">|</span>
          <Link to="/legal/refund" className="hover:text-ink">
            شرایط بازپرداخت
          </Link>
          <span className="mx-2 text-hairline">|</span>
          <Link to="/legal/support" className="hover:text-ink">
            پشتیبانی
          </Link>
        </div>
      </Panel>

      <Dialog
        open={Boolean(testPayment)}
        onOpenChange={(open) => {
          if (!open && busy !== "test") setTestPayment(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>پرداخت آزمایشی اشتراک</DialogTitle>
            <DialogDescription>
              این شبیه‌سازی فقط در محیط آزمایشی است و هیچ وجهی دریافت نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          {testPayment ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-hairline/70 bg-background/60 p-3">
                <div className="flex justify-between text-[11px]">
                  <span className="text-ink-soft">شماره فاکتور</span>
                  <span className="num font-mono text-[10px]">
                    {testPayment.number}
                  </span>
                </div>
                <div className="mt-2 flex justify-between text-[11px]">
                  <span className="text-ink-soft">مبلغ قابل پرداخت</span>
                  <span className="num font-bold">
                    {formatNumber(testPayment.amountToman)} تومان
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/40 px-3 py-2 text-[10px] leading-5 text-[#6f551d]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                نتیجه را انتخاب کنید تا مسیر موفق و ناموفق واقعاً ثبت و
                Audit شود.
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-[11px]"
                  onClick={() => finishTestPayment("failed")}
                  disabled={busy === "test"}
                >
                  {busy === "test" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <XCircle className="size-3.5" />
                  )}
                  پرداخت ناموفق
                </Button>
                <Button
                  className="h-9 rounded-xl text-[11px]"
                  onClick={() => finishTestPayment("success")}
                  disabled={busy === "test"}
                >
                  {busy === "test" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="size-3.5" />
                  )}
                  تأیید پرداخت آزمایشی
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>لغو اشتراک</DialogTitle>
            <DialogDescription>
              اطلاعات مالی حذف نمی‌شود. پس از لغو، ثبت اطلاعات جدید تا فعال‌سازی
              دوباره محدود است.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason" className="text-[11px]">
              دلیل لغو
            </Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="دلیل لغو را بنویسید…"
              className="min-h-20 text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setCancelOpen(false)}
              disabled={busy === "cancel"}
            >
              بازگشت
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              onClick={submitCancel}
              disabled={busy === "cancel" || cancelReason.trim().length < 3}
            >
              {busy === "cancel" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              ثبت لغو
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
