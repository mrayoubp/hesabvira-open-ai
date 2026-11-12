import { InvoiceDetailDialog } from "@/components/app/InvoiceDetailDialog";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
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
import type { Id } from "@/convex/_generated/dataModel";
import type { InvoiceStatus } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatMoney,
  formatNumber,
  INVOICE_STATUS_META,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  ReceiptText,
  Search,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

type Filter = "all" | InvoiceStatus;
type SortKey = "issueDate" | "number" | "customerName" | "total";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 10;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "draft", label: "پیش‌نویس" },
  { value: "issued", label: "صادرشده" },
  { value: "paid", label: "پرداخت‌شده" },
  { value: "void", label: "ابطال" },
];

const sortLabels: Record<SortKey, string> = {
  issueDate: "تاریخ صدور",
  number: "شماره سند",
  customerName: "مشتری",
  total: "مبلغ نهایی",
};

export default function Invoices() {
  const { businessId, branchId, fiscalYearId, currency, canWrite, workspace } =
    useWorkspace();
  const [status, setStatus] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("issueDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const setInvoiceStatus = useMutation(api.invoices.setStatus);

  const invoices = useQuery(
    api.invoices.list,
    businessId
      ? {
          businessId,
          branchId,
          fiscalYearId,
          search: deferredSearch.trim() || undefined,
        }
      : "skip",
  );

  const unit = currencyUnit(currency);
  const activeInvoiceId = searchParams.get("invoice");

  const counts = invoices?.reduce<Record<Filter, number>>(
    (acc, invoice) => {
      acc.all += 1;
      acc[invoice.status] += 1;
      return acc;
    },
    { all: 0, draft: 0, issued: 0, paid: 0, void: 0 },
  );

  const visible =
    invoices?.filter(
      (invoice) => status === "all" || invoice.status === status,
    ) ?? [];

  const sorted = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      if (sortKey === "issueDate") {
        return (a.issueDate - b.issueDate) * direction;
      }
      if (sortKey === "total") {
        return (a.total - b.total) * direction;
      }
      if (sortKey === "number") {
        return a.number.localeCompare(b.number, "fa") * direction;
      }
      return a.customerName.localeCompare(b.customerName, "fa") * direction;
    });
  }, [visible, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paged = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "issueDate" || key === "total" ? "desc" : "asc");
    }
    setPage(1);
  };

  const openInvoice = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("invoice", id);
    setSearchParams(next);
  };

  const handleDialogChange = (open: boolean) => {
    if (open) return;
    const next = new URLSearchParams(searchParams);
    next.delete("invoice");
    setSearchParams(next, { replace: true });
  };

  const quickAction = async (
    invoiceId: string,
    target: InvoiceStatus,
    number: string,
  ) => {
    if (!businessId) return;
    setPendingId(invoiceId);
    try {
      await setInvoiceStatus({
        businessId,
        invoiceId: invoiceId as Id<"invoices">,
        status: target,
      });
      toast.success(
        target === "issued"
          ? `فاکتور ${number} صادر شد.`
          : `فاکتور ${number} پرداخت‌شده ثبت شد.`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPendingId(null);
    }
  };

  const isFiltering = status !== "all" || deferredSearch.trim().length > 0;

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDirection === "asc" ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="فروش · دفتر اسناد"
        title="فاکتورهای فروش"
        description="پیش‌نویس بسازید، سند را نهایی کنید و پرداخت را ثبت کنید. تغییر مستقیم اسناد قطعی ممکن نیست؛ ابطال، ردپای سند را حفظ می‌کند."
        actions={
          canWrite ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/dashboard/invoices/new">
                <Plus className="size-4" />
                فاکتور جدید
              </Link>
            </Button>
          ) : (
            <span className="rounded-full border border-hairline/70 bg-surface/70 px-3 py-1.5 text-[9px] font-medium text-ink-soft">
              دسترسی مشاهده
            </span>
          )
        }
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          eyebrow="دفتر فروش"
          title="فهرست فاکتورها"
          description={
            invoices
              ? `${formatNumber(counts?.all ?? 0)} سند ثبت‌شده · واحد: ${unit}`
              : "در حال دریافت اسناد…"
          }
          action={
            <div className="relative w-full sm:w-72">
              <Search className="absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-soft/60" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="شماره فاکتور یا نام مشتری…"
                className="h-9 bg-surface pe-9 text-[11px]"
              />
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-1.5 border-y border-hairline/60 bg-cream/20 px-4 py-2.5 dark:bg-white/[0.015]">
          {filters.map((filter) => {
            const active = status === filter.value;
            const count = counts?.[filter.value];
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setStatus(filter.value);
                  setPage(1);
                }}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[10px] font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-[0_8px_16px_-12px_rgba(15,81,63,0.7)]"
                    : "text-ink-soft hover:bg-surface hover:text-ink",
                )}
              >
                {filter.label}
                <span
                  className={cn(
                    "num rounded-full px-1 text-[8px] font-semibold",
                    active
                      ? "bg-white/15 text-cream/80"
                      : "bg-cream/70 text-ink-soft/70 dark:bg-white/[0.05]",
                  )}
                >
                  {counts ? formatNumber(count ?? 0) : "—"}
                </span>
              </button>
            );
          })}
          <span className="ms-auto hidden items-center gap-1 text-[8.5px] text-ink-soft/60 sm:flex">
            مرتب‌سازی: {sortLabels[sortKey]}
            {sortDirection === "asc" ? " ↑" : " ↓"}
          </span>
        </div>

        {!invoices ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-[11px]" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-5" />}
            title={
              isFiltering
                ? "سندی با این مشخصات پیدا نشد"
                : "هنوز فاکتوری ثبت نشده"
            }
            description={
              isFiltering
                ? "فیلتر وضعیت یا عبارت جستجو را تغییر دهید."
                : "اولین فاکتور فروش را بسازید؛ مبالغ و مالیات روی سرور محاسبه می‌شوند."
            }
            action={
              isFiltering ? undefined : (
                <Button asChild size="sm" className="gap-1.5">
                  <Link to="/dashboard/invoices/new">
                    <Plus className="size-4" />
                    ساخت فاکتور
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4">
                      <button
                        type="button"
                        onClick={() => toggleSort("number")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        شماره سند
                        {sortIcon("number")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("customerName")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        مشتری
                        {sortIcon("customerName")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("issueDate")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        تاریخ صدور
                        {sortIcon("issueDate")}
                      </button>
                    </TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("total")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        مبلغ نهایی ({unit})
                        {sortIcon("total")}
                      </button>
                    </TableHead>
                    <TableHead className="w-44 pe-4 text-end">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((invoice) => (
                    <TableRow
                      key={invoice._id}
                      className="group cursor-pointer"
                      onClick={() => openInvoice(invoice._id)}
                    >
                      <TableCell className="ps-4">
                        <span
                          className="rounded-md border border-hairline/70 bg-cream/35 px-2 py-1 font-mono text-[10px] font-medium text-ink dark:bg-white/[0.03]"
                          dir="ltr"
                        >
                          {invoice.number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-[9px] font-bold text-brand">
                            {invoice.customerName.trim().charAt(0) || "م"}
                          </span>
                          <span className="max-w-[180px] truncate text-[11px] font-medium text-ink">
                            {invoice.customerName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="num text-[10px] text-ink-soft">
                        {formatJalali(invoice.issueDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="num text-[11px] font-bold text-ink">
                        {formatNumber(invoice.total)}
                      </TableCell>
                      <TableCell
                        className="pe-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[9.5px] text-brand hover:bg-brand-soft"
                            onClick={() => openInvoice(invoice._id)}
                          >
                            جزئیات
                            <ArrowLeft className="size-2.5" />
                          </Button>
                          {canWrite && invoice.status === "draft" ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2 text-[9.5px]"
                              disabled={pendingId === invoice._id}
                              onClick={() =>
                                quickAction(
                                  invoice._id,
                                  "issued",
                                  invoice.number,
                                )
                              }
                            >
                              {pendingId === invoice._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : null}
                              صدور
                            </Button>
                          ) : null}
                          {canWrite && invoice.status === "issued" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 border-gold/35 bg-gold-soft/70 px-2 text-[9.5px] text-[#7a6122] hover:bg-gold-soft dark:text-gold"
                              disabled={pendingId === invoice._id}
                              onClick={() =>
                                quickAction(
                                  invoice._id,
                                  "paid",
                                  invoice.number,
                                )
                              }
                            >
                              {pendingId === invoice._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : null}
                              ثبت پرداخت
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/60 md:hidden">
              {paged.map((invoice) => (
                <li key={invoice._id}>
                  <button
                    type="button"
                    onClick={() => openInvoice(invoice._id)}
                    className="w-full p-4 text-start transition-colors hover:bg-cream/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span
                          className="rounded-md border border-hairline/70 bg-cream/35 px-1.5 py-0.5 font-mono text-[9px] text-ink-soft"
                          dir="ltr"
                        >
                          {invoice.number}
                        </span>
                        <p className="mt-2 truncate text-[12px] font-bold text-ink">
                          {invoice.customerName}
                        </p>
                        <p className="num mt-1 text-[9.5px] text-ink-soft">
                          {formatJalali(invoice.issueDate)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge status={invoice.status} />
                        <span className="num text-[12px] font-bold text-ink">
                          {formatMoney(invoice.total, currency)}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-[9px] text-ink-soft" dir="ltr">
                  {formatNumber(pageStart + 1)}–
                  {formatNumber(Math.min(pageStart + PAGE_SIZE, sorted.length))}{" "}
                  / {formatNumber(sorted.length)}
                </span>
                <span className="flex items-center gap-2">
                  {(["draft", "issued", "paid", "void"] as InvoiceStatus[]).map(
                    (value) => (
                      <span
                        key={value}
                        className="flex items-center gap-1 text-[8px] text-ink-soft/70"
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            INVOICE_STATUS_META[value].dot,
                          )}
                        />
                        {INVOICE_STATUS_META[value].label}
                      </span>
                    ),
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  aria-label="صفحه قبل"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
                <span className="num min-w-14 text-center text-[9px] font-medium text-ink-soft">
                  {formatNumber(currentPage)} / {formatNumber(totalPages)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    setPage(Math.min(totalPages, currentPage + 1))
                  }
                  disabled={currentPage === totalPages}
                  aria-label="صفحه بعد"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>

      <InvoiceDetailDialog
        open={Boolean(activeInvoiceId)}
        onOpenChange={handleDialogChange}
        businessId={businessId}
        invoiceId={activeInvoiceId}
        currency={currency}
        businessName={workspace?.business.name}
      />
    </div>
  );
}
