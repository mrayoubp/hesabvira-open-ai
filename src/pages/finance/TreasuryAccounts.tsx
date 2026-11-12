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
import type { Id } from "@/convex/_generated/dataModel";
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
  Banknote,
  CalendarCheck2,
  Eye,
  EyeOff,
  Landmark,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface BankRow {
  _id: string;
  name: string;
  bankName: string;
  accountNumber: string;
  iban: string | null;
  holderName: string;
  bankBranch: string | null;
  branchId: string | null;
  notes: string | null;
  active: boolean;
  accountId: string;
  balance: number;
  canViewSensitive: boolean;
  createdAt: number;
}

interface FundRow {
  _id: string;
  name: string;
  responsibleName: string | null;
  branchId: string | null;
  notes: string | null;
  active: boolean;
  accountId: string;
  balance: number;
  createdAt: number;
}

type TabKey = "bank" | "cash" | "closings";

function parseDate(value: string) {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function BankDialog({
  open,
  onOpenChange,
  businessId,
  bank,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  bank: BankRow | null;
  onSaved: () => void;
}) {
  const createBank = useMutation(api.treasury.createBank);
  const updateBank = useMutation(api.treasury.updateBank);
  const { branches } = useWorkspace();
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [iban, setIban] = useState("");
  const [holderName, setHolderName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [branchId, setBranchId] = useState("none");
  const [notes, setNotes] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(bank?.name ?? "");
    setBankName(bank?.bankName ?? "");
    setAccountNumber(bank?.accountNumber ?? "");
    setIban(bank?.iban ?? "");
    setHolderName(bank?.holderName ?? "");
    setBankBranch(bank?.bankBranch ?? "");
    setBranchId(bank?.branchId ?? "none");
    setNotes(bank?.notes ?? "");
    setOpeningBalance("");
    setOpeningDate(isoDateValue(Date.now()));
  }, [open, bank]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    if (
      !name.trim() ||
      !bankName.trim() ||
      !accountNumber.trim() ||
      !holderName.trim()
    ) {
      toast.error("نام حساب، نام بانک، شماره حساب و صاحب حساب الزامی است.");
      return;
    }
    const opening = parseAmount(openingBalance);
    if (!bank && openingBalance && opening <= 0) {
      toast.error("موجودی اولیه معتبر نیست.");
      return;
    }
    setSaving(true);
    try {
      if (bank) {
        await updateBank({
          businessId,
          bankAccountId: bank._id as Id<"bankAccounts">,
          name: name.trim(),
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          iban: iban.trim() || undefined,
          holderName: holderName.trim(),
          bankBranch: bankBranch.trim() || undefined,
          branchId: branchId === "none" ? null : (branchId as Id<"branches">),
          notes: notes.trim() || undefined,
        });
        toast.success("اطلاعات حساب بانکی به‌روزرسانی شد.");
      } else {
        await createBank({
          businessId,
          name: name.trim(),
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          iban: iban.trim() || undefined,
          holderName: holderName.trim(),
          bankBranch: bankBranch.trim() || undefined,
          branchId: branchId === "none" ? undefined : (branchId as Id<"branches">),
          notes: notes.trim() || undefined,
          openingBalance: opening > 0 ? opening : undefined,
          openingDate: parseDate(openingDate),
        });
        toast.success("حساب بانکی ایجاد و به کدینگ حسابداری متصل شد.");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            {bank ? "ویرایش حساب بانکی" : "افزودن حساب بانکی"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            هر حساب بانکی یک حساب تفصیلی زیر «موجودی نزد بانک‌ها» دریافت می‌کند.
            موجودی اولیه با سند متوازن ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">نام حساب *</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="مثلاً حساب جاری اصلی"
                className="h-9 rounded-xl text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">نام بانک *</Label>
              <Input
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                placeholder="مثلاً بانک ملت"
                className="h-9 rounded-xl text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره حساب *</Label>
              <Input
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شماره شبا</Label>
              <Input
                value={iban}
                onChange={(event) => setIban(event.target.value)}
                placeholder="IR..."
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">نام صاحب حساب *</Label>
              <Input
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                className="h-9 rounded-xl text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شعبه بانک</Label>
              <Input
                value={bankBranch}
                onChange={(event) => setBankBranch(event.target.value)}
                className="h-9 rounded-xl text-[11px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">شعبه کسب‌وکار</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">بدون شعبه</SelectItem>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!bank ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[10px]">موجودی اولیه</Label>
                  <Input
                    value={openingBalance}
                    onChange={(event) => setOpeningBalance(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    className="num h-9 rounded-xl text-left text-[11px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px]">تاریخ موجودی اولیه</Label>
                  <Input
                    type="date"
                    value={openingDate}
                    onChange={(event) => setOpeningDate(event.target.value)}
                    dir="ltr"
                    className="num h-9 rounded-xl text-[11px]"
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">توضیحات</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
              {bank ? "ذخیره تغییرات" : "ایجاد حساب"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FundDialog({
  open,
  onOpenChange,
  businessId,
  fund,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  fund: FundRow | null;
  onSaved: () => void;
}) {
  const createFund = useMutation(api.treasury.createFund);
  const updateFund = useMutation(api.treasury.updateFund);
  const { branches } = useWorkspace();
  const [name, setName] = useState("");
  const [responsibleName, setResponsibleName] = useState("");
  const [branchId, setBranchId] = useState("none");
  const [notes, setNotes] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(fund?.name ?? "");
    setResponsibleName(fund?.responsibleName ?? "");
    setBranchId(fund?.branchId ?? "none");
    setNotes(fund?.notes ?? "");
    setOpeningBalance("");
    setOpeningDate(isoDateValue(Date.now()));
  }, [open, fund]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    if (!name.trim()) {
      toast.error("نام صندوق الزامی است.");
      return;
    }
    const opening = parseAmount(openingBalance);
    setSaving(true);
    try {
      if (fund) {
        await updateFund({
          businessId,
          cashFundId: fund._id as Id<"cashFunds">,
          name: name.trim(),
          responsibleName: responsibleName.trim() || undefined,
          branchId: branchId === "none" ? null : (branchId as Id<"branches">),
          notes: notes.trim() || undefined,
        });
        toast.success("اطلاعات صندوق به‌روزرسانی شد.");
      } else {
        await createFund({
          businessId,
          name: name.trim(),
          responsibleName: responsibleName.trim() || undefined,
          branchId: branchId === "none" ? undefined : (branchId as Id<"branches">),
          notes: notes.trim() || undefined,
          openingBalance: opening > 0 ? opening : undefined,
          openingDate: parseDate(openingDate),
        });
        toast.success("صندوق ایجاد و به کدینگ حسابداری متصل شد.");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            {fund ? "ویرایش صندوق" : "ایجاد صندوق"}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            برای هر صندوق حساب تفصیلی مستقل ساخته می‌شود تا گردش آن قابل
            پیگیری باشد.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px]">نام صندوق *</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثلاً صندوق فروش شعبه مرکزی"
              className="h-9 rounded-xl text-[11px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">مسئول صندوق</Label>
            <Input
              value={responsibleName}
              onChange={(event) => setResponsibleName(event.target.value)}
              className="h-9 rounded-xl text-[11px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">شعبه کسب‌وکار</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">بدون شعبه</SelectItem>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!fund ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">موجودی اولیه</Label>
                <Input
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="0"
                  className="num h-9 rounded-xl text-left text-[11px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">تاریخ موجودی اولیه</Label>
                <Input
                  type="date"
                  value={openingDate}
                  onChange={(event) => setOpeningDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[11px]"
                />
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label className="text-[10px]">توضیحات</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
              {fund ? "ذخیره تغییرات" : "ایجاد صندوق"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LedgerDialog({
  open,
  onOpenChange,
  businessId,
  target,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  target: { id: string; name: string; type: "bank" | "cash" } | null;
  currency: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ledger = useQuery(
    api.treasury.ledger,
    open && businessId && target
      ? {
          businessId,
          accountType: target.type,
          accountRefId: target.id,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          limit: 500,
        }
      : "skip",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {target?.type === "bank" ? (
              <Landmark className="size-4 text-brand" />
            ) : (
              <Wallet className="size-4 text-gold" />
            )}
            گردش {target?.name}
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            گردش واقعی تراکنش‌ها با مانده تجمعی؛ سند حسابداری هر ردیف قابل
            پیگیری است.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[9px] text-ink-soft">
            از
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              dir="ltr"
              className="num h-8 w-32 rounded-lg text-[9px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[9px] text-ink-soft">
            تا
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              dir="ltr"
              className="num h-8 w-32 rounded-lg text-[9px]"
            />
          </label>
          {(from || to) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="h-7 gap-1 rounded-lg px-2 text-[9px]"
            >
              <X className="size-3" />
              حذف فیلتر
            </Button>
          )}
          {ledger ? (
            <span className="ms-auto flex items-center gap-2 text-[9px] text-ink-soft">
              مانده پایان:
              <strong className="num text-[11px] text-brand">
                {formatMoney(ledger.closingBalance, currency)}
              </strong>
            </span>
          ) : null}
        </div>
        {!ledger ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : ledger.rows.length === 0 ? (
          <EmptyState
            icon={<Banknote className="size-5" />}
            title="گردشی در این بازه وجود ندارد"
            description="با ثبت دریافت، پرداخت یا انتقال، تراکنش‌های این حساب نمایش داده می‌شوند."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>شرح</TableHead>
                  <TableHead className="text-end">ورودی</TableHead>
                  <TableHead className="text-end">خروجی</TableHead>
                  <TableHead className="text-end">مانده</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                      {formatJalali(row.occurredAt)}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-[9px]">
                      {row.description}
                    </TableCell>
                    <TableCell className="num text-end text-[9px] text-brand">
                      {row.direction === "in"
                        ? formatMoney(row.amount, currency)
                        : "—"}
                    </TableCell>
                    <TableCell className="num text-end text-[9px] text-destructive">
                      {row.direction === "out"
                        ? formatMoney(row.amount, currency)
                        : "—"}
                    </TableCell>
                    <TableCell className="num text-end text-[10px] font-bold">
                      {formatMoney(row.balance, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {ledger?.truncated ? (
          <p className="text-[8px] text-ink-soft">
            بیش از ۵۰۰ ردیف وجود دارد؛ بازه را محدودتر کنید.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CloseFundDialog({
  open,
  onOpenChange,
  businessId,
  fund,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  fund: FundRow | null;
  currency: string;
  onSaved: () => void;
}) {
  const closeFundDay = useMutation(api.treasury.closeFundDay);
  const [closeDate, setCloseDate] = useState(() => isoDateValue(Date.now()));
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const countedValue = parseAmount(counted);
  const expected = fund?.balance ?? 0;
  const difference = counted === "" ? 0 : countedValue - expected;

  useEffect(() => {
    if (!open) return;
    setCloseDate(isoDateValue(Date.now()));
    setCounted("");
    setNote("");
  }, [open]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !fund) return;
    if (counted === "") {
      toast.error("موجودی شمارش‌شده را وارد کنید.");
      return;
    }
    setSaving(true);
    try {
      const result = await closeFundDay({
        businessId,
        cashFundId: fund._id as Id<"cashFunds">,
        closeDate: parseDate(closeDate),
        countedBalance: countedValue,
        note: note.trim() || undefined,
      });
      toast.success(
        `صندوق بسته شد؛ اختلاف شمارش ${formatMoney(result.difference, currency)}`,
      );
      onOpenChange(false);
      onSaved();
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
            <CalendarCheck2 className="size-4 text-gold" />
            بستن روز صندوق {fund?.name}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-5">
            موجودی محاسباتی از تراکنش‌های ثبت‌شده تا پایان روز محاسبه می‌شود.
            اختلاف با موجودی شمارش‌شده ثبت و برای پیگیری نگه داشته می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-brand/15 bg-brand-soft/40 p-3">
              <p className="text-[8px] text-ink-soft">موجودی محاسباتی</p>
              <p className="num mt-1 text-[13px] font-bold text-brand">
                {formatMoney(expected, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-gold/25 bg-gold-soft/40 p-3">
              <p className="text-[8px] text-ink-soft">اختلاف شمارش</p>
              <p
                className={cn(
                  "num mt-1 text-[13px] font-bold",
                  difference === 0
                    ? "text-ink"
                    : difference > 0
                      ? "text-brand"
                      : "text-destructive",
                )}
              >
                {formatMoney(difference, currency)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px]">تاریخ بستن</Label>
              <Input
                type="date"
                value={closeDate}
                onChange={(event) => setCloseDate(event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[10px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">موجودی شمارش‌شده *</Label>
              <Input
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="num h-9 rounded-xl text-left text-[10px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">توضیحات</Label>
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
              disabled={saving || counted === ""}
              className="rounded-xl"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              ثبت بستن روز
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TreasuryAccounts() {
  const { businessId, currency, canWrite, branches } = useWorkspace();
  const banks = useQuery(
    api.treasury.banks,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const funds = useQuery(
    api.treasury.funds,
    businessId ? { businessId, includeInactive: true } : "skip",
  );
  const closings = useQuery(
    api.treasury.fundClosings,
    businessId ? { businessId } : "skip",
  );
  const setBankActive = useMutation(api.treasury.setBankActive);
  const setFundActive = useMutation(api.treasury.setFundActive);
  const [tab, setTab] = useState<TabKey>("bank");
  const [bankDialog, setBankDialog] = useState(false);
  const [editingBank, setEditingBank] = useState<BankRow | null>(null);
  const [fundDialog, setFundDialog] = useState(false);
  const [editingFund, setEditingFund] = useState<FundRow | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<{
    id: string;
    name: string;
    type: "bank" | "cash";
  } | null>(null);
  const [closingFund, setClosingFund] = useState<FundRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleBank = async (bank: BankRow) => {
    if (!businessId) return;
    setBusyId(bank._id);
    try {
      await setBankActive({
        businessId,
        bankAccountId: bank._id as Id<"bankAccounts">,
        active: !bank.active,
      });
      toast.success(bank.active ? "حساب غیرفعال شد." : "حساب فعال شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const toggleFund = async (fund: FundRow) => {
    if (!businessId) return;
    setBusyId(fund._id);
    try {
      await setFundActive({
        businessId,
        cashFundId: fund._id as Id<"cashFunds">,
        active: !fund.active,
      });
      toast.success(fund.active ? "صندوق غیرفعال شد." : "صندوق فعال شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const sensitiveVisible = banks?.some((bank) => bank.canViewSensitive) ?? true;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="مالی · بانک و صندوق"
        title="بانک و صندوق"
        description="حساب‌های بانکی و صندوق‌ها با موجودی محاسبه‌شده از تراکنش‌ها؛ هر حساب به یک حساب تفصیلی در دفتر کل متصل است."
        actions={
          canWrite ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingFund(null);
                  setFundDialog(true);
                }}
                className="h-9 gap-1.5 px-3.5"
              >
                <Wallet className="size-4" />
                ایجاد صندوق
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingBank(null);
                  setBankDialog(true);
                }}
                className="h-9 gap-1.5 rounded-xl px-3.5"
              >
                <Plus className="size-4" />
                افزودن حساب بانکی
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline/60 bg-card/60 px-3 py-1.5 text-[9px] text-ink-soft">
              <LockKeyhole className="size-3.5" />
              دسترسی مشاهده
            </span>
          )
        }
      />

      {!sensitiveVisible ? (
        <div className="flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/40 px-3 py-2 text-[9px] leading-5 text-[#7a6122] dark:text-gold">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" />
          شماره حساب، شبا و نام صاحب حساب برای نقش شما ماسک شده است. عملیات
          حساس فقط با نقش‌های مجاز انجام می‌شود.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-brand/15 bg-brand-soft/30 px-3 py-2 text-[9px] text-ink-soft">
          <ShieldCheck className="size-3.5 text-brand" />
          اطلاعات حساس حساب‌ها فقط برای اعضای مجاز نمایش داده می‌شود و در سرور
          کنترل می‌گردد.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-hairline/60 bg-card/60 p-1.5">
        {[
          { key: "bank" as const, label: "حساب‌های بانکی", count: banks?.length },
          { key: "cash" as const, label: "صندوق‌ها", count: funds?.length },
          {
            key: "closings" as const,
            label: "بستن روز صندوق",
            count: closings?.length,
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
              {item.count ?? 0}
            </span>
          </button>
        ))}
      </div>

      {tab === "bank" ? (
        !banks ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[230px] rounded-[22px]" />
            ))}
          </div>
        ) : banks.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Landmark className="size-5" />}
              title="هنوز حساب بانکی ندارید"
              description="اولین حساب بانکی را با موجودی اولیه ثبت کنید تا دریافت، پرداخت و انتقال روی آن فعال شود."
              action={
                canWrite ? (
                  <Button
                    onClick={() => {
                      setEditingBank(null);
                      setBankDialog(true);
                    }}
                    className="rounded-xl"
                  >
                    <Plus className="size-4" />
                    افزودن حساب بانکی
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {banks.map((bank) => (
              <Panel
                key={bank._id}
                className={cn(
                  "relative overflow-hidden p-4",
                  !bank.active && "opacity-70",
                )}
              >
                <div className="absolute -top-8 -left-8 size-24 rounded-full bg-mist/30 blur-2xl" />
                <div className="relative flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]">
                      <Landmark className="size-4" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold text-ink">{bank.name}</p>
                      <p className="text-[8px] text-ink-soft">{bank.bankName}{bank.branchId ? ` · ${branches.find((branch) => branch._id === bank.branchId)?.name ?? ""}` : ""}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[8px]",
                      bank.active
                        ? "border-brand/20 bg-brand-soft text-brand"
                        : "border-hairline bg-muted text-ink-soft",
                    )}
                  >
                    {bank.active ? "فعال" : "غیرفعال"}
                  </span>
                </div>

                <div className="relative mt-4 rounded-xl border border-hairline/50 bg-background/60 px-3 py-2">
                  <p className="text-[8px] text-ink-soft">موجودی محاسبه‌شده</p>
                  <p
                    className={cn(
                      "num mt-1 text-[18px] font-black",
                      bank.balance >= 0 ? "text-brand" : "text-destructive",
                    )}
                  >
                    {formatMoney(bank.balance, currency)}
                  </p>
                </div>

                <div className="relative mt-3 space-y-1.5 text-[9px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-soft">شماره حساب</span>
                    <span className="num" dir="ltr">
                      {bank.accountNumber}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-soft">شبا</span>
                    <span className="num max-w-[170px] truncate" dir="ltr">
                      {bank.iban ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-soft">صاحب حساب</span>
                    <span className="max-w-[170px] truncate">{bank.holderName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-soft">شعبه</span>
                    <span className="max-w-[170px] truncate">
                      {bank.bankBranch ?? "—"}
                    </span>
                  </div>
                </div>

                <div className="relative mt-3 flex items-center gap-1.5 border-t border-hairline/50 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLedgerTarget({
                        id: bank._id,
                        name: bank.name,
                        type: "bank",
                      })
                    }
                    className="h-7 flex-1 gap-1 rounded-lg text-[8px]"
                  >
                    <Eye className="size-3" />
                    گردش
                  </Button>
                  {canWrite ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingBank(bank);
                          setBankDialog(true);
                        }}
                        className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                      >
                        <Pencil className="size-3" />
                        ویرایش
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === bank._id}
                        onClick={() => void toggleBank(bank)}
                        className={cn(
                          "h-7 gap-1 rounded-lg px-2 text-[8px]",
                          bank.active ? "text-destructive" : "text-brand",
                        )}
                      >
                        {busyId === bank._id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Power className="size-3" />
                        )}
                        {bank.active ? "غیرفعال" : "فعال"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </Panel>
            ))}
          </div>
        )
      ) : tab === "cash" ? (
        !funds ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[220px] rounded-[22px]" />
            ))}
          </div>
        ) : funds.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Wallet className="size-5" />}
              title="هنوز صندوقی ندارید"
              description="برای فروش نقدی و هزینه‌های روزانه یک یا چند صندوق با مسئول مشخص بسازید."
              action={
                canWrite ? (
                  <Button
                    onClick={() => {
                      setEditingFund(null);
                      setFundDialog(true);
                    }}
                    className="rounded-xl"
                  >
                    <Plus className="size-4" />
                    ایجاد صندوق
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {funds.map((fund) => (
              <Panel
                key={fund._id}
                className={cn(
                  "relative overflow-hidden p-4",
                  !fund.active && "opacity-70",
                )}
              >
                <div className="absolute -top-8 -left-8 size-24 rounded-full bg-gold/20 blur-2xl" />
                <div className="relative flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-gold-soft text-[#7a6122] dark:text-gold">
                      <Wallet className="size-4" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold">{fund.name}</p>
                      <p className="text-[8px] text-ink-soft">
                        مسئول: {fund.responsibleName ?? "—"}{fund.branchId ? ` · ${branches.find((branch) => branch._id === fund.branchId)?.name ?? ""}` : ""}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[8px]",
                      fund.active
                        ? "border-brand/20 bg-brand-soft text-brand"
                        : "border-hairline bg-muted text-ink-soft",
                    )}
                  >
                    {fund.active ? "فعال" : "غیرفعال"}
                  </span>
                </div>
                <div className="relative mt-4 rounded-xl border border-hairline/50 bg-background/60 px-3 py-2">
                  <p className="text-[8px] text-ink-soft">موجودی محاسبه‌شده</p>
                  <p
                    className={cn(
                      "num mt-1 text-[18px] font-black",
                      fund.balance >= 0 ? "text-gold" : "text-destructive",
                    )}
                  >
                    {formatMoney(fund.balance, currency)}
                  </p>
                </div>
                {fund.notes ? (
                  <p className="relative mt-2 line-clamp-2 text-[8px] leading-4 text-ink-soft">
                    {fund.notes}
                  </p>
                ) : null}
                <div className="relative mt-3 flex items-center gap-1.5 border-t border-hairline/50 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLedgerTarget({
                        id: fund._id,
                        name: fund.name,
                        type: "cash",
                      })
                    }
                    className="h-7 flex-1 gap-1 rounded-lg text-[8px]"
                  >
                    <Eye className="size-3" />
                    گردش
                  </Button>
                  {canWrite ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!fund.active}
                        onClick={() => setClosingFund(fund)}
                        className="h-7 gap-1 rounded-lg px-2 text-[8px] text-gold"
                      >
                        <CalendarCheck2 className="size-3" />
                        بستن روز
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingFund(fund);
                          setFundDialog(true);
                        }}
                        className="h-7 gap-1 rounded-lg px-2 text-[8px]"
                      >
                        <Pencil className="size-3" />
                        ویرایش
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === fund._id}
                        onClick={() => void toggleFund(fund)}
                        className={cn(
                          "h-7 gap-1 rounded-lg px-2 text-[8px]",
                          fund.active ? "text-destructive" : "text-brand",
                        )}
                      >
                        {busyId === fund._id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Power className="size-3" />
                        )}
                      </Button>
                    </>
                  ) : null}
                </div>
              </Panel>
            ))}
          </div>
        )
      ) : !closings ? (
        <Skeleton className="h-64 rounded-[22px]" />
      ) : closings.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<CalendarCheck2 className="size-5" />}
            title="بستن روزی ثبت نشده است"
            description="در پایان روز، موجودی شمارش‌شده هر صندوق را ثبت کنید تا اختلاف مشخص و قابل پیگیری شود."
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader
            eyebrow="کنترل صندوق"
            title="تاریخچه بستن روز"
            description="مقایسه موجودی محاسباتی و شمارش‌شده؛ اختلاف مثبت یعنی اضافه‌شمارش و اختلاف منفی یعنی کسری شمارش."
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>صندوق</TableHead>
                  <TableHead className="text-end">محاسباتی</TableHead>
                  <TableHead className="text-end">شمارش‌شده</TableHead>
                  <TableHead className="text-end">اختلاف</TableHead>
                  <TableHead>توضیحات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                      {formatJalali(row.closeDate)}
                    </TableCell>
                    <TableCell className="text-[9px] font-medium">
                      {row.fundName}
                    </TableCell>
                    <TableCell className="num text-end text-[9px]">
                      {formatMoney(row.expectedBalance, currency)}
                    </TableCell>
                    <TableCell className="num text-end text-[9px]">
                      {formatMoney(row.countedBalance, currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "num text-end text-[10px] font-bold",
                        row.difference === 0
                          ? "text-brand"
                          : "text-destructive",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {row.difference < 0 ? (
                          <ArrowDownLeft className="size-3" />
                        ) : row.difference > 0 ? (
                          <ArrowUpRight className="size-3" />
                        ) : null}
                        {formatMoney(row.difference, currency)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[8px] text-ink-soft">
                      {row.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}

      <BankDialog
        open={bankDialog}
        onOpenChange={setBankDialog}
        businessId={businessId}
        bank={editingBank}
        onSaved={() => setEditingBank(null)}
      />
      <FundDialog
        open={fundDialog}
        onOpenChange={setFundDialog}
        businessId={businessId}
        fund={editingFund}
        onSaved={() => setEditingFund(null)}
      />
      <LedgerDialog
        open={Boolean(ledgerTarget)}
        onOpenChange={(open) => {
          if (!open) setLedgerTarget(null);
        }}
        businessId={businessId}
        target={ledgerTarget}
        currency={currency}
      />
      <CloseFundDialog
        open={Boolean(closingFund)}
        onOpenChange={(open) => {
          if (!open) setClosingFund(null);
        }}
        businessId={businessId}
        fund={closingFund}
        currency={currency}
        onSaved={() => setClosingFund(null)}
      />
    </div>
  );
}
