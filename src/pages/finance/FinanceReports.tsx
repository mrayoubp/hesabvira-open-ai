import {
  EmptyState,
  PageHeader,
  Panel,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  downloadCsv,
  isoDateValue,
  printAccountingView,
  timestampFromDateInput,
} from "@/lib/accounting";
import { formatJalali, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Download,
  FileSpreadsheet,
  Printer,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

const REPORT_KINDS = [
  { value: "bank-ledger", label: "گردش حساب بانکی" },
  { value: "cash-ledger", label: "گردش صندوق" },
  { value: "receipts", label: "دریافت‌ها" },
  { value: "payments", label: "پرداخت‌ها" },
  { value: "incomes", label: "درآمدها" },
  { value: "expenses", label: "هزینه‌ها" },
  { value: "received-checks", label: "چک‌های دریافتی" },
  { value: "issued-checks", label: "چک‌های پرداختی" },
  { value: "receivables", label: "مطالبات" },
  { value: "payables", label: "بدهی‌ها" },
  { value: "cashflow", label: "جریان نقدینگی" },
  { value: "transfers", label: "انتقال وجه" },
] as const;

type ReportKind = (typeof REPORT_KINDS)[number]["value"];

const OPERATION_LABELS: Record<string, string> = {
  opening: "موجودی اولیه",
  receipt: "دریافت",
  payment: "پرداخت",
  income: "درآمد",
  "income-deposit": "واریز درآمد",
  "expense-approval": "تأیید هزینه",
  "expense-payment": "پرداخت هزینه",
  "check-receipt": "چک دریافتی",
  "check-collection": "وصول چک",
  "check-collected": "وصول چک",
  "check-bounced": "برگشت چک",
  "check-issued": "چک پرداختی",
  "check-cleared": "تسویه چک",
  "transfer-out": "خروج انتقال",
  "transfer-in": "ورود انتقال",
  "transfer-fee": "کارمزد انتقال",
  approved: "تأییدشده",
  posted: "ثبت‌شده",
  paid: "پرداخت‌شده",
  draft: "پیش‌نویس",
  issued: "صادرشده",
  delivered: "تحویل‌شده",
  collected: "وصول‌شده",
  bounced: "برگشتی",
  cancelled: "ابطال‌شده",
  received: "دریافت‌شده",
  pending: "در انتظار",
  assigned: "واگذارشده",
  void: "ابطال‌شده",
};

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return isoDateValue(date.getTime());
}

function reportKindLabel(kind: ReportKind) {
  return REPORT_KINDS.find((item) => item.value === kind)?.label ?? "گزارش مالی";
}

