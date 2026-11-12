import { StatusBadge } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_STATUS_META } from "@/lib/accounting";
import { formatJalali, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowUpLeft,
  BookOpen,
  Building2,
  ListTree,
  Package,
  Loader2,
  ReceiptText,
  Search,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router";

export function GlobalSearchDialog({
  open,
  onOpenChange,
  businessId,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
}) {
  const [term, setTerm] = useState("");
  const deferredTerm = useDeferredValue(term);
  const queryTerm = deferredTerm.trim();

  const results = useQuery(
    api.search.global,
    businessId && queryTerm.length >= 2
      ? { businessId, term: queryTerm }
      : "skip",
  );

  const isSearching =
    queryTerm.length >= 2 && results === undefined;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTerm("");
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="top-[12%] max-h-[80vh] translate-y-0 gap-0 overflow-hidden rounded-[24px] border-white/70 bg-card/95 p-0 shadow-2xl backdrop-blur-2xl dark:border-white/10 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-hairline/60 p-4 text-start">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Search className="size-4 text-brand" />
            جستجوی سراسری
            <span className="ms-auto rounded-md border border-hairline/70 px-1.5 py-0.5 font-mono text-[9px] text-ink-soft">
              Ctrl K
            </span>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            مشتری، فاکتور، حساب و سند حسابداری را در همین کسب‌وکار جستجو کنید.
          </DialogDescription>
        </DialogHeader>

        <div className="relative border-b border-hairline/60 p-3">
          <Search className="pointer-events-none absolute end-5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="مثلاً INV-0001، JV-1405-0001 یا نام مشتری…"
            autoFocus
            className="h-10 rounded-xl border-hairline bg-background pe-10 text-sm"
            aria-label="عبارت جستجوی سراسری"
          />
          {isSearching ? (
            <Loader2 className="absolute start-5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-brand" />
          ) : term ? (
            <button
              type="button"
              onClick={() => setTerm("")}
              className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink"
              aria-label="پاک کردن جستجو"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="max-h-[48vh] overflow-y-auto p-2">
          {queryTerm.length < 2 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs font-semibold text-ink">حداقل دو حرف بنویسید</p>
              <p className="mt-1 text-[10px] text-ink-soft">
                جستجو در مشتری، فاکتور، کدینگ حساب و اسناد حسابداری انجام
                می‌شود.
              </p>
            </div>
          ) : !results ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </div>
          ) : results.customers.length === 0 &&
            results.invoices.length === 0 &&
            results.accounts.length === 0 &&
            results.documents.length === 0 &&
            results.suppliers.length === 0 &&
            results.products.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs font-semibold text-ink">نتیجه‌ای پیدا نشد</p>
              <p className="mt-1 text-[10px] text-ink-soft">
                شماره سند یا نام دیگری را امتحان کنید.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.customers.length > 0 ? (
                <section aria-label="مشتریان">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <Users className="size-3" />
                    مشتریان
                  </p>
                  {results.customers.map((customer) => (
                    <Link
                      key={customer._id}
                      to={customer.href}
                      onClick={() => onOpenChange(false)}
                      className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]"
                    >
                      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                        <Users className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">
                          {customer.title}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] text-ink-soft">
                          {customer.subtitle}
                        </span>
                      </span>
                      <ArrowUpLeft className="size-3.5 text-ink-soft transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </section>
              ) : null}

              {results.invoices.length > 0 ? (
                <section aria-label="فاکتورها">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <ReceiptText className="size-3" />
                    فاکتورها
                  </p>
                  {results.invoices.map((invoice) => (
                    <Link
                      key={invoice._id}
                      to={invoice.href}
                      onClick={() => onOpenChange(false)}
                      className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]"
                    >
                      <span className="flex size-8 items-center justify-center rounded-lg bg-gold-soft/70 text-[#7a6122] dark:text-gold">
                        <ReceiptText className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-ink">
                            {invoice.title}
                          </span>
                          <StatusBadge status={invoice.status} />
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[9px] text-ink-soft">
                          <span>{invoice.subtitle}</span>
                          <span className="num">
                            {formatMoney(invoice.total, currency)}
                          </span>
                          <span className="num">
                            {formatJalali(invoice.date)}
                          </span>
                        </span>
                      </span>
                    </Link>
                  ))}
                </section>
              ) : null}

              {results.products.length > 0 ? (
                <section aria-label="کالاها و خدمات">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <Package className="size-3" />
                    کالاها و خدمات
                  </p>
                  {results.products.map((product) => (
                    <Link key={product._id} to={product.href} onClick={() => onOpenChange(false)} className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-mist/60 text-[#245c5c] dark:bg-mist/20 dark:text-[#a9d5e2]"><Package className="size-3.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{product.title}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-ink-soft">{product.subtitle}</span></span>
                      <ArrowUpLeft className="size-3.5 text-ink-soft transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </section>
              ) : null}

              {results.suppliers.length > 0 ? (
                <section aria-label="تأمین‌کنندگان">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <Truck className="size-3" />
                    تأمین‌کنندگان
                  </p>
                  {results.suppliers.map((supplier) => (
                    <Link key={supplier._id} to={supplier.href} onClick={() => onOpenChange(false)} className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-gold-soft/70 text-[#7a6122] dark:text-gold"><Truck className="size-3.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{supplier.title}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-ink-soft">{supplier.subtitle}</span></span>
                      <ArrowUpLeft className="size-3.5 text-ink-soft transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </section>
              ) : null}

              {results.accounts.length > 0 ? (
                <section aria-label="حساب‌ها">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <ListTree className="size-3" />
                    کدینگ حساب‌ها
                  </p>
                  {results.accounts.map((account) => (
                    <Link
                      key={account._id}
                      to={account.href}
                      onClick={() => onOpenChange(false)}
                      className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]"
                    >
                      <span className="flex size-8 items-center justify-center rounded-lg bg-mist/60 text-[#245c5c] dark:bg-mist/20 dark:text-[#a9d5e2]">
                        <ListTree className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[10px] font-semibold text-ink">
                          {account.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[9px] text-ink-soft">
                          {account.subtitle}
                        </span>
                      </span>
                      <ArrowUpLeft className="size-3.5 text-ink-soft transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </section>
              ) : null}

              {results.documents.length > 0 ? (
                <section aria-label="اسناد حسابداری">
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-ink-soft">
                    <BookOpen className="size-3" />
                    اسناد حسابداری
                  </p>
                  {results.documents.map((document) => {
                    const meta = DOCUMENT_STATUS_META[document.status];
                    return (
                      <Link
                        key={document._id}
                        to={document.href}
                        onClick={() => onOpenChange(false)}
                        className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-cream/55 dark:hover:bg-white/[0.05]"
                      >
                        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                          <BookOpen className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-ink">
                              {document.title}
                            </span>
                            <span className={cn("rounded-full border px-2 py-0.5 text-[8px]", meta.badge)}>
                              {meta.label}
                            </span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[9px] text-ink-soft">
                            <span className="truncate">{document.subtitle}</span>
                            <span className="num">
                              {formatMoney(document.totalDebit, currency)}
                            </span>
                            <span className="num">
                              {formatJalali(document.date)}
                            </span>
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </section>
              ) : null}

              <div className="mx-2 mt-2 rounded-xl border border-dashed border-hairline/70 bg-background/60 px-3 py-2">
                <p className="flex items-start gap-1.5 text-[9px] leading-5 text-ink-soft">
                  <Building2 className="mt-0.5 size-3 shrink-0" />
                  جستجو در همین کسب‌وکار انجام می‌شود و شامل مشتری، تأمین‌کننده،
                  کالا، فاکتور، حساب و سند حسابداری است. نتیجه‌ای خارج از
                  دسترسی شما نمایش داده نمی‌شود.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline/60 px-4 py-2 text-[9px] text-ink-soft">
          <span className="flex items-center gap-1">
            <span className="rounded border border-hairline px-1 py-0.5 font-mono text-[8px]">
              Esc
            </span>
            بستن
          </span>
          <span className="flex items-center gap-1">
            <span className="rounded border border-hairline px-1 py-0.5 font-mono text-[8px]">
              Ctrl K
            </span>
            جستجوی سریع
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SearchTrigger({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 rounded-[10px] border border-hairline/80 bg-surface/70 text-ink-soft transition-[background-color,border-color,color] hover:border-brand/20 hover:bg-surface hover:text-ink dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.07]",
        className,
      )}
      aria-label="جستجوی سراسری"
    >
      <Search className="size-4" />
      <span className="hidden flex-1 text-start text-[11px] lg:block">
        جستجو در اسناد و مشتریان…
      </span>
      <span className="hidden rounded-[5px] border border-hairline/70 bg-cream/35 px-1.5 py-0.5 font-mono text-[8px] text-ink-soft/70 lg:block dark:bg-white/[0.04]">
        Ctrl K
      </span>
    </button>
  );
}
