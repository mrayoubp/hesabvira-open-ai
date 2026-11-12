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
import { useWorkspace } from "@/hooks/use-workspace";
import {
  currencyUnit,
  formatJalali,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  Banknote,
  HandCoins,
  Landmark,
  Plus,
  ReceiptText,
  Search,
  Wallet,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router";

const METHOD_LABELS = {
  cash: "نقدی / صندوق",
  bank: "بانکی",
} as const;

export default function Payments() {
  const { businessId, branchId, fiscalYearId, currency } = useWorkspace();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "receipt" | "payment">(
    "all",
  );
  const deferredSearch = useDeferredValue(search);
  const unit = currencyUnit(currency);

  const payments = useQuery(
    api.payments.list,
    businessId ? { businessId, branchId, fiscalYearId, limit: 200 } : "skip",
  );
  const overview = useQuery(
    api.dashboard.overview,
    businessId
      ? {
          businessId,
          branchId,
          fiscalYearId,
          period: "year" as const,
        }
      : "skip",
  );

  const needle = deferredSearch.trim().toLowerCase();
  const visible =
    payments?.filter((payment) => {
      if (direction !== "all" && payment.direction !== direction) return false;
      if (!needle) return true;
      return [payment.partyName, payment.notes, payment.method]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    }) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="خزانه‌داری"
        title="دریافت و پرداخت"
        description="دریافت‌های واقعی مشتریان روی فاکتورها و مانده صندوق و بانک. پرداخت به تأمین‌کننده پس از فعال‌شدن ماژول خرید اضافه می‌شود."
        actions={
          <Button asChild size="sm" className="h-9 gap-1.5 rounded-xl px-3.5">
            <Link to="/dashboard/payments/new">
              <Plus className="size-4" />
              ثبت دریافت
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "موجودی صندوق",
            value: overview?.metrics.cashBalance,
            icon: Wallet,
            tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
          },
          {
            label: "موجودی بانک",
            value: overview?.metrics.bankBalance,
            icon: Landmark,
            tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
          },
          {
            label: "مطالبات باز",
            value: overview?.metrics.receivables,
            icon: HandCoins,
            tone: "bg-brand-soft text-brand",
          },
          {
            label: "فاکتورهای باز",
            value: overview?.metrics.unpaidInvoices,
            icon: ReceiptText,
            tone: "bg-cream/70 text-ink dark:bg-white/[0.06]",
            count: true,
          },
        ].map((card) => (
          <Panel key={card.label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-ink-soft">
                {card.label}
              </span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl",
                  card.tone,
                )}
              >
                <card.icon className="size-4" />
              </span>
            </div>
            {overview ? (
              <p className="num mt-3 truncate text-[20px] font-bold text-ink">
                {formatNumber(card.value ?? 0)}
                {!card.count ? (
                  <span className="ms-1 font-sans text-[9px] font-normal text-ink-soft">
                    {unit}
                  </span>
                ) : (
                  <span className="ms-1 font-sans text-[9px] font-normal text-ink-soft">
                    فاکتور
                  </span>
                )}
              </p>
            ) : (
              <Skeleton className="mt-3 h-6 w-28" />
            )}
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="دفتر دریافت و پرداخت"
          description={
            payments
              ? `${formatNumber(payments.length)} تراکنش ثبت‌شده · واحد ${unit}`
              : "در حال دریافت تراکنش‌ها…"
          }
          action={
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="نام شخص یا توضیحات"
                className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px]"
                aria-label="جستجوی دریافت و پرداخت"
              />
            </div>
          }
        />

        <div className="flex flex-wrap gap-1 border-b border-hairline/50 px-4 py-2">
          {(
            [
              ["all", "همه"],
              ["receipt", "دریافت‌ها"],
              ["payment", "پرداخت‌ها"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              aria-pressed={direction === value}
              className={cn(
                "rounded-full px-3 py-1.5 text-[9px] font-semibold transition-colors",
                direction === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-ink-soft hover:bg-cream/60 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {!payments ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Banknote className="size-5" />}
            title={
              payments.length === 0
                ? "هنوز دریافت یا پرداختی ثبت نشده"
                : "تراکنشی با این مشخصات پیدا نشد"
            }
            description={
              payments.length === 0
                ? "با ثبت دریافت روی فاکتور باز، مانده صندوق و بانک و نمودار جریان نقد زنده می‌شود."
                : "فیلتر یا عبارت جستجو را تغییر دهید."
            }
            action={
              payments.length === 0 ? (
                <Button asChild size="sm" className="rounded-lg">
                  <Link to="/dashboard/payments/new">ثبت اولین دریافت</Link>
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
                    <TableHead className="ps-4 text-[10px] text-ink-soft">
                      نوع
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      شخص
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      روش
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      مبلغ ({unit})
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      تاریخ
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      توضیحات
                    </TableHead>
                    <TableHead className="w-24 pe-4 text-[10px] text-ink-soft">
                      سند
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((payment) => (
                    <TableRow key={payment._id}>
                      <TableCell className="ps-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold",
                            payment.direction === "receipt"
                              ? "bg-brand-soft text-brand"
                              : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {payment.direction === "receipt" ? (
                            <HandCoins className="size-3" />
                          ) : (
                            <Banknote className="size-3" />
                          )}
                          {payment.direction === "receipt" ? "دریافت" : "پرداخت"}
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] font-medium text-ink">
                        {payment.partyName}
                      </TableCell>
                      <TableCell className="text-[9px] text-ink-soft">
                        {METHOD_LABELS[payment.method]}
                      </TableCell>
                      <TableCell className="num text-[10px] font-semibold text-ink">
                        {formatNumber(payment.amount)}
                      </TableCell>
                      <TableCell className="num text-[9px] text-ink-soft">
                        {formatJalali(payment.occurredAt)}
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-[9px] text-ink-soft">
                        {payment.notes ?? "—"}
                      </TableCell>
                      <TableCell className="pe-4">
                        {payment.invoiceId ? (
                          <Link
                            to={`/dashboard/invoices?invoice=${payment.invoiceId}`}
                            className="inline-flex items-center gap-1 text-[9px] font-semibold text-brand hover:underline"
                          >
                            فاکتور
                            <ArrowLeft className="size-3" />
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/50 md:hidden">
              {visible.map((payment) => (
                <li key={payment._id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-xl",
                          payment.direction === "receipt"
                            ? "bg-brand-soft text-brand"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {payment.direction === "receipt" ? (
                          <HandCoins className="size-4" />
                        ) : (
                          <Banknote className="size-4" />
                        )}
                      </span>
                      <div>
                        <p className="text-[11px] font-semibold text-ink">
                          {payment.partyName}
                        </p>
                        <p className="mt-0.5 text-[8px] text-ink-soft">
                          {METHOD_LABELS[payment.method]} ·{" "}
                          <span className="num">{formatJalali(payment.occurredAt)}</span>
                        </p>
                      </div>
                    </div>
                    <p className="num text-[11px] font-bold text-ink">
                      {formatNumber(payment.amount)}
                      <span className="ms-1 font-sans text-[8px] font-normal text-ink-soft">
                        {unit}
                      </span>
                    </p>
                  </div>
                  {payment.notes ? (
                    <p className="mt-2 text-[8px] text-ink-soft">{payment.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3 text-[8px] text-ink-soft">
          <span>
            {formatNumber(visible.length)} تراکنش · همه مبالغ از تراکنش‌های واقعی
          </span>
          <Link
            to="/dashboard/finance/payments"
            className="font-semibold text-gold hover:underline"
          >
            پرداخت به تأمین‌کننده
          </Link>
        </div>
      </Panel>

      <div className="flex items-start gap-2 rounded-[18px] border border-dashed border-hairline/70 bg-card/40 p-3 text-[9px] leading-5 text-ink-soft">
        <ReceiptText className="mt-0.5 size-3.5 shrink-0 text-gold" />
        دریافت‌ها به مانده واقعی فاکتور متصل می‌شوند. دریافت جزئی، فاکتور را
        «صادرشده» نگه می‌دارد و مانده باقی‌مانده در مطالبات دیده می‌شود.
      </div>
    </div>
  );
}