function ReportSheet({
  title,
  subtitle,
  rows,
  currency,
  totals,
  openingBalance,
  closingBalance,
}: {
  title: string;
  subtitle: string;
  rows: {
    id: string;
    date: number;
    number: string;
    party: string;
    description: string;
    account: string;
    debit: number;
    credit: number;
    amount: number;
    status: string;
    extra: string | null;
    href: string | null;
  }[];
  currency: string;
  totals: { debit: number; credit: number; amount: number; difference: number };
  openingBalance: number | null;
  closingBalance: number | null;
}) {
  return (
    <div className="print-sheet rounded-[22px] border border-hairline/60 bg-card p-4 text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-brand pb-3">
        <div>
          <p className="text-[9px] font-semibold tracking-wide text-gold">
            HESAB VIRA · گزارش مالی
          </p>
          <h2 className="mt-1 text-lg font-black">{title}</h2>
          <p className="mt-1 text-[9px] text-ink-soft">{subtitle}</p>
        </div>
        <div className="text-end">
          <p className="text-[8px] text-ink-soft">تعداد ردیف</p>
          <p className="num text-lg font-black text-brand">{rows.length}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["جمع بدهکار", formatMoney(totals.debit, currency)],
          ["جمع بستانکار", formatMoney(totals.credit, currency)],
          ["مانده", formatMoney(totals.difference, currency)],
          [
            "مانده پایان",
            closingBalance !== null
              ? formatMoney(closingBalance, currency)
              : "—",
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-hairline/50 bg-background/50 px-2.5 py-1.5"
          >
            <p className="text-[8px] text-ink-soft">{label}</p>
            <p className="num mt-0.5 text-[10px] font-bold">{value}</p>
          </div>
        ))}
      </div>
      {openingBalance !== null ? (
        <p className="mt-2 text-[8px] text-ink-soft">
          مانده ابتدای دوره:{" "}
          <span className="num font-semibold">
            {formatMoney(openingBalance, currency)}
          </span>
        </p>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>تاریخ</TableHead>
              <TableHead>شماره</TableHead>
              <TableHead>طرف حساب</TableHead>
              <TableHead>شرح</TableHead>
              <TableHead>حساب/روش</TableHead>
              <TableHead className="text-end">بدهکار</TableHead>
              <TableHead className="text-end">بستانکار</TableHead>
              <TableHead>وضعیت</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.id}-${row.number}`}>
                <TableCell className="num whitespace-nowrap text-[8px] text-ink-soft">
                  {formatJalali(row.date)}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-[8px] font-semibold">
                  {row.number}
                </TableCell>
                <TableCell className="max-w-[130px] truncate text-[8px]">
                  {row.party}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-[8px] text-ink-soft">
                  {row.description}
                </TableCell>
                <TableCell className="max-w-[100px] truncate text-[8px] text-ink-soft">
                  {row.account}
                </TableCell>
                <TableCell className="num text-end text-[8px]">
                  {row.debit > 0 ? formatMoney(row.debit, currency) : "—"}
                </TableCell>
                <TableCell className="num text-end text-[8px]">
                  {row.credit > 0 ? formatMoney(row.credit, currency) : "—"}
                </TableCell>
                <TableCell className="text-[8px] text-ink-soft">
                  {OPERATION_LABELS[row.status] ?? row.status}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function FinanceReports() {
  const { businessId, branchId, currency } = useWorkspace();
  const [searchParams] = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const initialKind = REPORT_KINDS.some(
    (item) => item.value === requestedKind,
  )
    ? (requestedKind as ReportKind)
    : "bank-ledger";
  const [kind, setKind] = useState<ReportKind>(initialKind);
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(() => isoDateValue(Date.now()));
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");

  const banks = useQuery(
    api.treasury.banks,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const funds = useQuery(
    api.treasury.funds,
    businessId ? { businessId, includeInactive: true } : "skip",
  );

  const ledgerKinds = kind === "bank-ledger" || kind === "cash-ledger";
  const bankOptions = (banks ?? []).map((bank) => ({
    id: bank._id,
    name: bank.name,
    type: "bank" as const,
  }));
  const fundOptions = (funds ?? []).map((fund) => ({
    id: fund._id,
    name: fund.name,
    type: "cash" as const,
  }));
  const accountOptions =
    kind === "bank-ledger"
      ? bankOptions
      : kind === "cash-ledger"
        ? fundOptions
        : [...bankOptions, ...fundOptions];
  const selectedAccount = accountOptions.find((item) => item.id === accountId);
  const effectiveAccount =
    selectedAccount ?? (ledgerKinds ? accountOptions[0] : undefined);
  const needsAccount = ledgerKinds && !effectiveAccount;

  useEffect(() => {
    setPage(1);
  }, [kind, from, to, search, accountId, pageSize]);

  const fromValue = timestampFromDateInput(from);
  const toValue = timestampFromDateInput(to, true);
  const report = useQuery(
    api.finance.report,
    businessId && !needsAccount
      ? {
          businessId,
          kind,
          branchId,
          from: Number.isFinite(fromValue) ? fromValue : undefined,
          to: Number.isFinite(toValue) ? toValue : undefined,
          accountType: effectiveAccount?.type,
          accountRefId: effectiveAccount?.id,
          search: search.trim() || undefined,
          page,
          pageSize: Number(pageSize),
        }
      : "skip",
  );

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `${report.title}-${from}-${to}`,
      [
        "تاریخ",
        "شماره",
        "طرف حساب",
        "شرح",
        "حساب/روش",
        "بدهکار",
        "بستانکار",
        "مبلغ",
        "وضعیت",
        "توضیح",
      ],
      report.rows.map((row) => [
        formatJalali(row.date),
        row.number,
        row.party,
        row.description,
        row.account,
        row.debit,
        row.credit,
        row.amount,
        OPERATION_LABELS[row.status] ?? row.status,
        row.extra ?? "",
      ]),
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · گزارش‌های مالی"
        title="گزارش‌های جامع خزانه‌داری"
        description="۱۲ گزارش مالی از داده واقعی با فیلتر تاریخ، شعبه، حساب، جستجو، صفحه‌بندی، چاپ، PDF مرورگری و خروجی Excel (CSV)."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!report}
              onClick={exportCsv}
              className="h-9 gap-1.5 px-3.5"
            >
              <FileSpreadsheet className="size-4" />
              Excel / CSV
            </Button>
            <Button
              size="sm"
              disabled={!report}
              onClick={() =>
                printAccountingView(`گزارش ${reportKindLabel(kind)}`)
              }
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
          </>
        }
      />

      <Panel className="space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setKind(item.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[8px] font-semibold transition-colors",
                kind === item.value
                  ? "border-brand bg-brand text-cream"
                  : "border-hairline bg-background text-ink-soft hover:border-brand/40 hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[9px] text-ink-soft">
            از
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              dir="ltr"
              className="num h-8 w-32 rounded-lg text-[9px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[9px] text-ink-soft">
            تا
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              dir="ltr"
              className="num h-8 w-32 rounded-lg text-[9px]"
            />
          </label>
          {accountOptions.length > 0 ? (
            <Select
              value={effectiveAccount?.id ?? (ledgerKinds ? "" : "all")}
              onValueChange={(value) =>
                setAccountId(value === "all" ? "" : value)
              }
            >
              <SelectTrigger className="h-8 w-[165px] rounded-lg text-[9px]">
                <SelectValue placeholder="همه حساب‌ها" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {!ledgerKinds ? (
                  <SelectItem value="all">همه حساب‌ها</SelectItem>
                ) : null}
                {accountOptions.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.type === "bank" ? "بانک" : "صندوق"} · {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-soft" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو در شماره، طرف حساب، شرح…"
              className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
            />
          </div>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[100px] rounded-lg text-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="10">۱۰ ردیف</SelectItem>
              <SelectItem value="25">۲۵ ردیف</SelectItem>
              <SelectItem value="50">۵۰ ردیف</SelectItem>
              <SelectItem value="100">۱۰۰ ردیف</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Panel>

      {needsAccount ? (
        <Panel>
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title="حساب مالی انتخاب نشده"
            description="برای گزارش گردش بانک یا صندوق ابتدا یک حساب مالی انتخاب کنید. اگر حسابی وجود ندارد، از صفحه بانک و صندوق ایجاد کنید."
          />
        </Panel>
      ) : !report ? (
        <Skeleton className="h-[420px] rounded-[22px]" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              {
                label: "جمع بدهکار",
                value: formatMoney(report.totals.debit, currency),
                tone: "text-brand",
              },
              {
                label: "جمع بستانکار",
                value: formatMoney(report.totals.credit, currency),
                tone: "text-destructive",
              },
              {
                label: "مانده دوره",
                value: formatMoney(report.totals.difference, currency),
                tone: "text-gold",
              },
              {
                label: "تعداد ردیف",
                value: report.total.toLocaleString("fa-IR"),
                tone: "text-ink",
              },
            ].map((card) => (
              <Panel key={card.label} className="p-3">
                <p className="text-[9px] text-ink-soft">{card.label}</p>
                <p className={cn("num mt-1.5 text-[15px] font-black", card.tone)}>
                  {card.value}
                </p>
              </Panel>
            ))}
          </div>

          <Panel className="space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold">{report.title}</p>
                <p className="text-[8px] text-ink-soft">
                  {Number.isFinite(fromValue)
                    ? formatJalali(fromValue)
                    : "ابتدای دوره"}{" "}
                  تا{" "}
                  {Number.isFinite(toValue) ? formatJalali(toValue) : "امروز"}
                  {effectiveAccount ? ` · ${effectiveAccount.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                >
                  <Download className="size-3" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    printAccountingView(`گزارش ${reportKindLabel(kind)}`)
                  }
                  className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                >
                  <Printer className="size-3" />
                  چاپ
                </Button>
              </div>
            </div>

            {report.rows.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="size-5" />}
                title="ردیفی در این گزارش نیست"
                description="بازه، حساب یا عبارت جستجو را تغییر دهید."
              />
            ) : (
              <ReportSheet
                title={report.title}
                subtitle={`${
                  Number.isFinite(fromValue)
                    ? formatJalali(fromValue)
                    : "ابتدای دوره"
                } تا ${
                  Number.isFinite(toValue) ? formatJalali(toValue) : "امروز"
                }`}
                rows={report.rows}
                currency={currency}
                totals={report.totals}
                openingBalance={report.openingBalance}
                closingBalance={report.closingBalance}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[8px] text-ink-soft">
                صفحه {report.page} از {report.pageCount} · {report.total} ردیف
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={report.page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                >
                  <ArrowRight className="size-3" />
                  قبلی
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={report.page >= report.pageCount}
                  onClick={() =>
                    setPage((value) => Math.min(report.pageCount, value + 1))
                  }
                  className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                >
                  بعدی
                  <ArrowLeft className="size-3" />
                </Button>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
