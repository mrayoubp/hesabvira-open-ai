import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { PaymentMethod } from "../schema";
import { resolveDocumentScope } from "./workspace";
import { writeAudit } from "./tenant";

/**
 * Applies a real customer receipt to an invoice. Partial receipts are allowed
 * and tracked in `paidAmount`; the status only flips to paid when fully settled.
 */
export async function applyInvoiceReceipt(
  ctx: MutationCtx,
  input: {
    business: Doc<"businesses">;
    invoice: Doc<"invoices">;
    customer: Doc<"customers">;
    actorId: Id<"users">;
    amount: number;
    method: PaymentMethod;
    occurredAt: number;
    notes?: string;
  },
) {
  const alreadyPaid = input.invoice.paidAmount ?? 0;
  const outstanding = Math.max(
    0,
    input.invoice.total -
      (input.invoice.returnedAmount ?? 0) -
      alreadyPaid,
  );
  if (outstanding <= 0) {
    throw new ConvexError("این فاکتور قبلاً تسویه شده است.");
  }
  if (input.amount <= 0) {
    throw new ConvexError("مبلغ دریافت باید بزرگ‌تر از صفر باشد.");
  }
  if (input.amount > outstanding) {
    throw new ConvexError(
      `مبلغ دریافت نمی‌تواند از مانده فاکتور (${outstanding}) بیشتر باشد.`,
    );
  }

  const scope = await resolveDocumentScope(
    ctx,
    input.business._id,
    input.occurredAt,
  );
  const now = Date.now();
  const paymentId = await ctx.db.insert("payments", {
    businessId: input.business._id,
    branchId: scope.branchId,
    fiscalYearId: scope.fiscalYearId,
    direction: "receipt",
    invoiceId: input.invoice._id,
    partyType: "customer",
    partyId: input.customer._id as string,
    partyName: input.customer.name,
    amount: input.amount,
    method: input.method,
    occurredAt: input.occurredAt,
    notes: input.notes,
    createdBy: input.actorId,
    createdAt: now,
  });

  const paidAmount = alreadyPaid + input.amount;
  const fullyPaid = paidAmount >= input.invoice.total;
  await ctx.db.patch(input.invoice._id, {
    paidAmount,
    status: fullyPaid ? "paid" : input.invoice.status,
    paidAt: fullyPaid ? input.occurredAt : input.invoice.paidAt,
    updatedAt: now,
  });

  await writeAudit(ctx, {
    businessId: input.business._id,
    actorId: input.actorId,
    action: "payment.receipt",
    entity: "payments",
    entityId: paymentId,
    summary: `دریافت ${input.amount.toLocaleString("en-US")} ${
      input.method === "cash" ? "نقدی" : "بانکی"
    } بابت فاکتور ${input.invoice.number} از ${input.customer.name}`,
  });

  return { paymentId, paidAmount, fullyPaid };
}
