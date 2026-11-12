import {
  EmptyState,
  PageHeader,
  Panel,
} from "@/components/app/ui";
import {
  DestinationSelect,
  FINANCE_METHOD_LABELS,
} from "@/components/finance/shared";
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
import type { Id } from "@/convex/_generated/dataModel";
import type { FinanceMethod } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  HandCoins,
  Loader2,
  LockKeyhole,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

type TabKey = "receivable" | "payable";

interface InvoiceItem {
  id: string;
  number: string;
  outstanding: number;
  dueDate: number | null;
}

interface ExpenseItem {
  id: string;
  number: string;
  outstanding: number;
  dueDate: number | null;
}

interface ReceivableGroup {
  customerId: string;
  customerName: string;
  phone: string | null;
  total: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
  dueDate: number | null;
  overdue: boolean;
  invoices: InvoiceItem[];
}

interface PayableGroup {
  supplierName: string;
  total: number;
  paid: number;
  outstanding: number;
  count: number;
  dueDate: number | null;
  overdue: boolean;
  expenses: ExpenseItem[];
}

function parseDate(value: string) {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function SettlementDialog({
  open,
  onOpenChange,
  businessId,
  currency,
  receivable,
  payable,
  banks,
  funds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
  receivable: ReceivableGroup | null;
  payable: PayableGroup | null;
  banks: { _id: string; name: string }[];
  funds: { _id: string; name: string }[];
}) {
  const createReceipt = useMutation(api.receipts.create);
  const postReceipt = useMutation(api.receipts.post);
  const createVoucher = useMutation(api.paymentVouchers.create);
  const postVoucher = useMutation(api.paymentVouchers.post);

  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("bank_transfer");
  const [sourceType, setSourceType] = useState<"bank" | "cash">("bank");
  const [bankAccountId, setBankAccountId] = useState("");
  const [cashFundId, setCashFundId] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [tracking, setTracking] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const items = receivable?.invoices ?? payable?.expenses ?? [];
  const selected = items.find((item) => item.id === itemId) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const first = receivable?.invoices[0] ?? payable?.expenses[0];
    setItemId(first?.id ?? "");
    setAmount(first ? String(first.outstanding) : "");
    setMethod("bank_transfer");
    setSourceType(banks[0] ? "bank" : "cash");
    setBankAccountId(banks[0]?._id ?? "");
    setCashFundId(funds[0]?._id ?? "");
    setOccurredDate(isoDateValue(Date.now()));
    setTracking("");
    setDescription("");
  }, [open, receivable, payable, banks, funds]);

  const selectItem = (value: string) => {
    setItemId(value);
    const item = items.find((row) => row.id === value);
    if (item) setAmount(String(item.outstanding));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !selected) return;
    const amountValue = parseAmount(amount);
    if (amountValue <= 0 || amountValue > selected.outstanding) {
      toast.error("مبلغ تسویه باید بین ۱ و مانده حساب باشد.");
      return;
    }
    if (sourceType === "bank" && !bankAccountId) {
      toast.error("حساب بانکی را انتخاب کنید.");
      return;
    }
    if (sourceType === "cash" && !cashFundId) {
      toast.error("صندوق را انتخاب کنید.");
      return;
    }
    setSaving(true);
    let createdId: string | null = null;
    try {
      if (receivable) {
        const created = await createReceipt({
          businessId,
          partyType: "customer",
          customerId: receivable.customerId as Id<"customers">,
          partyName: receivable.customerName,
          invoiceId: selected.id as Id<"invoices">,
          amount: amountValue,
          method,
          destinationType: sourceType,
          bankAccountId:
            sourceType === "bank"
              ? (bankAccountId as Id<"bankAccounts">)
              : undefined,
          cashFundId:
            sourceType === "cash"
              ? (cashFundId as Id<"cashFunds">)
              : undefined,
          trackingNumber: tracking.trim() || undefined,
          description:
            description.trim() || `تسویه فاکتور ${selected.number}`,
          occurredAt: parseDate(occurredDate),
        });
        createdId = created.receiptId as string;
        const posted = await postReceipt({
          businessId,
          receiptId: created.receiptId,
        });
        toast.success(
          `دریافت ${created.number} تأیید شد؛ سند ${posted.accountingNumber} ثبت گردید.`,
        );
      } else if (payable) {
        const created = await createVoucher({
          businessId,
          partyType: "supplier",
          partyName: payable.supplierName,
          expenseId: selected.id as Id<"expenseRecords">,
          amount: amountValue,
          method,
          sourceType,
          bankAccountId:
            sourceType === "bank"
              ? (bankAccountId as Id<"bankAccounts">)
              : undefined,
          cashFundId:
            sourceType === "cash"
              ? (cashFundId as Id<"cashFunds">)
              : undefined,
          trackingNumber: tracking.trim() || undefined,
          description:
            description.trim() || `تسویه هزینه ${selected.number}`,
          occurredAt: parseDate(occurredDate),
        });
        createdId = created.voucherId as string;
        const posted = await postVoucher({
          businessId,
          voucherId: created.voucherId,
        });
        toast.success(
          `پرداخت ${created.number} تأیید شد؛ سند ${posted.accountingNumber} ثبت گردید.`,
        );
      }
      onOpenChange(false);
    } catch (error) {
      if (createdId) {
        toast.error(
          "تسویه به‌صورت پیش‌نویس ثبت شد اما تأیید نشد؛ از صفحه دریافت/پرداخت آن را بررسی کنید.",
        );
        onOpenChange(false);
      } else {
        toast.error(getErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const title = receivable
    ? `تسویه مطالبات ${receivable.customerName}`
    : `تسویه بدهی ${payable?.supplierName ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HandCoins className="size-4 text-brand" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            تسویه جزئی یا کامل یکی از اسناد باز؛ سند حسابداری و به‌روزرسانی مانده
            در یک تراکنش انجام می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px]">سند مورد تسویه *</Label>
            <Select value={selected?.id ?? ""} onValueChange={selectItem}>
              <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.number} · مانده {formatMoney(item.outstanding, currency)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-gold/25 bg-gold-soft/40 p-3">
              <p className="text-[8px] text-ink-soft">مانده سند انتخابی</p>
              <p className="num mt-1 text-[13px] font-bold text-gold">
                {formatMoney(selected?.outstanding ?? 0, currency)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مبلغ تسویه *</Label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
              <button
                type="button"
                onClick={() =>
                  selected && setAmount(String(selected.outstanding))
                }
                className="text-[8px] font-semibold text-brand hover:underline"
              >
                تسویه کامل
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">روش تسویه</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as FinanceMethod)}
              >
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {(
                    ["cash", "card", "bank_transfer", "other"] as FinanceMethod[]
                  ).map((key) => (
                    <SelectItem key={key} value={key}>
                      {FINANCE_METHOD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ تسویه</Label>
              <Input
                type="date"
                value={occurredDate}
                onChange={(event) => setOccurredDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <DestinationSelect
              banks={banks}
              funds={funds}
              type={sourceType}
              bankAccountId={bankAccountId}
              cashFundId={cashFundId}
              onTypeChange={setSourceType}
              onBankChange={setBankAccountId}
              onFundChange={setCashFundId}
              label={receivable ? "حساب دریافت *" : "حساب پرداخت *"}
            />
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره پیگیری</Label>
              <Input
                value={tracking}
                onChange={(event) => setTracking(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[10px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">شرح</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="rounded-xl text-[11px]"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              انصراف
            </Button>
            <Button type="submit" disabled={saving} className="rounded-xl">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <HandCoins className="size-4" />
              )}
              ثبت تسویه و سند
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({
  open,
  onOpenChange,
  businessId,
  currency,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
  target:
    | { kind: "customer"; id: string; name: string }
    | { kind: "supplier"; name: string }
    | null;
}) {
  const statement = useQuery(
    api.finance.partyStatement,
    open && businessId && target
      ? target.kind === "customer"
        ? {
            businessId,
            kind: "customer" as const,
            partyId: target.id,
            partyName: target.name,
          }
        : { businessId, kind: "supplier" as const, partyName: target.name }
      : "skip",
  );
  const statementRows = (statement?.rows ?? []).map((row, index, rows) => ({
    ...row,
    balance: rows
      .slice(0, index + 1)
      .reduce((total, item) => total + item.debit - item.credit, 0),
  }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4 text-brand" />
            گردش حساب {target?.name}
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            اسناد و تسویه‌های واقعی طرف حساب؛ مانده تجمعی از بدهکار منهای
            بستانکار محاسبه می‌شود.
          </DialogDescription>
        </DialogHeader>
        {!statement ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : statement.rows.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="گردشی برای این طرف حساب نیست"
            description="با صدور فاکتور، هزینه یا تسویه، گردش حساب ایجاد می‌شود."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-hairline/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>تاریخ</TableHead>
                    <TableHead>سند</TableHead>
                    <TableHead>شرح</TableHead>
                    <TableHead className="text-end">بدهکار</TableHead>
                    <TableHead className="text-end">بستانکار</TableHead>
                    <TableHead className="text-end">مانده</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementRows.map((row) => {
                    return (
                      <TableRow key={`${row.id}-${row.number}`}>
                        <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                          {formatJalali(row.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[9px]">
                          {row.href ? (
                            <Link
                              to={row.href}
                              className="num font-semibold text-brand hover:underline"
                            >
                              {row.number}
                            </Link>
                          ) : (
                            <span className="num">{row.number}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-[8px] text-ink-soft">
                          {row.description}
                        </TableCell>
                        <TableCell className="num text-end text-[9px]">
                          {row.debit > 0 ? formatMoney(row.debit, currency) : "—"}
                        </TableCell>
                        <TableCell className="num text-end text-[9px]">
                          {row.credit > 0 ? formatMoney(row.credit, currency) : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "num text-end text-[10px] font-bold",
                            row.balance > 0 ? "text-gold" : "text-brand",
                          )}
                        >
                          {formatMoney(Math.abs(row.balance), currency)}
                          <span className="ms-1 text-[7px] font-normal text-ink-soft">
                            {row.balance > 0 ? "بدهکار" : "بستانکار"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-4 text-[10px]">
              <span>
                جمع بدهکار:{" "}
                <strong className="num">
                  {formatMoney(statement.totals.debit, currency)}
                </strong>
              </span>
              <span>
                جمع بستانکار:{" "}
                <strong className="num">
                  {formatMoney(statement.totals.credit, currency)}
                </strong>
              </span>
              <span className="rounded-full border border-brand/20 bg-brand-soft px-3 py-1 font-bold text-brand">
                مانده: {formatMoney(Math.abs(statement.totals.balance), currency)}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Receivables() {
  const { businessId, branchId, currency } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(
    searchParams.get("tab") === "payables" ? "payable" : "receivable",
  );
  const [search, setSearch] = useState("");
  const [settleReceivable, setSettleReceivable] =
    useState<ReceivableGroup | null>(null);
  const [settlePayable, setSettlePayable] = useState<PayableGroup | null>(null);
  const [statementTarget, setStatementTarget] = useState<
    | { kind: "customer"; id: string; name: string }
    | { kind: "supplier"; name: string }
    | null
  >(null);

  const receivableData = useQuery(
    api.finance.receivables,
    businessId
      ? { businessId, branchId, search: search.trim() || undefined }
      : "skip",
  );
  const payableData = useQuery(
    api.finance.payables,
    businessId
      ? { businessId, branchId, search: search.trim() || undefined }
      : "skip",
  );
  const accounts = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  );
  const activeBanks = accounts?.banks.filter((bank) => bank.active) ?? [];
  const activeFunds = accounts?.funds.filter((fund) => fund.active) ?? [];

  const receivables = receivableData?.rows ?? [];
  const payables = payableData?.rows ?? [];
  const activeRows = tab === "receivable" ? receivables : payables;
  const overdueCount = activeRows.filter((row) => row.overdue).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · مطالبات و بدهی‌ها"
        title="مطالبات مشتریان و بدهی تأمین‌کنندگان"
        description="مانده‌های واقعی از فاکتورها، دریافت‌ها و هزینه‌ها؛ تسویه جزئی، کامل و گردش حساب هر طرف."
        actions={
          <span className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-card/60 px-3 py-1.5 text-[9px] text-ink-soft">
            <LockKeyhole className="size-3.5" />
            تسویه از همین صفحه انجام می‌شود
          </span>
        }
      />

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-hairline/60 bg-card/60 p-1.5">
        {[
          {
            key: "receivable" as const,
            label: "مطالبات مشتریان",
            count: receivables.length,
          },
          {
            key: "payable" as const,
            label: "بدهی تأمین‌کنندگان",
            count: payables.length,
          },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[10px] font-semibold transition-colors sm:flex-none",
              tab === item.key
                ? "bg-brand text-cream shadow-sm"
                : "text-ink-soft hover:bg-background hover:text-ink",
            )}
          >
            {item.label}
            <span
              className={cn(
                "num rounded-full px-1.5 py-0.5 text-[8px]",
                tab === item.key ? "bg-white/15" : "bg-muted",
              )}
            >
              {item.count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">
              {tab === "receivable" ? "جمع مطالبات باز" : "جمع بدهی باز"}
            </span>
            {tab === "receivable" ? (
              <ArrowDownLeft className="size-4 text-brand" />
            ) : (
              <ArrowUpRight className="size-4 text-destructive" />
            )}
          </div>
          <p
            className={cn(
              "num mt-3 text-[19px] font-black",
              tab === "receivable" ? "text-brand" : "text-destructive",
            )}
          >
            {formatMoney(
              tab === "receivable"
                ? (receivableData?.totals.outstanding ?? 0)
                : (payableData?.totals.outstanding ?? 0),
              currency,
            )}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {activeRows.length} طرف حساب با مانده
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">مانده سررسید گذشته</span>
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-destructive">
            {overdueCount}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            نیازمند پیگیری و تسویه
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">تسویه‌شده در کل</span>
            <CalendarClock className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">
            {formatMoney(
              tab === "receivable"
                ? (receivableData?.totals.paid ?? 0)
                : (payableData?.totals.paid ?? 0),
              currency,
            )}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            مجموع دریافت/پرداخت ثبت‌شده
          </p>
        </Panel>
      </div>

      <Panel className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-soft" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                tab === "receivable"
                  ? "جستجوی نام یا تلفن مشتری…"
                  : "جستجوی نام تأمین‌کننده…"
              }
              className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
            />
          </div>
          <span className="text-[8px] text-ink-soft">
            مانده‌ها از فاکتورها و هزینه‌های تأییدشده محاسبه می‌شوند.
          </span>
        </div>

        {tab === "receivable" ? (
          !receivableData ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : receivables.length === 0 ? (
            <EmptyState
              icon={<HandCoins className="size-5" />}
              title="مطالبه بازی وجود ندارد"
              description="همه فاکتورهای صادرشده تسویه شده‌اند یا هنوز فاکتور بازی ثبت نشده است."
              action={
                <Button asChild variant="outline" className="rounded-xl">
                  <Link to="/dashboard/invoices">مشاهده فاکتورها</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>مشتری</TableHead>
                    <TableHead className="text-end">مبلغ کل</TableHead>
                    <TableHead className="text-end">پرداخت‌شده</TableHead>
                    <TableHead className="text-end">مانده</TableHead>
                    <TableHead>سررسید</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-[150px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables.map((row) => (
                    <TableRow key={row.customerId}>
                      <TableCell className="max-w-[170px]">
                        <p className="truncate text-[9px] font-semibold">
                          {row.customerName}
                        </p>
                        <p className="num text-[8px] text-ink-soft">
                          {row.phone ?? "—"} · {row.invoiceCount} فاکتور
                        </p>
                      </TableCell>
                      <TableCell className="num text-end text-[9px]">
                        {formatMoney(row.total, currency)}
                      </TableCell>
                      <TableCell className="num text-end text-[9px] text-brand">
                        {formatMoney(row.paid, currency)}
                      </TableCell>
                      <TableCell className="num text-end text-[10px] font-bold text-gold">
                        {formatMoney(row.outstanding, currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.dueDate ? (
                          <>
                            <p className="num text-[9px]">
                              {formatJalali(row.dueDate)}
                            </p>
                            {row.overdue ? (
                              <span className="inline-flex items-center gap-1 text-[7px] text-destructive">
                                <AlertTriangle className="size-2.5" />
                                سررسید گذشته
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[8px] text-ink-soft">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[8px]",
                            row.overdue
                              ? "border-destructive/25 bg-destructive/5 text-destructive"
                              : "border-gold/30 bg-gold-soft text-[#7a6122] dark:text-gold",
                          )}
                        >
                          {row.overdue ? "سررسید گذشته" : "باز"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setStatementTarget({
                                kind: "customer",
                                id: row.customerId,
                                name: row.customerName,
                              })
                            }
                            className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                          >
                            <BookOpen className="size-3" />
                            گردش
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setSettleReceivable(row)}
                            className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                          >
                            <HandCoins className="size-3" />
                            تسویه
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : !payableData ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : payables.length === 0 ? (
          <EmptyState
            icon={<Truck className="size-5" />}
            title="بدهی بازی وجود ندارد"
            description="هزینه‌های تأییدشده‌ای که مانده دارند در این بخش نمایش داده می‌شوند."
            action={
              <Button asChild variant="outline" className="rounded-xl">
                <Link to="/dashboard/finance/income-expenses?tab=expenses">
                  مشاهده هزینه‌ها
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تأمین‌کننده</TableHead>
                  <TableHead className="text-end">مبلغ کل</TableHead>
                  <TableHead className="text-end">پرداخت‌شده</TableHead>
                  <TableHead className="text-end">مانده</TableHead>
                  <TableHead>سررسید</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="w-[150px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payables.map((row) => (
                  <TableRow key={row.supplierName}>
                    <TableCell className="max-w-[170px]">
                      <p className="truncate text-[9px] font-semibold">
                        {row.supplierName}
                      </p>
                      <p className="num text-[8px] text-ink-soft">
                        {row.count} هزینه
                      </p>
                    </TableCell>
                    <TableCell className="num text-end text-[9px]">
                      {formatMoney(row.total, currency)}
                    </TableCell>
                    <TableCell className="num text-end text-[9px] text-brand">
                      {formatMoney(row.paid, currency)}
                    </TableCell>
                    <TableCell className="num text-end text-[10px] font-bold text-gold">
                      {formatMoney(row.outstanding, currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.dueDate ? (
                        <>
                          <p className="num text-[9px]">
                            {formatJalali(row.dueDate)}
                          </p>
                          {row.overdue ? (
                            <span className="inline-flex items-center gap-1 text-[7px] text-destructive">
                              <AlertTriangle className="size-2.5" />
                              سررسید گذشته
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[8px] text-ink-soft">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[8px]",
                          row.overdue
                            ? "border-destructive/25 bg-destructive/5 text-destructive"
                            : "border-gold/30 bg-gold-soft text-[#7a6122] dark:text-gold",
                        )}
                      >
                        {row.overdue ? "سررسید گذشته" : "باز"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setStatementTarget({
                              kind: "supplier",
                              name: row.supplierName,
                            })
                          }
                          className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                        >
                          <BookOpen className="size-3" />
                          گردش
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setSettlePayable(row)}
                          className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                        >
                          <Wallet className="size-3" />
                          تسویه
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <SettlementDialog
        open={Boolean(settleReceivable || settlePayable)}
        onOpenChange={(open) => {
          if (!open) {
            setSettleReceivable(null);
            setSettlePayable(null);
          }
        }}
        businessId={businessId}
        currency={currency}
        receivable={settleReceivable}
        payable={settlePayable}
        banks={activeBanks}
        funds={activeFunds}
      />
      <StatementDialog
        open={Boolean(statementTarget)}
        onOpenChange={(open) => {
          if (!open) setStatementTarget(null);
        }}
        businessId={businessId}
        currency={currency}
        target={statementTarget}
      />
    </div>
  );
}
