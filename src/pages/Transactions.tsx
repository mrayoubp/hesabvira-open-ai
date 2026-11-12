import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import {
  currencyUnit,
  formatJalali,
  formatNumber,
} from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Info,
  Loader2,
  Plus,
  Receipt,
  Scale,
  Search,
  Wallet,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

type Kind = "income" | "expense";
type Method = "cash" | "bank" | "accrual";

const METHOD_LABELS: Record<Method, string> = {
  cash: "نقدی",
  bank: "بانکی",
  accrual: "تعهدی (بدون اثر نقدی)",
};

const KIND_META = {
  income: {
    label: "درآمد",
    color: "text-brand",
    chip: "bg-brand-soft text-brand",
    icon: CircleDollarSign,
  },
  expense: {
    label: "هزینه",
    color: "text-[#8a6a20] dark:text-gold",
    chip: "bg-gold-soft text-[#7a6122] dark:text-gold",
    icon: Receipt,
  },
} as const;

function TransactionDialog({
  kind,
  onClose,
  businessId,
  currency,
}: {
  kind: Kind | null;
  onClose: () => void;
  businessId?: ReturnType<typeof useWorkspace>["businessId"];
  currency: string;
}) {
  const create = useMutation(api.transactions.create);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  if (!kind) return null;
  const meta = KIND_META[kind];
  const unit = currencyUnit(currency);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (title.trim().length === 0) {
      toast.error("عنوان را وارد کنید.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ باید بزرگ‌تر از صفر باشد.");
      return;
    }
    const occurredAt = Date.parse(`${date}T12:00:00Z`);
    if (!Number.isFinite(occurredAt)) {
      toast.error("تاریخ معتبر نیست.");
      return;
    }
    setSaving(true);
    try {
      await create({
        businessId,
        kind,
        title,
        amount: amountValue,
        category: category.trim() || undefined,
        method,
        occurredAt,
        notes: notes.trim() || undefined,
      });
      toast.success(
        kind === "income" ? "درآمد ثبت شد." : "هزینه ثبت شد.",
      );
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] border-white/70 bg-card/95 backdrop-blur-xl dark:border-white/10 sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <meta.icon className="size-4" />
            </span>
            ثبت {meta.label} جدید
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            این تراکنش در داشبورد مدیریتی و گردش نقدی لحاظ می‌شود؛ سند رسمی
            دفتر دوبل نیست.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tx-title" className="text-xs">
              عنوان <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tx-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                kind === "income" ? "مثلاً درآمد مشاوره" : "مثلاً اجاره ماهانه"
              }
              maxLength={160}
              required
              className="rounded-xl border-hairline bg-background text-xs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-amount" className="text-xs">
                مبلغ ({unit}) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tx-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder="0"
                className="num rounded-xl border-hairline bg-background text-start text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date" className="text-xs">
                تاریخ
              </Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                dir="ltr"
                className="num rounded-xl border-hairline bg-background text-start text-xs"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-category" className="text-xs">
                دسته‌بندی
              </Label>
              <Input
                id="tx-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="اختیاری"
                maxLength={80}
                className="rounded-xl border-hairline bg-background text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">روش</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as Method)}
              >
                <SelectTrigger className="rounded-xl border-hairline bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {(
                    ["cash", "bank", "accrual"] as Method[]
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {METHOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-notes" className="text-xs">
              توضیحات
            </Label>
            <Textarea
              id="tx-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder="جزئیات اختیاری"
              maxLength={500}
              className="resize-none rounded-xl border-hairline bg-background text-xs"
            />
          </div>

          <DialogFooter className="gap-2 border-t border-hairline/60 pt-3 sm:justify-start">
            <Button type="submit" disabled={saving} className="gap-1.5 rounded-xl">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              ثبت {meta.label}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border-hairline bg-card"
            >
              انصراف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Transactions() {
  const { businessId, branchId, fiscalYearId, currency, canWrite } =
    useWorkspace();
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogKind, setDialogKind] = useState<Kind | null>(() => {
    const requested = searchParams.get("new");
    return requested === "income" || requested === "expense" ? requested : null;
  });
  const deferredSearch = useDeferredValue(search);
  const unit = currencyUnit(currency);

  const transactions = useQuery(
    api.transactions.list,
    businessId
      ? { businessId, branchId, fiscalYearId, limit: 300 }
      : "skip",
  );

  const closeDialog = () => {
    setDialogKind(null);
    if (searchParams.has("new")) {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  };

  const visible = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return (transactions ?? []).filter((row) => {
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (!needle) return true;
      return [row.title, row.category, row.notes, row.method]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [transactions, kindFilter, deferredSearch]);

  const income = (transactions ?? [])
    .filter((row) => row.kind === "income")
    .reduce((sum, row) => sum + row.amount, 0);
  const expense = (transactions ?? [])
    .filter((row) => row.kind === "expense")
    .reduce((sum, row) => sum + row.amount, 0);
  const net = income - expense;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="مدیریت درآمد و هزینه"
        title="درآمد و هزینه"
        description="ثبت درآمدهای غیرفاکتوری و هزینه‌های عملیاتی. این تراکنش‌ها داشبورد مدیریتی و گردش نقدی را تغذیه می‌کنند و جایگزین سند رسمی نیستند."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canWrite}
              onClick={() => setDialogKind("expense")}
              className="h-9 gap-1.5 px-3.5"
            >
              <Receipt className="size-4" />
              ثبت هزینه
            </Button>
            <Button
              size="sm"
              disabled={!canWrite}
              onClick={() => setDialogKind("income")}
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              ثبت درآمد
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "جمع درآمد",
            value: income,
            icon: CircleDollarSign,
            tone: "bg-brand-soft text-brand",
            delta: <ArrowUpRight className="size-3.5" />,
          },
          {
            label: "جمع هزینه",
            value: expense,
            icon: Receipt,
            tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
            delta: <ArrowDownRight className="size-3.5" />,
          },
          {
            label: "مانده مدیریتی",
            value: net,
            icon: Wallet,
            tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
            delta: <Scale className="size-3.5" />,
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
            <p
              className={cn(
                "num mt-3 truncate text-[19px] font-bold",
                card.label === "مانده مدیریتی"
                  ? net >= 0
                    ? "text-brand"
                    : "text-destructive"
                  : "text-ink",
              )}
            >
              {formatNumber(card.value)}
              <span className="ms-1 font-sans text-[9px] font-normal text-ink-soft">
                {unit}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1 text-[8px] text-ink-soft">
              {card.delta}
              در تراکنش‌های بارگذاری‌شده
            </p>
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="دفتر درآمد و هزینه"
          description={
            transactions
              ? `${formatNumber(transactions.length)} تراکنش ثبت‌شده`
              : "در حال دریافت تراکنش‌ها…"
          }
          action={
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جستجو در عنوان یا دسته"
                className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px]"
                aria-label="جستجوی درآمد و هزینه"
              />
            </div>
          }
        />

        <div className="flex flex-wrap gap-1 border-b border-hairline/50 px-4 py-2">
          {(
            [
              ["all", "همه"],
              ["income", "درآمد"],
              ["expense", "هزینه"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKindFilter(value)}
              aria-pressed={kindFilter === value}
              className={cn(
                "rounded-full px-3 py-1.5 text-[9px] font-semibold transition-colors",
                kindFilter === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-ink-soft hover:bg-cream/60 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {!transactions ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Scale className="size-5" />}
            title={
              transactions.length === 0
                ? "هنوز درآمد یا هزینه‌ای ثبت نشده"
                : "تراکنشی پیدا نشد"
            }
            description={
              transactions.length === 0
                ? "اولین هزینه یا درآمد مدیریتی را ثبت کنید تا کارت‌ها و نمودار سود و زیان کامل شوند."
                : "فیلتر یا عبارت جستجو را تغییر دهید."
            }
            action={
              transactions.length === 0 && canWrite ? (
                <Button
                  size="sm"
                  className="rounded-lg"
                  onClick={() => setDialogKind("expense")}
                >
                  ثبت هزینه
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
                      عنوان
                    </TableHead>
                    <TableHead className="text-[10px] text-ink-soft">
                      دسته
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const meta = KIND_META[row.kind];
                    return (
                      <TableRow key={row._id}>
                        <TableCell className="ps-4">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold",
                              meta.chip,
                            )}
                          >
                            <meta.icon className="size-3" />
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-[10px] font-medium text-ink">
                          {row.title}
                        </TableCell>
                        <TableCell className="text-[9px] text-ink-soft">
                          {row.category ?? "—"}
                        </TableCell>
                        <TableCell className="text-[9px] text-ink-soft">
                          {METHOD_LABELS[row.method]}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "num text-[10px] font-semibold",
                            row.kind === "income"
                              ? "text-brand"
                              : "text-[#8a6a20] dark:text-gold",
                          )}
                        >
                          {row.kind === "income" ? "+" : "−"}{" "}
                          {formatNumber(row.amount)}
                        </TableCell>
                        <TableCell className="num text-[9px] text-ink-soft">
                          {formatJalali(row.occurredAt)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-[9px] text-ink-soft">
                          {row.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-hairline/50 md:hidden">
              {visible.map((row) => {
                const meta = KIND_META[row.kind];
                return (
                  <li key={row._id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-8 items-center justify-center rounded-xl",
                            meta.chip,
                          )}
                        >
                          <meta.icon className="size-4" />
                        </span>
                        <div>
                          <p className="text-[11px] font-semibold text-ink">
                            {row.title}
                          </p>
                          <p className="mt-0.5 text-[8px] text-ink-soft">
                            {row.category ?? meta.label} ·{" "}
                            {METHOD_LABELS[row.method]}
                          </p>
                        </div>
                      </div>
                      <p
                        className={cn(
                          "num shrink-0 text-[11px] font-bold",
                          meta.color,
                        )}
                      >
                        {row.kind === "income" ? "+" : "−"}{" "}
                        {formatNumber(row.amount)}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center justify-between ps-10 text-[8px] text-ink-soft">
                      <span className="num">{formatJalali(row.occurredAt)}</span>
                      {row.notes ? <span className="truncate">{row.notes}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-3 text-[8px] text-ink-soft">
          <span>
            {formatNumber(visible.length)} تراکنش · واحد {unit}
          </span>
          <span className="flex items-center gap-1">
            <Info className="size-3" />
            روش تعهدی در سود اثر دارد اما در جریان نقدی نه.
          </span>
        </div>
      </Panel>

      <TransactionDialog
        key={dialogKind ?? "closed"}
        kind={dialogKind}
        onClose={closeDialog}
        businessId={businessId}
        currency={currency}
      />
    </div>
  );
}
