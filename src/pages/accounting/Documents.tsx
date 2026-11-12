import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { AccountingDocumentStatus } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  DOCUMENT_KIND_LABELS,
  documentStatusMeta,
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
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileClock,
  FilePlus2,
  FileText,
  Search,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router";

const STATUS_TABS: {
  value: "all" | AccountingDocumentStatus;
  label: string;
}[] = [
  { value: "all", label: "همه" },
  { value: "draft", label: "پیش‌نویس" },
  { value: "pending", label: "در انتظار تأیید" },
  { value: "posted", label: "قطعی" },
  { value: "reversed", label: "معکوس‌شده" },
];

export default function Documents() {
  const { businessId, fiscalYearId, currency, canWrite } = useWorkspace();
  const unit = currencyUnit(currency);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | AccountingDocumentStatus>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const fromTimestamp = from ? timestampFromDateInput(from) : undefined;
  const toTimestamp = to ? timestampFromDateInput(to, true) : undefined;
  const invalidRange =
    fromTimestamp !== undefined &&
    toTimestamp !== undefined &&
    Number.isFinite(fromTimestamp) &&
    Number.isFinite(toTimestamp) &&
    fromTimestamp > toTimestamp;

  const documents = useQuery(
    api.accountingDocuments.list,
    businessId && fiscalYearId && !invalidRange
      ? {
          businessId,
          fiscalYearId,
          status: status === "all" ? undefined : status,
          search: deferredSearch.trim() || undefined,
          from:
            fromTimestamp !== undefined && Number.isFinite(fromTimestamp)
              ? fromTimestamp
              : undefined,
          to:
            toTimestamp !== undefined && Number.isFinite(toTimestamp)
              ? toTimestamp
              : undefined,
          page,
          pageSize: 25,
        }
      : "skip",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="حسابداری دوبل · اسناد"
        title="اسناد حسابداری"
        description="پیش‌نویس، در انتظار تأیید، قطعی و معکوس‌شده. فقط سند قطعی وارد دفتر روزنامه، دفتر کل و تراز می‌شود."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard/accounting/journal">
                <BookOpen className="size-4" />
                دفتر روزنامه
              </Link>
            </Button>
            {canWrite ? (
              <Button
                asChild
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-3.5"
              >
                <Link to="/dashboard/accounting/documents/new">
                  <FilePlus2 className="size-4" />
                  سند جدید
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          title="فهرست اسناد"
          description={
            documents
              ? `${formatNumber(documents.total)} سند در این فیلتر`
              : "در حال دریافت اسناد…"
          }
          action={
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="شماره یا شرح سند"
                className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px]"
                aria-label="جستجوی سند"
              />
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline/50 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-[8px] font-semibold transition-colors",
                  status === tab.value
                    ? "bg-primary text-primary-foreground"
                    : "text-ink-soft hover:bg-cream/60 hover:text-ink",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              dir="ltr"
              aria-label="از تاریخ"
              className="num h-7 w-32 rounded-lg border-hairline bg-background text-start text-[9px]"
            />
            <span className="text-[8px] text-ink-soft">تا</span>
            <Input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              dir="ltr"
              aria-label="تا تاریخ"
              className="num h-7 w-32 rounded-lg border-hairline bg-background text-start text-[9px]"
            />
          </div>
        </div>

        {invalidRange ? (
          <p className="mx-4 mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[9px] text-destructive">
            تاریخ شروع بعد از تاریخ پایان است.
          </p>
        ) : !documents ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : documents.items.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={
              status === "all" && !search
                ? "هنوز سندی در این دوره ثبت نشده"
                : "سندی با این فیلتر پیدا نشد"
            }
            description={
              status === "all" && !search
                ? "اولین سند متوازن را ثبت کنید. پیش‌نویس‌ها در گزارش‌های دفتر اثر ندارند."
                : "وضعیت، بازه تاریخ یا عبارت جستجو را تغییر دهید."
            }
            action={
              status === "all" && !search && canWrite ? (
                <Button asChild size="sm" className="rounded-xl">
                  <Link to="/dashboard/accounting/documents/new">
                    <FilePlus2 className="size-4" />
                    ثبت اولین سند
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4 text-[9px] text-ink-soft">
                      شماره
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      تاریخ
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      شرح
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      نوع
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      ردیف
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      مبلغ ({unit})
                    </TableHead>
                    <TableHead className="text-[9px] text-ink-soft">
                      ثبت‌کننده
                    </TableHead>
                    <TableHead className="pe-4 text-[9px] text-ink-soft">
                      وضعیت
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.items.map((document) => {
                    const meta = documentStatusMeta(
                      document.status as AccountingDocumentStatus,
                    );
                    return (
                      <TableRow key={document._id}>
                        <TableCell className="ps-4">
                          <Link
                            to={`/dashboard/accounting/documents/${document._id}`}
                            className="num font-mono text-[10px] font-semibold text-brand hover:underline"
                          >
                            {document.number}
                          </Link>
                        </TableCell>
                        <TableCell className="num text-[9px] text-ink-soft">
                          {formatJalali(document.documentDate)}
                        </TableCell>
                        <TableCell className="max-w-64">
                          <p className="truncate text-[10px] text-ink">
                            {document.description}
                          </p>
                        </TableCell>
                        <TableCell className="text-[8px] text-ink-soft">
                          {DOCUMENT_KIND_LABELS[document.kind]}
                        </TableCell>
                        <TableCell className="num text-[9px] text-ink-soft">
                          {document.lineCount}
                        </TableCell>
                        <TableCell className="num text-[10px] font-semibold text-ink">
                          {formatNumber(document.totalDebit)}
                        </TableCell>
                        <TableCell className="text-[8px] text-ink-soft">
                          {document.createdByName}
                        </TableCell>
                        <TableCell className="pe-4">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-semibold",
                                meta.badge,
                              )}
                            >
                              <span
                                className={cn("size-1.5 rounded-full", meta.dot)}
                              />
                              {meta.label}
                            </span>
                            {document.difference !== 0 ? (
                              <AlertTriangle
                                className="size-3 text-gold"
                                aria-label="سند نامتوازن"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/40 md:hidden">
              {documents.items.map((document) => {
                const meta = documentStatusMeta(
                  document.status as AccountingDocumentStatus,
                );
                return (
                  <li key={document._id} className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/dashboard/accounting/documents/${document._id}`}
                        className="num font-mono text-[11px] font-semibold text-brand"
                      >
                        {document.number}
                      </Link>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[8px]",
                          meta.badge,
                        )}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-ink">
                      {document.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[8px] text-ink-soft">
                      <span className="num">{formatJalali(document.documentDate)}</span>
                      <span className="num font-semibold text-ink">
                        {formatNumber(document.totalDebit)} {unit}
                      </span>
                      <span>{document.createdByName}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3">
          <div className="flex flex-wrap gap-2 text-[8px] text-ink-soft">
            <span className="rounded-lg bg-background/70 px-2 py-1">
              جمع بدهکار:{" "}
              <b className="num text-ink">
                {formatNumber(documents?.totals.debit ?? 0)}
              </b>
            </span>
            <span className="rounded-lg bg-background/70 px-2 py-1">
              جمع بستانکار:{" "}
              <b className="num text-ink">
                {formatNumber(documents?.totals.credit ?? 0)}
              </b>
            </span>
          </div>
          {documents && documents.pageCount > 1 ? (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={documents.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="size-7 rounded-lg p-0"
                aria-label="صفحه قبل"
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <span className="num text-[9px] text-ink-soft">
                {formatNumber(documents.page)} / {formatNumber(documents.pageCount)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={documents.page >= documents.pageCount}
                onClick={() =>
                  setPage((current) =>
                    Math.min(documents.pageCount, current + 1),
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
      </Panel>

      <div className="flex items-start gap-2 rounded-[20px] border border-hairline/60 bg-card/60 px-4 py-3 text-[9px] leading-5 text-ink-soft">
        <FileClock className="mt-0.5 size-3.5 shrink-0 text-gold" />
        پیش‌نویس و سند در انتظار تأیید در هیچ گزارش دفتر کل، معین یا تراز
        آزمایشی محاسبه نمی‌شود. برای اصلاح سند قطعی از سند اصلاحی یا معکوس
        استفاده کنید.
        <Link
          to="/dashboard/accounting/trial-balance"
          className="ms-auto hidden shrink-0 items-center gap-1 font-semibold text-brand hover:underline sm:flex"
        >
          کنترل تراز
          <ArrowLeft className="size-3" />
        </Link>
      </div>
    </div>
  );
}
