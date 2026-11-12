import {
  EmptyState,
  PageHeader,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AccountLevel } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  ACCOUNT_LEVEL_LABELS,
  ACCOUNT_TYPE_LABELS,
  balanceSide,
  downloadCsv,
  printAccountingView,
  timestampFromDateInput,
} from "@/lib/accounting";
import {
  currencyUnit,
  formatJalali,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Printer,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LEVELS: AccountLevel[] = ["group", "ledger", "subsidiary", "detail"];

function OpeningCell({ net }: { net: number }) {
  const side = balanceSide(net);
  if (side.side === null) return <span className="text-ink-soft">—</span>;
  return (
    <span className="num font-semibold text-ink">
      {formatNumber(side.amount)}
      <span className="ms-1 font-sans text-[8px] font-normal text-ink-soft">
        {side.side === "debit" ? "بد" : "بس"}
      </span>
    </span>
  );
}

export default function TrialBalance() {
  const { businessId, fiscalYearId, branches, activeFiscalYear, currency } =
    useWorkspace();
  const unit = currencyUnit(currency);
  const [level, setLevel] = useState<AccountLevel>("ledger");
  const [branchId, setBranchId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fromTimestamp = from ? timestampFromDateInput(from) : undefined;
  const toTimestamp = to ? timestampFromDateInput(to, true) : undefined;
  const invalidRange =
    fromTimestamp !== undefined &&
    toTimestamp !== undefined &&
    Number.isFinite(fromTimestamp) &&
    Number.isFinite(toTimestamp) &&
    fromTimestamp > toTimestamp;

  const report = useQuery(
    api.accountingReports.trialBalanceReport,
    businessId && fiscalYearId && !invalidRange
      ? {
          businessId,
          fiscalYearId,
          level,
          branchId:
            branchId === "all" ? undefined : (branchId as Id<"branches">),
          from:
            fromTimestamp !== undefined && Number.isFinite(fromTimestamp)
              ? fromTimestamp
              : undefined,
          to:
            toTimestamp !== undefined && Number.isFinite(toTimestamp)
              ? toTimestamp
              : undefined,
        }
      : "skip",
  );

  const exportExcel = () => {
    if (!report) return;
    downloadCsv(
      `trial-balance-${level}`,
      [
        "کد حساب",
        "عنوان حساب",
        "نوع",
        "مانده اول دوره",
        "گردش بدهکار",
        "گردش بستانکار",
        "مانده بدهکار",
        "مانده بستانکار",
      ],
      report.rows.map((row) => [
        row.code,
        row.name,
        ACCOUNT_TYPE_LABELS[row.type],
        row.openingNet,
        row.periodDebit,
        row.periodCredit,
        row.debitBalance,
        row.creditBalance,
      ]),
    );
    toast.success("خروجی Excel تراز آزمایشی آماده شد.");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حسابداری دوبل · کنترل توازن"
        title="تراز آزمایشی"
        description="مانده اول دوره، گردش و مانده پایان در سطح کل، معین یا تفصیلی. اختلاف بدهکار و بستانکار به‌صورت صریح هشدار داده می‌شود."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={!report || report.rows.length === 0}
              className="h-9 gap-1.5 rounded-xl"
            >
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => printAccountingView("تراز آزمایشی")}
              disabled={!report}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={exportExcel}
              disabled={!report || report.rows.length === 0}
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Download className="size-4" />
              دانلود
            </Button>
          </>
        }
      />

      <Panel className="overflow-hidden print-sheet">
        <PanelHeader
          title={`تراز آزمایشی ${ACCOUNT_LEVEL_LABELS[level]}`}
          description={
            report
              ? `${formatJalali(report.from)} تا ${formatJalali(report.to)} · ${
                  activeFiscalYear?.name ?? ""
                }`
              : "در حال محاسبه تراز…"
          }
          action={
            <div className="flex flex-wrap gap-1 print:hidden">
              {LEVELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLevel(value)}
                  className={cn(
                    "rounded-full px-2.5 py-1.5 text-[8px] font-semibold transition-colors",
                    level === value
                      ? "bg-primary text-primary-foreground"
                      : "text-ink-soft hover:bg-cream/60 hover:text-ink",
                  )}
                >
                  {ACCOUNT_LEVEL_LABELS[value]}
                </button>
              ))}
            </div>
          }
        />

        <div className="hidden border-b border-hairline/50 px-4 py-2 print:block">
          <p className="text-[10px] font-semibold text-ink">
            {activeFiscalYear?.name} · {report ? `${formatJalali(report.from)} تا ${formatJalali(report.to)}` : ""}
          </p>
        </div>

        <div className="grid gap-2 border-b border-hairline/50 px-4 py-2 print:hidden sm:grid-cols-3">
          <div className="space-y-1">
            <span className="text-[8px] text-ink-soft">شعبه</span>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="h-9 rounded-xl border-hairline bg-background text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">همه شعبه‌ها</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch._id} value={branch._id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[8px] text-ink-soft" htmlFor="trial-from">
              از تاریخ
            </label>
            <Input
              id="trial-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              dir="ltr"
              className="num h-9 rounded-xl border-hairline bg-background text-start text-[10px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[8px] text-ink-soft" htmlFor="trial-to">
              تا تاریخ
            </label>
            <Input
              id="trial-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              dir="ltr"
              className="num h-9 rounded-xl border-hairline bg-background text-start text-[10px]"
            />
          </div>
        </div>

        {invalidRange ? (
          <p className="mx-4 mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[9px] text-destructive">
            تاریخ شروع بعد از تاریخ پایان است.
          </p>
        ) : !report ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : report.rows.length === 0 ? (
          <EmptyState
            icon={<Scale className="size-5" />}
            title="داده‌ای برای تراز این سطح نیست"
            description="سطح دیگری را انتخاب کنید یا سند قطعی ثبت کنید. فقط اسناد قطعی در تراز محاسبه می‌شوند."
          />
        ) : (
          <>
            <div
              className={cn(
                "mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[9px]",
                report.balanced
                  ? "border-brand/20 bg-brand-soft/30 text-brand dark:bg-brand-soft/10"
                  : "border-destructive/25 bg-destructive/5 text-destructive",
              )}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                {report.balanced ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <AlertTriangle className="size-3.5" />
                )}
                {report.balanced
                  ? "تراز این سطح متوازن است."
                  : "اختلاف در تراز آزمایشی وجود دارد."}
              </span>
              <span className="num">
                اختلاف گردش: {formatNumber(report.difference)} {unit} ·
                اختلاف مانده: {formatNumber(report.closingDifference)} {unit}
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4 text-[9px] text-ink-soft">
                      کد حساب
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      عنوان حساب
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      نوع
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      مانده اول دوره
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      گردش بدهکار
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      گردش بستانکار
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      مانده بدهکار
                    </TableHead>
                    <TableHead className="pe-4 text-[9px] text-ink-soft">
                      مانده بستانکار
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.accountId}>
                      <TableCell className="num ps-4 font-mono text-[9px] text-ink-soft">
                        {row.code}
                      </TableCell>
                      <TableCell className="text-[9px] font-semibold text-ink">
                        {row.name}
                      </TableCell>
                      <TableCell className="text-[8px] text-ink-soft">
                        {ACCOUNT_TYPE_LABELS[row.type]}
                      </TableCell>
                      <TableCell>
                        <OpeningCell net={row.openingNet} />
                      </TableCell>
                      <TableCell className="num text-[9px] text-ink">
                        {row.periodDebit ? formatNumber(row.periodDebit) : "—"}
                      </TableCell>
                      <TableCell className="num text-[9px] text-ink">
                        {row.periodCredit ? formatNumber(row.periodCredit) : "—"}
                      </TableCell>
                      <TableCell className="num text-[9px] font-semibold text-ink">
                        {row.debitBalance
                          ? formatNumber(row.debitBalance)
                          : "—"}
                      </TableCell>
                      <TableCell className="num pe-4 text-[9px] font-semibold text-ink">
                        {row.creditBalance
                          ? formatNumber(row.creditBalance)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-brand-deep text-cream">
                    <TableCell colSpan={4} className="ps-4 text-[9px] font-bold">
                      جمع کل
                    </TableCell>
                    <TableCell className="num text-[9px] font-bold">
                      {formatNumber(report.totalDebit)}
                    </TableCell>
                    <TableCell className="num text-[9px] font-bold">
                      {formatNumber(report.totalCredit)}
                    </TableCell>
                    <TableCell className="num text-[9px] font-bold">
                      {formatNumber(report.totalDebitBalance)}
                    </TableCell>
                    <TableCell className="num pe-4 text-[9px] font-bold">
                      {formatNumber(report.totalCreditBalance)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3 text-[8px] text-ink-soft">
              <span>
                {formatNumber(report.rows.length)} حساب در سطح{" "}
                {ACCOUNT_LEVEL_LABELS[level]} · فقط اسناد قطعی
              </span>
              <span className="num">
                جمع بدهکار: {formatNumber(report.totalDebit)} · جمع بستانکار:{" "}
                {formatNumber(report.totalCredit)}
              </span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
