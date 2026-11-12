import "@/styles/dashboard-luxe.css";
import {
  BranchSelector,
  FiscalYearSelector,
} from "@/components/app/HeaderSelectors";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  currencyUnit,
  formatJalali,
  formatMoney,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpLeft,
  ArrowUpRight,
  Banknote,
  Boxes,
  CalendarRange,
  Coins,
  CreditCard,
  ExternalLink,
  FileText,
  HandCoins,
  Info,
  Landmark,
  Loader2,
  PackagePlus,
  Plus,
  Receipt,
  ReceiptText,
  Scale,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PeriodKey =
  | "today"
  | "week"
  | "month"
  | "lastMonth"
  | "quarter"
  | "year"
  | "custom";

type OverviewData = FunctionReturnType<typeof api.dashboard.overview>;
type FinanceOverviewData = FunctionReturnType<typeof api.finance.overview>;
type TreasuryData = FunctionReturnType<typeof api.treasury.accountBalances>;
type ReceiptRow = FunctionReturnType<typeof api.receipts.list>[number];
type PaymentRow = FunctionReturnType<typeof api.paymentVouchers.list>[number];
type SaleRow = FunctionReturnType<typeof api.sales.list>[number];
type PurchaseRow = FunctionReturnType<typeof api.purchases.list>[number];

const PERIOD_PRESETS: { value: PeriodKey; label: string; hint: string }[] = [
  { value: "today", label: "روزانه", hint: "امروز" },
  { value: "week", label: "هفتگی", hint: "این هفته" },
  { value: "month", label: "ماهانه", hint: "این ماه" },
  { value: "year", label: "سالانه", hint: "سال جاری" },
];

const PERIOD_NAMES: Record<PeriodKey, string> = {
  today: "امروز",
  week: "این هفته",
  month: "این ماه",
  lastMonth: "ماه گذشته",
  quarter: "سه ماه اخیر",
  year: "سال جاری",
  custom: "بازه دلخواه",
};

const REPORT_TABS = [
  {
    key: "sales",
    label: "آخرین فروش",
    title: "فاکتورهای فروش",
    icon: ReceiptText,
    listHref: "/dashboard/commerce/sales",
    createHref: "/dashboard/invoices/new",
    createLabel: "ثبت فاکتور فروش",
    empty: "در این بازه فاکتور فروشی ثبت نشده است.",
  },
  {
    key: "purchases",
    label: "آخرین خرید",
    title: "فاکتورهای خرید",
    icon: ShoppingCart,
    listHref: "/dashboard/commerce/purchases",
    createHref: "/dashboard/commerce/purchases",
    createLabel: "ثبت فاکتور خرید",
    empty: "در این بازه فاکتور خریدی ثبت نشده است.",
  },
  {
    key: "receipts",
    label: "آخرین دریافت",
    title: "دریافت‌های وجه",
    icon: HandCoins,
    listHref: "/dashboard/finance/receipts",
    createHref: "/dashboard/finance/receipts",
    createLabel: "ثبت دریافت",
    empty: "در این بازه دریافت تأییدشده‌ای ثبت نشده است.",
  },
  {
    key: "payments",
    label: "آخرین پرداخت",
    title: "پرداخت‌های وجه",
    icon: Banknote,
    listHref: "/dashboard/finance/payments",
    createHref: "/dashboard/finance/payments",
    createLabel: "ثبت پرداخت",
    empty: "در این بازه پرداخت تأییدشده‌ای ثبت نشده است.",
  },
] as const;

type ReportTabKey = (typeof REPORT_TABS)[number]["key"];
type StatusTone = "brand" | "gold" | "muted" | "danger";

const STATUS_TONES: Record<StatusTone, string> = {
  brand: "border-brand/20 bg-brand-soft text-brand dark:bg-brand-soft/30",
  gold: "border-gold/30 bg-gold-soft text-[#7a6122] dark:text-gold",
  muted: "border-hairline bg-cream/50 text-ink-soft dark:bg-white/[0.05]",
  danger: "border-destructive/25 bg-destructive/5 text-destructive",
};

const INVOICE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "پیش‌نویس", tone: "muted" },
  issued: { label: "صادرشده", tone: "gold" },
  paid: { label: "پرداخت‌شده", tone: "brand" },
  void: { label: "ابطال", tone: "danger" },
};

const PURCHASE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "پیش‌نویس", tone: "muted" },
  posted: { label: "ثبت‌شده", tone: "gold" },
  paid: { label: "پرداخت‌شده", tone: "brand" },
  cancelled: { label: "ابطال", tone: "danger" },
};

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const QUICK_ACTIONS = [
  {
    label: "ثبت فاکتور فروش",
    icon: ReceiptText,
    to: "/dashboard/invoices/new",
  },
  {
    label: "ثبت فاکتور خرید",
    icon: ShoppingCart,
    to: "/dashboard/commerce/purchases",
  },
  {
    label: "دریافت وجه",
    icon: HandCoins,
    to: "/dashboard/finance/receipts",
  },
  {
    label: "پرداخت وجه",
    icon: Banknote,
    to: "/dashboard/finance/payments",
  },
  {
    label: "افزودن کالا",
    icon: PackagePlus,
    to: "/dashboard/commerce/products?new=1",
  },
  {
    label: "افزودن شخص",
    icon: UserPlus,
    to: "/dashboard/customers?new=1",
  },
  {
    label: "ثبت هزینه",
    icon: Receipt,
    to: "/dashboard/finance/income-expenses?tab=expenses",
  },
] as const;

interface DocumentRow {
  id: string;
  reference: string;
  party: string;
  amount: number;
  date: number;
  statusLabel: string;
  statusTone: StatusTone;
  href: string;
}

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-cream/60 px-2 py-1 text-[11px] font-medium text-ink-soft dark:bg-white/[0.05]">
        دوره جاری
      </span>
    );
  }

  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold",
        value === 0
          ? "bg-cream/60 text-ink-soft dark:bg-white/[0.05]"
          : positive
            ? "bg-brand-soft text-brand dark:bg-brand-soft/30"
            : "bg-destructive/10 text-destructive",
      )}
      title="تغییر نسبت به دوره قبل"
    >
      <Icon className="size-2.5" />
      {formatNumber(Math.abs(value))}٪
    </span>
  );
}

