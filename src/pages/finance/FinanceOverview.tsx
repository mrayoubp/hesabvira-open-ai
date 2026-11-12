import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DateRangeFields,
  RECEIVED_CHECK_STATUS_META,
} from "@/components/finance/shared";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { formatJalali, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  HandCoins,
  Landmark,
  LineChart,
  ReceiptText,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return isoDateValue(date.getTime());
}

const OPERATION_LABELS: Record<string, string> = {
  opening: "موجودی اولیه",
  receipt: "دریافت",
  payment: "پرداخت",
  "income-deposit": "واریز درآمد",
  "expense-payment": "پرداخت هزینه",
  "check-receipt": "چک دریافتی",
  "check-collected": "وصول چک",
  "check-bounced": "برگشت چک",
  "check-issued": "چک پرداختی",
  "check-cleared": "تسویه چک پرداختی",
  "transfer-out": "خروج انتقال",
  "transfer-in": "ورود انتقال",
  adjustment: "اصلاحی",
};

function Metric({
  label,
  value,
  hint,
  icon,
  tone,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone: string;
  to?: string;
}) {
  const body = (
    <Panel className="group h-full p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold text-ink-soft">{label}</span>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl",
            tone,
          )}
        >
          {icon}
        </span>
      </div>
      <p className="num mt-3 truncate text-[20px] font-black text-ink">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 flex items-center gap-1 truncate text-[8px] text-ink-soft">
          {hint}
        </p>
      ) : null}
    </Panel>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function FinanceOverview() {
  const { businessId, branchId, currency, role } = useWorkspace();
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(() => isoDateValue(Date.now()));
  const fromTimestamp = timestampFromDateInput(from);
  const toTimestamp = timestampFromDateInput(to, true);

  const overview = useQuery(
    api.finance.overview,
    businessId && Number.isFinite(fromTimestamp) && Number.isFinite(toTimestamp)
      ? { businessId, branchId, from: fromTimestamp, to: toTimestamp }
      : businessId
        ? { businessId, branchId }
        : "skip",
  );

  const metrics = overview?.metrics;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="مالی · مرکز فرماندهی خزانه"
        title="داشبورد مدیریت مالی"
        description="تصویر زنده بانک، صندوق، دریافت و پرداخت، چک و مطالبات؛ همه اعداد از تراکنش‌ها و اسناد واقعی خوانده می‌شوند."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard/finance/accounts">
                <Landmark className="size-4" />
                بانک و صندوق
              </Link>
            </Button>
            <Button asChild size="sm" className="h-9 gap-1.5 rounded-xl px-3.5">
              <Link to="/dashboard/finance/receipts">
                <HandCoins className="size-4" />
                ثبت دریافت
              </Link>
            </Button>
          </>
        }
      />

      <Panel className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <CalendarRange className="size-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold text-ink">بازه گزارش</p>
            <p className="text-[8px] text-ink-soft">
              {overview?.period.label ?? "در حال محاسبه…"}
            </p>
          </div>
        </div>
        <DateRangeFields
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
        />
        <div className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-background/60 px-3 py-1.5 text-[8px] text-ink-soft">
          <span className="size-1.5 rounded-full bg-brand" />
          نقش: {role === "owner" ? "مالک" : role === "admin" ? "مدیر" : role === "accountant" ? "حسابدار" : role === "viewer" ? "مشاهده‌گر" : "فروش"}
        </div>
      </Panel>

      {!overview ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="h-[112px] rounded-[20px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="مجموع موجودی بانک‌ها"
              value={formatMoney(metrics?.totalBank ?? 0, currency)}
              hint={`${overview.banks.filter((bank) => bank.active).length} حساب فعال`}
              icon={<Landmark className="size-4" />}
              tone="bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]"
              to="/dashboard/finance/accounts"
            />
            <Metric
              label="مجموع موجودی صندوق‌ها"
              value={formatMoney(metrics?.totalCash ?? 0, currency)}
              hint={`${overview.funds.filter((fund) => fund.active).length} صندوق فعال`}
              icon={<Wallet className="size-4" />}
              tone="bg-gold-soft text-[#7a6122] dark:text-gold"
              to="/dashboard/finance/accounts"
            />
            <Metric
              label="دریافت‌های امروز"
              value={formatMoney(metrics?.todayReceipts ?? 0, currency)}
              hint="فقط دریافت‌های تأییدشده"
              icon={<ArrowDownLeft className="size-4" />}
              tone="bg-brand-soft text-brand"
              to="/dashboard/finance/receipts"
            />
            <Metric
              label="پرداخت‌های امروز"
              value={formatMoney(metrics?.todayPayments ?? 0, currency)}
              hint="فقط پرداخت‌های تأییدشده"
              icon={<ArrowUpRight className="size-4" />}
              tone="bg-destructive/10 text-destructive"
              to="/dashboard/finance/payments"
            />
            <Metric
              label="مطالبات مشتریان"
              value={formatMoney(metrics?.receivables ?? 0, currency)}
              hint="مانده فاکتورهای صادرشده"
              icon={<HandCoins className="size-4" />}
              tone="bg-brand-soft text-brand"
              to="/dashboard/finance/receivables"
            />
            <Metric
              label="بدهی تأمین‌کنندگان"
              value={formatMoney(metrics?.payables ?? 0, currency)}
              hint="هزینه‌های تأییدشده پرداخت‌نشده"
              icon={<ReceiptText className="size-4" />}
              tone="bg-cream/70 text-ink dark:bg-white/[0.06]"
              to="/dashboard/finance/receivables?tab=payables"
            />
            <Metric
              label="چک‌های دریافتی باز"
              value={formatMoney(metrics?.receivedChecks ?? 0, currency)}
              hint={`${metrics?.receivedChecksCount ?? 0} فقره در جریان`}
              icon={<CircleDollarSign className="size-4" />}
              tone="bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]"
              to="/dashboard/finance/checks"
            />
            <Metric
              label="چک‌های پرداختی باز"
              value={formatMoney(metrics?.issuedChecks ?? 0, currency)}
              hint={`${metrics?.issuedChecksCount ?? 0} فقره در جریان`}
              icon={<Banknote className="size-4" />}
              tone="bg-gold-soft text-[#7a6122] dark:text-gold"
              to="/dashboard/finance/checks?tab=issued"
            />
            <Metric
              label="چک‌های نزدیک سررسید"
              value={formatMoney(metrics?.dueSoonAmount ?? 0, currency)}
              hint={`${metrics?.dueSoonCount ?? 0} فقره تا ۱۴ روز آینده یا معوق`}
              icon={<AlertTriangle className="size-4" />}
              tone="bg-destructive/10 text-destructive"
              to="/dashboard/finance/checks?due=soon"
            />
            <Metric
              label="درآمد ماه جاری"
              value={formatMoney(metrics?.monthIncome ?? 0, currency)}
              hint="فروش + درآمدهای متفرقه"
              icon={<TrendingUp className="size-4" />}
              tone="bg-brand-soft text-brand"
              to="/dashboard/finance/income-expenses"
            />
            <Metric
              label="هزینه ماه جاری"
              value={formatMoney(metrics?.monthExpense ?? 0, currency)}
              hint="هزینه‌های تأییدشده"
              icon={<Scale className="size-4" />}
              tone="bg-destructive/10 text-destructive"
              to="/dashboard/finance/income-expenses?tab=expenses"
            />
            <Metric
              label="گردش نقدینگی بازه"
              value={formatMoney(metrics?.netCashflow ?? 0, currency)}
              hint={overview.period.label}
              icon={<LineChart className="size-4" />}
              tone="bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]"
              to="/dashboard/finance/reports?kind=cashflow"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Panel>
              <PanelHeader
                eyebrow="نمودار گردش"
                title="جریان نقدینگی بازه"
                description="ورودی و خروجی بانک و صندوق؛ انتقال‌های داخلی برای جلوگیری از شمارش دوباره حذف شده‌اند."
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg px-2 text-[9px] text-brand"
                  >
                    <Link to="/dashboard/finance/reports?kind=cashflow">
                      گزارش کامل
                      <ArrowLeft className="size-3" />
                    </Link>
                  </Button>
                }
              />
              <div className="h-[290px] px-2 pb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={overview.cashflowSeries}
                    margin={{ top: 10, right: 8, left: 8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="financeBalance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#245C49" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#245C49" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(38,53,46,0.09)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 8, fill: "#6a756f" }}
                      axisLine={false}
                      tickLine={false}
                      reversed
                    />
                    <YAxis
                      tick={{ fontSize: 8, fill: "#6a756f" }}
                      axisLine={false}
                      tickLine={false}
                      width={58}
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat("en-US", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(value)
                      }
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatMoney(Number(value), currency),
                        name === "inflow"
                          ? "ورودی"
                          : name === "outflow"
                            ? "خروجی"
                            : "مانده",
                      ]}
                      contentStyle={{
                        borderRadius: 14,
                        border: "1px solid rgba(36,92,73,0.16)",
                        fontSize: 10,
                        direction: "rtl",
                        fontFamily: "Vazirmatn",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke="#245C49"
                      strokeWidth={2.5}
                      fill="url(#financeBalance)"
                      name="balance"
                    />
                    <Area
                      type="monotone"
                      dataKey="inflow"
                      stroke="#C5A45B"
                      strokeWidth={1.5}
                      fill="transparent"
                      name="inflow"
                    />
                    <Area
                      type="monotone"
                      dataKey="outflow"
                      stroke="#b4544e"
                      strokeWidth={1.5}
                      fill="transparent"
                      name="outflow"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                eyebrow="هشدار سررسید"
                title="چک‌های نزدیک سررسید"
                description="۱۴ روز آینده؛ بر اساس تاریخ سررسید ثبت‌شده."
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg px-2 text-[9px] text-brand"
                  >
                    <Link to="/dashboard/finance/checks">همه چک‌ها</Link>
                  </Button>
                }
              />
              {overview.dueSoon.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="size-5" />}
                  title="چک نزدیک سررسیدی نیست"
                  description="چک‌های دریافتی و پرداختی باز در ۱۴ روز آینده در این بخش هشدار می‌دهند."
                />
              ) : (
                <div className="divide-y divide-hairline/50">
                  {overview.dueSoon.map((check, index) => (
                    <div
                      key={`${check.type}-${check.checkNumber}-${index}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold text-ink">
                          {check.partyName}
                        </p>
                        <p className="num mt-0.5 text-[8px] text-ink-soft">
                          {check.checkNumber} · {formatJalali(check.dueDate)}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="num text-[10px] font-bold text-ink">
                          {formatMoney(check.amount, currency)}
                        </p>
                        <span
                          className={cn(
                            "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[8px]",
                            RECEIVED_CHECK_STATUS_META[
                              check.status as keyof typeof RECEIVED_CHECK_STATUS_META
                            ]?.className ?? "border-hairline bg-muted text-ink-soft",
                          )}
                        >
                          {check.type === "received" ? "دریافتی" : "پرداختی"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="آخرین تحرکات"
                title="تراکنش‌های اخیر"
                description="آخرین ۱۵ حرکت ثبت‌شده روی بانک و صندوق."
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg px-2 text-[9px] text-brand"
                  >
                    <Link to="/dashboard/finance/accounts">گردش حساب‌ها</Link>
                  </Button>
                }
              />
              {overview.recentTransactions.length === 0 ? (
                <EmptyState
                  icon={<Banknote className="size-5" />}
                  title="هنوز تراکنشی ثبت نشده"
                  description="با ثبت موجودی اولیه بانک یا صندوق، گردش مالی شروع می‌شود."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>تاریخ</TableHead>
                        <TableHead>شرح</TableHead>
                        <TableHead>حساب</TableHead>
                        <TableHead>نوع</TableHead>
                        <TableHead className="text-end">مبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.recentTransactions.map((row) => (
                        <TableRow key={row._id}>
                          <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                            {formatJalali(row.occurredAt)}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-[9px] font-medium">
                            {row.description}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[9px] text-ink-soft">
                            {row.accountName}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[8px] text-ink-soft">
                            {OPERATION_LABELS[row.operationType] ??
                              row.operationType}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "num text-end text-[10px] font-bold",
                              row.direction === "in"
                                ? "text-brand"
                                : "text-destructive",
                            )}
                          >
                            {row.direction === "in" ? "+" : "−"}
                            {formatMoney(row.amount, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>

            <div className="space-y-4">
              <Panel>
                <PanelHeader
                  eyebrow="تفکیک حساب‌ها"
                  title="موجودی بانک‌ها"
                  description="محاسبه‌شده از تراکنش‌های تأییدشده."
                />
                <div className="divide-y divide-hairline/50">
                  {overview.banks.length === 0 ? (
                    <p className="px-4 py-5 text-center text-[9px] text-ink-soft">
                      حساب بانکی ثبت نشده است.
                    </p>
                  ) : (
                    overview.banks.map((bank) => (
                      <div
                        key={bank._id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold">
                            {bank.name}
                          </p>
                          <p className="text-[8px] text-ink-soft">
                            {bank.bankName}
                            {!bank.active ? " · غیرفعال" : ""}
                          </p>
                        </div>
                        <p className="num shrink-0 text-[10px] font-bold text-brand">
                          {formatMoney(bank.balance, currency)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
              <Panel>
                <PanelHeader
                  eyebrow="تفکیک حساب‌ها"
                  title="موجودی صندوق‌ها"
                  description="مسئول و مانده هر صندوق."
                />
                <div className="divide-y divide-hairline/50">
                  {overview.funds.length === 0 ? (
                    <p className="px-4 py-5 text-center text-[9px] text-ink-soft">
                      صندوقی ثبت نشده است.
                    </p>
                  ) : (
                    overview.funds.map((fund) => (
                      <div
                        key={fund._id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold">
                            {fund.name}
                          </p>
                          <p className="text-[8px] text-ink-soft">
                            {fund.responsibleName ?? "بدون مسئول"}
                            {!fund.active ? " · غیرفعال" : ""}
                          </p>
                        </div>
                        <p className="num shrink-0 text-[10px] font-bold text-gold">
                          {formatMoney(fund.balance, currency)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
