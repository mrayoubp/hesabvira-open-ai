import { Brand } from "@/components/app/Brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import {
  formatJalaliLong,
  formatJalaliMonth,
  formatNumber,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  Check,
  CreditCard,
  FileText,
  Loader2,
  LockKeyhole,
  Search,
  Settings,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
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
    label: "مهلت تمدید",
    className: "border-gold/40 bg-gold-soft text-[#7a6122]",
    dot: "bg-gold",
  },
  expired: {
    label: "منقضی‌شده",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
  cancelled: {
    label: "لغو/تعلیق",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
  legacy: {
    label: "قدیمی",
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

const PLAN_LABEL: Record<string, string> = {
  quarterly: "سه‌ماهه",
  annual: "یک‌ساله",
};

function AccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-[28px] border border-hairline/80 bg-surface p-7 text-center shadow-xl">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-destructive/5 text-destructive">
          <LockKeyhole className="size-5" />
        </span>
        <h1 className="mt-4 text-base font-bold text-ink">
          دسترسی مدیریت سامانه مجاز نیست
        </h1>
        <p className="mt-2 text-[11px] leading-6 text-ink-soft">
          این بخش فقط برای مدیر اصلی حساب ویرا با مجوز ویژه فعال است. دسترسی در
          سمت سرور و برای هر درخواست دوباره بررسی می‌شود.
        </p>
        <Button asChild className="mt-5 rounded-xl">
          <Link to="/dashboard">بازگشت به فضای کاری</Link>
        </Button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-brand text-cream shadow-sm"
          : "text-ink-soft hover:bg-cream/60 hover:text-ink"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  accent?: "brand" | "gold" | "red";
}) {
  const classes =
    accent === "gold"
      ? "bg-gold-soft text-[#7a6122]"
      : accent === "red"
        ? "bg-destructive/5 text-destructive"
        : "bg-brand-soft text-brand";
  return (
    <div className="rounded-[24px] border border-hairline/80 bg-surface p-4 shadow-[0_18px_45px_-40px_rgba(22,58,46,0.55)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold text-ink-soft">{label}</p>
        <span
          className={`flex size-8 items-center justify-center rounded-xl ${classes}`}
        >
          {icon}
        </span>
      </div>
      <p className="num mt-3 text-2xl font-black text-ink">{value}</p>
      <p className="mt-1 text-[9px] leading-5 text-ink-soft">{hint}</p>
    </div>
  );
}

export default function AdminSubscriptionsPage() {
  const isAdmin = useQuery(api.platform.amIPlatformAdmin);
  if (isAdmin === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-xs text-ink-soft">
        <Loader2 className="size-4 animate-spin" /> بررسی مجوز مدیریت سامانه…
      </div>
    );
  }
  if (isAdmin === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-xs text-ink-soft">
        <Loader2 className="size-4 animate-spin text-brand" />
        بررسی مجوز مدیر سامانه…
      </div>
    );
  }
  if (!isAdmin) return <AccessDenied />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [tab, setTab] = useState<"customers" | "plans" | "legal" | "settings">(
    "customers",
  );
  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    type: "renew" | "suspend" | "activate";
    businessId: string;
    name: string;
    planId?: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [renewPlanId, setRenewPlanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const overview = useQuery(api.platform.overview, {
    q: queryText || undefined,
    status: statusFilter || undefined,
    planCode: planFilter || undefined,
  });
  const detail = useQuery(
    api.platform.businessDetail,
    detailId ? { businessId: detailId as never } : "skip",
  );
  const renewManually = useMutation(api.platform.renewManually);
  const setState = useMutation(api.platform.setSubscriptionState);

  async function submitAction() {
    if (!dialog) return;
    setBusy("action");
    try {
      if (dialog.type === "renew") {
        await renewManually({
          businessId: dialog.businessId as never,
          planId: (renewPlanId || dialog.planId || undefined) as never,
          reason,
        });
        toast.success("تمدید دستی ثبت و اشتراک فعال شد.");
      } else {
        await setState({
          businessId: dialog.businessId as never,
          action: dialog.type === "suspend" ? "suspend" : "activate",
          reason,
        });
        toast.success(
          dialog.type === "suspend"
            ? "اشتراک معلق شد و دلیل آن ثبت شد."
            : "اشتراک دوباره فعال شد.",
        );
      }
      setDialog(null);
      setReason("");
      setRenewPlanId("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const rows = overview?.rows ?? [];
  const plans = overview?.plans ?? [];
  const maxMonthly = Math.max(
    1,
    ...(overview?.monthly.map((row) => row.amountToman) ?? [0]),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-background/85 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brand subtitle="HESAB VIRA · PLATFORM" />
            <Badge
              variant="outline"
              className="hidden border-gold/40 bg-gold-soft text-[#7a6122] sm:inline-flex"
            >
              مدیر سامانه
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="h-8 rounded-xl text-[10px]">
              <Link to="/dashboard">
                <ArrowLeft className="size-3.5" />
                فضای کاری
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold-soft/50 px-2.5 py-1 text-[10px] font-semibold text-[#7c6126]">
              <ShieldCheck className="size-3 text-gold" />
              مدیریت اشتراک‌ها و درآمد
            </span>
            <h1 className="mt-3 text-[26px] font-black text-ink sm:text-[32px]">
              پنل مدیر حساب ویرا
            </h1>
            <p className="mt-2 max-w-2xl text-[12px] leading-7 text-ink-soft">
              همه اعداد این صفحه از کسب‌وکارها، اشتراک‌ها و فاکتورهای پرداخت‌شده
              واقعی خوانده می‌شوند. هیچ درآمد نمایشی ساخته نمی‌شود.
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 rounded-2xl border border-white/80 bg-white/65 p-1 shadow-sm">
            <TabButton
              active={tab === "customers"}
              onClick={() => setTab("customers")}
              icon={<Users className="size-3.5" />}
            >
              مشتریان و اشتراک‌ها
            </TabButton>
            <TabButton
              active={tab === "plans"}
              onClick={() => setTab("plans")}
              icon={<CreditCard className="size-3.5" />}
            >
              تعرفه‌ها
            </TabButton>
            <TabButton
              active={tab === "legal"}
              onClick={() => setTab("legal")}
              icon={<FileText className="size-3.5" />}
            >
              صفحات حقوقی
            </TabButton>
            <TabButton
              active={tab === "settings"}
              onClick={() => setTab("settings")}
              icon={<Settings className="size-3.5" />}
            >
              تنظیمات پرداخت
            </TabButton>
          </nav>
        </div>

        {overview === undefined ? (
          <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-ink-soft">
            <Loader2 className="size-4 animate-spin" /> در حال خواندن داده‌های
            واقعی…
          </div>
        ) : tab === "customers" ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                label="کل کسب‌وکارها"
                value={formatNumber(overview.totals.businesses)}
                hint="فضاهای کاری ثبت‌شده"
                icon={<Building2 className="size-4" />}
              />
              <Metric
                label="اشتراک فعال"
                value={formatNumber(overview.totals.active)}
                hint="با دسترسی کامل به ثبت اطلاعات"
                icon={<BadgeCheck className="size-4" />}
              />
              <Metric
                label="در انتظار پرداخت"
                value={formatNumber(overview.totals.pending)}
                hint="بدون ثبت اطلاعات جدید"
                icon={<CalendarClock className="size-4" />}
                accent="gold"
              />
              <Metric
                label="منقضی / مهلت تمدید"
                value={formatNumber(overview.totals.expired)}
                hint="مشاهده و خروجی حفظ می‌شود"
                icon={<XCircle className="size-4" />}
                accent="red"
              />
              <Metric
                label="درآمد ثبت‌شده"
                value={formatNumber(overview.totals.paidToman)}
                hint="جمع فاکتورهای پرداخت‌شده (تومان)"
                icon={<Activity className="size-4" />}
                accent="gold"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-[0_20px_50px_-42px_rgba(22,58,46,0.55)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-ink">
                      درآمد ماهانه اشتراک
                    </p>
                    <p className="mt-1 text-[10px] text-ink-soft">
                      بر اساس زمان تأیید پرداخت، ۱۲ ماه اخیر
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-brand/20 bg-brand-soft text-brand"
                  >
                    تومان
                  </Badge>
                </div>
                <div className="mt-5 flex h-32 items-end gap-2">
                  {overview.monthly.map((month) => (
                    <div
                      key={month.start}
                      className="flex flex-1 flex-col items-center gap-1.5"
                      title={`${formatNumber(month.amountToman)} تومان`}
                    >
                      <span className="num text-[8px] text-ink-soft">
                        {month.amountToman > 0
                          ? formatNumber(month.amountToman)
                          : ""}
                      </span>
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-brand/45 to-brand"
                        style={{
                          height: `${Math.max(
                            month.amountToman > 0 ? 5 : 1,
                            Math.round((month.amountToman / maxMonthly) * 100),
                          )}%`,
                        }}
                      />
                      <span className="text-[8px] text-ink-soft">
                        {formatJalaliMonth(month.start)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-[0_20px_50px_-42px_rgba(22,58,46,0.55)]">
                <p className="text-sm font-bold text-ink">درآمد سالانه</p>
                <p className="mt-1 text-[10px] text-ink-soft">
                  جمع فاکتورهای پرداخت‌شده به تفکیک سال میلادی ثبت
                </p>
                <div className="mt-4 space-y-2">
                  {overview.annual.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-hairline p-3 text-center text-[10px] text-ink-soft">
                      هنوز پرداخت موفقی ثبت نشده است.
                    </p>
                  ) : (
                    overview.annual.map((row) => (
                      <div
                        key={row.year}
                        className="flex items-center justify-between rounded-xl border border-hairline/60 bg-background/50 px-3 py-2"
                      >
                        <span className="num text-[10px] text-ink-soft">
                          {row.year}
                        </span>
                        <span className="num text-[11px] font-bold text-ink">
                          {formatNumber(row.amountToman)}{" "}
                          <span className="font-sans text-[8px] font-normal text-ink-soft">
                            تومان
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-hairline/80 bg-surface shadow-[0_20px_50px_-42px_rgba(22,58,46,0.55)]">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-ink">مشتریان</p>
                  <p className="mt-1 text-[10px] text-ink-soft">
                    جستجو و فیلتر در سمت سرور؛ {formatNumber(rows.length)} نتیجه
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-soft/60" />
                    <Input
                      value={queryText}
                      onChange={(event) => setQueryText(event.target.value)}
                      placeholder="نام کسب‌وکار، مدیر یا ایمیل…"
                      className="h-8 w-52 rounded-xl ps-8 text-[10px]"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="h-8 rounded-xl border border-input bg-background/60 px-2 text-[10px]"
                  >
                    <option value="">همه وضعیت‌ها</option>
                    <option value="active">فعال</option>
                    <option value="pending_payment">در انتظار پرداخت</option>
                    <option value="grace">مهلت تمدید</option>
                    <option value="expired">منقضی‌شده</option>
                    <option value="cancelled">لغوشده</option>
                  </select>
                  <select
                    value={planFilter}
                    onChange={(event) => setPlanFilter(event.target.value)}
                    className="h-8 rounded-xl border border-input bg-background/60 px-2 text-[10px]"
                  >
                    <option value="">همه پلن‌ها</option>
                    {plans.map((plan) => (
                      <option key={plan._id} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto border-t border-hairline/50">
                {rows.length === 0 ? (
                  <p className="py-12 text-center text-[11px] text-ink-soft">
                    مشتری‌ای با این فیلتر پیدا نشد.
                  </p>
                ) : (
                  <table className="w-full min-w-[900px] text-[10px]">
                    <thead className="bg-background/55 text-ink-soft">
                      <tr>
                        <th className="px-4 py-2.5 text-start font-medium">
                          کسب‌وکار
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          مدیر
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          پلن
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          وضعیت
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          پایان
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          پرداخت‌شده (تومان)
                        </th>
                        <th className="px-2 py-2.5 text-start font-medium">
                          عملیات
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const meta =
                          STATUS_META[row.status] ?? STATUS_META.pending_payment;
                        return (
                          <tr
                            key={row.businessId}
                            className="border-t border-hairline/40 hover:bg-background/30"
                          >
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => setDetailId(row.businessId)}
                                className="text-start"
                              >
                                <span className="block font-bold text-ink">
                                  {row.name}
                                </span>
                                <span className="mt-0.5 block text-[9px] text-ink-soft">
                                  {row.businessType ?? "—"} ·{" "}
                                  {row.city ?? "—"}
                                </span>
                              </button>
                            </td>
                            <td className="px-2 py-3">
                              <p className="text-ink">{row.ownerName ?? "—"}</p>
                              <p className="mt-0.5 text-[8px] text-ink-soft">
                                {row.ownerEmail ?? "—"}
                              </p>
                            </td>
                            <td className="px-2 py-3">
                              <Badge
                                variant="outline"
                                className="border-hairline bg-white/60 font-normal"
                              >
                                {row.planName ??
                                  (row.planCode
                                    ? PLAN_LABEL[row.planCode] ?? row.planCode
                                    : "—")}
                              </Badge>
                            </td>
                            <td className="px-2 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${meta.className}`}
                              >
                                <span
                                  className={`size-1.5 rounded-full ${meta.dot}`}
                                />
                                {meta.label}
                              </span>
                            </td>
                            <td className="num px-2 py-3 text-[9px] text-ink-soft">
                              {row.endAt ? formatJalaliLong(row.endAt) : "—"}
                            </td>
                            <td className="num px-2 py-3 font-bold text-ink">
                              {formatNumber(row.paidTotalToman)}
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-lg px-2 text-[9px]"
                                  onClick={() => {
                                    setDialog({
                                      type: "renew",
                                      businessId: row.businessId,
                                      name: row.name,
                                      planId: row.planId ?? undefined,
                                    });
                                    setRenewPlanId(row.planId ?? "");
                                    setReason("");
                                  }}
                                >
                                  تمدید
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 rounded-lg px-2 text-[9px]"
                                  onClick={() => {
                                    setDialog({
                                      type:
                                        row.status === "cancelled"
                                          ? "activate"
                                          : "suspend",
                                      businessId: row.businessId,
                                      name: row.name,
                                    });
                                    setReason("");
                                  }}
                                >
                                  {row.status === "cancelled"
                                    ? "فعال‌سازی"
                                    : "تعلیق"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-sm">
              <p className="text-sm font-bold text-ink">
                آخرین اقدامات مدیر سامانه
              </p>
              <div className="mt-3 space-y-2">
                {overview.recentAudit.length === 0 ? (
                  <p className="text-[10px] text-ink-soft">
                    هنوز اقدام مدیریتی ثبت نشده است.
                  </p>
                ) : (
                  overview.recentAudit.map((row) => (
                    <div
                      key={row._id}
                      className="flex flex-col gap-1 rounded-xl border border-hairline/50 bg-background/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-[10px] text-ink">{row.summary}</span>
                      <span className="num text-[8px] text-ink-soft">
                        {formatJalaliLong(row.createdAt)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : tab === "plans" ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-gold/25 bg-gold-soft/35 px-4 py-3 text-[10px] leading-5 text-[#6f551d]">
              فقط دو پلن رسمی مجاز است. تغییر قیمت، مدت یا محدودیت‌ها فقط از
              همین‌جا انجام می‌شود و در Audit Log ثبت می‌گردد. پلن‌های قدیمی
              مشتریان با مبلغ فاکتور پرداخت‌شده قبلی تحت تأثیر قرار نمی‌گیرند.
            </div>
            {plans.length === 0 ? (
              <EmptySeed />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {plans.map((plan) => (
                  <PlanEditor key={`${plan._id}-${plan.updatedAt}`} plan={plan} />
                ))}
              </div>
            )}
          </div>
        ) : tab === "legal" ? (
          <div className="mt-5">
            <LegalAdmin />
          </div>
        ) : (
          <div className="mt-5 max-w-2xl">
            <BillingSettings />
          </div>
        )}
      </main>

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>پرونده اشتراک مشتری</DialogTitle>
            <DialogDescription>
              اطلاعات تماس، اعضا، فاکتورها، پرداخت‌ها و تاریخچه رویدادها.
            </DialogDescription>
          </DialogHeader>
          {detail === undefined ? (
            <div className="flex items-center justify-center py-10 text-xs text-ink-soft">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : detail === null ? (
            <p className="py-10 text-center text-xs text-ink-soft">
              پرونده پیدا نشد.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-brand-soft/50 p-3">
                  <p className="text-[9px] text-ink-soft">کسب‌وکار</p>
                  <p className="mt-1 text-xs font-bold text-ink">
                    {detail.business.name}
                  </p>
                  <p className="mt-1 text-[9px] text-ink-soft">
                    {detail.business.businessType ?? "—"} ·{" "}
                    {detail.business.city ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl bg-gold-soft/50 p-3">
                  <p className="text-[9px] text-ink-soft">پلن و وضعیت</p>
                  <p className="mt-1 text-xs font-bold text-ink">
                    {detail.plan?.name ?? "—"}
                  </p>
                  <p className="mt-1 text-[9px] text-ink-soft">
                    {STATUS_META[detail.access.status]?.label ??
                      detail.access.status}
                  </p>
                </div>
                <div className="rounded-xl bg-mist/40 p-3">
                  <p className="text-[9px] text-ink-soft">اعضا</p>
                  <p className="num mt-1 text-xs font-bold text-ink">
                    {formatNumber(detail.members.length)}
                  </p>
                  <p className="mt-1 text-[9px] text-ink-soft">
                    {detail.members
                      .map((member) => member.name ?? member.email ?? "—")
                      .slice(0, 2)
                      .join("، ")}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold text-ink">فاکتورها</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[9px]">
                    <thead className="text-ink-soft">
                      <tr className="border-b border-hairline/60">
                        <th className="py-2 text-start font-medium">شماره</th>
                        <th className="py-2 text-start font-medium">دوره</th>
                        <th className="py-2 text-start font-medium">
                          مبلغ (تومان)
                        </th>
                        <th className="py-2 text-start font-medium">وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.invoices.map((invoice) => (
                        <tr
                          key={invoice._id}
                          className="border-b border-hairline/30 last:border-0"
                        >
                          <td className="num py-2 font-mono text-[8px]">
                            {invoice.number}
                          </td>
                          <td className="num py-2 text-ink-soft">
                            {formatJalaliLong(invoice.periodStart)}
                          </td>
                          <td className="num py-2 font-bold">
                            {formatNumber(invoice.amountToman)}
                          </td>
                          <td className="py-2">
                            {INVOICE_STATUS[invoice.status] ?? invoice.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detail.invoices.length === 0 ? (
                    <p className="py-3 text-[9px] text-ink-soft">
                      فاکتوری ثبت نشده است.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold text-ink">پرداخت‌ها</p>
                  <div className="mt-2 space-y-1.5">
                    {detail.payments.length === 0 ? (
                      <p className="text-[9px] text-ink-soft">
                        پرداختی ثبت نشده است.
                      </p>
                    ) : (
                      detail.payments.map((payment) => (
                        <div
                          key={payment._id}
                          className="flex items-center justify-between rounded-lg border border-hairline/50 px-2 py-1.5"
                        >
                          <span className="text-[9px] text-ink-soft">
                            {payment.provider} · {payment.status}
                          </span>
                          <span className="num text-[9px] font-bold">
                            {formatNumber(payment.amountToman)} تومان
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-ink">تاریخچه</p>
                  <div className="mt-2 space-y-1.5">
                    {detail.events.slice(0, 6).map((event) => (
                      <div
                        key={event._id}
                        className="rounded-lg border border-hairline/50 px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-semibold">
                            {event.type}
                          </span>
                          <span className="num text-[8px] text-ink-soft">
                            {formatJalaliLong(event.createdAt)}
                          </span>
                        </div>
                        {event.reason ? (
                          <p className="mt-1 text-[8px] text-ink-soft">
                            {event.reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {detail.events.length === 0 ? (
                      <p className="text-[9px] text-ink-soft">
                        رویدادی ثبت نشده است.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "renew"
                ? "تمدید دستی اشتراک"
                : dialog?.type === "suspend"
                  ? "تعلیق اشتراک"
                  : "فعال‌سازی دوباره اشتراک"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.name} — دلیل این اقدام در Audit Log ثبت می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog?.type === "renew" ? (
              <div className="space-y-1.5">
                <Label className="text-[11px]">پلن تمدید</Label>
                <select
                  value={renewPlanId}
                  onChange={(event) => setRenewPlanId(event.target.value)}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2 text-xs"
                >
                  <option value="">پلن فعلی</option>
                  {plans.map((plan) => (
                    <option key={plan._id} value={plan._id}>
                      {plan.name} — {formatNumber(plan.priceToman)} تومان
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="admin-action-reason" className="text-[11px]">
                دلیل (الزامی)
              </Label>
              <Textarea
                id="admin-action-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-20 text-xs"
                placeholder="دلیل را برای پیگیری ثبت کنید…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setDialog(null)}
              disabled={busy === "action"}
            >
              انصراف
            </Button>
            <Button
              className="rounded-xl"
              onClick={submitAction}
              disabled={busy === "action" || reason.trim().length < 3}
            >
              {busy === "action" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              ثبت اقدام
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptySeed() {
  const seed = useMutation(api.platform.seedDefaults);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[26px] border border-dashed border-hairline bg-white/60 p-8 text-center">
      <p className="text-sm font-bold text-ink">داده اولیه تعرفه‌ها پیدا نشد</p>
      <p className="mx-auto mt-2 max-w-md text-[10px] leading-6 text-ink-soft">
        دو پلن رسمی سه‌ماهه و یک‌ساله، صفحات حقوقی و تنظیمات پرداخت را یک‌بار
        ایجاد کنید. این عملیات فقط توسط مدیر سامانه مجاز است.
      </p>
      <Button
        className="mt-4 rounded-xl"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await seed({});
            toast.success("داده‌های اولیه ساخته شد.");
          } catch (error) {
            toast.error(getErrorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        ایجاد داده‌های اولیه
      </Button>
    </div>
  );
}

interface PlanRow {
  _id: string;
  code: string;
  name: string;
  description: string;
  durationMonths: number;
  priceToman: number;
  active: boolean;
  features: string[];
  limits: {
    maxUsers: number;
    maxBranches: number;
    maxWarehouses: number;
    maxStorageMb: number;
    allowedModules: string[];
    advancedFeatures: string[];
  };
}

function PlanEditor({ plan }: { plan: PlanRow }) {
  const update = useMutation(api.platform.updatePlan);
  const [form, setForm] = useState({
    name: plan.name,
    description: plan.description,
    durationMonths: String(plan.durationMonths),
    priceToman: String(plan.priceToman),
    active: plan.active,
    features: plan.features.join("\n"),
    maxUsers: String(plan.limits.maxUsers),
    maxBranches: String(plan.limits.maxBranches),
    maxWarehouses: String(plan.limits.maxWarehouses),
    maxStorageMb: String(plan.limits.maxStorageMb),
    allowedModules: plan.limits.allowedModules.join(", "),
    advancedFeatures: plan.limits.advancedFeatures.join(", "),
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      await update({
        planId: plan._id as never,
        name: form.name,
        description: form.description,
        durationMonths: Number(form.durationMonths),
        priceToman: Number(form.priceToman),
        active: form.active,
        features: form.features
          .split("\n")
          .map((row) => row.trim())
          .filter(Boolean),
        limits: {
          maxUsers: Number(form.maxUsers),
          maxBranches: Number(form.maxBranches),
          maxWarehouses: Number(form.maxWarehouses),
          maxStorageMb: Number(form.maxStorageMb),
          allowedModules: form.allowedModules
            .split(",")
            .map((row) => row.trim())
            .filter(Boolean),
          advancedFeatures: form.advancedFeatures
            .split(",")
            .map((row) => row.trim())
            .filter(Boolean),
        },
      });
      toast.success(`${form.name} به‌روزرسانی شد.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-[0_20px_50px_-42px_rgba(22,58,46,0.55)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">{plan.name}</p>
          <p className="mt-0.5 font-mono text-[9px] text-ink-soft">
            {plan.code}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            form.active
              ? "border-brand/20 bg-brand-soft text-brand"
              : "border-hairline bg-muted text-ink-soft"
          }
        >
          {form.active ? "فعال" : "غیرفعال"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[10px]">نام پلن</Label>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            className="h-9 rounded-xl text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">مدت (ماه)</Label>
          <Input
            type="number"
            value={form.durationMonths}
            onChange={(event) => set("durationMonths", event.target.value)}
            className="num h-9 rounded-xl text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">قیمت (تومان)</Label>
          <Input
            type="number"
            value={form.priceToman}
            onChange={(event) => set("priceToman", event.target.value)}
            className="num h-9 rounded-xl text-xs"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[10px]">توضیح</Label>
          <Textarea
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            className="min-h-16 text-xs"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[10px]">ویژگی‌ها (هر خط یک مورد)</Label>
          <Textarea
            value={form.features}
            onChange={(event) => set("features", event.target.value)}
            className="min-h-24 text-xs"
          />
        </div>
        {(
          [
            ["maxUsers", "کاربر"],
            ["maxBranches", "شعبه"],
            ["maxWarehouses", "انبار"],
            ["maxStorageMb", "مگابایت فایل"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label className="text-[10px]">{label}</Label>
            <Input
              type="number"
              value={form[key]}
              onChange={(event) => set(key, event.target.value)}
              className="num h-9 rounded-xl text-xs"
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label className="text-[10px]">ماژول‌های مجاز (با کاما)</Label>
          <Input
            value={form.allowedModules}
            onChange={(event) => set("allowedModules", event.target.value)}
            className="h-9 rounded-xl text-[10px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">امکانات پیشرفته (با کاما)</Label>
          <Input
            value={form.advancedFeatures}
            onChange={(event) => set("advancedFeatures", event.target.value)}
            className="h-9 rounded-xl text-[10px]"
          />
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[10px] text-ink-soft">
        <Checkbox
          checked={form.active}
          onCheckedChange={(value) => set("active", value === true)}
        />
        پلن برای ثبت‌نام جدید فعال باشد
      </label>
      <Button
        className="mt-4 h-9 w-full rounded-xl text-[11px]"
        onClick={save}
        disabled={busy}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        ذخیره تغییرات تعرفه
      </Button>
    </div>
  );
}

function LegalAdmin() {
  const pages = useQuery(api.platform.adminLegalPages);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  if (pages === undefined) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-xs text-ink-soft">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (pages.length === 0) return <EmptySeed />;
  const selected =
    pages.find((page) => page.slug === selectedSlug) ?? pages[0];
  return (
    <div className="grid gap-4 xl:grid-cols-[0.35fr_0.65fr]">
      <div className="space-y-2">
        <p className="px-1 text-[10px] font-semibold text-ink-soft">
          صفحات حقوقی و پشتیبانی
        </p>
        {pages.map((page) => (
          <button
            key={page._id}
            type="button"
            onClick={() => setSelectedSlug(page.slug)}
            className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors ${
              page.slug === selected.slug
                ? "border-brand/25 bg-brand-soft/70"
                : "border-hairline/60 bg-white/60 hover:bg-white"
            }`}
          >
            <span>
              <span className="block text-[11px] font-semibold text-ink">
                {page.title}
              </span>
              <span className="mt-0.5 block font-mono text-[8px] text-ink-soft">
                /legal/{page.slug}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[8px] text-ink-soft">
              نسخه {page.version.toLocaleString("fa-IR")}
              {page.active ? (
                <Check className="size-3 text-brand" />
              ) : (
                <XCircle className="size-3 text-destructive" />
              )}
            </span>
          </button>
        ))}
      </div>
      <LegalEditor key={`${selected._id}-${selected.version}`} page={selected} />
    </div>
  );
}

function LegalEditor({
  page,
}: {
  page: {
    _id: string;
    slug: string;
    title: string;
    content: string;
    version: number;
    active: boolean;
    updatedAt: number;
  };
}) {
  const update = useMutation(api.platform.updateLegalPage);
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content);
  const [active, setActive] = useState(page.active);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await update({
        pageId: page._id as never,
        title,
        content,
        active,
      });
      toast.success("صفحه حقوقی به‌روزرسانی شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-[0_18px_45px_-40px_rgba(22,58,46,0.55)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[9px] text-ink-soft">{page.slug}</p>
          <p className="mt-1 text-sm font-bold text-ink">{page.title}</p>
        </div>
        <Badge variant="outline" className="border-hairline">
          نسخه {page.version.toLocaleString("fa-IR")}
        </Badge>
      </div>
      <div className="mt-4 space-y-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-9 rounded-xl text-xs"
        />
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="min-h-64 text-[11px] leading-6"
        />
        <label className="flex items-center gap-2 text-[10px] text-ink-soft">
          <Checkbox
            checked={active}
            onCheckedChange={(value) => setActive(value === true)}
          />
          صفحه برای کاربران نمایش داده شود
        </label>
        <Button
          className="h-9 w-full rounded-xl text-[11px]"
          onClick={save}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          ذخیره متن حقوقی
        </Button>
      </div>
    </div>
  );
}

function BillingSettings() {
  const settings = useQuery(api.platform.adminBillingSettings);
  if (settings === undefined) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-xs text-ink-soft">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  return (
    <BillingSettingsForm
      initial={{
        testMode: settings.testMode,
        provider: settings.provider,
        gatewayLabel: settings.gatewayLabel,
        graceDays: String(settings.graceDays),
      }}
      requiredEnv={settings.requiredEnv}
    />
  );
}

function BillingSettingsForm({
  initial,
  requiredEnv,
}: {
  initial: {
    testMode: boolean;
    provider: string;
    gatewayLabel: string;
    graceDays: string;
  };
  requiredEnv: string[];
}) {
  const update = useMutation(api.platform.updateBillingSettings);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await update({
        testMode: form.testMode,
        provider: form.provider as "test" | "zarinpal" | "none",
        gatewayLabel: form.gatewayLabel,
        graceDays: Number(form.graceDays),
      });
      toast.success("تنظیمات پرداخت ذخیره شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[26px] border border-hairline/80 bg-surface p-5 shadow-[0_20px_50px_-42px_rgba(22,58,46,0.55)]">
      <p className="text-sm font-bold text-ink">تنظیمات درگاه و مهلت تمدید</p>
      <p className="mt-1 text-[10px] leading-5 text-ink-soft">
        کلیدها و اطلاعات محرمانه فقط در متغیرهای محیطی سمت سرور نگه‌داری
        می‌شوند. این صفحه هیچ Secret را نمایش نمی‌دهد.
      </p>
      <div className="mt-4 space-y-3">
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-gold/25 bg-gold-soft/30 px-3 py-2.5 text-[10px] leading-5 text-[#6f551d]">
          <Checkbox
            checked={form.testMode}
            onCheckedChange={(value) =>
              setForm((current) => ({
                ...current,
                testMode: value === true,
              }))
            }
            className="mt-0.5"
          />
          <span>
            <strong>پرداخت آزمایشی فعال باشد.</strong> در این حالت هیچ پرداخت
            واقعی انجام نمی‌شود و همه تراکنش‌ها با برچسب آزمایشی ثبت می‌شوند. پیش
            از Production این گزینه را خاموش کنید.
          </span>
        </label>
        <div className="space-y-1.5">
          <Label className="text-[10px]">درگاه</Label>
          <select
            value={form.provider}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                provider: event.target.value,
              }))
            }
            className="h-9 w-full rounded-xl border border-input bg-background px-2 text-xs"
          >
            <option value="test">آزمایشی داخلی</option>
            <option value="zarinpal">زرین‌پال (ساختار آماده، بدون کلید)</option>
            <option value="none">غیرفعال</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">نام نمایشی درگاه</Label>
          <Input
            value={form.gatewayLabel}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                gatewayLabel: event.target.value,
              }))
            }
            className="h-9 rounded-xl text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">مهلت تمدید (روز)</Label>
          <Input
            type="number"
            value={form.graceDays}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                graceDays: event.target.value,
              }))
            }
            className="num h-9 rounded-xl text-xs"
          />
        </div>
        <div className="rounded-xl border border-hairline/60 bg-background/50 p-3">
          <p className="text-[10px] font-semibold text-ink">
            متغیرهای محیطی لازم برای درگاه واقعی
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {requiredEnv.map((key) => (
              <code
                key={key}
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[8px] text-ink-soft"
              >
                {key}
              </code>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-5 text-ink-soft">
            تا اتصال و آزمایش امضای Webhook، پرداخت واقعی فعال نیست. کلیدها را
            از بخش Keys پروژه وارد کنید.
          </p>
        </div>
        <Button
          className="h-9 w-full rounded-xl text-[11px]"
          onClick={save}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          ذخیره تنظیمات پرداخت
        </Button>
      </div>
    </div>
  );
}
