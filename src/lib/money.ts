import { toEnglishDigits } from "./format";

export const MAX_LINES = 50;

/**
 * Client-side mirror of the server money math, used for live previews only.
 * The server recomputes every total before persisting a document.
 */
export function parseQuantityMilli(input: string): number {
  const normalised = toEnglishDigits(input).replace(/[,\s]/g, "");
  const value = Number(normalised);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1000);
}

export function parseAmount(input: string): number {
  const normalised = toEnglishDigits(input).replace(/[,\s]/g, "");
  const value = Number(normalised);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

export function lineTotal(quantityMilli: number, unitPrice: number) {
  return Math.round((quantityMilli * unitPrice) / 1000);
}

export function invoiceTotals(input: {
  subtotal: number;
  discount: number;
  taxRateBps: number;
}) {
  const discount = Math.min(
    Math.max(Math.round(input.discount) || 0, 0),
    input.subtotal,
  );
  const taxable = input.subtotal - discount;
  const taxAmount = Math.round((taxable * input.taxRateBps) / 10000);
  return { discount, taxAmount, total: taxable + taxAmount };
}
