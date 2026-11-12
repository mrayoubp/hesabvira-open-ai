import { CustomerDialog } from "@/components/app/CustomerDialog";
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
import type { CustomerSummary } from "@/convex/customers";
import { useWorkspace } from "@/hooks/use-workspace";
import { currencyUnit, formatJalali, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router";

type SortKey = "name" | "code" | "createdAt" | "totalSales" | "outstanding";
type SortDirection = "asc" | "desc";
const PAGE_SIZE = 10;

export default function Customers() {
  const { businessId, currency } = useWorkspace();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);

  const customers = useQuery(
    api.customers.list,
    businessId
      ? { businessId, search: deferredSearch.trim() || undefined }
      : "skip",
  );

  // Deep links from global search and the dashboard onboarding.
  useEffect(() => {
    if (!customers) return;
    const newCustomer = searchParams.get("new");
    const customerId = searchParams.get("customer");
    if (!newCustomer && !customerId) return;

    if (newCustomer) {
      setEditing(null);
      setDialogOpen(true);
    } else if (customerId) {
      const match = customers.find((item) => item._id === customerId);
      if (match) {
        setEditing(match);
        setDialogOpen(true);
      }
    }

    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("customer");
    setSearchParams(next, { replace: true });
  }, [customers, searchParams, setSearchParams]);

  const unit = currencyUnit(currency);

  const sorted = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...(customers ?? [])].sort((a, b) => {
      if (sortKey === "createdAt") {
        return (a.createdAt - b.createdAt) * direction;
      }
      if (sortKey === "totalSales") {
        return (a.totalSales - b.totalSales) * direction;
      }
      if (sortKey === "outstanding") {
        return (a.outstanding - b.outstanding) * direction;
      }
      if (sortKey === "code") {
        return a.code.localeCompare(b.code, "fa") * direction;
      }
      return a.name.localeCompare(b.name, "fa") * direction;
    });
  }, [customers, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paged = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (customer: CustomerSummary) => {
    setEditing(customer);
    setDialogOpen(true);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "createdAt" ? "desc" : "asc");
    }
    setPage(1);
  };

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
        eyebrow="اشخاص · دفتر مشتریان"
        title="مشتریان"
        description="پرونده هر مشتری، جمع فروش و مانده بدهی او. حذف اطلاعات مالی انجام نمی‌شود؛ اسناد قابل ردیابی می‌مانند."
        actions={
          <Button
            size="sm"
            onClick={openCreate}
            className="gap-1.5"
            disabled={!businessId}
          >
            <Plus className="size-4" />
            مشتری جدید
          </Button>
        }
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          eyebrow="فهرست مشتریان"
          title="دفتر طرف حساب‌ها"
          description={
            customers
              ? `${formatNumber(customers.length)} پرونده در این فضای کاری`
              : "در حال بارگذاری…"
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
                placeholder="جستجو در نام، کد یا تماس…"
                className="h-9 bg-surface pe-9 text-[11px]"
              />
            </div>
          }
        />

        {!customers ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-[11px]" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={search ? "مشتری‌ای پیدا نشد" : "هنوز مشتری‌ای ثبت نشده"}
            description={
              search
                ? "عبارت جستجو را تغییر دهید یا مشتری جدیدی ثبت کنید."
                : "برای صدور فاکتور، ابتدا پرونده مشتری را بسازید."
            }
            action={
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="size-4" />
                ثبت مشتری
              </Button>
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
                        onClick={() => toggleSort("code")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        کد
                        {sortIcon("code")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("name")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        مشتری
                        {sortIcon("name")}
                      </button>
                    </TableHead>
                    <TableHead>تماس</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("createdAt")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        تاریخ ثبت
                        {sortIcon("createdAt")}
                      </button>
                    </TableHead>
                    <TableHead>فاکتور</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("totalSales")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        فروش ({unit})
                        {sortIcon("totalSales")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("outstanding")}
                        className="flex items-center gap-1 transition-colors hover:text-ink"
                      >
                        مانده
                        {sortIcon("outstanding")}
                      </button>
                    </TableHead>
                    <TableHead className="w-14 pe-4 text-end">ویرایش</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((customer) => (
                    <TableRow key={customer._id} className="group align-middle">
                      <TableCell className="ps-4">
                        <span
                          className="rounded-md border border-hairline/70 bg-cream/35 px-1.5 py-0.5 font-mono text-[9px] text-ink-soft dark:bg-white/[0.03]"
                          dir="ltr"
                        >
                          {customer.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-[9px] font-bold text-brand">
                            {customer.name.trim().charAt(0) || "م"}
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-[190px] truncate text-[11px] font-semibold text-ink">
                              {customer.name}
                            </p>
                            {customer.address ? (
                              <p className="mt-0.5 max-w-[190px] truncate text-[8px] text-ink-soft/70">
                                {customer.address}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="num text-[10px] text-ink-soft"
                        dir="ltr"
                      >
                        {customer.phone ?? "—"}
                      </TableCell>
                      <TableCell className="num text-[10px] text-ink-soft">
                        {formatJalali(customer.createdAt)}
                      </TableCell>
                      <TableCell className="num text-[10px] text-ink-soft">
                        {formatNumber(customer.invoiceCount)}
                      </TableCell>
                      <TableCell className="num text-[10.5px] font-semibold text-ink">
                        {formatNumber(customer.totalSales)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "num text-[10.5px] font-semibold",
                          customer.outstanding > 0
                            ? "text-[#8a6a20] dark:text-gold"
                            : "text-ink-soft",
                        )}
                      >
                        {formatNumber(customer.outstanding)}
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-ink-soft/60 hover:bg-brand-soft hover:text-brand"
                          onClick={() => openEdit(customer)}
                          aria-label={`ویرایش ${customer.name}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/60 md:hidden">
              {paged.map((customer) => (
                <li key={customer._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-[11px] font-bold text-brand">
                        {customer.name.trim().charAt(0) || "م"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-bold text-ink">
                          {customer.name}
                        </p>
                        <p className="mt-1 font-mono text-[8.5px] text-ink-soft">
                          {customer.code} ·{" "}
                          <span dir="ltr">{customer.phone ?? "—"}</span>
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[9px]"
                      onClick={() => openEdit(customer)}
                    >
                      ویرایش
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-hairline/60 pt-3">
                    <div>
                      <p className="text-[7.5px] text-ink-soft/60">فاکتور</p>
                      <p className="num mt-0.5 text-[11px] font-semibold text-ink">
                        {formatNumber(customer.invoiceCount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[7.5px] text-ink-soft/60">فروش</p>
                      <p className="num mt-0.5 text-[11px] font-semibold text-ink">
                        {formatNumber(customer.totalSales)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[7.5px] text-ink-soft/60">مانده</p>
                      <p
                        className={cn(
                          "num mt-0.5 text-[11px] font-semibold",
                          customer.outstanding > 0
                            ? "text-[#8a6a20] dark:text-gold"
                            : "text-ink",
                        )}
                      >
                        {formatNumber(customer.outstanding)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3">
              <span className="num text-[9px] text-ink-soft" dir="ltr">
                {formatNumber(pageStart + 1)}–
                {formatNumber(Math.min(pageStart + PAGE_SIZE, sorted.length))} /{" "}
                {formatNumber(sorted.length)}
              </span>
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

      {businessId ? (
        <CustomerDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          businessId={businessId}
          customer={editing}
        />
      ) : null}
    </div>
  );
}
