import {
  EmptyState,
  PageHeader,
  Panel,
} from "@/components/app/ui";
import {
  AttachmentField,
  AttachmentLink,
  DateRangeFields,
  DestinationSelect,
  EXPENSE_CATEGORY_LABELS,
  FINANCE_METHOD_LABELS,
  StatusPill,
  VOUCHER_STATUS_META,
} from "@/components/finance/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import type {
  ExpenseCategory,
  ExpenseStatus,
  FinanceMethod,
  VoucherStatus,
} from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileClock,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

type TabKey = "income" | "expense";

interface ExpenseRow {
  _id: string;
  number: string;
  status: ExpenseStatus;
  category: ExpenseCategory;
  supplierName: string | null;
  amount: number;
  paidAmount: number;
  outstanding: number;
  dueDate: number | null;
  description: string;
  occurredAt: number;
  attachmentName: string | null;
  attachmentStorageId: string | null;
  accountingDocumentId: string | null;
  approvedAt: number | null;
  paidAt: number | null;
  createdAt: number;
}

const INCOME_METHODS: FinanceMethod[] = ["cash", "card", "bank_transfer", "other"];
const EXPENSE_STATUS_META: Record<
  ExpenseStatus,
  { label: string; className: string }
> = {
  draft: VOUCHER_STATUS_META.draft,
  approved: {
    label: "تأییدشده / پرداخت‌نشده",
    className: "border-gold/40 bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  paid: VOUCHER_STATUS_META.posted,
  cancelled: VOUCHER_STATUS_META.cancelled,
};

function parseDate(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function IncomeDialog({
  open,
  onOpenChange,
  businessId,
  currency,
  customers,
  banks,
  funds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
  customers: { _id: string; name: string }[];
  banks: { _id: string; name: string }[];
  funds: { _id: string; name: string }[];
}) {
  const createIncome = useMutation(api.incomeExpenses.createIncome);
  const [category, setCategory] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("bank_transfer");
  const [destinationType, setDestinationType] = useState<"bank" | "cash">(
    "bank",
  );
  const [bankAccountId, setBankAccountId] = useState("");
  const [cashFundId, setCashFundId] = useState("");
  const [description, setDescription] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [attachmentStorageId, setAttachmentStorageId] = useState<
    string | undefined
  >();
  const [attachmentName, setAttachmentName] = useState<string | undefined>();
  const [saving, setSaving] = useState<"draft" | "post" | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory("");
    setCustomerId("");
    setPartyName("");
    setAmount("");
    setMethod("bank_transfer");
    setDestinationType(banks[0] ? "bank" : "cash");
    setBankAccountId(banks[0]?._id ?? "");
    setCashFundId(funds[0]?._id ?? "");
    setDescription("");
    setOccurredDate(isoDateValue(Date.now()));
    setAttachmentStorageId(undefined);
    setAttachmentName(undefined);
  }, [open, banks, funds]);

  const submit = async (intent: "draft" | "post") => {
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (amountValue <= 0) {
      toast.error("مبلغ درآمد معتبر نیست.");
      return;
    }
    if (!category.trim() || !description.trim()) {
      toast.error("دسته‌بندی و شرح درآمد الزامی است.");
      return;
    }
    if (destinationType === "bank" && !bankAccountId) {
      toast.error("حساب بانکی مقصد را انتخاب کنید.");
      return;
    }
    if (destinationType === "cash" && !cashFundId) {
      toast.error("صندوق مقصد را انتخاب کنید.");
      return;
    }
    const customer = customers.find((item) => item._id === customerId);
    const finalParty = customer?.name ?? partyName.trim();
    if (!customerId && !finalParty) {
      toast.error("دریافت‌کننده درآمد را وارد کنید.");
      return;
    }
    setSaving(intent);
    try {
      const result = await createIncome({
        businessId,
        category: category.trim(),
        customerId: customerId
          ? (customerId as Id<"customers">)
          : undefined,
        partyName: finalParty || undefined,
        amount: amountValue,
        method,
        destinationType,
        bankAccountId:
          destinationType === "bank"
            ? (bankAccountId as Id<"bankAccounts">)
            : undefined,
        cashFundId:
          destinationType === "cash"
            ? (cashFundId as Id<"cashFunds">)
            : undefined,
        description: description.trim(),
        occurredAt: parseDate(occurredDate),
        attachmentStorageId: attachmentStorageId
          ? (attachmentStorageId as Id<"_storage">)
          : undefined,
        attachmentName,
        status: intent === "post" ? "posted" : "draft",
      });
      toast.success(
        intent === "post"
          ? `درآمد ${result.number} ثبت شد و سند حسابداری ایجاد گردید.`
          : `پیش‌نویس درآمد ${result.number} ذخیره شد.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-brand" />
            ثبت درآمد
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            درآمد متفرقه جدا از فاکتور فروش ثبت می‌شود. درآمدی که قبلاً در فاکتور
            فروش ثبت شده نباید دوباره وارد شود.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">دسته‌بندی درآمد *</Label>
              <Input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="مثلاً فروش ضایعات، خدمات مشاوره"
                list="income-categories"
                className="h-9 rounded-xl text-[10px]"
              />
              <datalist id="income-categories">
                <option value="فروش کالا" />
                <option value="خدمات" />
                <option value="اجاره" />
                <option value="سود بانکی" />
                <option value="فروش ضایعات" />
                <option value="سایر درآمدها" />
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ درآمد *</Label>
              <Input
                type="date"
                value={occurredDate}
                onChange={(event) => setOccurredDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مشتری (اختیاری)</Label>
              <Select
                value={customerId || "none"}
                onValueChange={(value) => {
                  if (value === "none") {
                    setCustomerId("");
                    return;
                  }
                  setCustomerId(value);
                  const customer = customers.find((item) => item._id === value);
                  setPartyName(customer?.name ?? "");
                }}
              >
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue placeholder="بدون مشتری" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none">بدون مشتری / سایر</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer._id} value={customer._id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">دریافت از</Label>
              <Input
                value={partyName}
                onChange={(event) => setPartyName(event.target.value)}
                disabled={Boolean(customerId)}
                className="h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مبلغ درآمد *</Label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder="0"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
              {parseAmount(amount) > 0 ? (
                <p className="num text-[8px] text-ink-soft">
                  {formatMoney(parseAmount(amount), currency)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">روش دریافت</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as FinanceMethod)}
              >
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {INCOME_METHODS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {FINANCE_METHOD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DestinationSelect
              banks={banks}
              funds={funds}
              type={destinationType}
              bankAccountId={bankAccountId}
              cashFundId={cashFundId}
              onTypeChange={setDestinationType}
              onBankChange={setBankAccountId}
              onFundChange={setCashFundId}
              label="حساب مقصد *"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">شرح درآمد *</Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="rounded-xl text-[11px]"
              />
            </div>
            <AttachmentField
              businessId={businessId}
              value={attachmentStorageId}
              fileName={attachmentName}
              onChange={(storageId, name) => {
                setAttachmentStorageId(storageId);
                setAttachmentName(name);
              }}
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
            <Button
              type="button"
              variant="outline"
              disabled={saving !== null}
              onClick={() => void submit("draft")}
              className="rounded-xl"
            >
              {saving === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileClock className="size-4" />
              )}
              پیش‌نویس
            </Button>
            <Button
              type="button"
              disabled={saving !== null}
              onClick={() => void submit("post")}
              className="rounded-xl"
            >
              {saving === "post" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              ثبت و تأیید درآمد
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({
  open,
  onOpenChange,
  businessId,
  currency,
  editId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
  editId: string | null;
}) {
  const createExpense = useMutation(api.incomeExpenses.createExpense);
  const updateExpense = useMutation(api.incomeExpenses.updateExpense);
  const approveExpense = useMutation(api.incomeExpenses.approveExpense);
  const detail = useQuery(
    api.incomeExpenses.expenseGet,
    open && businessId && editId
      ? { businessId, expenseId: editId as Id<"expenseRecords"> }
      : "skip",
  );
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [supplierName, setSupplierName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [attachmentStorageId, setAttachmentStorageId] = useState<
    string | undefined
  >();
  const [attachmentName, setAttachmentName] = useState<string | undefined>();
  const [saving, setSaving] = useState<"draft" | "approve" | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!editId) {
      setCategory("other");
      setSupplierName("");
      setAmount("");
      setDueDate("");
      setDescription("");
      setOccurredDate(isoDateValue(Date.now()));
      setAttachmentStorageId(undefined);
      setAttachmentName(undefined);
      return;
    }
    if (!detail) return;
    setCategory(detail.category);
    setSupplierName(detail.supplierName ?? "");
    setAmount(String(detail.amount));
    setDueDate(detail.dueDate ? isoDateValue(detail.dueDate) : "");
    setDescription(detail.description);
    setOccurredDate(isoDateValue(detail.occurredAt));
    setAttachmentStorageId(detail.attachmentStorageId ?? undefined);
    setAttachmentName(detail.attachmentName ?? undefined);
  }, [open, editId, detail?._id]);

  const submit = async (intent: "draft" | "approve") => {
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (amountValue <= 0) {
      toast.error("مبلغ هزینه معتبر نیست.");
      return;
    }
    if (!description.trim()) {
      toast.error("شرح هزینه الزامی است.");
      return;
    }
    setSaving(intent);
    try {
      if (editId) {
        await updateExpense({
          businessId,
          expenseId: editId as Id<"expenseRecords">,
          category,
          supplierName: supplierName.trim() || undefined,
          amount: amountValue,
          dueDate: dueDate ? parseDate(dueDate) : undefined,
          description: description.trim(),
          occurredAt: parseDate(occurredDate),
          attachmentStorageId: attachmentStorageId
            ? (attachmentStorageId as Id<"_storage">)
            : undefined,
          attachmentName,
        });
        if (intent === "approve") {
          await approveExpense({
            businessId,
            expenseId: editId as Id<"expenseRecords">,
          });
        }
        toast.success(
          intent === "approve"
            ? "هزینه ویرایش و تأیید شد؛ سند حسابداری ثبت گردید."
            : "پیش‌نویس هزینه به‌روزرسانی شد.",
        );
      } else {
        const result = await createExpense({
          businessId,
          category,
          supplierName: supplierName.trim() || undefined,
          amount: amountValue,
          dueDate: dueDate ? parseDate(dueDate) : undefined,
          description: description.trim(),
          occurredAt: parseDate(occurredDate),
          attachmentStorageId: attachmentStorageId
            ? (attachmentStorageId as Id<"_storage">)
            : undefined,
          attachmentName,
          status: intent === "approve" ? "approved" : "draft",
        });
        toast.success(
          intent === "approve"
            ? `هزینه ${result.number} تأیید شد و سند حسابداری ایجاد گردید.`
            : `پیش‌نویس هزینه ${result.number} ذخیره شد.`,
        );
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="size-4 text-destructive" />
            {editId ? "ویرایش هزینه" : "ثبت هزینه"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            تأیید هزینه، سند «بدهکار هزینه / بستانکار بدهی» ایجاد می‌کند.
            پرداخت از طریق تسویه هزینه ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>
        {editId && !detail ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">دسته‌بندی *</Label>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    setCategory(value as ExpenseCategory)
                  }
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {(
                      Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]
                    ).map((key) => (
                      <SelectItem key={key} value={key}>
                        {EXPENSE_CATEGORY_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">تأمین‌کننده / طرف حساب</Label>
                <Input
                  value={supplierName}
                  onChange={(event) => setSupplierName(event.target.value)}
                  className="h-9 rounded-xl text-[10px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">مبلغ هزینه *</Label>
                <Input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className="num h-9 rounded-xl text-left text-[11px]"
                />
                {parseAmount(amount) > 0 ? (
                  <p className="num text-[8px] text-ink-soft">
                    {formatMoney(parseAmount(amount), currency)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">تاریخ هزینه *</Label>
                <Input
                  type="date"
                  value={occurredDate}
                  onChange={(event) => setOccurredDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[10px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">سررسید بدهی</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[10px]"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">شرح هزینه *</Label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  className="rounded-xl text-[11px]"
                />
              </div>
              <AttachmentField
                businessId={businessId}
                value={attachmentStorageId}
                fileName={attachmentName}
                onChange={(storageId, name) => {
                  setAttachmentStorageId(storageId);
                  setAttachmentName(name);
                }}
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
              <Button
                type="button"
                variant="outline"
                disabled={saving !== null}
                onClick={() => void submit("draft")}
                className="rounded-xl"
              >
                {saving === "draft" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileClock className="size-4" />
                )}
                ذخیره پیش‌نویس
              </Button>
              <Button
                type="button"
                disabled={saving !== null}
                onClick={() => void submit("approve")}
                className="rounded-xl"
              >
                {saving === "approve" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {editId ? "ذخیره و تأیید" : "ثبت و تأیید هزینه"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayExpenseDialog({
  open,
  onOpenChange,
  businessId,
  currency,
  expense,
  banks,
  funds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  currency: string;
  expense: ExpenseRow | null;
  banks: { _id: string; name: string }[];
  funds: { _id: string; name: string }[];
}) {
  const createVoucher = useMutation(api.paymentVouchers.create);
  const postVoucher = useMutation(api.paymentVouchers.post);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("bank_transfer");
  const [sourceType, setSourceType] = useState<"bank" | "cash">("bank");
  const [bankAccountId, setBankAccountId] = useState("");
  const [cashFundId, setCashFundId] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [trackingNumber, setTrackingNumber] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(expense ? String(expense.outstanding) : "");
    setMethod("bank_transfer");
    setSourceType(banks[0] ? "bank" : "cash");
    setBankAccountId(banks[0]?._id ?? "");
    setCashFundId(funds[0]?._id ?? "");
    setOccurredDate(isoDateValue(Date.now()));
    setTrackingNumber("");
    setDescription(expense ? `تسویه هزینه ${expense.number}` : "");
  }, [open, expense, banks, funds]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !expense) return;
    const amountValue = parseAmount(amount);
    if (amountValue <= 0 || amountValue > expense.outstanding) {
      toast.error("مبلغ پرداخت باید بین ۱ و مانده هزینه باشد.");
      return;
    }
    if (sourceType === "bank" && !bankAccountId) {
      toast.error("حساب بانکی مبدأ را انتخاب کنید.");
      return;
    }
    if (sourceType === "cash" && !cashFundId) {
      toast.error("صندوق مبدأ را انتخاب کنید.");
      return;
    }
    setSaving(true);
    try {
      const voucher = await createVoucher({
        businessId,
        partyType: "supplier",
        partyName: expense.supplierName ?? "تأمین‌کننده",
        expenseId: expense._id as Id<"expenseRecords">,
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
        trackingNumber: trackingNumber.trim() || undefined,
        description: description.trim() || `تسویه هزینه ${expense.number}`,
        occurredAt: parseDate(occurredDate),
      });
      const posted = await postVoucher({
        businessId,
        voucherId: voucher.voucherId,
      });
      toast.success(
        `پرداخت ${voucher.number} ثبت شد؛ سند ${posted.accountingNumber} ایجاد گردید.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-brand" />
            تسویه هزینه {expense?.number}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            پرداخت جزئی یا کامل هزینه؛ سند پرداخت بدهی تأمین‌کننده را کاهش
            می‌دهد و از حساب مبدأ خارج می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-gold/25 bg-gold-soft/40 p-3">
              <p className="text-[8px] text-ink-soft">مانده هزینه</p>
              <p className="num mt-1 text-[13px] font-bold text-gold">
                {formatMoney(expense?.outstanding ?? 0, currency)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مبلغ پرداخت *</Label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">روش پرداخت</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as FinanceMethod)}
              >
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {INCOME_METHODS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {FINANCE_METHOD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ پرداخت</Label>
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
              label="حساب مبدأ *"
            />
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره پیگیری</Label>
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
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
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              ثبت پرداخت و سند
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function IncomeExpenses() {
  const { businessId, branchId, currency, canWrite } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(
    searchParams.get("tab") === "expenses" ? "expense" : "income",
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);
  const [payingExpense, setPayingExpense] = useState<ExpenseRow | null>(null);
  const [pending, setPending] = useState<{
    type: "approve" | "delete" | "post-income" | "delete-income";
    id: string;
    number: string;
  } | null>(null);
  const approveExpense = useMutation(api.incomeExpenses.approveExpense);
  const removeExpense = useMutation(api.incomeExpenses.removeExpenseDraft);
  const postIncome = useMutation(api.incomeExpenses.postIncome);
  const removeIncome = useMutation(api.incomeExpenses.removeIncomeDraft);

  const accounts = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  );
  const customers = useQuery(
    api.customers.list,
    businessId ? { businessId } : "skip",
  );
  const incomesData = useQuery(
    api.incomeExpenses.incomes,
    businessId
      ? {
          businessId,
          branchId,
          status:
            tab === "income" && status !== "all"
              ? (status as VoucherStatus)
              : undefined,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );
  const expensesData = useQuery(
    api.incomeExpenses.expenses,
    businessId
      ? {
          businessId,
          branchId,
          status:
            tab === "expense" && status !== "all"
              ? (status as ExpenseStatus)
              : undefined,
          category:
            tab === "expense" && category !== "all"
              ? (category as ExpenseCategory)
              : undefined,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );

  const activeBanks = accounts?.banks.filter((bank) => bank.active) ?? [];
  const activeFunds = accounts?.funds.filter((fund) => fund.active) ?? [];
  const customerOptions =
    customers?.map((customer) => ({ _id: customer._id, name: customer.name })) ??
    [];

  const switchTab = (next: TabKey) => {
    setTab(next);
    setStatus("all");
    setCategory("all");
    setSearch("");
  };

  const confirmPending = async () => {
    if (!businessId || !pending) return;
    try {
      if (pending.type === "approve") {
        await approveExpense({
          businessId,
          expenseId: pending.id as Id<"expenseRecords">,
        });
        toast.success(`هزینه ${pending.number} تأیید و سند حسابداری ثبت شد.`);
      } else if (pending.type === "delete") {
        await removeExpense({
          businessId,
          expenseId: pending.id as Id<"expenseRecords">,
        });
        toast.success(`پیش‌نویس هزینه ${pending.number} حذف شد.`);
      } else if (pending.type === "post-income") {
        const result = await postIncome({
          businessId,
          incomeId: pending.id as Id<"incomeRecords">,
        });
        toast.success(
          `درآمد ${pending.number} تأیید شد؛ سند ${result.accountingNumber} ثبت گردید.`,
        );
      } else {
        await removeIncome({
          businessId,
          incomeId: pending.id as Id<"incomeRecords">,
        });
        toast.success(`پیش‌نویس درآمد ${pending.number} حذف شد.`);
      }
      setPending(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const incomeRows = incomesData ?? [];
  const expenseRows = expensesData ?? [];
  const postedIncome = incomeRows.filter((row) => row.status === "posted");
  const totalIncome = postedIncome.reduce((sum, row) => sum + row.amount, 0);
  const approvedExpenses = expenseRows.filter(
    (row) => row.status === "approved" || row.status === "paid",
  );
  const totalExpense = approvedExpenses.reduce((sum, row) => sum + row.amount, 0);
  const outstandingExpense = expenseRows.reduce(
    (sum, row) => sum + row.outstanding,
    0,
  );

  const statusOptions =
    tab === "income"
      ? [
          ["draft", "پیش‌نویس"],
          ["posted", "تأییدشده"],
          ["cancelled", "لغوشده"],
        ]
      : [
          ["draft", "پیش‌نویس"],
          ["approved", "تأییدشده"],
          ["paid", "پرداخت‌شده"],
          ["cancelled", "لغوشده"],
        ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · درآمد و هزینه"
        title="مدیریت درآمدها و هزینه‌ها"
        description="ثبت درآمد متفرقه و هزینه‌های دسته‌بندی‌شده با پیوست رسید، تأیید، تسویه جزئی و سند حسابداری خودکار."
        actions={
          canWrite ? (
            <Button
              size="sm"
              onClick={() =>
                tab === "income" ? setIncomeOpen(true) : (setEditingExpense(null), setExpenseOpen(true))
              }
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              {tab === "income" ? "ثبت درآمد" : "ثبت هزینه"}
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-card/60 px-3 py-1.5 text-[9px] text-ink-soft">
              <LockKeyhole className="size-3.5" />
              دسترسی مشاهده
            </span>
          )
        }
      />

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-hairline/60 bg-card/60 p-1.5">
        {[
          { key: "income" as const, label: "درآمدها", count: incomesData?.length },
          {
            key: "expense" as const,
            label: "هزینه‌ها",
            count: expensesData?.length,
          },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => switchTab(item.key)}
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
              {item.count ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">درآمد تأییدشده</span>
            <ArrowDownLeft className="size-4 text-brand" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-brand">
            {formatMoney(totalIncome, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {postedIncome.length} فقره در نتیجه فیلتر
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">هزینه تأییدشده</span>
            <ArrowUpRight className="size-4 text-destructive" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-destructive">
            {formatMoney(totalExpense, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {approvedExpenses.length} فقره هزینه
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">مانده بدهی هزینه‌ها</span>
            <ReceiptText className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">
            {formatMoney(outstandingExpense, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            قابل تسویه از بخش هزینه‌ها
          </p>
        </Panel>
      </div>

      <Panel className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[190px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-soft" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجوی شماره، شرح، دسته یا طرف حساب…"
              className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[140px] rounded-lg text-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">همه وضعیت‌ها</SelectItem>
              {statusOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tab === "expense" ? (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 w-[130px] rounded-lg text-[9px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">همه دسته‌ها</SelectItem>
                {(
                  Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]
                ).map((key) => (
                  <SelectItem key={key} value={key}>
                    {EXPENSE_CATEGORY_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="w-full sm:w-auto">
            <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>
          {(from || to || search || status !== "all" || category !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
                setSearch("");
                setStatus("all");
                setCategory("all");
              }}
              className="h-8 rounded-lg text-[9px]"
            >
              پاک‌کردن فیلترها
            </Button>
          )}
        </div>

        {tab === "income" ? (
          !incomesData ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : incomeRows.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="size-5" />}
              title="درآمدی یافت نشد"
              description="درآمد متفرقه را ثبت کنید؛ درآمد فاکتور فروش نباید دوباره وارد شود."
              action={
                canWrite ? (
                  <Button onClick={() => setIncomeOpen(true)} className="rounded-xl">
                    <Plus className="size-4" />
                    ثبت درآمد
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>شماره</TableHead>
                    <TableHead>تاریخ</TableHead>
                    <TableHead>دسته</TableHead>
                    <TableHead>دریافت از</TableHead>
                    <TableHead>حساب</TableHead>
                    <TableHead className="text-end">مبلغ</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-[110px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incomeRows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="num text-[9px] font-bold text-brand">
                        {row.number}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                        {formatJalali(row.occurredAt)}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-[9px]">
                        {row.category}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-[9px]">
                        {row.partyName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-[8px] text-ink-soft">
                        {row.destinationName}
                      </TableCell>
                      <TableCell className="num text-end text-[10px] font-bold text-brand">
                        {formatMoney(row.amount, currency)}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          label={VOUCHER_STATUS_META[row.status].label}
                          className={VOUCHER_STATUS_META[row.status].className}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {row.attachmentStorageId ? (
                            <AttachmentLink
                              businessId={businessId}
                              storageId={row.attachmentStorageId}
                              fileName={row.attachmentName}
                            />
                          ) : null}
                          {canWrite && row.status === "draft" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() =>
                                  setPending({
                                    type: "post-income",
                                    id: row._id,
                                    number: row.number,
                                  })
                                }
                                className="h-7 rounded-lg px-2 text-[8px]"
                              >
                                تأیید
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setPending({
                                    type: "delete-income",
                                    id: row._id,
                                    number: row.number,
                                  })
                                }
                                className="h-7 rounded-lg px-2 text-[8px] text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : !expensesData ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : expenseRows.length === 0 ? (
          <EmptyState
            icon={<TrendingDown className="size-5" />}
            title="هزینه‌ای یافت نشد"
            description="هزینه را با دسته‌بندی و رسید ثبت کنید؛ پیش‌نویس تا تأیید سند نمی‌سازد."
            action={
              canWrite ? (
                <Button
                  onClick={() => {
                    setEditingExpense(null);
                    setExpenseOpen(true);
                  }}
                  className="rounded-xl"
                >
                  <Plus className="size-4" />
                  ثبت هزینه
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>شماره</TableHead>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>دسته</TableHead>
                  <TableHead>طرف حساب</TableHead>
                  <TableHead className="text-end">مبلغ</TableHead>
                  <TableHead className="text-end">مانده</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="w-[150px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseRows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="num text-[9px] font-bold text-brand">
                      {row.number}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                      {formatJalali(row.occurredAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[9px]">
                      {EXPENSE_CATEGORY_LABELS[row.category]}
                    </TableCell>
                    <TableCell className="max-w-[130px] truncate text-[9px]">
                      {row.supplierName ?? "—"}
                    </TableCell>
                    <TableCell className="num text-end text-[10px] font-bold">
                      {formatMoney(row.amount, currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "num text-end text-[10px] font-bold",
                        row.outstanding > 0 ? "text-gold" : "text-brand",
                      )}
                    >
                      {formatMoney(row.outstanding, currency)}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        label={EXPENSE_STATUS_META[row.status].label}
                        className={EXPENSE_STATUS_META[row.status].className}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {row.attachmentStorageId ? (
                          <AttachmentLink
                            businessId={businessId}
                            storageId={row.attachmentStorageId}
                            fileName={row.attachmentName}
                          />
                        ) : null}
                        {canWrite ? (
                          row.status === "draft" ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingExpense(row);
                                  setExpenseOpen(true);
                                }}
                                className="h-7 rounded-lg px-2 text-[8px]"
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  setPending({
                                    type: "approve",
                                    id: row._id,
                                    number: row.number,
                                  })
                                }
                                className="h-7 rounded-lg px-2 text-[8px]"
                              >
                                تأیید
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setPending({
                                    type: "delete",
                                    id: row._id,
                                    number: row.number,
                                  })
                                }
                                className="h-7 rounded-lg px-2 text-[8px] text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </>
                          ) : row.status === "approved" && row.outstanding > 0 ? (
                            <Button
                              size="sm"
                              onClick={() => setPayingExpense(row)}
                              className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                            >
                              <Wallet className="size-3" />
                              پرداخت
                            </Button>
                          ) : null
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <IncomeDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        businessId={businessId}
        currency={currency}
        customers={customerOptions}
        banks={activeBanks}
        funds={activeFunds}
      />
      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={(open) => {
          setExpenseOpen(open);
          if (!open) setEditingExpense(null);
        }}
        businessId={businessId}
        currency={currency}
        editId={editingExpense?._id ?? null}
      />
      <PayExpenseDialog
        open={Boolean(payingExpense)}
        onOpenChange={(open) => {
          if (!open) setPayingExpense(null);
        }}
        businessId={businessId}
        currency={currency}
        expense={payingExpense}
        banks={activeBanks}
        funds={activeFunds}
      />

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              {pending?.type === "approve"
                ? "تأیید هزینه"
                : pending?.type === "delete"
                  ? "حذف پیش‌نویس هزینه"
                  : pending?.type === "post-income"
                    ? "تأیید درآمد"
                    : "حذف پیش‌نویس درآمد"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[10px] leading-5">
              {pending?.type === "approve" || pending?.type === "post-income"
                ? `با تأیید ${pending?.number} سند حسابداری متوازن و تراکنش مالی متناظر ثبت می‌شود.`
                : `پیش‌نویس ${pending?.number} برای همیشه حذف می‌شود و سندی ایجاد نمی‌کند.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmPending()}
              className={cn(
                "rounded-xl",
                (pending?.type === "delete" ||
                  pending?.type === "delete-income") &&
                  "bg-destructive hover:bg-destructive/90",
              )}
            >
              تأیید
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
