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
  Banknote,
  CheckCircle2,
  Eye,
  FileClock,
  HandCoins,
  Landmark,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const PAYMENT_METHODS: FinanceMethod[] = [
  "cash",
  "card",
  "bank_transfer",
  "other",
];

function parseDate(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function PaymentDialog({
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
  const accounts = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  );
  const detail = useQuery(
    api.paymentVouchers.get,
    open && businessId && editId
      ? { businessId, voucherId: editId as Id<"paymentVouchers"> }
      : "skip",
  );
  const createVoucher = useMutation(api.paymentVouchers.create);
  const updateDraft = useMutation(api.paymentVouchers.updateDraft);
  const postVoucher = useMutation(api.paymentVouchers.post);

  const [partyType, setPartyType] = useState<"supplier" | "other">("other");
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("bank_transfer");
  const [sourceType, setSourceType] = useState<"bank" | "cash">("bank");
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
  const [saving, setSaving] = useState<"draft" | "post" | null>(null);

  const activeBanks = accounts?.banks.filter((bank) => bank.active) ?? [];
  const activeFunds = accounts?.funds.filter((fund) => fund.active) ?? [];
  const sourceBalance =
    sourceType === "bank"
      ? activeBanks.find((bank) => bank._id === bankAccountId)?.balance
      : activeFunds.find((fund) => fund._id === cashFundId)?.balance;

  useEffect(() => {
    if (!open) return;
    if (!editId) {
      setPartyType("other");
      setPartyName("");
      setAmount("");
      setMethod("bank_transfer");
      setSourceType("bank");
      setBankAccountId("");
      setCashFundId("");
      setTrackingNumber("");
      setDescription("");
      setOccurredDate(isoDateValue(Date.now()));
      setAttachmentStorageId(undefined);
      setAttachmentName(undefined);
      return;
    }
    if (!detail) return;
    setPartyType(detail.partyType);
    setPartyName(detail.partyName);
    setAmount(String(detail.amount));
    setMethod(detail.method === "check" ? "bank_transfer" : detail.method);
    setSourceType(detail.sourceType);
    setBankAccountId(detail.bankAccountId ?? "");
    setCashFundId(detail.cashFundId ?? "");
    setTrackingNumber(detail.trackingNumber ?? "");
    setDescription(detail.description);
    setOccurredDate(isoDateValue(detail.occurredAt));
    setAttachmentStorageId(detail.attachmentStorageId ?? undefined);
    setAttachmentName(detail.attachmentName ?? undefined);
  }, [open, editId, detail?._id]);

  useEffect(() => {
    if (!open || editId) return;
    if (!cashFundId && activeFunds[0]) setCashFundId(activeFunds[0]._id);
    if (!bankAccountId && activeBanks[0]) setBankAccountId(activeBanks[0]._id);
  }, [open, editId, activeFunds, activeBanks, cashFundId, bankAccountId]);

  const submit = async (intent: "draft" | "post") => {
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (!partyName.trim()) {
      toast.error("پرداخت‌شونده را وارد کنید.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ پرداخت باید بزرگ‌تر از صفر باشد.");
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
    setSaving(intent);
    try {
      const payload = {
        businessId,
        partyType,
        partyName: partyName.trim(),
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
        description: description.trim() || "پرداخت وجه",
        occurredAt: parseDate(occurredDate),
        attachmentStorageId: attachmentStorageId
          ? (attachmentStorageId as Id<"_storage">)
          : undefined,
        attachmentName,
      };
      let targetId = editId;
      let number = detail?.number;
      if (editId) {
        await updateDraft({
          ...payload,
          voucherId: editId as Id<"paymentVouchers">,
        });
      } else {
        const created = await createVoucher(payload);
        targetId = created.voucherId as string;
        number = created.number;
      }
      if (intent === "post" && targetId) {
        const posted = await postVoucher({
          businessId,
          voucherId: targetId as Id<"paymentVouchers">,
        });
        toast.success(
          `پرداخت ${number} تأیید شد؛ سند ${posted.accountingNumber} ثبت گردید.`,
        );
      } else {
        toast.success(`پیش‌نویس پرداخت ${number} ذخیره شد.`);
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
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HandCoins className="size-4 text-destructive" />
            {editId ? "ویرایش پیش‌نویس پرداخت" : "ثبت پرداخت وجه"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            پرداخت با چک از این فرم انجام نمی‌شود؛ برای چاپ و پیگیری وضعیت از
            ماژول «چک‌های پرداختی» استفاده کنید.
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
                <Label className="text-[10px]">تاریخ پرداخت *</Label>
                <Input
                  type="date"
                  value={occurredDate}
                  onChange={(event) => setOccurredDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[10px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">نوع پرداخت‌شونده</Label>
                <Select
                  value={partyType}
                  onValueChange={(value) =>
                    setPartyType(value as "supplier" | "other")
                  }
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="other">سایر / عمومی</SelectItem>
                    <SelectItem value="supplier">تأمین‌کننده</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">پرداخت به *</Label>
                <Input
                  value={partyName}
                  onChange={(event) => setPartyName(event.target.value)}
                  placeholder="نام دریافت‌کننده"
                  className="h-9 rounded-xl text-[10px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">مبلغ پرداخت *</Label>
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
                <Label className="text-[10px]">روش پرداخت *</Label>
                <Select
                  value={method}
                  onValueChange={(value) => setMethod(value as FinanceMethod)}
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {PAYMENT_METHODS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {FINANCE_METHOD_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DestinationSelect
                banks={activeBanks}
                funds={activeFunds}
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
              <div className="rounded-xl border border-hairline/60 bg-background/60 px-3 py-2">
                <p className="text-[8px] text-ink-soft">موجودی فعلی مبدأ</p>
                <p
                  className={cn(
                    "num mt-1 text-[12px] font-bold",
                    (sourceBalance ?? 0) >= parseAmount(amount)
                      ? "text-brand"
                      : "text-destructive",
                  )}
                >
                  {sourceBalance === undefined
                    ? "—"
                    : formatMoney(sourceBalance, currency)}
                </p>
              </div>
            </div>
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
                onClick={() => void submit("post")}
                className="rounded-xl"
              >
                {saving === "post" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                ثبت و تأیید پرداخت
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDetailDialog({
  businessId,
  voucherId,
  currency,
  canWrite,
  onClose,
  onEdit,
  onPost,
  onDelete,
}: {
  businessId?: Id<"businesses">;
  voucherId: string | null;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onPost: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const detail = useQuery(
    api.paymentVouchers.get,
    businessId && voucherId
      ? { businessId, voucherId: voucherId as Id<"paymentVouchers"> }
      : "skip",
  );
  return (
    <Dialog open={Boolean(voucherId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HandCoins className="size-4 text-brand" />
            رسید پرداخت
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
              kind="پرداخت وجه"
              number={detail.number}
              date={detail.occurredAt}
              party={detail.partyName}
              amount={detail.amount}
              method={FINANCE_METHOD_LABELS[detail.method]}
              account={detail.sourceName}
              description={detail.description}
              status={detail.status}
              trackingNumber={detail.trackingNumber}
              accountingNumber={detail.accountingNumber}
              currency={currency}
            >
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[9px] text-ink-soft">
                <span>ثبت‌کننده: {detail.createdByName}</span>
                {detail.expenseId ? <span>مرتبط با هزینه</span> : null}
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
                onClick={() => printAccountingView(`رسید پرداخت ${detail.number}`)}
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
                    تأیید پرداخت
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

export default function PaymentVouchers() {
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
  const postVoucher = useMutation(api.paymentVouchers.post);
  const removeDraft = useMutation(api.paymentVouchers.removeDraft);

  const rows = useQuery(
    api.paymentVouchers.list,
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
        const result = await postVoucher({
          businessId,
          voucherId: pending.id as Id<"paymentVouchers">,
        });
        toast.success(
          `پرداخت ${pending.number} تأیید شد؛ سند ${result.accountingNumber} ثبت گردید.`,
        );
      } else {
        await removeDraft({
          businessId,
          voucherId: pending.id as Id<"paymentVouchers">,
        });
        toast.success(`پیش‌نویس ${pending.number} حذف شد.`);
      }
      setPending(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const posted = rows?.filter((row) => row.status === "posted") ?? [];
  const totalPosted = posted.reduce((sum, row) => sum + row.amount, 0);
  const totalBank = posted
    .filter((row) => row.sourceType === "bank")
    .reduce((sum, row) => sum + row.amount, 0);
  const drafts = rows?.filter((row) => row.status === "draft").length ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · پرداخت وجه"
        title="پرداخت‌ها"
        description="ثبت پرداخت نقدی، کارت‌خوان و انتقال بانکی با پیوست مدرک، چاپ رسید و سند حسابداری خودکار."
        actions={
          canWrite ? (
            <Button
              onClick={openCreate}
              size="sm"
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              ثبت پرداخت جدید
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
            <span className="text-[10px] text-ink-soft">جمع پرداخت‌های تأییدشده</span>
            <HandCoins className="size-4 text-destructive" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-destructive">
            {formatMoney(totalPosted, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {posted.length} فقره در نتیجه فیلتر
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">پرداخت از بانک</span>
            <Landmark className="size-4 text-[#245c5c] dark:text-[#a9d5e2]" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-[#245c5c] dark:text-[#a9d5e2]">
            {formatMoney(totalBank, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            کارت‌خوان و انتقال بانکی
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">پیش‌نویس‌های در انتظار</span>
            <FileClock className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">{drafts}</p>
          <p className="mt-1 text-[8px] text-ink-soft">
            بدون اثر روی موجودی تا تأیید
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
              {PAYMENT_METHODS.map((key) => (
                <SelectItem key={key} value={key}>
                  {FINANCE_METHOD_LABELS[key]}
                </SelectItem>
              ))}
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
            icon={<Banknote className="size-5" />}
            title="پرداختی یافت نشد"
            description={
              canWrite
                ? "اولین پرداخت را ثبت کنید؛ پیش‌نویس تا زمان تأیید روی موجودی اثر ندارد."
                : "با تغییر فیلترها دوباره جستجو کنید."
            }
            action={
              canWrite ? (
                <Button onClick={openCreate} className="rounded-xl">
                  <Plus className="size-4" />
                  ثبت پرداخت
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
                  <TableHead>پرداخت به</TableHead>
                  <TableHead>روش</TableHead>
                  <TableHead>حساب مبدأ</TableHead>
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
                        {row.sourceType === "bank" ? (
                          <Landmark className="size-3" />
                        ) : (
                          <Wallet className="size-3" />
                        )}
                        {row.sourceName}
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
                        {row.expenseId ? (
                          <span className="text-[7px] text-ink-soft">
                            مرتبط با هزینه
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

      <PaymentDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditId(null);
        }}
        businessId={businessId}
        currency={currency}
        editId={editId}
      />
      <PaymentDetailDialog
        businessId={businessId}
        voucherId={detailId}
        currency={currency}
        canWrite={canWrite}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
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
                ? "تأیید پرداخت وجه"
                : "حذف پیش‌نویس پرداخت"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[10px] leading-5">
              {pending?.type === "post"
                ? `پرداخت ${pending.number} تأیید می‌شود، موجودی کاهش می‌یابد و سند حسابداری متوازن ثبت می‌گردد.`
                : `پیش‌نویس ${pending?.number} برای همیشه حذف می‌شود.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmPending()}
              className={cn(
                "rounded-xl",
                pending?.type === "delete" &&
                  "bg-destructive hover:bg-destructive/90",
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