function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  change,
  href,
  cta,
  featured = false,
  valueDanger = false,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  icon: ReactNode;
  change: number | null;
  href: string;
  cta: string;
  featured?: boolean;
  valueDanger?: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative flex min-h-[188px] flex-col overflow-hidden rounded-[22px] p-5 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5",
        featured
          ? "border border-[#1c5544] bg-[linear-gradient(132deg,#0b3328_0%,#0f4b3a_58%,#092e23_100%)] text-cream shadow-[0_26px_54px_-36px_rgba(8,45,34,0.85)]"
          : "border border-hairline/80 bg-surface shadow-[0_1px_2px_rgba(24,34,44,0.03),0_20px_46px_-42px_rgba(15,81,63,0.28)] dark:border-white/[0.08] dark:bg-card",
      )}
    >
      {featured ? (
        <>
          <span
            className="pointer-events-none absolute -start-10 -top-14 size-40 rounded-full bg-[#4d9d82]/20 blur-3xl"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-l from-transparent via-gold/60 to-transparent"
            aria-hidden
          />
          <TrendingUp
            className="pointer-events-none absolute -bottom-5 -end-4 size-28 text-white/[0.035]"
            strokeWidth={1}
            aria-hidden
          />
        </>
      ) : (
        <span
          className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-l from-transparent via-brand/25 to-transparent"
          aria-hidden
        />
      )}

      <div className="relative flex items-start justify-between gap-3">
        <span
          className={cn(
            "text-[12px] font-semibold leading-4",
            featured ? "text-cream/60" : "text-ink-soft",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[11px] transition-transform duration-300 group-hover:scale-105",
            featured
              ? "bg-white/[0.09] text-gold ring-1 ring-inset ring-white/10"
              : "bg-brand-soft text-brand dark:bg-brand-soft/30",
          )}
          aria-hidden
        >
          {icon}
        </span>
      </div>

      <p
        className={cn(
          "num relative mt-4 truncate text-[26px] font-bold leading-none tracking-[-0.01em]",
          featured
            ? "text-cream"
            : valueDanger
              ? "text-destructive"
              : "text-ink",
        )}
        title={`${value} ${unit}`}
      >
        {value}
        <span
          className={cn(
            "ms-1.5 font-sans text-[12px] font-normal",
            featured ? "text-cream/40" : "text-ink-soft",
          )}
        >
          {unit}
        </span>
      </p>

      <div className="relative mt-3 flex min-w-0 items-center gap-2">
        <ChangeBadge value={change} />
        <p
          className={cn(
            "truncate text-[11px] leading-4",
            featured ? "text-cream/45" : "text-ink-soft",
          )}
          title={hint}
        >
          {hint}
        </p>
      </div>

      <Link
        to={href}
        className={cn(
          "relative mt-auto flex items-center gap-1 pt-3 text-[12px] font-semibold transition-opacity hover:opacity-100",
          featured ? "text-gold/85" : "text-brand opacity-80",
        )}
      >
        {cta}
        <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
      </Link>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-gold">
            <span className="h-px w-4 bg-gold/60" aria-hidden />
            {eyebrow}
          </span>
        ) : null}
        <h2 className="text-[15px] font-extrabold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[164px] rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="h-[152px] rounded-[24px]" />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-[358px] rounded-[24px]" />
        <Skeleton className="h-[358px] rounded-[24px]" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[340px] rounded-[24px]" />
        <Skeleton className="h-[340px] rounded-[24px]" />
      </div>
    </div>
  );
}

