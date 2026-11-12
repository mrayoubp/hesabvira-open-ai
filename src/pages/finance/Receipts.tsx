import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import {
  AttachmentField,
  AttachmentLink,
  DateRangeFields,
  DestinationSelect,
  FINANCE_METHOD_LABELS,
  StatusPill,
  VOUCHER_STATUS_META,
  VoucherSheet,
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
import type { FinanceMethod, VoucherStatus } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  isoDateValue,
  printAccountingView,
  timestampFromDateInput,
} from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  Eye,
  FileClock,
  HandCoins,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function parseDate(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function defaultCheckDate() {
  return isoDateValue(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function ReceiptDialog({
  open,
  onOpenChange,
  businessId,
  branchId,
  fiscalYearId,
  currency,
  editId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  branchId?: Id<"branches">;
  fiscalYearId?: Id<"fiscalYears">;
  currency: string;
  editId: string | null;
}) {
  const accounts = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  );
  const customers = useQuery(
    api.customers.list,
    businessId ? { businessId } : "skip",
  );
  const invoices = useQuery(
    api.invoices.list,
    businessId
      ? { businessId, branchId, fiscalYearId, status: "issued" as const }
      : "skip",
  );
  const detail = useQuery(
    api.receipts.get,
    open && businessId && editId
      ? { businessId, receiptId: editId as Id<"receipts"> }
      : "skip",
  );
  const createReceipt = useMutation(api.receipts.create);
  const updateDraft = useMutation(api.receipts.updateDraft);
  const postReceipt = useMutation(api.receipts.post);

  const [customerId, setCustomerId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("cash");
  const [destinationType, setDestinationType] = useState<"bank" | "cash">(
    "cash",
  );
  const [bankAccountId, setBankAccountId] = useState("");
  const [cashFundId, setCashFundId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [description, setDescription] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [attachmentStorageId, setAttachmentStorageId] = useState<
    string | undefined
  >();
  const [attachmentName, setAttachmentName] = useState<string | undefined>();
  const [checkDueDate, setCheckDueDate] = useState(defaultCheckDate);
  const [checkBankName, setCheckBankName] = useState("");
  const [checkBankBranch, setCheckBankBranch] = useState("");
  const [saving, setSaving] = useState<"draft" | "post" | null>(null);

  const activeBanks =
    accounts?.banks.filter((bank) => bank.active) ?? [];
  const activeFunds = accounts?.funds.filter((fund) => fund.active) ?? [];

  useEffect(() => {
    if (!open) return;
    if (!editId) {
      setCustomerId("");
      setPartyName("");
      setInvoiceId("");
      setAmount("");
      setMethod("cash");
      setDestinationType("cash");
      setBankAccountId("");
      setCashFundId("");
      setTrackingNumber("");
      setDescription("");
      setOccurredDate(isoDateValue(Date.now()));
      setAttachmentStorageId(undefined);
      setAttachmentName(undefined);
      setCheckDueDate(defaultCheckDate());
      setCheckBankName("");
      setCheckBankBranch("");
      return;
    }
    if (!detail) return;
    setCustomerId(detail.customerId ?? "");
    setPartyName(detail.partyName);
    setInvoiceId(detail.invoiceId ?? "");
    setAmount(String(detail.amount));
    setMethod(detail.method);
    setDestinationType(detail.destinationType);
    setBankAccountId(detail.bankAccountId ?? "");
    setCashFundId(detail.cashFundId ?? "");
    setTrackingNumber(detail.trackingNumber ?? "");
    setDescription(detail.description);
    setOccurredDate(isoDateValue(detail.occurredAt));
    setAttachmentStorageId(detail.attachmentStorageId ?? undefined);
    setAttachmentName(detail.attachmentName ?? undefined);
    setCheckDueDate(
      detail.checkDueDate
        ? isoDateValue(detail.checkDueDate)
        : defaultCheckDate(),
    );
    setCheckBankName(detail.checkBankName ?? "");
    setCheckBankBranch(detail.checkBankBranch ?? "");
  }, [open, editId, detail?._id]);

  useEffect(() => {
    if (!open || editId) return;
    if (!cashFundId && activeFunds[0]) setCashFundId(activeFunds[0]._id);
    if (!bankAccountId && activeBanks[0]) setBankAccountId(activeBanks[0]._id);
  }, [open, editId, activeFunds, activeBanks, cashFundId, bankAccountId]);

  const selectedCustomer = customers?.find(
    (customer) => customer._id === customerId,
  );
  const customerInvoices = (invoices ?? []).filter(
    (invoice) =>
      invoice.outstanding > 0 &&
      (!customerId || invoice.customerId === customerId),
  );
  const selectedInvoice = customerInvoices.find(
    (invoice) => invoice._id === invoiceId,
  );
  const effectiveParty = selectedCustomer?.name ?? partyName;

  const selectInvoice = (value: string) => {
    if (value === "none") {
      setInvoiceId("");
      return;
    }
    setInvoiceId(value);
    const invoice = invoices?.find((item) => item._id === value);
    if (invoice) {
      setCustomerId(invoice.customerId);
      setPartyName(invoice.customerName);
      setAmount(String(invoice.outstanding));
    }
  };

  const submit = async (
    event: React.FormEvent<HTMLFormElement>,
    intent: "draft" | "post",
  ) => {
    event.preventDefault();
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (!effectiveParty.trim()) {
      toast.error("دریافت‌کننده را مشخص کنید.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ دریافت باید بزرگ‌تر از صفر باشد.");
      return;
    }
    if (selectedInvoice && amountValue > selectedInvoice.outstanding) {
      toast.error("مبلغ از مانده فاکتور بیشتر است.");
      return;
    }
    if (method !== "check" && destinationType === "bank" && !bankAccountId) {
      toast.error("حساب بانکی مقصد را انتخاب کنید.");
      return;
    }
    if (method !== "check" && destinationType === "cash" && !cashFundId) {
      toast.error("صندوق مقصد را انتخاب کنید.");
      return;
    }
    setSaving(intent);
    try {
      const payload = {
        businessId,
        partyType: customerId ? ("customer" as const) : ("other" as const),
        customerId: customerId
          ? (customerId as Id<"customers">)
          : undefined,
        partyName: effectiveParty.trim(),
        invoiceId: invoiceId ? (invoiceId as Id<"invoices">) : undefined,
        amount: amountValue,
        method,
        destinationType: method === "check" ? ("cash" as const) : destinationType,
        bankAccountId:
          method !== "check" && destinationType === "bank"
            ? (bankAccountId as Id<"bankAccounts">)
            : undefined,
        cashFundId:
          method !== "check" && destinationType === "cash"
            ? (cashFundId as Id<"cashFunds">)
            : undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        description: description.trim() || "دریافت وجه",
        occurredAt: parseDate(occurredDate),
        attachmentStorageId: attachmentStorageId
          ? (attachmentStorageId as Id<"_storage">)
          : undefined,
        attachmentName: attachmentName,
        checkDueDate:
          method === "check" ? parseDate(checkDueDate) : undefined,
        checkBankName: checkBankName.trim() || undefined,
        checkBankBranch: checkBankBranch.trim() || undefined,
      };
      let targetId = editId;
      let number = detail?.number;
      if (editId) {
        await updateDraft({ ...payload, receiptId: editId as Id<"receipts"> });
      } else {
        const created = await createReceipt(payload);
        targetId = created.receiptId as string;
        number = created.number;
      }
      if (intent === "post" && targetId) {
        const posted = await postReceipt({
          businessId,
          receiptId: targetId as Id<"receipts">,
        });
        toast.success(
          `دریافت ${number} تأیید شد؛ سند ${posted.accountingNumber} ثبت گردید.`,
        );
      } else {
        toast.success(`پیش‌نویس دریافت ${number} ذخیره شد.`);
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
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HandCoins className="size-4 text-brand" />
            {editId ? "ویرایش پیش‌نویس دریافت" : "ثبت دریافت وجه"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            تأیید دریافت، یک سند حسابداری متوازن و یک تراکنش بانک/صندوق در همان
            تراکنش دیتابیس ایجاد می‌کند.
          </DialogDescription>
        </DialogHeader>

        {editId && !detail ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">تاریخ دریافت *</Label>
                <Input
                  type="date"
                  value={occurredDate}
                  onChange={(event) => setOccurredDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[10px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">دریافت از *</Label>
                <Select
                  value={customerId || "other"}
                  onValueChange={(value) => {
                    if (value === "other") {
                      setCustomerId("");
                      setInvoiceId("");
                      return;
                    }
                    setCustomerId(value);
                    const customer = customers?.find(
                      (item) => item._id === value,
                    );
                    setPartyName(customer?.name ?? "");
                    setInvoiceId("");
                  }}
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue placeholder="مشتری یا سایر" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="other">سایر / دریافت متفرقه</SelectItem>
                    {customers?.map((customer) => (
                      <SelectItem key={customer._id} value={customer._id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!customerId ? (
                  <Input
                    value={partyName}
                    onChange={(event) => setPartyName(event.target.value)}
                    placeholder="نام دریافت‌کننده"
                    className="h-8 rounded-lg text-[10px]"
                  />
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">فاکتور مرتبط (اختیاری)</Label>
                <Select
                  value={invoiceId || "none"}
                  onValueChange={selectInvoice}
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue placeholder="بدون فاکتور" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="none">بدون فاکتور / دریافت متفرقه</SelectItem>
                    {customerInvoices.map((invoice) => (
                      <SelectItem key={invoice._id} value={invoice._id}>
                        {invoice.number} · مانده{" "}
                        {formatMoney(invoice.outstanding, currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedInvoice ? (
                  <p className="num text-[8px] text-gold">
                    مانده فاکتور: {formatMoney(selectedInvoice.outstanding, currency)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">مبلغ دریافت *</Label>
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
                <Label className="text-[10px]">روش دریافت *</Label>
                <Select
                  value={method}
                  onValueChange={(value) => setMethod(value as FinanceMethod)}
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {(
                      Object.keys(FINANCE_METHOD_LABELS) as FinanceMethod[]
                    ).map((key) => (
                      <SelectItem key={key} value={key}>
                        {FINANCE_METHOD_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {method === "check" ? (
                <div className="rounded-xl border border-gold/25 bg-gold-soft/30 p-3 text-[9px] leading-5 text-[#7a6122] dark:text-gold">
                  چک در «چک‌های دریافتنی» ثبت می‌شود و هنگام وصول، حساب بانکی
                  مقصد انتخاب خواهد شد؛ بنابراین در این مرحله حساب مقصد لازم
                  نیست.
                </div>
              ) : (
                <DestinationSelect
                  banks={activeBanks}
                  funds={activeFunds}
                  type={destinationType}
                  bankAccountId={bankAccountId}
                  cashFundId={cashFundId}
                  onTypeChange={setDestinationType}
                  onBankChange={setBankAccountId}
                  onFundChange={setCashFundId}
                  label="حساب مقصد *"
                />
              )}
              <div className="space-y-1.5">
                <Label className="text-[10px]">
                  {method === "check" ? "شماره چک" : "شماره پیگیری"}
                </Label>
                <Input
                  value={trackingNumber}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-left text-[10px]"
                />
              </div>
            </div>

            {method === "check" ? (
              <div className="grid gap-3 rounded-xl border border-gold/25 bg-gold-soft/30 p-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px]">تاریخ سررسید چک *</Label>
                  <Input
                    type="date"
                    value={checkDueDate}
                    onChange={(event) => setCheckDueDate(event.target.value)}
                    dir="ltr"
                    className="num h-8 rounded-lg text-[10px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px]">بانک چک</Label>
                  <Input
                    value={checkBankName}
                    onChange={(event) => setCheckBankName(event.target.value)}
                    className="h-8 rounded-lg text-[10px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px]">شعبه چک</Label>
                  <Input
                    value={checkBankBranch}
                    onChange={(event) => setCheckBankBranch(event.target.value)}
                    className="h-8 rounded-lg text-[10px]"
                  />
                </div>
                <p className="sm:col-span-3 text-[8px] leading-4 text-[#7a6122] dark:text-gold">
                  با تأیید، چک در «چک‌های دریافتنی» ثبت می‌شود؛ وصول آن از صفحه
                  چک‌ها انجام می‌گیرد.
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">شرح</Label>
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
                onClick={(event) =>
                  void submit(
                    event as unknown as React.FormEvent<HTMLFormElement>,
                    "draft",
                  )
                }
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
                onClick={(event) =>
                  void submit(
                    event as unknown as React.FormEvent<HTMLFormElement>,
                    "post",
                  )
                }
                className="rounded-xl"
              >
                {saving === "post" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                ثبت و تأیید دریافت
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDetailDialog({
  businessId,
  receiptId,
  currency,
  canWrite,
  onClose,
  onEdit,
  onPost,
  onDelete,
}: {
  businessId?: Id<"businesses">;
  receiptId: string | null;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onPost: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const detail = useQuery(
    api.receipts.get,
    businessId && receiptId
      ? { businessId, receiptId: receiptId as Id<"receipts"> }
      : "skip",
  );

  return (
    <Dialog open={Boolean(receiptId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="size-4 text-brand" />
            رسید دریافت
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            پیش‌نمایش رسید برای چاپ یا ذخیره PDF از پنجره چاپ مرورگر.
          </DialogDescription>
        </DialogHeader>
        {!detail ? (
          <Skeleton className="h-[420px] rounded-[24px]" />
        ) : (
          <>
            <VoucherSheet
              kind="دریافت وجه"
              number={detail.number}
              date={detail.occurredAt}
              party={detail.partyName}
              amount={detail.amount}
              method={FINANCE_METHOD_LABELS[detail.method]}
              account={detail.destinationName}
              description={detail.description}
              status={detail.status}
              trackingNumber={detail.trackingNumber}
              accountingNumber={detail.accountingNumber}
              currency={currency}
            >
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[9px] text-ink-soft">
                <span>ثبت‌کننده: {detail.createdByName}</span>
                {detail.attachmentStorageId ? (
                  <AttachmentLink
                    businessId={businessId}
                    storageId={detail.attachmentStorageId}
                    fileName={detail.attachmentName}
                  />
                ) : null}
              </div>
            </VoucherSheet>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => printAccountingView(`رسید دریافت ${detail.number}`)}
                className="rounded-xl"
              >
                <Printer className="size-4" />
                چاپ / PDF
              </Button>
              {detail.status === "draft" && canWrite ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onEdit(detail._id)}
                    className="rounded-xl"
                  >
                    <Pencil className="size-4" />
                    ویرایش
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onDelete(detail._id)}
                    className="rounded-xl text-destructive"
                  >
                    <Trash2 className="size-4" />
                    حذف
                  </Button>
                  <Button
                    onClick={() => onPost(detail._id)}
                    className="rounded-xl"
                  >
                    <CheckCircle2 className="size-4" />
                    تأیید دریافت
                  </Button>
                </>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Receipts() {
  const { businessId, branchId, fiscalYearId, currency, canWrite } =
    useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | VoucherStatus>("all");
  const [method, setMethod] = useState<"all" | FinanceMethod>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    type: "post" | "delete";
    id: string;
    number: string;
  } | null>(null);
  const postReceipt = useMutation(api.receipts.post);
  const removeDraft = useMutation(api.receipts.removeDraft);

  const rows = useQuery(
    api.receipts.list,
    businessId
      ? {
          businessId,
          branchId,
          fiscalYearId,
          status: status === "all" ? undefined : status,
          method: method === "all" ? undefined : method,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );

  const openCreate = () => {
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (id: string) => {
    setDetailId(null);
    setEditId(id);
    setFormOpen(true);
  };

  const confirmPending = async () => {
    if (!businessId || !pending) return;
    try {
      if (pending.type === "post") {
        const result = await postReceipt({
          businessId,
          receiptId: pending.id as Id<"receipts">,
        });
        toast.success(
          `دریافت ${pending.number} تأیید شد؛ سند ${result.accountingNumber} ثبت گردید.`,
        );
      } else {
        await removeDraft({
          businessId,
          receiptId: pending.id as Id<"receipts">,
        });
        toast.success(`پیش‌نویس ${pending.number} حذف شد.`);
      }
      setPending(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const postedRows = rows?.filter((row) => row.status === "posted") ?? [];
  const totalPosted = postedRows.reduce((sum, row) => sum + row.amount, 0);
  const totalChecks = postedRows
    .filter((row) => row.method === "check")
    .reduce((sum, row) => sum + row.amount, 0);
  const drafts = rows?.filter((row) => row.status === "draft").length ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · دریافت وجه"
        title="دریافت‌ها"
        description="ثبت دریافت نقدی، کارت‌خوان، انتقال بانکی و چک؛ با تخصیص به فاکتور، پیوست مدرک، چاپ رسید و سند خودکار."
        actions={
          canWrite ? (
            <Button
              onClick={openCreate}
              size="sm"
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              ثبت دریافت جدید
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-card/60 px-3 py-1.5 text-[9px] text-ink-soft">
              <LockKeyhole className="size-3.5" />
              دسترسی مشاهده
            </span>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">جمع دریافت‌های تأییدشده</span>
            <HandCoins className="size-4 text-brand" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-brand">
            {formatMoney(totalPosted, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {postedRows.length} فقره در نتیجه فیلتر
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">دریافت‌های چکی</span>
            <ReceiptText className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">
            {formatMoney(totalChecks, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            چک‌ها در چرخه وصول پیگیری می‌شوند
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">پیش‌نویس‌های در انتظار</span>
            <FileClock className="size-4 text-destructive" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-destructive">
            {drafts}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            بدون سند حسابداری تا زمان تأیید
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
              placeholder="جستجوی شماره، نام، شرح یا پیگیری…"
              className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as "all" | VoucherStatus)}
          >
            <SelectTrigger className="h-8 w-[120px] rounded-lg text-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">همه وضعیت‌ها</SelectItem>
              <SelectItem value="draft">پیش‌نویس</SelectItem>
              <SelectItem value="posted">تأییدشده</SelectItem>
              <SelectItem value="cancelled">لغوشده</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={method}
            onValueChange={(value) =>
              setMethod(value as "all" | FinanceMethod)
            }
          >
            <SelectTrigger className="h-8 w-[120px] rounded-lg text-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">همه روش‌ها</SelectItem>
              {(Object.keys(FINANCE_METHOD_LABELS) as FinanceMethod[]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {FINANCE_METHOD_LABELS[key]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <div className="w-full sm:w-auto">
            <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>
          {(from || to || search || status !== "all" || method !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
                setSearch("");
                setStatus("all");
                setMethod("all");
              }}
              className="h-8 rounded-lg text-[9px]"
            >
              پاک‌کردن فیلترها
            </Button>
          )}
        </div>

        {!rows ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<HandCoins className="size-5" />}
            title="دریافتی یافت نشد"
            description={
              canWrite
                ? "اولین دریافت را ثبت کنید؛ پیش‌نویس قابل ویرایش است و پس از تأیید سند حسابداری می‌سازد."
                : "با تغییر فیلترها دوباره جستجو کنید."
            }
            action={
              canWrite ? (
                <Button onClick={openCreate} className="rounded-xl">
                  <Plus className="size-4" />
                  ثبت دریافت
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
                  <TableHead>دریافت از</TableHead>
                  <TableHead>روش</TableHead>
                  <TableHead>حساب مقصد</TableHead>
                  <TableHead className="text-end">مبلغ</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailId(row._id)}
                        className="num text-[9px] font-bold text-brand hover:underline"
                      >
                        {row.number}
                      </button>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                      {formatJalali(row.occurredAt)}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-[9px] font-medium">
                      {row.partyName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[8px] text-ink-soft">
                      {FINANCE_METHOD_LABELS[row.method]}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate text-[8px] text-ink-soft">
                      <span className="inline-flex items-center gap-1">
                        {row.destinationType === "bank" ? (
                          <Wallet className="size-3" />
                        ) : (
                          <ReceiptText className="size-3" />
                        )}
                        {row.destinationName}
                      </span>
                    </TableCell>
                    <TableCell className="num text-end text-[10px] font-bold text-ink">
                      {formatMoney(row.amount, currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusPill
                          label={VOUCHER_STATUS_META[row.status].label}
                          className={VOUCHER_STATUS_META[row.status].className}
                        />
                        {row.accountingDocumentId ? (
                          <span className="text-[7px] text-ink-soft">
                            سند حسابداری ثبت شد
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailId(row._id)}
                          className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                        >
                          <Eye className="size-3" />
                          رسید
                        </Button>
                        {canWrite && row.status === "draft" ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(row._id)}
                              className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                            >
                              <Pencil className="size-3" />
                              ویرایش
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                setPending({
                                  type: "post",
                                  id: row._id,
                                  number: row.number,
                                })
                              }
                              className="h-7 rounded-lg px-2 text-[8px]"
                            >
                              تأیید
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
        )}
      </Panel>

      <ReceiptDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditId(null);
        }}
        businessId={businessId}
        branchId={branchId}
        fiscalYearId={fiscalYearId}
        currency={currency}
        editId={editId}
      />
      <ReceiptDetailDialog
        businessId={businessId}
        receiptId={detailId}
        currency={currency}
        canWrite={canWrite}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
          setFormOpen(true);
        }}
        onPost={(id) => {
          const row = rows?.find((item) => item._id === id);
          setDetailId(null);
          setPending({ type: "post", id, number: row?.number ?? "" });
        }}
        onDelete={(id) => {
          const row = rows?.find((item) => item._id === id);
          setDetailId(null);
          setPending({ type: "delete", id, number: row?.number ?? "" });
        }}
      />

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              {pending?.type === "post"
                ? "تأیید دریافت وجه"
                : "حذف پیش‌نویس دریافت"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[10px] leading-5">
              {pending?.type === "post"
                ? `دریافت ${pending.number} تأیید می‌شود و سند حسابداری متوازن ایجاد می‌گردد. پس از تأیید، ویرایش مستقیم ممکن نیست.`
                : `پیش‌نویس ${pending?.number} برای همیشه حذف می‌شود. این عملیات سند حسابداری ایجاد نمی‌کند.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmPending()}
              className={cn(
                "rounded-xl",
                pending?.type === "delete" && "bg-destructive hover:bg-destructive/90",
              )}
            >
              {pending?.type === "post" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {pending?.type === "post" ? "تأیید و ثبت سند" : "حذف پیش‌نویس"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
