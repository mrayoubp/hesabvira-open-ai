import type { InvoiceStatus, MemberRole } from "@/convex/schema";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Converts Persian/Arabic digits in user input to ASCII digits. */
export function toEnglishDigits(input: string) {
  return input
    .replace(/[۰-۹]/g, (char) =>
      String(PERSIAN_DIGITS.indexOf(char)),
    )
    .replace(/[٠-٩]/g, (char) =>
      String("٠١٢٣٤٥٦٧٨٩".indexOf(char)),
    );
}

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const jalaliDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tehran",
});

const jalaliLongDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Tehran",
});

const jalaliMonth = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "long",
  timeZone: "Asia/Tehran",
});

const currencyUnits: Record<string, string> = {
  IRT: "تومان",
  IRR: "ریال",
};

export function currencyUnit(currency = "IRT") {
  return currencyUnits[currency] ?? currency;
}

export function formatNumber(value: number) {
  return integerFormatter.format(value);
}

export function formatMoney(value: number, currency = "IRT") {
  return `${formatNumber(value)} ${currencyUnit(currency)}`;
}

/** Quantities are stored in thousandths to keep decimals exact. */
export function formatQuantity(quantityMilli: number) {
  return quantityFormatter.format(quantityMilli / 1000);
}

export function formatJalali(timestamp: number) {
  return jalaliDate.format(new Date(timestamp));
}

export function formatJalaliLong(timestamp: number) {
  return jalaliLongDate.format(new Date(timestamp));
}

export function formatJalaliMonth(timestamp: number) {
  return jalaliMonth.format(new Date(timestamp));
}

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", " هزار", " میلیون", " میلیارد", " هزار میلیارد"];

function threeDigitsToWords(value: number): string {
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  if (hundred > 0) parts.push(HUNDREDS[hundred]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const ten = Math.floor(rest / 10);
    const one = rest % 10;
    if (ten > 0) parts.push(TENS[ten]);
    if (one > 0) parts.push(ONES[one]);
  }
  return parts.join(" و ");
}

/** Converts a non-negative integer amount to Persian words for invoices. */
export function numberToPersianWords(value: number): string {
  const amount = Math.floor(Math.abs(value));
  if (amount === 0) return "صفر";
  const groups: number[] = [];
  let remaining = amount;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  return groups
    .map((group, index) =>
      group > 0 ? `${threeDigitsToWords(group)}${SCALES[index] ?? ""}` : "",
    )
    .filter(Boolean)
    .reverse()
    .join(" و ");
}

export const INVOICE_STATUS_META: Record<
  InvoiceStatus,
  { label: string; hint: string; badge: string; dot: string }
> = {
  draft: {
    label: "پیش‌نویس",
    hint: "قابل ویرایش، خارج از گزارش فروش",
    badge: "border-hairline bg-muted text-ink-soft",
    dot: "bg-ink-soft/60",
  },
  issued: {
    label: "صادرشده",
    hint: "سند قطعی، در انتظار پرداخت",
    badge: "border-gold/40 bg-gold-soft text-[#7a6122] dark:text-gold",
    dot: "bg-gold",
  },
  paid: {
    label: "پرداخت‌شده",
    hint: "تسویه‌شده و بسته",
    badge: "border-brand/25 bg-brand-soft text-brand",
    dot: "bg-brand",
  },
  void: {
    label: "ابطال",
    hint: "حذف منطقی با حفظ ردپا",
    badge: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive/70",
  },
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "مالک",
  admin: "مدیر",
  accountant: "حسابدار",
  viewer: "فقط مشاهده",
};

export const TAX_RATE_OPTIONS = [
  { value: 0, label: "بدون مالیات" },
  { value: 600, label: "۶٪" },
  { value: 900, label: "۹٪" },
  { value: 1000, label: "۱۰٪" },
];
