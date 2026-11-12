import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import {
  DateRangeFields,
  ISSUED_CHECK_STATUS_META,
  RECEIVED_CHECK_STATUS_META,
  StatusPill,
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
import type {
  IssuedCheckStatus,
  ReceivedCheckStatus,
} from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  ChevronLeft,
  Clock3,
  History,
  Landmark,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

type TabKey = "received" | "issued";

interface ReceivedRow {
  _id: string;
  checkNumber: string;
  amount: number;
  issueDate: number;
  dueDate: number;
  bankName: string;
  bankBranch: string | null;
  issuerName: string;
  customerId: string | null;
  customerName: string | null;
  description: string | null;
  status: ReceivedCheckStatus;
  accountingDocumentId: string | null;
  lastAccountingDocumentId: string | null;
  daysToDue: number;
  overdue: boolean;
  dueSoon: boolean;
  createdAt: number;
}

interface IssuedRow {
  _id: string;
  checkNumber: string;
  amount: number;
  payeeName: string;
  issueDate: number;
  dueDate: number;
  bankAccountId: string;
  bankName: string;
  status: IssuedCheckStatus;
  description: string | null;
  accountingDocumentId: string | null;
  lastAccountingDocumentId: string | null;
  daysToDue: number;
  overdue: boolean;
  dueSoon: boolean;
  createdAt: number;
}

const RECEIVED_TRANSITIONS: Record<ReceivedCheckStatus, ReceivedCheckStatus[]> = {
  received: ["pending", "assigned", "collected", "bounced", "cancelled"],
  pending: ["assigned", "collected", "bounced", "cancelled"],
  assigned: ["collected", "bounced", "cancelled"],
  collected: [],
  bounced: [],
  cancelled: [],
};

const ISSUED_TRANSITIONS: Record<IssuedCheckStatus, IssuedCheckStatus[]> = {
  issued: ["delivered", "collected", "cancelled", "bounced"],
  delivered: ["collected", "cancelled", "bounced"],
  collected: [],
  cancelled: [],
  bounced: [],
};

function parseDate(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function defaultDueDate() {
  return isoDateValue(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function ReceivedDialog({
  open,
  onOpenChange,
  businessId,
  customers,
  check,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  customers: { _id: string; name: string }[];
  check: ReceivedRow | null;
}) {
  const createReceived = useMutation(api.checks.createReceived);
  const updateReceived = useMutation(api.checks.updateReceived);
  const [customerId, setCustomerId] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [issueDate, setIssueDate] = useState(() => isoDateValue(Date.now()));
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(check?.customerId ?? "");
    setCheckNumber(check?.checkNumber ?? "");
    setAmount(check ? String(check.amount) : "");
    setIssueDate(isoDateValue(check?.issueDate ?? Date.now()));
    setDueDate(isoDateValue(check?.dueDate ?? Date.now() + 30 * 86400000));
    setBankName(check?.bankName ?? "");
    setBankBranch(check?.bankBranch ?? "");
    setIssuerName(check?.issuerName ?? "");
    setDescription(check?.description ?? "");
  }, [open, check]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (!check && !customerId) {
      toast.error("مشتری مرتبط را انتخاب کنید.");
      return;
    }
    if (!checkNumber.trim() || !bankName.trim() || !issuerName.trim()) {
      toast.error("شماره چک، بانک و صادرکننده الزامی است.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ چک معتبر نیست.");
      return;
    }
    if (parseDate(dueDate) < parseDate(issueDate)) {
      toast.error("تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد.");
      return;
    }
    setSaving(true);
    try {
      if (check) {
        await updateReceived({
          businessId,
          checkId: check._id as Id<"receivedChecks">,
          checkNumber: checkNumber.trim(),
          issueDate: parseDate(issueDate),
          dueDate: parseDate(dueDate),
          bankName: bankName.trim(),
          bankBranch: bankBranch.trim() || undefined,
          issuerName: issuerName.trim(),
          description: description.trim() || undefined,
        });
        toast.success("اطلاعات چک دریافتی به‌روزرسانی شد.");
      } else {
        await createReceived({
          businessId,
          customerId: customerId as Id<"customers">,
          checkNumber: checkNumber.trim(),
          amount: amountValue,
          issueDate: parseDate(issueDate),
          dueDate: parseDate(dueDate),
          bankName: bankName.trim(),
          bankBranch: bankBranch.trim() || undefined,
          issuerName: issuerName.trim() || undefined,
          description: description.trim() || undefined,
        });
        toast.success("چک دریافتی ثبت شد.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Banknote className="size-4 text-brand" />
            {check ? "ویرایش چک دریافتی" : "ثبت چک دریافتی"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            ثبت چک، آن را در حساب «چک‌های دریافتنی» نگه می‌دارد؛ وصول یا برگشت
            از طریق تغییر وضعیت با سند خودکار ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">مشتری مرتبط *</Label>
              {check ? (
                <div className="flex h-9 items-center rounded-xl border border-hairline bg-muted/40 px-3 text-[10px]">
                  {check.customerName ?? "—"}
                </div>
              ) : (
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue placeholder="انتخاب مشتری" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {customers.map((customer) => (
                      <SelectItem key={customer._id} value={customer._id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره چک *</Label>
              <Input
                value={checkNumber}
                onChange={(event) => setCheckNumber(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مبلغ چک *</Label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={Boolean(check)}
                inputMode="numeric"
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
              {check ? (
                <p className="text-[8px] text-ink-soft">
                  مبلغ چک پس از ثبت قابل ویرایش نیست.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">صادرکننده *</Label>
              <Input
                value={issuerName}
                onChange={(event) => setIssuerName(event.target.value)}
                className="h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ صدور *</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ سررسید *</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">بانک چک *</Label>
              <Input
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                className="h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شعبه بانک</Label>
              <Input
                value={bankBranch}
                onChange={(event) => setBankBranch(event.target.value)}
                className="h-9 rounded-xl text-[10px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">توضیحات</Label>
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
              {check ? "ذخیره تغییرات" : "ثبت چک"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssuedDialog({
  open,
  onOpenChange,
  businessId,
  banks,
  check,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  banks: { _id: string; name: string }[];
  check: IssuedRow | null;
}) {
  const createIssued = useMutation(api.checks.createIssued);
  const updateIssued = useMutation(api.checks.updateIssued);
  const [bankAccountId, setBankAccountId] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [issueDate, setIssueDate] = useState(() => isoDateValue(Date.now()));
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBankAccountId(check?.bankAccountId ?? banks[0]?._id ?? "");
    setCheckNumber(check?.checkNumber ?? "");
    setAmount(check ? String(check.amount) : "");
    setPayeeName(check?.payeeName ?? "");
    setIssueDate(isoDateValue(check?.issueDate ?? Date.now()));
    setDueDate(isoDateValue(check?.dueDate ?? Date.now() + 30 * 86400000));
    setDescription(check?.description ?? "");
  }, [open, check, banks]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    const amountValue = parseAmount(amount);
    if (!bankAccountId) {
      toast.error("بانک چک را انتخاب کنید.");
      return;
    }
    if (!checkNumber.trim() || !payeeName.trim()) {
      toast.error("شماره چک و ذی‌نفع الزامی است.");
      return;
    }
    if (amountValue <= 0) {
      toast.error("مبلغ چک معتبر نیست.");
      return;
    }
    if (parseDate(dueDate) < parseDate(issueDate)) {
      toast.error("تاریخ سررسید قبل از تاریخ صدور است.");
      return;
    }
    setSaving(true);
    try {
      if (check) {
        await updateIssued({
          businessId,
          checkId: check._id as Id<"issuedChecks">,
          bankAccountId: bankAccountId as Id<"bankAccounts">,
          checkNumber: checkNumber.trim(),
          issueDate: parseDate(issueDate),
          dueDate: parseDate(dueDate),
          payeeName: payeeName.trim(),
          description: description.trim() || undefined,
        });
        toast.success("اطلاعات چک پرداختی به‌روزرسانی شد.");
      } else {
        const result = await createIssued({
          businessId,
          bankAccountId: bankAccountId as Id<"bankAccounts">,
          checkNumber: checkNumber.trim(),
          amount: amountValue,
          payeeName: payeeName.trim(),
          issueDate: parseDate(issueDate),
          dueDate: parseDate(dueDate),
          description: description.trim() || undefined,
        });
        toast.success(`چک پرداختی ثبت شد؛ سند ${result.accountingNumber} ایجاد گردید.`);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4 text-gold" />
            {check ? "ویرایش چک پرداختی" : "ثبت چک پرداختی"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            با ثبت چک، بدهی به ذی‌نفع کاهش و «چک‌های پرداختنی» افزایش می‌یابد.
            وصول توسط ذی‌نفع از تغییر وضعیت ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">حساب بانکی *</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue placeholder="انتخاب بانک" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {banks.map((bank) => (
                    <SelectItem key={bank._id} value={bank._id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره چک *</Label>
              <Input
                value={checkNumber}
                onChange={(event) => setCheckNumber(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">مبلغ چک *</Label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={Boolean(check)}
                inputMode="numeric"
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">ذی‌نفع *</Label>
              <Input
                value={payeeName}
                onChange={(event) => setPayeeName(event.target.value)}
                className="h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ صدور *</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ سررسید *</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">توضیحات</Label>
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
              {check ? "ذخیره تغییرات" : "ثبت چک پرداختی"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  open,
  onOpenChange,
  businessId,
  type,
  check,
  banks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  type: TabKey;
  check: ReceivedRow | IssuedRow | null;
  banks: { _id: string; name: string }[];
}) {
  const changeReceived = useMutation(api.checks.changeReceivedStatus);
  const changeIssued = useMutation(api.checks.changeIssuedStatus);
  const [status, setStatus] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const options =
    type === "received"
      ? RECEIVED_TRANSITIONS[(check?.status as ReceivedCheckStatus) ?? "received"]
      : ISSUED_TRANSITIONS[(check?.status as IssuedCheckStatus) ?? "issued"];

  useEffect(() => {
    if (!open) return;
    setStatus("");
    setBankAccountId(banks[0]?._id ?? "");
    setNote("");
  }, [open, banks]);

  const labels =
    type === "received" ? RECEIVED_CHECK_STATUS_META : ISSUED_CHECK_STATUS_META;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !check || !status) return;
    if (type === "received" && status === "collected" && !bankAccountId) {
      toast.error("حساب بانکی مقصد وصول را انتخاب کنید.");
      return;
    }
    setSaving(true);
    try {
      const result =
        type === "received"
          ? await changeReceived({
              businessId,
              checkId: check._id as Id<"receivedChecks">,
              status: status as ReceivedCheckStatus,
              bankAccountId:
                status === "collected"
                  ? (bankAccountId as Id<"bankAccounts">)
                  : undefined,
              note: note.trim() || undefined,
            })
          : await changeIssued({
              businessId,
              checkId: check._id as Id<"issuedChecks">,
              status: status as IssuedCheckStatus,
              note: note.trim() || undefined,
            });
      toast.success(
        result.accountingNumber
          ? `وضعیت چک تغییر کرد؛ سند ${result.accountingNumber} ثبت شد.`
          : "وضعیت چک به‌روزرسانی شد.",
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
      <DialogContent className="rounded-[24px] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="size-4 text-brand" />
            تغییر وضعیت چک {check?.checkNumber}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            فقط گذارهای مجاز نمایش داده می‌شوند. وصول، برگشت و ابطال سند
            حسابداری متناظر ایجاد می‌کنند.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <div className="rounded-xl border border-hairline/60 bg-muted/30 p-4 text-center text-[10px] text-ink-soft">
            این چک در وضعیت نهایی است و تغییر وضعیت دیگری برای آن مجاز نیست.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[10px]">وضعیت جدید *</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                  <SelectValue placeholder="انتخاب وضعیت" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {options.map((value) => (
                    <SelectItem key={value} value={value}>
                      {labels[value as keyof typeof labels]?.label ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "received" && status === "collected" ? (
              <div className="space-y-1.5">
                <Label className="text-[10px]">حساب بانکی وصول *</Label>
                <Select
                  value={bankAccountId}
                  onValueChange={setBankAccountId}
                >
                  <SelectTrigger className="h-9 w-full rounded-xl text-[10px]">
                    <SelectValue placeholder="انتخاب بانک" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {banks.map((bank) => (
                      <SelectItem key={bank._id} value={bank._id}>
                        {bank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-[10px]">توضیح تغییر وضعیت</Label>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
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
              <Button
                type="submit"
                disabled={saving || !status}
                className="rounded-xl"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                ثبت تغییر وضعیت
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  open,
  onOpenChange,
  businessId,
  type,
  check,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  type: TabKey;
  check: ReceivedRow | IssuedRow | null;
}) {
  const history = useQuery(
    api.checks.history,
    open && businessId && check
      ? {
          businessId,
          checkType: type,
          checkId: check._id,
        }
      : "skip",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-brand" />
            سوابق چک {check?.checkNumber}
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            تاریخچه کامل تغییر وضعیت‌ها همراه با سند حسابداری و کاربر ثبت‌کننده.
          </DialogDescription>
        </DialogHeader>
        {!history ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<History className="size-5" />}
            title="سابقه‌ای ثبت نشده"
            description="با اولین تغییر وضعیت، تاریخچه این چک ایجاد می‌شود."
          />
        ) : (
          <div className="relative space-y-3 ps-5">
            <div className="absolute top-2 bottom-2 right-1.5 w-px bg-hairline" />
            {history.map((item) => (
              <div
                key={item._id}
                className="relative rounded-xl border border-hairline/60 bg-background/60 p-3"
              >
                <span className="absolute top-4 -right-[15px] size-2 rounded-full bg-brand ring-4 ring-background" />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-ink">
                    {item.toStatus}
                  </span>
                  <span className="num text-[8px] text-ink-soft">
                    {formatJalali(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-[8px] text-ink-soft">
                  ثبت‌کننده: {item.actorName}
                </p>
                {item.note ? (
                  <p className="mt-1 text-[9px] leading-5">{item.note}</p>
                ) : null}
                {item.accountingDocumentId ? (
                  <p className="mt-1 text-[8px] text-brand">
                    سند حسابداری ثبت شده است
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Checks() {
  const { businessId, branchId, currency, canWrite } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(
    searchParams.get("tab") === "issued" ? "issued" : "received",
  );
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dueFilter = searchParams.get("due") === "soon";
  const [formOpen, setFormOpen] = useState(false);
  const [editingReceived, setEditingReceived] = useState<ReceivedRow | null>(
    null,
  );
  const [editingIssued, setEditingIssued] = useState<IssuedRow | null>(null);
  const [statusCheck, setStatusCheck] = useState<
    ReceivedRow | IssuedRow | null
  >(null);
  const [historyCheck, setHistoryCheck] = useState<
    ReceivedRow | IssuedRow | null
  >(null);

  const options = useQuery(
    api.checks.options,
    businessId ? { businessId } : "skip",
  );
  const dueSoon = useQuery(
    api.checks.dueSoon,
    businessId ? { businessId, days: 30 } : "skip",
  );

  const receivedData = useQuery(
    api.checks.receivedList,
    businessId
      ? {
          businessId,
          branchId,
          status:
            tab === "received" && status !== "all"
              ? (status as ReceivedCheckStatus)
              : undefined,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );
  const issuedData = useQuery(
    api.checks.issuedList,
    businessId
      ? {
          businessId,
          branchId,
          status:
            tab === "issued" && status !== "all"
              ? (status as IssuedCheckStatus)
              : undefined,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );

  const switchTab = (next: TabKey) => {
    setTab(next);
    setStatus("all");
    setSearch("");
  };

  const openCreate = () => {
    setEditingReceived(null);
    setEditingIssued(null);
    setFormOpen(true);
  };

  const receivedRows = (receivedData ?? []).filter(
    (row) => !dueFilter || row.dueSoon || row.overdue,
  );
  const issuedRows = (issuedData ?? []).filter(
    (row) => !dueFilter || row.dueSoon || row.overdue,
  );
  const activeRows = tab === "received" ? receivedRows : issuedRows;
  const activeOpen = activeRows.filter((row) =>
    tab === "received"
      ? !["collected", "bounced", "cancelled"].includes(row.status)
      : !["collected", "bounced", "cancelled"].includes(row.status),
  );
  const openAmount = activeOpen.reduce((sum, row) => sum + row.amount, 0);
  const overdueCount = activeRows.filter((row) => row.overdue).length;
  const dueCount = (dueSoon ?? []).length;

  const statusOptions =
    tab === "received"
      ? (Object.keys(RECEIVED_CHECK_STATUS_META) as ReceivedCheckStatus[])
      : (Object.keys(ISSUED_CHECK_STATUS_META) as IssuedCheckStatus[]);
  const statusMeta =
    tab === "received" ? RECEIVED_CHECK_STATUS_META : ISSUED_CHECK_STATUS_META;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · چک‌ها"
        title="مدیریت چک‌های دریافتی و پرداختی"
        description="چرخه کامل چک با وضعیت‌های مجاز، سوابق تغییر، هشدار سررسید و اسناد حسابداری متناظر."
        actions={
          canWrite ? (
            <Button
              onClick={openCreate}
              size="sm"
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              <Plus className="size-4" />
              {tab === "received" ? "ثبت چک دریافتی" : "ثبت چک پرداختی"}
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-card/60 px-3 py-1.5 text-[9px] text-ink-soft">
              <LockKeyhole className="size-3.5" />
              دسترسی مشاهده
            </span>
          )
        }
      />

      {dueCount > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[9px] leading-5 text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {dueCount} چک در ۳۰ روز آینده سررسید می‌شود؛ برای جلوگیری از برگشت،
          وضعیت و موجودی حساب را بررسی کنید.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-hairline/60 bg-card/60 p-1.5">
        {[
          {
            key: "received" as const,
            label: "چک‌های دریافتی",
            count: receivedData?.length,
          },
          {
            key: "issued" as const,
            label: "چک‌های پرداختی",
            count: issuedData?.length,
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
            <span className="text-[10px] text-ink-soft">مبلغ چک‌های باز</span>
            <Clock3 className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">
            {formatMoney(openAmount, currency)}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            {activeOpen.length} فقره در جریان
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">سررسید گذشته</span>
            <ShieldAlert className="size-4 text-destructive" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-destructive">
            {overdueCount}
          </p>
          <p className="mt-1 text-[8px] text-ink-soft">
            نیازمند پیگیری فوری
          </p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-soft">نزدیک سررسید</span>
            <AlertTriangle className="size-4 text-gold" />
          </div>
          <p className="num mt-3 text-[19px] font-black text-gold">{dueCount}</p>
          <p className="mt-1 text-[8px] text-ink-soft">
            هر دو نوع چک تا ۳۰ روز آینده
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
              placeholder="جستجوی شماره چک، بانک، صادرکننده یا ذی‌نفع…"
              className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[130px] rounded-lg text-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">همه وضعیت‌ها</SelectItem>
              {statusOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusMeta[value as keyof typeof statusMeta]?.label ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-full sm:w-auto">
            <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>
          {dueFilter ? (
            <span className="rounded-full border border-destructive/25 bg-destructive/5 px-2 py-1 text-[8px] text-destructive">
              فیلتر نزدیک سررسید
            </span>
          ) : null}
          {(from || to || search || status !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
                setSearch("");
                setStatus("all");
              }}
              className="h-8 rounded-lg text-[9px]"
            >
              پاک‌کردن فیلترها
            </Button>
          )}
        </div>

        {tab === "received" ? (
          !receivedData ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : receivedRows.length === 0 ? (
            <EmptyState
              icon={<Banknote className="size-5" />}
              title="چک دریافتی یافت نشد"
              description="چک دریافتی را ثبت کنید یا فیلترها را تغییر دهید."
              action={
                canWrite ? (
                  <Button onClick={openCreate} className="rounded-xl">
                    <Plus className="size-4" />
                    ثبت چک دریافتی
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>شماره چک</TableHead>
                    <TableHead>مشتری / صادرکننده</TableHead>
                    <TableHead>بانک</TableHead>
                    <TableHead>سررسید</TableHead>
                    <TableHead className="text-end">مبلغ</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-[170px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivedRows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="num text-[9px] font-bold text-brand">
                        {row.checkNumber}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate text-[9px]">
                        <p className="font-medium">
                          {row.customerName ?? row.issuerName}
                        </p>
                        <p className="text-[8px] text-ink-soft">{row.issuerName}</p>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-[8px] text-ink-soft">
                        {row.bankName}
                        {row.bankBranch ? ` · ${row.bankBranch}` : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="num text-[9px]">{formatJalali(row.dueDate)}</p>
                        {row.overdue ? (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[7px] text-destructive">
                            <AlertTriangle className="size-2.5" />
                            گذشته
                          </span>
                        ) : row.dueSoon ? (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[7px] text-gold">
                            <Clock3 className="size-2.5" />
                            {row.daysToDue} روز
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="num text-end text-[10px] font-bold">
                        {formatMoney(row.amount, currency)}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          label={RECEIVED_CHECK_STATUS_META[row.status].label}
                          className={RECEIVED_CHECK_STATUS_META[row.status].className}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setHistoryCheck(row)}
                            className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                          >
                            <History className="size-3" />
                            سوابق
                          </Button>
                          {canWrite ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingReceived(row);
                                  setEditingIssued(null);
                                  setFormOpen(true);
                                }}
                                className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                              >
                                <Pencil className="size-3" />
                                ویرایش
                              </Button>
                              {RECEIVED_TRANSITIONS[row.status].length > 0 ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setStatusCheck(row)}
                                  className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                                >
                                  <ChevronLeft className="size-3" />
                                  وضعیت
                                </Button>
                              ) : null}
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
        ) : !issuedData ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : issuedRows.length === 0 ? (
          <EmptyState
            icon={<Landmark className="size-5" />}
            title="چک پرداختی یافت نشد"
            description="چک پرداختی را با بانک، ذی‌نفع و سررسید ثبت کنید."
            action={
              canWrite ? (
                <Button onClick={openCreate} className="rounded-xl">
                  <Plus className="size-4" />
                  ثبت چک پرداختی
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>شماره چک</TableHead>
                  <TableHead>ذی‌نفع</TableHead>
                  <TableHead>بانک</TableHead>
                  <TableHead>سررسید</TableHead>
                  <TableHead className="text-end">مبلغ</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="w-[170px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {issuedRows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="num text-[9px] font-bold text-brand">
                      {row.checkNumber}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-[9px] font-medium">
                      {row.payeeName}
                    </TableCell>
                    <TableCell className="max-w-[130px] truncate text-[8px] text-ink-soft">
                      {row.bankName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="num text-[9px]">{formatJalali(row.dueDate)}</p>
                      {row.overdue ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[7px] text-destructive">
                          <AlertTriangle className="size-2.5" />
                          گذشته
                        </span>
                      ) : row.dueSoon ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[7px] text-gold">
                          <Clock3 className="size-2.5" />
                          {row.daysToDue} روز
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="num text-end text-[10px] font-bold">
                      {formatMoney(row.amount, currency)}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        label={ISSUED_CHECK_STATUS_META[row.status].label}
                        className={ISSUED_CHECK_STATUS_META[row.status].className}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setHistoryCheck(row)}
                          className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                        >
                          <History className="size-3" />
                          سوابق
                        </Button>
                        {canWrite ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingIssued(row);
                                setEditingReceived(null);
                                setFormOpen(true);
                              }}
                              className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                            >
                              <Pencil className="size-3" />
                              ویرایش
                            </Button>
                            {ISSUED_TRANSITIONS[row.status].length > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setStatusCheck(row)}
                                className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                              >
                                <ChevronLeft className="size-3" />
                                وضعیت
                              </Button>
                            ) : null}
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

      <ReceivedDialog
        open={formOpen && tab === "received"}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingReceived(null);
        }}
        businessId={businessId}
        customers={options?.customers ?? []}
        check={editingReceived}
      />
      <IssuedDialog
        open={formOpen && tab === "issued"}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingIssued(null);
        }}
        businessId={businessId}
        banks={options?.banks ?? []}
        check={editingIssued}
      />
      <StatusDialog
        open={Boolean(statusCheck)}
        onOpenChange={(open) => {
          if (!open) setStatusCheck(null);
        }}
        businessId={businessId}
        type={tab}
        check={statusCheck}
        banks={options?.banks ?? []}
      />
      <HistoryDialog
        open={Boolean(historyCheck)}
        onOpenChange={(open) => {
          if (!open) setHistoryCheck(null);
        }}
        businessId={businessId}
        type={tab}
        check={historyCheck}
      />

    </div>
  );
}
