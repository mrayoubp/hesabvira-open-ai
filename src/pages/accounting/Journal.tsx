import { AccountPicker } from "@/components/accounting/AccountPicker";
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
import type { AccountingDocumentStatus } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  documentStatusMeta,
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
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  Search,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type JournalData = FunctionReturnType<typeof api.accountingReports.journal>;

export default function Journal() {
  const { businessId, fiscalYearId, branches, activeFiscalYear, currency } =
    useWorkspace();
  const convex = useConvex();
  const unit = currencyUnit(currency);
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<"date_asc" | "date_desc">("date_asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const fromTimestamp = from ? timestampFromDateInput(from) : undefined;
  const toTimestamp = to ? timestampFromDateInput(to, true) : undefined;
  const invalidRange =
    fromTimestamp !== undefined &&
    toTimestamp !== undefined &&
    Number.isFinite(fromTimestamp) &&
    Number.isFinite(toTimestamp) &&
    fromTimestamp > toTimestamp;

  const accounts = useQuery(
    api.accounts.list,
    businessId ? { businessId } : "skip",
  );

  const queryArgs =
    businessId && fiscalYearId && !invalidRange
      ? {
          businessId,
          fiscalYearId,
          branchId:
            branchId === "all" ? undefined : (branchId as Id<"branches">),
          accountId: accountId ? (accountId as Id<"accounts">) : undefined,
          from:
            fromTimestamp !== undefined && Number.isFinite(fromTimestamp)
              ? fromTimestamp
              : undefined,
          to:
            toTimestamp !== undefined && Number.isFinite(toTimestamp)
              ? toTimestamp
              : undefined,
          search: deferredSearch.trim() || undefined,
          sort,
          page,
          pageSize: 50,
        }
      : null;

  const journal = useQuery(
    api.accountingReports.journal,
    queryArgs ?? "skip",
  ) as JournalData | undefined;

  const exportExcel = async () => {
    if (!queryArgs) return;
    setExporting(true);
    try {
      const data = await convex.query(api.accountingReports.journal, {
        ...queryArgs,
        exportAll: true,
      });
      downloadCsv(
        `journal-${data.fiscalYear.name.replace(/\s/g, "-")}`,
        [
          "تاریخ",
          "شماره سند",
          "شرح سند",
          "کد حساب",
          "عنوان حساب",
          "شرح ردیف",
          "بدهکار",
          "بستانکار",
          "وضعیت",
        ],
        data.rows.map((row) => [
          formatJalali(row.documentDate),
          row.documentNumber,
          row.documentDescription,
          row.accountCode,
          row.accountName,
          row.lineDescription,
          row.debit,
          row.credit,
          documentStatusMeta(row.documentStatus as AccountingDocumentStatus)
            .label,
        ]),
      );
      toast.success(`${formatNumber(data.rows.length)} ردیف برای Excel آماده شد.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خروجی انجام نشد.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حسابداری دوبل · دفتر روزنامه"
        title="دفتر روزنامه"
        description="ریز ردیف‌های اسناد قطعی به ترتیب تاریخ، با فیلتر حساب، شعبه، شماره سند و بازه زمانی."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={!journal || exporting || journal.rows.length === 0}
              className="h-9 gap-1.5 rounded-xl"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => printAccountingView("دفتر روزنامه")}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={exportExcel}
              disabled={!journal || exporting || journal.rows.length === 0}
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
          title="گردش دفتر روزنامه"
          description={
            journal
              ? `${formatNumber(journal.total)} ردیف از ${formatNumber(
                  journal.documentCount,
                )} سند`
              : "در حال محاسبه گزارش…"
          }
          action={
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="شماره سند، شرح یا حساب"
                className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px] print:hidden"
                aria-label="جستجوی دفتر روزنامه"
              />
            </div>
          }
        />

        <div className="hidden border-b border-hairline/50 px-4 py-2 print:block">
          <p className="text-[10px] font-semibold text-ink">
            {activeFiscalYear?.name} ·{" "}
            {journal
              ? `${formatJalali(journal.from)} تا ${formatJalali(journal.to)}`
              : ""}
          </p>
        </div>

        <div className="grid gap-2 border-b border-hairline/50 px-4 py-2 print:hidden sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-[8px] text-ink-soft" htmlFor="journal-account">
              حساب
            </label>
            <AccountPicker
              id="journal-account"
              accounts={accounts ?? []}
              value={accountId}
              onChange={(value) => {
                setAccountId(value || null);
                setPage(1);
              }}
              placeholder="همه حساب‌ها"
            />
          </div>
          <div className="space-y-1">
            <span className="text-[8px] text-ink-soft">شعبه</span>
            <Select
              value={branchId}
              onValueChange={(value) => {
                setBranchId(value);
                setPage(1);
              }}
            >
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
            <label className="text-[8px] text-ink-soft" htmlFor="journal-from">
              از تاریخ
            </label>
            <Input
              id="journal-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              dir="ltr"
              className="num h-9 rounded-xl border-hairline bg-background text-start text-[10px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[8px] text-ink-soft" htmlFor="journal-to">
              تا تاریخ
            </label>
            <Input
              id="journal-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              dir="ltr"
              className="num h-9 rounded-xl border-hairline bg-background text-start text-[10px]"
            />
          </div>
        </div>

        {invalidRange ? (
          <p className="mx-4 mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[9px] text-destructive">
            تاریخ شروع بعد از تاریخ پایان است.
          </p>
        ) : !journal ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : journal.rows.length === 0 ? (
          <EmptyState
            icon={<ArrowDownUp className="size-5" />}
            title="ردیفی در دفتر روزنامه نیست"
            description="فقط اسناد قطعی در این گزارش دیده می‌شوند. فیلترها را تغییر دهید یا سند جدیدی قطعی کنید."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4 text-[9px] text-ink-soft">
                      <button
                        type="button"
                        onClick={() => {
                          setSort((current) =>
                            current === "date_asc" ? "date_desc" : "date_asc",
                          );
                          setPage(1);
                        }}
                        className="flex items-center gap-1 hover:text-ink print:pointer-events-none"
                      >
                        تاریخ
                        <ArrowDownUp className="size-3 print:hidden" />
                      </button>
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      شماره سند
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      شرح
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      کد حساب
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      عنوان حساب
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      بدهکار ({unit})
                    </TableHead>
                    <TableHead className="pe-4 text-[9px] text-ink-soft">
                      بستانکار ({unit})
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journal.rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="num ps-4 text-[9px] text-ink-soft">
                        {formatJalali(row.documentDate)}
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/dashboard/accounting/documents/${row.documentId}`}
                          className="num font-mono text-[9px] font-semibold text-brand hover:underline"
                        >
                          {row.documentNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-52">
                        <p className="truncate text-[9px] text-ink">
                          {row.documentDescription}
                        </p>
                        {row.lineDescription !== row.documentDescription ? (
                          <p className="mt-0.5 truncate text-[8px] text-ink-soft">
                            {row.lineDescription}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="num font-mono text-[9px] text-ink-soft">
                        {row.accountCode}
                      </TableCell>
                      <TableCell className="text-[9px] text-ink">
                        {row.accountName}
                      </TableCell>
                      <TableCell className="num text-[9px] font-semibold text-ink">
                        {row.debit ? formatNumber(row.debit) : "—"}
                      </TableCell>
                      <TableCell className="num pe-4 text-[9px] font-semibold text-ink">
                        {row.credit ? formatNumber(row.credit) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-brand-soft/35 font-bold dark:bg-brand-soft/10">
                    <TableCell colSpan={5} className="ps-4 text-[9px] text-ink">
                      جمع کل ({formatNumber(journal.total)} ردیف)
                    </TableCell>
                    <TableCell className="num text-[10px] text-ink">
                      {formatNumber(journal.totalDebit)}
                    </TableCell>
                    <TableCell className="num pe-4 text-[10px] text-ink">
                      {formatNumber(journal.totalCredit)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3 print:hidden">
              <span
                className={cn(
                  "text-[8px]",
                  journal.difference === 0 ? "text-brand" : "text-destructive",
                )}
              >
                {journal.difference === 0
                  ? "جمع بدهکار و بستانکار این فیلتر برابر است."
                  : `اختلاف: ${formatNumber(Math.abs(journal.difference))} ${unit}`}
              </span>
              {journal.pageCount > 1 ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={journal.page <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="size-7 rounded-lg p-0"
                    aria-label="صفحه قبل"
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                  <span className="num text-[9px] text-ink-soft">
                    {formatNumber(journal.page)} /{" "}
                    {formatNumber(journal.pageCount)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={journal.page >= journal.pageCount}
                    onClick={() =>
                      setPage((current) =>
                        Math.min(journal.pageCount, current + 1),
                      )
                    }
                    className="size-7 rounded-lg p-0"
                    aria-label="صفحه بعد"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
