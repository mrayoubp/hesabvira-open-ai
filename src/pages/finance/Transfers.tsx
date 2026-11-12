import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/app/ui";
import {
  DateRangeFields,
  DestinationSelect,
} from "@/components/finance/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ArrowLeftRight,
  ArrowRight,
  Landmark,
  Loader2,
  LockKeyhole,
  Search,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface TransferRow {
  _id: string;
  number: string;
  fromType: "bank" | "cash";
  fromName: string;
  toType: "bank" | "cash";
  toName: string;
  amount: number;
  fee: number;
  occurredAt: number;
  description: string;
  accountingDocumentId: string;
  createdAt: number;
}

function parseDate(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export default function Transfers() {
  const { businessId, branchId, currency, canWrite } = useWorkspace();
  const options = useQuery(
    api.transfers.options,
    businessId ? { businessId } : "skip",
  );
  const accounts = useQuery(
    api.treasury.accountBalances,
    businessId ? { businessId } : "skip",
  );
  const createTransfer = useMutation(api.transfers.create);

  const [fromType, setFromType] = useState<"bank" | "cash">("bank");
  const [fromBankId, setFromBankId] = useState("");
  const [fromFundId, setFromFundId] = useState("");
  const [toType, setToType] = useState<"bank" | "cash">("cash");
  const [toBankId, setToBankId] = useState("");
  const [toFundId, setToFundId] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [occurredDate, setOccurredDate] = useState(() =>
    isoDateValue(Date.now()),
  );
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useQuery(
    api.transfers.list,
    businessId
      ? {
          businessId,
          branchId,
          from: from ? timestampFromDateInput(from) : undefined,
          to: to ? timestampFromDateInput(to, true) : undefined,
          search: search.trim() || undefined,
          limit: 500,
        }
      : "skip",
  );

  const activeBanks = accounts?.banks.filter((bank) => bank.active) ?? [];
  const activeFunds = accounts?.funds.filter((fund) => fund.active) ?? [];

  useEffect(() => {
    if (!options) return;
    if (!fromBankId && options.banks[0]) setFromBankId(options.banks[0]._id);
    if (!fromFundId && options.funds[0]) setFromFundId(options.funds[0]._id);
    if (!toFundId && options.funds[0]) setToFundId(options.funds[0]._id);
    if (!toBankId && options.banks[1]) setToBankId(options.banks[1]._id);
    if (!toBankId && options.banks[0]) setToBankId(options.banks[0]._id);
  }, [options, fromBankId, fromFundId, toBankId, toFundId]);

  const sourceBalance =
    fromType === "bank"
      ? activeBanks.find((bank) => bank._id === fromBankId)?.balance
      : activeFunds.find((fund) => fund._id === fromFundId)?.balance;
  const amountValue = parseAmount(amount);
  const feeValue = parseAmount(fee);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId) return;
    if (amountValue <= 0) {
      toast.error("مبلغ انتقال باید بزرگ‌تر از صفر باشد.");
      return;
    }
    if (fromType === "bank" && !fromBankId) {
      toast.error("حساب مبدأ را انتخاب کنید.");
      return;
    }
    if (fromType === "cash" && !fromFundId) {
      toast.error("صندوق مبدأ را انتخاب کنید.");
      return;
    }
    if (toType === "bank" && !toBankId) {
      toast.error("حساب مقصد را انتخاب کنید.");
      return;
    }
    if (toType === "cash" && !toFundId) {
      toast.error("صندوق مقصد را انتخاب کنید.");
      return;
    }
    setSaving(true);
    try {
      const result = await createTransfer({
        businessId,
        fromType,
        fromBankAccountId:
          fromType === "bank" ? (fromBankId as Id<"bankAccounts">) : undefined,
        fromCashFundId:
          fromType === "cash" ? (fromFundId as Id<"cashFunds">) : undefined,
        toType,
        toBankAccountId:
          toType === "bank" ? (toBankId as Id<"bankAccounts">) : undefined,
        toCashFundId:
          toType === "cash" ? (toFundId as Id<"cashFunds">) : undefined,
        amount: amountValue,
        fee: feeValue > 0 ? feeValue : undefined,
        occurredAt: parseDate(occurredDate),
        description: description.trim() || "انتقال وجه بین حساب‌ها",
      });
      toast.success(
        `انتقال ${result.number} ثبت شد؛ سند ${result.accountingNumber} ایجاد گردید.`,
      );
      setAmount("");
      setFee("");
      setDescription("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const totalAmount = (rows ?? []).reduce((sum, row) => sum + row.amount, 0);
  const totalFee = (rows ?? []).reduce((sum, row) => sum + row.fee, 0);
  const sameAccount =
    (fromType === toType && fromType === "bank" && fromBankId === toBankId) ||
    (fromType === toType && fromType === "cash" && fromFundId === toFundId);

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · انتقال وجه"
        title="انتقال بین حساب‌ها"
        description="انتقال اتمیک بین بانک و صندوق با کنترل موجودی، ثبت جداگانه کارمزد و سند حسابداری خودکار."
      />

      <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
        <Panel className="h-fit">
          <PanelHeader
            eyebrow="عملیات جدید"
            title="انتقال وجه"
            description="مبدأ و مقصد نمی‌توانند یکسان باشند؛ موجودی مبدأ در سرور کنترل می‌شود."
          />
          {canWrite ? (
            <form onSubmit={submit} className="space-y-3 p-4 pt-0">
              <div className="grid grid-cols-2 gap-3">
                <DestinationSelect
                  banks={activeBanks}
                  funds={activeFunds}
                  type={fromType}
                  bankAccountId={fromBankId}
                  cashFundId={fromFundId}
                  onTypeChange={setFromType}
                  onBankChange={setFromBankId}
                  onFundChange={setFromFundId}
                  label="از حساب *"
                />
                <DestinationSelect
                  banks={activeBanks}
                  funds={activeFunds}
                  type={toType}
                  bankAccountId={toBankId}
                  cashFundId={toFundId}
                  onTypeChange={setToType}
                  onBankChange={setToBankId}
                  onFundChange={setToFundId}
                  label="به حساب *"
                />
              </div>

              <div className="flex items-center justify-center">
                <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <ArrowRight className="size-3.5 rotate-90" />
                </span>
              </div>

              <div className="rounded-xl border border-hairline/60 bg-background/60 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-ink-soft">موجودی مبدأ</span>
                  <span className="num text-[11px] font-bold text-brand">
                    {sourceBalance === undefined
                      ? "—"
                      : formatMoney(sourceBalance, currency)}
                  </span>
                </div>
                {amountValue + feeValue > 0 ? (
                  <p
                    className={cn(
                      "mt-1 text-[8px]",
                      sourceBalance !== undefined &&
                        sourceBalance < amountValue + feeValue
                        ? "text-destructive"
                        : "text-ink-soft",
                    )}
                  >
                    مبلغ قابل برداشت با کارمزد:{" "}
                    {formatMoney(amountValue + feeValue, currency)}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px]">مبلغ انتقال *</Label>
                  <Input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    className="num h-9 rounded-xl text-left text-[11px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px]">کارمزد</Label>
                  <Input
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    className="num h-9 rounded-xl text-left text-[11px]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">تاریخ انتقال *</Label>
                <Input
                  type="date"
                  value={occurredDate}
                  onChange={(event) => setOccurredDate(event.target.value)}
                  dir="ltr"
                  className="num h-9 rounded-xl text-[10px]"
                />
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
              {sameAccount ? (
                <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[8px] text-destructive">
                  حساب مبدأ و مقصد یکسان است؛ یک حساب دیگر انتخاب کنید.
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={saving || sameAccount}
                className="w-full rounded-xl"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowLeftRight className="size-4" />
                )}
                ثبت انتقال و سند خودکار
              </Button>
            </form>
          ) : (
            <EmptyState
              icon={<LockKeyhole className="size-5" />}
              title="اجازه ثبت انتقال ندارید"
              description="نقش مشاهده‌گر فقط می‌تواند تاریخچه انتقال‌ها را ببیند."
            />
          )}
        </Panel>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Panel className="p-4">
              <span className="text-[10px] text-ink-soft">جمع انتقال‌ها</span>
              <p className="num mt-2 text-[18px] font-black text-ink">
                {formatMoney(totalAmount, currency)}
              </p>
              <p className="mt-1 text-[8px] text-ink-soft">
                {rows?.length ?? 0} فقره در نتیجه فیلتر
              </p>
            </Panel>
            <Panel className="p-4">
              <span className="text-[10px] text-ink-soft">کارمزد ثبت‌شده</span>
              <p className="num mt-2 text-[18px] font-black text-gold">
                {formatMoney(totalFee, currency)}
              </p>
              <p className="mt-1 text-[8px] text-ink-soft">
                هزینه جداگانه در سند
              </p>
            </Panel>
            <Panel className="p-4">
              <span className="text-[10px] text-ink-soft">حساب‌های فعال</span>
              <p className="num mt-2 text-[18px] font-black text-brand">
                {(options?.banks.length ?? 0) + (options?.funds.length ?? 0)}
              </p>
              <p className="mt-1 text-[8px] text-ink-soft">
                بانک و صندوق قابل انتقال
              </p>
            </Panel>
          </div>

          <Panel className="overflow-hidden">
            <PanelHeader
              eyebrow="تاریخچه"
              title="انتقال‌های ثبت‌شده"
              description="هر انتقال در یک تراکنش دیتابیس، همراه با سند متوازن ثبت شده است."
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline/50 px-3 py-2">
              <div className="relative min-w-[170px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-soft" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="جستجوی شماره یا شرح…"
                  className="h-8 rounded-lg border-hairline bg-background pr-8 text-[9px]"
                />
              </div>
              <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
            </div>
            {!rows ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight className="size-5" />}
                title="انتقالی ثبت نشده"
                description="با انتخاب مبدأ، مقصد و مبلغ، اولین انتقال را ثبت کنید."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>شماره</TableHead>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>از</TableHead>
                      <TableHead>به</TableHead>
                      <TableHead className="text-end">مبلغ</TableHead>
                      <TableHead className="text-end">کارمزد</TableHead>
                      <TableHead>شرح</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row: TransferRow) => (
                      <TableRow key={row._id}>
                        <TableCell className="num text-[9px] font-bold text-brand">
                          {row.number}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-[9px] text-ink-soft">
                          {formatJalali(row.occurredAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[9px]">
                          <span className="inline-flex items-center gap-1">
                            {row.fromType === "bank" ? (
                              <Landmark className="size-3 text-[#245c5c] dark:text-[#a9d5e2]" />
                            ) : (
                              <Wallet className="size-3 text-gold" />
                            )}
                            {row.fromName}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[9px]">
                          <span className="inline-flex items-center gap-1">
                            {row.toType === "bank" ? (
                              <Landmark className="size-3 text-[#245c5c] dark:text-[#a9d5e2]" />
                            ) : (
                              <Wallet className="size-3 text-gold" />
                            )}
                            {row.toName}
                          </span>
                        </TableCell>
                        <TableCell className="num text-end text-[10px] font-bold">
                          {formatMoney(row.amount, currency)}
                        </TableCell>
                        <TableCell className="num text-end text-[9px] text-gold">
                          {row.fee > 0 ? formatMoney(row.fee, currency) : "—"}
                        </TableCell>
                        <TableCell className="max-w-[170px] truncate text-[8px] text-ink-soft">
                          {row.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