function PeriodFilters({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  periodLabel,
  refreshing,
  customRangeTooLong,
}: {
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  periodLabel: string;
  refreshing: boolean;
  customRangeTooLong: boolean;
}) {
  const isMainPeriod = PERIOD_PRESETS.some((option) => option.value === period);

  return (
    <Panel className="overflow-hidden p-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand dark:bg-brand-soft/30">
            <CalendarRange className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-ink">بازه گزارش</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-soft">
              {periodLabel}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-background/75 p-1 dark:bg-white/[0.04]"
            role="group"
            aria-label="انتخاب بازه گزارش"
          >
            {PERIOD_PRESETS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPeriodChange(option.value)}
                aria-pressed={period === option.value}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all",
                  period === option.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-ink-soft hover:bg-cream/70 hover:text-ink dark:hover:bg-white/[0.07]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Select
            value={isMainPeriod ? undefined : period}
            onValueChange={(value) => onPeriodChange(value as PeriodKey)}
          >
            <SelectTrigger className="h-9 w-[132px] rounded-full border-hairline/80 bg-surface text-[12px] shadow-none">
              <SelectValue placeholder="بازه‌های بیشتر" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="lastMonth">ماه گذشته</SelectItem>
              <SelectItem value="quarter">سه ماه اخیر</SelectItem>
              <SelectItem value="custom">بازه دلخواه</SelectItem>
            </SelectContent>
          </Select>

          <div className="hidden items-center gap-1.5 sm:flex">
            <BranchSelector compact />
            <FiscalYearSelector compact />
          </div>

          {refreshing ? (
            <Loader2
              className="size-3.5 animate-spin text-brand"
              aria-label="در حال به‌روزرسانی"
            />
          ) : null}
        </div>
      </div>

      {period === "custom" ? (
        <div className="mt-3 grid gap-2 border-t border-hairline/60 pt-3 sm:grid-cols-[150px_150px_1fr]">
          <label className="flex items-center gap-2 text-[12px] text-ink-soft">
            از تاریخ
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => onCustomFromChange(event.target.value)}
              className="num h-8 rounded-lg border-hairline bg-background px-2 text-[12px]"
              dir="ltr"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-ink-soft">
            تا تاریخ
            <Input
              type="date"
              value={customTo}
              onChange={(event) => onCustomToChange(event.target.value)}
              className="num h-8 rounded-lg border-hairline bg-background px-2 text-[12px]"
              dir="ltr"
            />
          </label>
          <span className="self-center text-[11px] leading-5 text-ink-soft">
            بازه دلخواه با تقویم میلادی انتخاب می‌شود و گزارش‌ها با تاریخ شمسی
            نمایش داده می‌شوند.
          </span>
          {customRangeTooLong ? (
            <p
              className="flex items-center gap-1.5 self-center rounded-lg border border-gold/30 bg-gold-soft/40 px-2 py-1 text-[11px] text-[#7a6122] sm:col-span-3 dark:text-gold"
              role="alert"
            >
              <AlertTriangle className="size-3" />
              برای پایداری گزارش، بازه دلخواه حداکثر دو سال است.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function QuickActionsPanel({ canWrite }: { canWrite: boolean }) {
  return (
    <Panel className="overflow-hidden border-[#174838] bg-[linear-gradient(118deg,#0a3428_0%,#0f4a39_55%,#092e24_100%)] text-cream shadow-[0_28px_60px_-42px_rgba(8,45,34,0.9)] dark:border-[#224f3f]">
      <span
        className="pointer-events-none absolute -start-16 -top-24 size-64 rounded-full bg-[#57a98d]/15 blur-3xl"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-20 end-20 size-56 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />

      <div className="relative flex flex-col gap-2 px-5 pb-3.5 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-white/[0.08] text-gold ring-1 ring-inset ring-white/10">
            <Sparkles className="size-4" />
          </span>
          <div>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-gold">
              <span className="h-px w-3 bg-gold/60" aria-hidden />
              میان‌بر عملیات
            </span>
            <h2 className="mt-0.5 text-[14px] font-extrabold text-cream">
              عملیات سریع
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className="hidden text-[12px] text-cream/45 sm:block">
            مستقیماً به فرم واقعی همان ماژول می‌روید.
          </p>
          {!canWrite ? (
            <span className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold">
              دسترسی مشاهده
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-px bg-white/[0.075] sm:grid-cols-4 xl:grid-cols-7">
        {QUICK_ACTIONS.map((action) => {
          const content = (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.065] text-gold transition-colors group-hover:bg-gold/15">
                <action.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-start text-[12px] font-semibold leading-4 text-cream/85 transition-colors group-hover:text-cream">
                {action.label}
              </span>
              <ArrowUpLeft className="absolute end-3 top-3 size-3 text-cream/20 transition-all group-hover:-translate-y-0.5 group-hover:-translate-x-0.5 group-hover:text-gold/70" />
            </>
          );

          return canWrite ? (
            <Link
              key={action.label}
              to={action.to}
              className="group relative flex min-h-[92px] items-center gap-2.5 bg-[#0d3e30]/80 px-3.5 py-3.5 transition-colors last:col-span-2 hover:bg-white/[0.055] sm:last:col-span-2 xl:last:col-span-1"
            >
              {content}
            </Link>
          ) : (
            <div
              key={action.label}
              className="relative flex min-h-[92px] cursor-not-allowed items-center gap-2.5 bg-[#0d3e30]/80 px-3.5 py-3.5 opacity-45 last:col-span-2 sm:last:col-span-2 xl:last:col-span-1"
              aria-disabled
            >
              {content}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: string | number;
    color?: string;
  }>;
  label?: string | number;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-hairline/80 bg-card/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur"
    >
      {label ? <p className="mb-1.5 font-semibold text-ink">{label}</p> : null}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div
            key={`${entry.name ?? "item"}-${index}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-1.5 text-ink-soft">
              <span
                className="size-1.5 rounded-full"
                style={{ background: entry.color }}
              />
              {entry.name}
            </span>
            <span className="num font-medium text-ink">
              {formatMoney(Number(entry.value ?? 0), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesProfitChart({
  data,
  currency,
}: {
  data: OverviewData;
  currency: string;
}) {
  const revenue = data.metrics.totalSales + data.metrics.totalIncome;
  const profit = data.metrics.netProfit;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : null;
  const hasData = data.financeSeries.some(
    (row) => row.revenue !== 0 || row.profit !== 0,
  );

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        eyebrow="نبض کسب‌وکار"
        title="نمودار فروش و سود"
        description="درآمد فروش و درآمد سایر، در کنار سود مدیریتی هر بازه."
        action={
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-brand" />
              درآمد
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-gold" />
              سود
            </span>
          </div>
        }
      />
      {!hasData ? (
        <EmptyState
          icon={<TrendingUp className="size-5" />}
          title="هنوز فروش یا سودی در این بازه نیست"
          description="با صدور فاکتور فروش یا ثبت درآمد، نمودار فروش و سود از اسناد واقعی ساخته می‌شود."
          className="py-12"
          action={
            <Button asChild size="sm" className="rounded-xl">
              <Link to="/dashboard/invoices/new">ساخت فاکتور</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="h-[252px] px-1 pb-2 sm:px-3" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.financeSeries}
                margin={{ top: 14, right: 8, left: 4, bottom: 4 }}
              >
                <defs>
                  <linearGradient
                    id="dashboardRevenueArea"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--brand)"
                      stopOpacity={0.26}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--brand)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 7"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="label"
                  reversed
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  minTickGap={20}
                  interval="preserveStartEnd"
                  tick={{
                    fontSize: 8,
                    fontFamily: "Vazirmatn",
                    fill: "var(--ink-soft)",
                  }}
                />
                <YAxis
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{
                    fontSize: 7,
                    fontFamily: "JetBrains Mono",
                    fill: "var(--ink-soft)",
                  }}
                  tickFormatter={(value: number) => compactNumber.format(value)}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--hairline)"
                  strokeDasharray="3 5"
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={<ChartTooltip currency={currency} />}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="درآمد"
                  stroke="var(--brand)"
                  strokeWidth={2.4}
                  fill="url(#dashboardRevenueArea)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "var(--gold)",
                    stroke: "var(--card)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="سود"
                  stroke="var(--gold)"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "var(--brand)",
                    stroke: "var(--card)",
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mx-4 mb-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline/50 bg-background/50 p-2.5">
            <div>
              <p className="text-[11px] text-ink-soft">درآمد بازه</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-ink">
                {formatMoney(revenue, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">سود دوره</p>
              <p
                className={cn(
                  "num mt-1 truncate text-[12px] font-bold",
                  profit >= 0 ? "text-brand" : "text-destructive",
                )}
              >
                {formatMoney(profit, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">حاشیه سود</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-ink">
                {margin === null ? "—" : `${formatNumber(margin)}٪`}
              </p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function ExpenseChart({
  data,
  currency,
}: {
  data: OverviewData;
  currency: string;
}) {
  const expenses = data.financeSeries.map((row) => row.expense);
  const total = data.metrics.totalExpenses;
  const average = expenses.length > 0 ? total / expenses.length : 0;
  const peak = Math.max(0, ...expenses);
  const hasData = total > 0;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        eyebrow="کنترل هزینه"
        title="نمودار هزینه‌ها"
        description="روند هزینه‌های مدیریتی ثبت‌شده در بازه انتخاب‌شده."
        action={
          <Link
            to="/dashboard/finance/income-expenses?tab=expenses"
            className="flex size-7 items-center justify-center rounded-full bg-background text-ink-soft transition-colors hover:bg-cream hover:text-ink"
            aria-label="ثبت هزینه"
          >
            <Receipt className="size-3.5" />
          </Link>
        }
      />
      {!hasData ? (
        <EmptyState
          icon={<Receipt className="size-5" />}
          title="هزینه‌ای در این بازه ثبت نشده"
          description="با ثبت هزینه، روند هزینه‌ها و شاخص‌های کنترل آن در همین بخش ساخته می‌شود."
          className="py-12"
          action={
            <Button asChild size="sm" variant="outline" className="rounded-xl">
              <Link to="/dashboard/finance/income-expenses?tab=expenses">
                ثبت هزینه
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="h-[252px] px-1 pb-2 sm:px-3" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.financeSeries}
                margin={{ top: 14, right: 8, left: 4, bottom: 4 }}
              >
                <defs>
                  <linearGradient
                    id="dashboardExpenseBar"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--gold)"
                      stopOpacity={0.95}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--gold)"
                      stopOpacity={0.42}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 7"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="label"
                  reversed
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  minTickGap={20}
                  interval="preserveStartEnd"
                  tick={{
                    fontSize: 8,
                    fontFamily: "Vazirmatn",
                    fill: "var(--ink-soft)",
                  }}
                />
                <YAxis
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{
                    fontSize: 7,
                    fontFamily: "JetBrains Mono",
                    fill: "var(--ink-soft)",
                  }}
                  tickFormatter={(value: number) => compactNumber.format(value)}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                  content={<ChartTooltip currency={currency} />}
                />
                <Bar
                  dataKey="expense"
                  name="هزینه"
                  fill="url(#dashboardExpenseBar)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mx-4 mb-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline/50 bg-background/50 p-2.5">
            <div>
              <p className="text-[11px] text-ink-soft">جمع هزینه</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-[#8a6a20] dark:text-gold">
                {formatMoney(total, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">میانگین بازه</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-ink">
                {formatMoney(Math.round(average), currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">بیشترین هزینه</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-ink">
                {formatMoney(peak, currency)}
              </p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function IncomeExpenseChart({
  data,
  currency,
}: {
  data: OverviewData;
  currency: string;
}) {
  const revenue = data.metrics.totalSales + data.metrics.totalIncome;
  const expense = data.metrics.totalExpenses;
  const balance = revenue - expense;
  const hasData = revenue > 0 || expense > 0;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        eyebrow="تراز عملیاتی"
        title="مقایسه درآمد و مخارج"
        description="مقایسه ستون‌به‌ستون درآمد و هزینه در بازه‌های گزارش؛ برای دیدن تراز نقدی دوره."
        action={
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-brand" />
              درآمد
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-gold" />
              مخارج
            </span>
          </div>
        }
      />
      {!hasData ? (
        <EmptyState
          icon={<Scale className="size-5" />}
          title="تراز عملیاتی برای نمایش نیست"
          description="پس از ثبت درآمد و هزینه در همین بازه، مقایسه ستونی درآمد و مخارج ساخته می‌شود."
          className="py-12"
        />
      ) : (
        <>
          <div className="h-[236px] px-1 pb-2 sm:px-3" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.financeSeries}
                margin={{ top: 14, right: 8, left: 4, bottom: 4 }}
                barGap={4}
              >
                <CartesianGrid
                  strokeDasharray="4 7"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="label"
                  reversed
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  minTickGap={20}
                  interval="preserveStartEnd"
                  tick={{
                    fontSize: 8,
                    fontFamily: "Vazirmatn",
                    fill: "var(--ink-soft)",
                  }}
                />
                <YAxis
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{
                    fontSize: 7,
                    fontFamily: "JetBrains Mono",
                    fill: "var(--ink-soft)",
                  }}
                  tickFormatter={(value: number) => compactNumber.format(value)}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                  content={<ChartTooltip currency={currency} />}
                />
                <Bar
                  dataKey="revenue"
                  name="درآمد"
                  fill="var(--brand)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                />
                <Bar
                  dataKey="expense"
                  name="مخارج"
                  fill="var(--gold)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mx-4 mb-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline/50 bg-background/50 p-2.5">
            <div>
              <p className="text-[11px] text-ink-soft">درآمد</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-brand">
                {formatMoney(revenue, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">مخارج</p>
              <p className="num mt-1 truncate text-[12px] font-bold text-[#8a6a20] dark:text-gold">
                {formatMoney(expense, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-soft">تراز</p>
              <p
                className={cn(
                  "num mt-1 truncate text-[12px] font-bold",
                  balance >= 0 ? "text-ink" : "text-destructive",
                )}
              >
                {formatMoney(balance, currency)}
              </p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function salesDocuments(rows: SaleRow[] | undefined): DocumentRow[] {
  return (rows ?? [])
    .filter((row) => row.status !== "void")
    .slice(0, 5)
    .map((row) => {
      const status = INVOICE_STATUS[row.status] ?? INVOICE_STATUS.issued;
      return {
        id: row._id,
        reference: row.number,
        party: row.customerName,
        amount: row.total,
        date: row.issueDate,
        statusLabel: status.label,
        statusTone: status.tone,
        href: `/dashboard/invoices?invoice=${row._id}`,
      };
    });
}

function purchaseDocuments(rows: PurchaseRow[] | undefined): DocumentRow[] {
  return (rows ?? [])
    .filter((row) => row.kind === "purchase" && row.status !== "cancelled")
    .slice(0, 5)
    .map((row) => {
      const status = PURCHASE_STATUS[row.status] ?? PURCHASE_STATUS.posted;
      return {
        id: row._id,
        reference: row.number,
        party: row.supplierName,
        amount: row.total,
        date: row.issueDate,
        statusLabel: status.label,
        statusTone: status.tone,
        href: "/dashboard/commerce/purchases",
      };
    });
}

function receiptDocuments(rows: ReceiptRow[] | undefined): DocumentRow[] {
  return (rows ?? []).slice(0, 5).map((row) => ({
    id: row._id,
    reference: row.number,
    party: row.partyName,
    amount: row.amount,
    date: row.occurredAt,
    statusLabel: "تأییدشده",
    statusTone: "brand",
    href: "/dashboard/finance/receipts",
  }));
}

function paymentDocuments(rows: PaymentRow[] | undefined): DocumentRow[] {
  return (rows ?? []).slice(0, 5).map((row) => ({
    id: row._id,
    reference: row.number,
    party: row.partyName,
    amount: row.amount,
    date: row.occurredAt,
    statusLabel: "تأییدشده",
    statusTone: "gold",
    href: "/dashboard/finance/payments",
  }));
}

function RecentReportsPanel({
  sales,
  purchases,
  receipts,
  payments,
  currency,
  canWrite,
}: {
  sales: SaleRow[] | undefined;
  purchases: PurchaseRow[] | undefined;
  receipts: ReceiptRow[] | undefined;
  payments: PaymentRow[] | undefined;
  currency: string;
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<ReportTabKey>("sales");

  const groups = useMemo(
    () => ({
      sales: salesDocuments(sales),
      purchases: purchaseDocuments(purchases),
      receipts: receiptDocuments(receipts),
      payments: paymentDocuments(payments),
    }),
    [sales, purchases, receipts, payments],
  );

  const loading =
    (tab === "sales" && sales === undefined) ||
    (tab === "purchases" && purchases === undefined) ||
    (tab === "receipts" && receipts === undefined) ||
    (tab === "payments" && payments === undefined);

  const activeTab =
    REPORT_TABS.find((item) => item.key === tab) ?? REPORT_TABS[0];
  const rows = groups[tab];

  return (
    <Panel className="min-w-0 overflow-hidden">
      <PanelHeader
        eyebrow="دفتر روز"
        title="گزارش‌های اخیر"
        description="آخرین اسناد واقعی همین بازه؛ از فاکتورها تا دریافت و پرداخت."
        action={
          <Link
            to={activeTab.listHref}
            className="flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
          >
            مشاهده همه
            <ArrowLeft className="size-3" />
          </Link>
        }
      />

      <div
        className="flex gap-1 overflow-x-auto border-b border-hairline/60 px-4 pb-2.5"
        role="tablist"
        aria-label="گزارش‌های اخیر"
      >
        {REPORT_TABS.map((item) => {
          const selected = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                selected
                  ? "bg-brand text-cream shadow-sm dark:bg-brand/80 dark:text-[#08261e]"
                  : "text-ink-soft hover:bg-cream/60 hover:text-ink dark:hover:bg-white/[0.05]",
              )}
            >
              <item.icon className="size-3" />
              {item.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<activeTab.icon className="size-5" />}
          title={`${activeTab.title} خالی است`}
          description={activeTab.empty}
          className="py-10"
          action={
            canWrite ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-xl"
              >
                <Link to={activeTab.createHref}>{activeTab.createLabel}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-hairline/45">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to={row.href}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream/35 dark:hover:bg-white/[0.035]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand dark:bg-brand-soft/30">
                  <activeTab.icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="num truncate font-mono text-[12px] font-semibold text-ink">
                      {row.reference}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-semibold",
                        STATUS_TONES[row.statusTone],
                      )}
                    >
                      {row.statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-ink-soft">
                    {row.party}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="num truncate text-[12px] font-bold text-ink">
                    {formatMoney(row.amount, currency)}
                  </p>
                  <p className="num mt-1 text-[11px] text-ink-soft/75">
                    {formatJalali(row.date)}
                  </p>
                </div>
                <ArrowUpLeft className="size-3 shrink-0 text-ink-soft/30 transition-all group-hover:-translate-y-0.5 group-hover:-translate-x-0.5 group-hover:text-brand" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-hairline/50 px-4 py-2 text-[11px] text-ink-soft">
        <span>نمایش ۵ سند آخر</span>
        <span>{activeTab.title}</span>
      </div>
    </Panel>
  );
}

function ActivityPanel({
  data,
  currency,
}: {
  data: OverviewData;
  currency: string;
}) {
  const rows = data.activity.slice(0, 6);

  const iconFor = (kind: string) => {
    if (kind === "invoice") return ReceiptText;
    if (kind === "customer") return Users;
    if (kind === "payment") return HandCoins;
    return Scale;
  };

  return (
    <Panel className="min-w-0 overflow-hidden">
      <PanelHeader
        eyebrow="ردپای کاربران"
        title="فعالیت‌های اخیر"
        description="آخرین رویدادهای ثبت‌شده در بازه جاری، همراه با کاربر و سند."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-soft/60 px-2.5 py-1 text-[11px] font-semibold text-brand dark:bg-brand-soft/20">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
            </span>
            به‌روزرسانی زنده
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="فعالیتی در این بازه نیست"
          description="با صدور فاکتور، ثبت دریافت یا ثبت هزینه، گزارش فعالیت کاربران اینجا ساخته می‌شود."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-hairline/45">
          {rows.map((row) => {
            const Icon = iconFor(row.kind);
            return (
              <li key={row._id}>
                <Link
                  to={row.href}
                  className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-cream/35 dark:hover:bg-white/[0.035]"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-cream/60 text-ink-soft dark:bg-white/[0.05]">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-[12px] font-semibold text-ink">
                        {row.actionLabel}
                      </p>
                      <span className="num font-mono text-[7px] text-ink-soft/70">
                        {row.documentNumber}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-soft">
                      {row.partyName}
                      <span className="mx-1 text-ink-soft/40">·</span>
                      {row.actorName}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    {row.amount === null ? (
                      <p className="text-[11px] text-ink-soft">—</p>
                    ) : (
                      <p className="num text-[12px] font-semibold text-ink">
                        {formatMoney(row.amount, currency)}
                      </p>
                    )}
                    <p className="num mt-1 text-[11px] text-ink-soft/70">
                      {formatJalali(row.date)}
                    </p>
                  </div>
                  <ExternalLink className="mt-1 size-2.5 shrink-0 text-ink-soft/25 transition-colors group-hover:text-brand" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-hairline/50 px-4 py-2 text-[11px] text-ink-soft">
        <span>آخرین رویدادهای ثبت‌شده</span>
        <Link
          to="/dashboard/notifications"
          className="font-semibold text-brand hover:underline"
        >
          مشاهده اعلان‌ها
        </Link>
      </div>
    </Panel>
  );
}

function AccountCard({
  title,
  value,
  unit,
  hint,
  detail,
  icon,
  tone,
  loading,
}: {
  title: string;
  value: number;
  unit: string;
  hint: string;
  detail: string;
  icon: ReactNode;
  tone: "brand" | "gold" | "mist";
  loading: boolean;
}) {
  const toneClasses = {
    brand: {
      icon: "bg-brand-soft text-brand dark:bg-brand-soft/30",
      rule: "from-brand/70 via-brand/20 to-transparent",
      glow: "bg-brand/10",
    },
    gold: {
      icon: "bg-gold-soft text-[#8a6c2c] dark:bg-gold-soft/25 dark:text-gold",
      rule: "from-gold/80 via-gold/20 to-transparent",
      glow: "bg-gold/15",
    },
    mist: {
      icon: "bg-mist/70 text-[#36697b] dark:bg-mist/20 dark:text-[#a9d5e2]",
      rule: "from-[#6f91a3]/70 via-[#6f91a3]/20 to-transparent",
      glow: "bg-mist/50",
    },
  }[tone];

  return (
    <Link
      to="/dashboard/finance/accounts"
      className="group relative flex min-h-[150px] flex-col overflow-hidden rounded-[20px] border border-hairline/80 bg-surface p-4 shadow-[0_1px_2px_rgba(24,34,44,0.03),0_18px_38px_-38px_rgba(15,81,63,0.25)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(24,34,44,0.03),0_24px_46px_-34px_rgba(15,81,63,0.28)] dark:border-white/[0.08] dark:bg-card"
    >
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-l",
          toneClasses.rule,
        )}
        aria-hidden
      />
      <span
        className={cn(
          "pointer-events-none absolute -left-9 -top-10 size-28 rounded-full blur-3xl",
          toneClasses.glow,
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-soft">{title}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-[10px]",
            toneClasses.icon,
          )}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-7 w-24 rounded-lg" />
      ) : (
        <p
          className="num relative mt-4 truncate text-[20px] font-bold leading-none text-ink"
          title={`${formatNumber(value)} ${unit}`}
        >
          {formatNumber(value)}
          <span className="ms-1 font-sans text-[11px] font-normal text-ink-soft">
            {unit}
          </span>
        </p>
      )}
      <p
        className="relative mt-2 truncate text-[11px] text-ink-soft"
        title={hint}
      >
        {hint}
      </p>
      <div className="relative mt-auto flex items-center justify-between gap-2 pt-2">
        <span className="truncate text-[7.5px] text-ink-soft/70">{detail}</span>
        <ArrowUpLeft className="size-3 shrink-0 text-ink-soft/30 transition-all group-hover:-translate-y-0.5 group-hover:-translate-x-0.5 group-hover:text-brand" />
      </div>
    </Link>
  );
}

function AccountsSection({
  treasury,
  receipts,
  currency,
}: {
  treasury: TreasuryData | undefined;
  receipts: ReceiptRow[] | undefined;
  currency: string;
}) {
  const unit = currencyUnit(currency);
  const activeFunds =
    treasury?.funds.filter((fund) => fund.active) ?? treasury?.funds ?? [];
  const activeBanks =
    treasury?.banks.filter((bank) => bank.active) ?? treasury?.banks ?? [];
  const primaryFund =
    activeFunds.find((fund) => /مرکزی|اصلی/.test(fund.name)) ??
    activeFunds[0] ??
    treasury?.funds[0];
  const cardReceipts = (receipts ?? []).filter(
    (receipt) => receipt.method === "card",
  );
  const cardTotal = cardReceipts.reduce(
    (sum, receipt) => sum + receipt.amount,
    0,
  );

  return (
    <section>
      <SectionHeading
        eyebrow="خزانه"
        title="حساب‌ها و نقدینگی"
        description="مانده واقعی صندوق و بانک‌ها، به‌همراه گردش دریافت کارتی همین بازه."
        action={
          <Link
            to="/dashboard/finance/accounts"
            className="flex items-center gap-1 rounded-full border border-hairline/70 bg-surface/70 px-3 py-1.5 text-[12px] font-semibold text-brand transition-colors hover:bg-surface"
          >
            مدیریت حساب‌ها
            <ArrowLeft className="size-3" />
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AccountCard
          title="صندوق مرکزی"
          value={primaryFund?.balance ?? 0}
          unit={unit}
          hint={
            primaryFund
              ? `صندوق اصلی: ${primaryFund.name}`
              : "صندوق نقدی تعریف نشده است"
          }
          detail={
            primaryFund?.responsibleName
              ? `مسئول: ${primaryFund.responsibleName}`
              : "مانده تجمعی صندوق"
          }
          icon={<Wallet className="size-4" />}
          tone="gold"
          loading={treasury === undefined}
        />
        <AccountCard
          title="بانک‌ها"
          value={treasury?.totalBank ?? 0}
          unit={unit}
          hint={`${formatNumber(activeBanks.length)} حساب بانکی فعال`}
          detail="جمع مانده تمام حساب‌های بانکی"
          icon={<Landmark className="size-4" />}
          tone="mist"
          loading={treasury === undefined}
        />
        <AccountCard
          title="کارت‌خوان‌ها"
          value={cardTotal}
          unit={unit}
          hint={`${formatNumber(cardReceipts.length)} دریافت کارتی در این بازه`}
          detail="گردش تأییدشده روش پرداخت کارتی"
          icon={<CreditCard className="size-4" />}
          tone="gold"
          loading={receipts === undefined}
        />
        <AccountCard
          title="موجودی نقدی"
          value={treasury?.totalCash ?? 0}
          unit={unit}
          hint={`${formatNumber(activeFunds.length)} صندوق فعال`}
          detail="جمع مانده تمام صندوق‌های نقدی"
          icon={<Coins className="size-4" />}
          tone="brand"
          loading={treasury === undefined}
        />
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { businessId, branchId, fiscalYearId, currency, workspace, canWrite } =
    useWorkspace();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(() =>
    isoDate(Date.now() - 29 * 24 * 60 * 60 * 1000),
  );
  const [customTo, setCustomTo] = useState(() => isoDate(Date.now()));

  const customFromTs = Date.parse(`${customFrom}T12:00:00Z`);
  const customToTs = Date.parse(`${customTo}T12:00:00Z`);
  const customRangeTooLong =
    period === "custom" &&
    Number.isFinite(customFromTs) &&
    Number.isFinite(customToTs) &&
    Math.abs(customToTs - customFromTs) > 731 * 24 * 60 * 60 * 1000;

  const liveOverview = useQuery(
    api.dashboard.overview,
    businessId && !customRangeTooLong
      ? {
          businessId,
          branchId,
          fiscalYearId,
          period,
          from:
            period === "custom" && Number.isFinite(customFromTs)
              ? customFromTs
              : undefined,
          to:
            period === "custom" && Number.isFinite(customToTs)
              ? customToTs
              : undefined,
        }
      : "skip",
  ) as OverviewData | undefined;

  const scopeKey = `${businessId ?? ""}:${branchId ?? ""}:${
    fiscalYearId ?? ""
  }`;
  const [cachedOverview, setCachedOverview] = useState<{
    key: string;
    data: OverviewData;
  } | null>(null);

  // Keep the last successful snapshot while a period change is loading so the
  // page doesn't blink back to skeletons on every filter change.
  if (liveOverview && cachedOverview?.data !== liveOverview) {
    setCachedOverview({ key: scopeKey, data: liveOverview });
  }

  const overview = customRangeTooLong
    ? undefined
    : (liveOverview ??
      (cachedOverview?.key === scopeKey ? cachedOverview.data : undefined));

  const documentScope =
    businessId && overview
      ? {
          businessId,
          branchId,
          fiscalYearId,
          from: overview.period.startAt,
          to: overview.period.endAt,
        }
      : null;

  const receipts = useQuery(
    api.receipts.list,
    documentScope
      ? {
          ...documentScope,
          status: "posted" as const,
          limit: 500,
        }
      : "skip",
  ) as ReceiptRow[] | undefined;

  const paymentVouchers = useQuery(
    api.paymentVouchers.list,
    documentScope
      ? {
          ...documentScope,
          status: "posted" as const,
          limit: 500,
        }
      : "skip",
  ) as PaymentRow[] | undefined;

  const sales = useQuery(
    api.sales.list,
    documentScope
      ? {
          businessId: documentScope.businessId,
          branchId: documentScope.branchId,
          fiscalYearId: documentScope.fiscalYearId,
          from: documentScope.from,
          to: documentScope.to,
          limit: 30,
        }
      : "skip",
  ) as SaleRow[] | undefined;

  const purchases = useQuery(
    api.purchases.list,
    documentScope
      ? {
          businessId: documentScope.businessId,
          from: documentScope.from,
          to: documentScope.to,
          limit: 30,
        }
      : "skip",
  ) as PurchaseRow[] | undefined;

  const treasuryBalances = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  ) as TreasuryData | undefined;

  // The management overview and the treasury ledger are separate movement
  // sources. Summing the two read-only cash-flow series keeps the receipt /
  // payment cards complete without touching any stored financial document.
  const financeOverview = useQuery(
    api.finance.overview,
    documentScope
      ? {
          businessId: documentScope.businessId,
          branchId: documentScope.branchId,
          from: documentScope.from,
          to: documentScope.to,
        }
      : "skip",
  ) as FinanceOverviewData | undefined;

  const unit = currencyUnit(currency);
  const metrics = overview?.metrics;
  const managementInflow =
    overview?.cashflowSeries.reduce((sum, row) => sum + row.inflow, 0) ?? 0;
  const managementOutflow =
    overview?.cashflowSeries.reduce((sum, row) => sum + row.outflow, 0) ?? 0;
  const ledgerInflow =
    financeOverview?.cashflowSeries.reduce((sum, row) => sum + row.inflow, 0) ??
    0;
  const ledgerOutflow =
    financeOverview?.cashflowSeries.reduce(
      (sum, row) => sum + row.outflow,
      0,
    ) ?? 0;
  const periodInflow = managementInflow + ledgerInflow;
  const periodOutflow = managementOutflow + ledgerOutflow;
  const periodLabel = overview
    ? `${PERIOD_NAMES[period]} · ${overview.period.display}`
    : PERIOD_NAMES[period];
  const refreshing = Boolean(overview && !liveOverview && !customRangeTooLong);

  const handlePeriodChange = (next: PeriodKey) => {
    setPeriod(next);
  };

  return (
    <div className="vira-luxe-dashboard page-enter space-y-5 sm:space-y-6">
      <header className="vira-luxe-hero" aria-labelledby="vira-dashboard-title">
        <div className="vira-luxe-hero__aura" aria-hidden="true" />
        <div className="vira-luxe-hero__content">
          <div className="vira-luxe-hero__headline">
            <div className="vira-luxe-hero__eyebrow">
              <span className="vira-luxe-hero__diamond" aria-hidden="true" />
              VIRA / EXECUTIVE OVERVIEW
            </div>
            <p className="vira-luxe-hero__business">
              {workspace?.business.name ?? "فضای کاری مالی"}
            </p>
            <h1 id="vira-dashboard-title">داشبورد مدیریتی ویرا</h1>
            <p className="vira-luxe-hero__description">
              نگاهی روشن به عملکرد مالی، جریان نقدینگی و عملیات کسب‌وکار شما؛
              بر پایه اسناد واقعی.
            </p>
            <div className="vira-luxe-hero__meta">
              <span className="vira-luxe-hero__live">
                <span className="vira-luxe-hero__live-dot" aria-hidden="true" />
                {refreshing ? "در حال به‌روزرسانی" : overview ? "متصل به داده‌های مالی" : "در انتظار داده‌ها"}
              </span>
              <span className="vira-luxe-hero__divider" aria-hidden="true" />
              <CalendarRange className="size-4" aria-hidden="true" />
              <span>{periodLabel}</span>
            </div>
          </div>
          <div className="vira-luxe-hero__aside">
            <div className="vira-luxe-hero__monogram" aria-hidden="true">
              <Landmark className="size-7" strokeWidth={1.45} />
            </div>
            {metrics ? (
              <div className="vira-luxe-hero__summary">
                <span>فروش دوره</span>
                <strong className="num" dir="ltr">{formatNumber(metrics.totalSales)}</strong>
                <small>{unit}</small>
              </div>
            ) : (
              <div className="vira-luxe-hero__summary">
                <span>مرکز کنترل مالی</span>
                <strong>حساب ویرا</strong>
                <small>مدیریت یکپارچه کسب‌وکار</small>
              </div>
            )}
            <div className="vira-luxe-hero__actions">
              {canWrite ? (
                <>
                  <Button asChild size="sm" className="vira-luxe-primary-action">
                    <Link to="/dashboard/invoices/new">
                      <Plus className="size-4" /> فاکتور جدید
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="vira-luxe-secondary-action">
                    <Link to="/dashboard/finance/receipts">
                      <HandCoins className="size-4" /> ثبت دریافت
                    </Link>
                  </Button>
                </>
              ) : (
                <span className="vira-luxe-hero__readonly">حالت مشاهده · بدون دسترسی ثبت</span>
              )}
            </div>
          </div>
        </div>
      </header>

      <PeriodFilters
        period={period}
        onPeriodChange={handlePeriodChange}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        periodLabel={periodLabel}
        refreshing={refreshing}
        customRangeTooLong={customRangeTooLong}
      />

      {customRangeTooLong && !overview ? (
        <Panel>
          <EmptyState
            icon={<CalendarRange className="size-5" />}
            title="بازه انتخابی بیش از حد طولانی است"
            description="برای دیدن گزارش، بازه دلخواه را حداکثر دو سال انتخاب کنید یا یکی از بازه‌های آماده را برگزینید."
            className="py-10"
            action={
              <Button
                type="button"
                size="sm"
                className="rounded-xl"
                onClick={() => setPeriod("year")}
              >
                نمایش سال جاری
              </Button>
            }
          />
        </Panel>
      ) : !overview || !metrics ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section>
            <SectionHeading
              eyebrow="شش شاخص کلیدی"
              title="تصویر کلی کسب‌وکار"
              description={periodLabel}
              action={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline/70 bg-surface/65 px-2.5 py-1 text-[11px] text-ink-soft">
                  <span className="size-1.5 rounded-full bg-brand" />
                  داده زنده از اسناد
                </span>
              }
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label="مجموع فروش"
                value={formatNumber(metrics.totalSales)}
                unit={unit}
                hint={`${formatNumber(metrics.invoiceCount)} سند فروش در این بازه`}
                change={overview.changes.sales}
                icon={<TrendingUp className="size-4" />}
                href="/dashboard/commerce/sales"
                cta="مشاهده فروش‌ها"
                featured
              />
              <StatCard
                label="مجموع خرید"
                value={formatNumber(metrics.totalPurchases)}
                unit={unit}
                hint={`${formatNumber(
                  metrics.purchaseInvoiceCount,
                )} فاکتور خرید در این بازه`}
                change={overview.changes.purchases}
                icon={<ShoppingCart className="size-4" />}
                href="/dashboard/commerce/purchases"
                cta="مشاهده خریدها"
              />
              <StatCard
                label="سود خالص"
                value={formatNumber(metrics.netProfit)}
                unit={unit}
                hint="فروش + درآمد سایر − هزینه"
                change={overview.changes.profit}
                icon={<Coins className="size-4" />}
                href="/dashboard/reports"
                cta="جزئیات سود"
                valueDanger={metrics.netProfit < 0}
              />
              <StatCard
                label="موجودی انبار"
                value={formatNumber(metrics.inventoryValue)}
                unit={unit}
                hint={`${formatNumber(
                  metrics.productCount,
                )} کالا · ${formatNumber(metrics.stockQuantity)} مقدار موجودی`}
                change={null}
                icon={<Boxes className="size-4" />}
                href="/dashboard/commerce/inventory"
                cta="مشاهده انبار"
              />
              <StatCard
                label="مجموع دریافت‌ها"
                value={formatNumber(periodInflow)}
                unit={unit}
                hint="ورودی نقدی و بانکی این بازه"
                change={null}
                icon={<HandCoins className="size-4" />}
                href="/dashboard/finance/receipts"
                cta="مشاهده دریافت‌ها"
              />
              <StatCard
                label="مجموع پرداخت‌ها"
                value={formatNumber(periodOutflow)}
                unit={unit}
                hint="خروجی نقدی و بانکی این بازه"
                change={null}
                icon={<Banknote className="size-4" />}
                href="/dashboard/finance/payments"
                cta="مشاهده پرداخت‌ها"
                valueDanger={false}
              />
            </div>
          </section>

          <QuickActionsPanel canWrite={canWrite} />

          <section>
            <SectionHeading
              eyebrow="تحلیل عملکرد"
              title="نمودارهای مالی"
              description="فروش و سود، هزینه‌ها و مقایسه درآمد و مخارج؛ همه بر اساس اسناد همین بازه."
              action={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold-soft/40 px-2.5 py-1 text-[11px] font-semibold text-[#7a6122] dark:text-gold">
                  <FileText className="size-3" />
                  داده واقعی
                </span>
              }
            />
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <SalesProfitChart data={overview} currency={currency} />
              <ExpenseChart data={overview} currency={currency} />
              <div className="xl:col-span-2">
                <IncomeExpenseChart data={overview} currency={currency} />
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <RecentReportsPanel
              sales={sales}
              purchases={purchases}
              receipts={receipts}
              payments={paymentVouchers}
              currency={currency}
              canWrite={canWrite}
            />
            <ActivityPanel data={overview} currency={currency} />
          </div>

          <AccountsSection
            treasury={treasuryBalances}
            receipts={receipts}
            currency={currency}
          />

          <div className="flex items-start gap-2 rounded-2xl border border-hairline/60 bg-surface/55 px-4 py-3 text-[11px] leading-5 text-ink-soft">
            <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
            <p>
              مبالغ دریافت و پرداخت، گردش واقعی نقدی و بانکی دوره است. حساب
              کارت‌خوان در سیستم به‌صورت مانده مستقل نگهداری نمی‌شود؛ به همین
              دلیل کارت «کارت‌خوان‌ها» مجموع دریافت‌های تأییدشده با روش پرداخت
              کارتی در همین بازه را نشان می‌دهد. هیچ داده آزمایشی در این داشبورد
              ساخته نشده است.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
