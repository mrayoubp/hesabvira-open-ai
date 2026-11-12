import type {
  ExpenseCategory,
  FinanceMethod,
  IssuedCheckStatus,
  ReceivedCheckStatus,
  VoucherStatus,
} from "@/convex/schema";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Banknote,
  CheckCircle2,
  FileUp,
  Landmark,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatJalali, formatMoney } from "@/lib/format";

export const VOUCHER_STATUS_META: Record<
  VoucherStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "پیش‌نویس",
    className: "border-hairline bg-muted text-ink-soft",
  },
  posted: {
    label: "تأییدشده",
    className: "border-brand/25 bg-brand-soft text-brand",
  },
  cancelled: {
    label: "لغوشده",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
  },
};

export const FINANCE_METHOD_LABELS: Record<FinanceMethod, string> = {
  cash: "نقدی",
  card: "کارت‌خوان",
  bank_transfer: "انتقال بانکی",
  check: "چک",
  other: "سایر",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "اجاره",
  salary: "حقوق",
  utilities: "آب و برق",
  internet: "اینترنت",
  transport: "حمل‌ونقل",
  repairs: "تعمیرات",
  advertising: "تبلیغات",
  supplies: "لوازم مصرفی",
  other: "سایر هزینه‌ها",
};

export const RECEIVED_CHECK_STATUS_META: Record<
  ReceivedCheckStatus,
  { label: string; className: string }
> = {
  received: {
    label: "دریافت‌شده",
    className: "border-mist bg-mist/50 text-[#2d6470] dark:text-[#a9d5e2]",
  },
  pending: {
    label: "در انتظار وصول",
    className: "border-gold/40 bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  assigned: {
    label: "واگذارشده به بانک",
    className: "border-brand/25 bg-brand-soft text-brand",
  },
  collected: {
    label: "وصول‌شده",
    className: "border-brand/25 bg-brand-soft text-brand",
  },
  bounced: {
    label: "برگشتی",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
  },
  cancelled: {
    label: "ابطال‌شده",
    className: "border-hairline bg-muted text-ink-soft",
  },
};

export const ISSUED_CHECK_STATUS_META: Record<
  IssuedCheckStatus,
  { label: string; className: string }
> = {
  issued: {
    label: "صادرشده",
    className: "border-gold/40 bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  delivered: {
    label: "تحویل‌شده",
    className: "border-mist bg-mist/50 text-[#2d6470] dark:text-[#a9d5e2]",
  },
  collected: {
    label: "وصول‌شده توسط ذی‌نفع",
    className: "border-brand/25 bg-brand-soft text-brand",
  },
  cancelled: {
    label: "ابطال‌شده",
    className: "border-hairline bg-muted text-ink-soft",
  },
  bounced: {
    label: "برگشتی",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
  },
};

export function StatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-semibold whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

export interface AccountOption {
  _id: string;
  name: string;
}

