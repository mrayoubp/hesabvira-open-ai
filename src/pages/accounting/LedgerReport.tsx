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
import { useWorkspace } from "@/hooks/use-workspace";
import {
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
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  ListTree,
  Printer,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type LedgerData = FunctionReturnType<typeof api.accountingReports.ledger>;
type SubsidiaryData = FunctionReturnType<
  typeof api.accountingReports.subsidiary
>;

function BalanceCell({
  net,
  currency,
}: {
  net: number;
  currency: string;
}) {
  const side = balanceSide(net);
  if (side.side === null) {
    return <span className="text-ink-soft">—</span>;
  }
  return (
    <span className="num font-semibold text-ink">
      {formatNumber(side.amount)}
      <span className="ms-1 font-sans text-[8px] font-normal text-ink-soft">
        {side.side === "debit" ? "بد" : "بس"} {currency}
      </span>
    </span>
  );
}

export default function LedgerReport({
  mode,
}: {
  mode: "ledger" | "subsidiary";
}) {
  const { businessId, fiscalYearId, branches, activeFiscalYear, currency } =
    useWorkspace();
  const unit = currencyUnit(currency);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [detailAccountId, setDetailAccountId] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const isSubsidiary = mode === "subsidiary";

  const accounts = useQuery(
    api.accounts.list,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const selectableAccounts = (accounts ?? []).filter(
    (account) => !isSubsidiary || account.level === "subsidiary",
  );

  const fromTimestamp = from ? timestampFromDateInput(from) : undefined;
  const toTimestamp = to ? timestampFromDateInput(to, true) : undefined;
  const invalidRange =
    fromTimestamp !== undefined &&
    toTimestamp !== undefined &&
    Number.isFinite(fromTimestamp) &&
    Number.isFinite(toTimestamp) &&
    fromTimestamp > toTimestamp;

  const sharedArgs =
    businessId && fiscalYearId && accountId && !invalidRange
      ? {
          businessId,
          fiscalYearId,
          accountId: accountId as Id<"accounts">,
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
      : null;

  const ledger = useQuery(
    api.accountingReports.ledger,
    !isSubsidiary && sharedArgs ? sharedArgs : "skip",
  ) as LedgerData | undefined;
  const subsidiary = useQuery(
    api.accountingReports.subsidiary,
    isSubsidiary && sharedArgs
      ? {
          ...sharedArgs,
          detailAccountId:
            detailAccountId === "all"
              ? undefined
              : (detailAccountId as Id<"accounts">),
        }
      : "skip",
  ) as SubsidiaryData | undefined;
  const data: LedgerData | SubsidiaryData | undefined = isSubsidiary
    ? subsidiary
    : ledger;

  const account = data?.account;
  const selectedAccount = accounts?.find((row) => row._id === accountId);
  const details = subsidiary?.details ?? [];

  const exportExcel = () => {
    if (!data) return;
    downloadCsv(
      `${isSubsidiary ? "subsidiary" : "ledger"}-${data.account.code}`,
      [
        "تاریخ",
        "شماره سند",
        "شرح سند",
        "کد حساب",
        "عنوان حساب",
        "شرح ردیف",
        "بدهکار",
        "بستانکار",
        "مانده",
      ],
      data.rows.map((row) => [
        formatJalali(row.documentDate),
        row.documentNumber,
        row.documentDescription,
        row.accountCode,
        row.accountName,
        row.description,
        row.debit,
        row.credit,
        row.runningNet,
      ]),
    );
    toast.success("خروجی Excel آماده شد.");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          isSubsidiary
            ? "حسابداری دوبل · دفتر معین"
            : "حسابداری دوبل · دفتر کل"
        }
        title={isSubsidiary ? "دفتر معین" : "دفتر کل"}
        description={
          isSubsidiary
            ? "انتخاب حساب معین و تفصیلی، مانده اول دوره، گردش بدهکار و بستانکار و مانده پایان."
            : "مانده اول دوره، گردش و مانده پایان هر حساب با ریز اسناد مرتبط. گردش حساب‌های کل شامل زیرمجموعه‌هاست."
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={!data || data.rows.length === 0}
              className="h-9 gap-1.5 rounded-xl"
            >
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                printAccountingView(isSubsidiary ? "دفتر معین" : "دفتر کل")
              }
              disabled={!data}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={exportExcel}
              disabled={!data || data.rows.length === 0}
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
          title={account ? `${account.code} — ${account.name}` : "انتخاب حساب"}
          description={
            data
              ? `${formatJalali(data.from)} تا ${formatJalali(data.to)} · ${
                  activeFiscalYear?.name ?? ""
                }`
              : "برای مشاهده گردش، حساب را انتخاب کنید."
          }
          action={
            <div className="flex flex-wrap gap-1">
              <Button asChild variant="outline" size="sm" className="h-7 rounded-lg text-[8px] print:hidden">
                <Link to="/dashboard/accounting/journal">دفتر روزنامه</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-7 rounded-lg text-[8px] print:hidden">
                <Link to="/dashboard/accounting/trial-balance">تراز آزمایشی</Link>
              </Button>
            </div>
          }
        />

        <div
          className={
            isSubsidiary
              ? "grid gap-2 border-b border-hairline/50 px-4 py-2 print:hidden sm:grid-cols-2 lg:grid-cols-5"
              : "grid gap-2 border-b border-hairline/50 px-4 py-2 print:hidden sm:grid-cols-2 lg:grid-cols-4"
          }
        >
          <div className="space-y-1">
            <span className="text-[8px] text-ink-soft">
              {isSubsidiary ? "حساب معین" : "حساب"}
            </span>
            <AccountPicker
              accounts={selectableAccounts}
              value={accountId}
              onChange={(value) => {
                setAccountId(value || null);
                setDetailAccountId("all");
              }}
              allowInactive
              placeholder={isSubsidiary ? "انتخاب معین" : "انتخاب حساب"}
            />
          </div>
          {isSubsidiary ? (
            <div className="space-y-1">
              <span className="text-[8px] text-ink-soft">تفصیلی</span>
              <Select
                value={detailAccountId}
                onValueChange={setDetailAccountId}
                disabled={!subsidiary}
              >
                <SelectTrigger className="h-9 rounded-xl border-hairline bg-background text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 rounded-xl">
                  <SelectItem value="all">همه تفصیلی‌ها</SelectItem>
                  {details.map((detail) => (
                    <SelectItem key={detail._id} value={detail._id}>
                      {detail.code} — {detail.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
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
            <label className="text-[8px] text-ink-soft" htmlFor="ledger-from">
              از تاریخ
            </label>
            <Input
              id="ledger-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              dir="ltr"
              className="num h-9 rounded-xl border-hairline bg-background text-start text-[10px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[8px] text-ink-soft" htmlFor="ledger-to">
              تا تاریخ
            </label>
            <Input
              id="ledger-to"
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
        ) : !accountId ? (
          <EmptyState
            icon={
              isSubsidiary ? (
                <ListTree className="size-5" />
              ) : (
                <Scale className="size-5" />
              )
            }
            title={
              isSubsidiary
                ? "یک حساب معین انتخاب کنید"
                : "یک حساب برای گزارش انتخاب کنید"
            }
            description={
              isSubsidiary
                ? "گزارش معین، گردش تفصیلی‌های زیرمجموعه را نیز نشان می‌دهد."
                : "گردش حساب‌های کل شامل تمام معین و تفصیلی‌های زیرمجموعه است."
            }
          />
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-2 border-b border-hairline/50 px-4 py-3 sm:grid-cols-4">
              {[
                {
                  label: "مانده اول دوره",
                  value: <BalanceCell net={data.openingNet} currency={unit} />,
                },
                {
                  label: "گردش بدهکار",
                  value: (
                    <span className="num font-semibold text-ink">
                      {formatNumber(data.debit)}
                    </span>
                  ),
                },
                {
                  label: "گردش بستانکار",
                  value: (
                    <span className="num font-semibold text-ink">
                      {formatNumber(data.credit)}
                    </span>
                  ),
                },
                {
                  label: "مانده پایان دوره",
                  value: <BalanceCell net={data.closingNet} currency={unit} />,
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-hairline/50 bg-background/60 p-2.5"
                >
                  <p className="text-[8px] text-ink-soft">{card.label}</p>
                  <div className="mt-1 text-[11px]">{card.value}</div>
                </div>
              ))}
            </div>

            {isSubsidiary && details.length > 0 ? (
              <div className="border-b border-hairline/50 px-4 py-3">
                <p className="mb-2 text-[9px] font-semibold text-ink-soft">
                  گردش تفصیلی‌های این معین
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {details.map((detail) => (
                    <button
                      key={detail._id}
                      type="button"
                      onClick={() => setDetailAccountId(detail._id)}
                      className={
                        detailAccountId === detail._id
                          ? "rounded-xl border border-brand/30 bg-brand-soft/30 p-2.5 text-start dark:bg-brand-soft/10"
                          : "rounded-xl border border-hairline/50 bg-background/50 p-2.5 text-start hover:border-brand/20"
                      }
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="num font-mono text-[8px] text-ink-soft">
                          {detail.code}
                        </span>
                        <span className="text-[8px] text-ink-soft">
                          {detail.linkedEntityName ?? detail.name}
                        </span>
                      </div>
                      <p className="mt-1 flex items-center justify-between gap-2 text-[9px]">
                        <span className="text-ink-soft">مانده پایان</span>
                        <BalanceCell net={detail.closingNet} currency={unit} />
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {data.rows.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="size-5" />}
                title="گردشی در این بازه نیست"
                description="بازه تاریخ، شعبه یا حساب دیگری را انتخاب کنید. فقط اسناد قطعی محاسبه می‌شوند."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="ps-4 text-[9px] text-ink-soft">
                        تاریخ
                      </TableHead>
                      <TableHead className="text-[9px] text-ink-soft">
                        شماره سند
                      </TableHead>
                      <TableHead className="text-[9px] text-ink-soft">
                        شرح
                      </TableHead>
                      <TableHead className="text-[9px] text-ink-soft">
                        حساب ردیف
                      </TableHead>
                      <TableHead className="text-[9px] text-ink-soft">
                        بدهکار ({unit})
                      </TableHead>
                      <TableHead className="text-[9px] text-ink-soft">
                        بستانکار ({unit})
                      </TableHead>
                      <TableHead className="pe-4 text-[9px] text-ink-soft">
                        مانده
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TableRow key={row.lineId}>
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
                        <TableCell className="max-w-56">
                          <p className="truncate text-[9px] text-ink">
                            {row.description || row.documentDescription}
                          </p>
                          <p className="mt-0.5 truncate text-[8px] text-ink-soft">
                            {row.documentDescription}
                          </p>
                        </TableCell>
                        <TableCell className="text-[8px] text-ink-soft">
                          <span className="num font-mono">{row.accountCode}</span>
                          <span className="mx-1">·</span>
                          {row.accountName}
                        </TableCell>
                        <TableCell className="num text-[9px] font-semibold text-ink">
                          {row.debit ? formatNumber(row.debit) : "—"}
                        </TableCell>
                        <TableCell className="num text-[9px] font-semibold text-ink">
                          {row.credit ? formatNumber(row.credit) : "—"}
                        </TableCell>
                        <TableCell className="pe-4">
                          <BalanceCell net={row.runningNet} currency={unit} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <TableRow className="bg-brand-soft/35 font-bold dark:bg-brand-soft/10">
                      <TableCell colSpan={4} className="ps-4 text-[9px] text-ink">
                        جمع گردش بازه
                      </TableCell>
                      <TableCell className="num text-[10px] text-ink">
                        {formatNumber(data.debit)}
                      </TableCell>
                      <TableCell className="num text-[10px] text-ink">
                        {formatNumber(data.credit)}
                      </TableCell>
                      <TableCell className="pe-4">
                        <BalanceCell net={data.closingNet} currency={unit} />
                      </TableCell>
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            )}
          </>
        )}
      </Panel>

      {selectedAccount && !selectedAccount.active ? (
        <p className="rounded-[18px] border border-gold/25 bg-gold-soft/30 px-4 py-3 text-[9px] leading-5 text-[#7a6122] dark:bg-gold-soft/5 dark:text-gold">
          این حساب غیرفعال است؛ گردش تاریخی آن همچنان در گزارش نمایش داده
          می‌شود اما در سند جدید قابل انتخاب نیست.
        </p>
      ) : null}
    </div>
  );
}
