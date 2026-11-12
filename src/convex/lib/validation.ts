/**
 * Server-side money and input validation.
 * All amounts are integers; there is no floating point arithmetic on money.
 */

import { ConvexError } from "convex/values";

export const MAX_LINES = 50;
export const MAX_QUANTITY_MILLI = 1_000_000_000; // 1,000,000 units
export const MAX_UNIT_PRICE = 1_000_000_000_000; // 1e12

export function fail(message: string): never {
  throw new ConvexError(message);
}

export function requireString(
  value: string | undefined,
  label: string,
  options: { max?: number; optional?: boolean } = {},
) {
  const text = (value ?? "").trim();
  if (!text) {
    if (options.optional) return undefined;
    fail(`${label} الزامی است.`);
  }
  if (text.length > (options.max ?? 200)) {
    fail(`${label} بیش از حد طولانی است.`);
  }
  return text;
}

export function optionalString(
  value: string | undefined,
  label: string,
  max = 500,
) {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  if (text.length > max) fail(`${label} بیش از حد طولانی است.`);
  return text;
}

export function requireInt(
  value: number,
  label: string,
  options: { min?: number; max?: number } = {},
) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    fail(`${label} باید یک عدد صحیح باشد.`);
  }
  if (options.min !== undefined && value < options.min) {
    fail(`${label} نمی‌تواند کمتر از ${options.min} باشد.`);
  }
  if (options.max !== undefined && value > options.max) {
    fail(`${label} بیش از حد مجاز است.`);
  }
  return value;
}

/** Validates an Iranian mobile/landline-ish phone number (digits, +, -, spaces). */
export function validatePhone(value: string | undefined) {
  const phone = (value ?? "").trim();
  if (!phone) return undefined;
  if (!/^[0-9+\-\s()]{4,20}$/.test(phone)) {
    fail("شماره تماس معتبر نیست.");
  }
  return phone;
}

export function validateEmail(value: string | undefined) {
  const email = (value ?? "").trim();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    fail("ایمیل معتبر نیست.");
  }
  return email;
}

export interface RawInvoiceLine {
  description: string;
  quantityMilli: number;
  unitPrice: number;
}

export interface ComputedLine extends RawInvoiceLine {
  lineTotal: number;
}

export function computeLines(lines: RawInvoiceLine[]): {
  lines: ComputedLine[];
  subtotal: number;
} {
  if (!Array.isArray(lines) || lines.length === 0) {
    fail("حداقل یک ردیف کالا یا خدمت لازم است.");
  }
  if (lines.length > MAX_LINES) {
    fail(`حداکثر ${MAX_LINES} ردیف در هر فاکتور مجاز است.`);
  }

  let subtotal = 0;
  const computed = lines.map((line) => {
    const description = requireString(line.description, "شرح ردیف", {
      max: 200,
    }) as string;
    const quantityMilli = requireInt(line.quantityMilli, "تعداد", {
      min: 1,
      max: MAX_QUANTITY_MILLI,
    });
    const unitPrice = requireInt(line.unitPrice, "مبلغ واحد", {
      min: 0,
      max: MAX_UNIT_PRICE,
    });
    // Integer math: thousandths of a unit × price, rounded to the currency unit.
    const lineTotal = Math.round((quantityMilli * unitPrice) / 1000);
    if (!Number.isSafeInteger(lineTotal)) {
      fail("مبلغ ردیف از محدوده مجاز بیشتر است.");
    }
    subtotal += lineTotal;
    if (!Number.isSafeInteger(subtotal)) {
      fail("جمع فاکتور از محدوده مجاز بیشتر است.");
    }
    return { description, quantityMilli, unitPrice, lineTotal };
  });

  return { lines: computed, subtotal };
}

export function computeTotals(input: {
  subtotal: number;
  discount: number;
  taxRateBps: number;
}) {
  const discount = requireInt(input.discount, "تخفیف", { min: 0 });
  if (discount > input.subtotal) {
    fail("تخفیف نمی‌تواند از جمع کل بیشتر باشد.");
  }
  const taxRateBps = requireInt(input.taxRateBps, "نرخ مالیات", {
    min: 0,
    max: 10000,
  });
  const taxable = input.subtotal - discount;
  const taxAmount = Math.round((taxable * taxRateBps) / 10000);
  return {
    discount,
    taxRateBps,
    taxAmount,
    total: taxable + taxAmount,
  };
}

export function percentToBps(percent: number) {
  return Math.round(percent * 100);
}