export function DestinationSelect({
  banks,
  funds,
  type,
  bankAccountId,
  cashFundId,
  onTypeChange,
  onBankChange,
  onFundChange,
  label = "حساب مقصد",
  disabled,
}: {
  banks: AccountOption[];
  funds: AccountOption[];
  type: "bank" | "cash";
  bankAccountId: string;
  cashFundId: string;
  onTypeChange: (type: "bank" | "cash") => void;
  onBankChange: (id: string) => void;
  onFundChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-semibold text-ink-soft">{label}</span>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onTypeChange("bank")}
          aria-pressed={type === "bank"}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border p-2 text-[9px] font-semibold transition-colors",
            type === "bank"
              ? "border-brand bg-brand-soft text-brand"
              : "border-hairline bg-background text-ink-soft hover:text-ink",
          )}
        >
          <Landmark className="size-3.5" />
          بانک
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onTypeChange("cash")}
          aria-pressed={type === "cash"}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border p-2 text-[9px] font-semibold transition-colors",
            type === "cash"
              ? "border-brand bg-brand-soft text-brand"
              : "border-hairline bg-background text-ink-soft hover:text-ink",
          )}
        >
          <Banknote className="size-3.5" />
          صندوق
        </button>
      </div>
      {type === "bank" ? (
        <Select value={bankAccountId} onValueChange={onBankChange} disabled={disabled}>
          <SelectTrigger className="h-9 w-full rounded-xl border-hairline bg-background text-[10px]">
            <SelectValue placeholder="انتخاب حساب بانکی" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {banks.length === 0 ? (
              <SelectItem value="none" disabled>
                حساب بانکی فعالی وجود ندارد
              </SelectItem>
            ) : (
              banks.map((bank) => (
                <SelectItem key={bank._id} value={bank._id}>
                  {bank.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      ) : (
        <Select value={cashFundId} onValueChange={onFundChange} disabled={disabled}>
          <SelectTrigger className="h-9 w-full rounded-xl border-hairline bg-background text-[10px]">
            <SelectValue placeholder="انتخاب صندوق" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {funds.length === 0 ? (
              <SelectItem value="none" disabled>
                صندوق فعالی وجود ندارد
              </SelectItem>
            ) : (
              funds.map((fund) => (
                <SelectItem key={fund._id} value={fund._id}>
                  {fund.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function AttachmentField({
  businessId,
  value,
  fileName,
  onChange,
  disabled,
}: {
  businessId?: Id<"businesses">;
  value?: string;
  fileName?: string;
  onChange: (storageId: string | undefined, name: string | undefined) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!businessId) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("حجم فایل باید کمتر از ۸ مگابایت باشد.");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ businessId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error("upload failed");
      const payload = (await response.json()) as { storageId?: string };
      if (!payload.storageId) throw new Error("storageId missing");
      await registerUpload({
        businessId,
        storageId: payload.storageId as Id<"_storage">,
        name: file.name,
      });
      onChange(payload.storageId, file.name);
      toast.success("فایل پیوست شد.");
    } catch {
      toast.error("بارگذاری فایل انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-semibold text-ink-soft">
        پیوست مدرک
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {value ? (
        <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft/40 px-3 py-2">
          <Paperclip className="size-3.5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-[9px] text-ink">
            {fileName ?? "فایل پیوست"}
          </span>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => onChange(undefined, undefined)}
            className="rounded-full p-1 text-ink-soft hover:bg-white/60 hover:text-destructive"
            aria-label="حذف پیوست"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="h-8 w-full gap-1.5 rounded-xl border-dashed border-hairline bg-background text-[9px]"
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileUp className="size-3.5" />
          )}
          {uploading ? "در حال بارگذاری…" : "انتخاب فایل (PDF یا تصویر)"}
        </Button>
      )}
    </div>
  );
}

export function AttachmentLink({
  businessId,
  storageId,
  fileName,
}: {
  businessId?: Id<"businesses">;
  storageId?: string | null;
  fileName?: string | null;
}) {
  const url = useQuery(
    api.files.url,
    businessId && storageId
      ? { businessId, storageId: storageId as Id<"_storage"> }
      : "skip",
  );
  if (!storageId) return null;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[9px] font-semibold text-brand hover:underline"
    >
      <Paperclip className="size-3" />
      {fileName ?? "مشاهده پیوست"}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1 text-[9px] text-ink-soft">
      <Paperclip className="size-3" />
      {fileName ?? "پیوست ثبت‌شده"}
    </span>
  );
}

export function VoucherSheet({
  kind,
  number,
  date,
  party,
  amount,
  method,
  account,
  description,
  status,
  trackingNumber,
  accountingNumber,
  currency,
  children,
}: {
  kind: "دریافت وجه" | "پرداخت وجه" | "درآمد" | "هزینه";
  number: string;
  date: number;
  party: string;
  amount: number;
  method?: string;
  account: string;
  description: string;
  status: string;
  trackingNumber?: string | null;
  accountingNumber?: string | null;
  currency: string;
  children?: ReactNode;
}) {
  return (
    <div className="print-sheet mx-auto w-full max-w-[720px] rounded-[24px] border border-hairline/70 bg-white p-6 text-ink shadow-sm dark:border-white/10 dark:bg-card print:rounded-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-gold">
            HESAB VIRA
          </p>
          <h2 className="mt-1 text-xl font-black">رسید {kind}</h2>
          <p className="mt-1 text-[10px] text-ink-soft">
            سند مالی ثبت‌شده در سیستم حساب ویرا
          </p>
        </div>
        <div className="text-end">
          <p className="num text-lg font-black text-brand">{number}</p>
          <p className="num mt-1 text-[10px] text-ink-soft">
            {formatJalali(date)}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-brand">
            <CheckCircle2 className="size-3" />
            {status === "posted"
              ? "تأییدشده"
              : status === "draft"
                ? "پیش‌نویس"
                : "لغوشده"}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          ["طرف حساب", party],
          ["مبلغ", formatMoney(amount, currency)],
          ["روش", method ?? "—"],
          ["حساب مالی", account],
          ["شماره پیگیری", trackingNumber || "—"],
          ["سند حسابداری", accountingNumber || "در انتظار تأیید"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-hairline/50 bg-background/50 px-3 py-2"
          >
            <p className="text-[8px] text-ink-soft">{label}</p>
            <p className="mt-1 break-words text-[11px] font-semibold text-ink">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-hairline/50 bg-background/50 px-3 py-2">
        <p className="text-[8px] text-ink-soft">شرح</p>
        <p className="mt-1 text-[11px] leading-6 text-ink">{description}</p>
      </div>

      {children}

      <div className="mt-8 flex items-end justify-between border-t border-dashed border-hairline pt-4 text-[9px] text-ink-soft">
        <span>مهر و امضا</span>
        <span className="num">{number}</span>
      </div>
    </div>
  );
}

export function DateRangeFields({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-[9px] text-ink-soft">
        از
        <Input
          type="date"
          value={from}
          onChange={(event) => {
            if (event.target.value) onFrom(event.target.value);
          }}
          dir="ltr"
          className="num h-8 w-32 rounded-lg border-hairline bg-background px-2 text-[9px]"
        />
      </label>
      <label className="flex items-center gap-1 text-[9px] text-ink-soft">
        تا
        <Input
          type="date"
          value={to}
          onChange={(event) => {
            if (event.target.value) onTo(event.target.value);
          }}
          dir="ltr"
          className="num h-8 w-32 rounded-lg border-hairline bg-background px-2 text-[9px]"
        />
      </label>
    </div>
  );
}
