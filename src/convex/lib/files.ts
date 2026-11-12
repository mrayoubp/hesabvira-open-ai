import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

const REFERENCE_TABLES: {
  table:
    | "productCategories"
    | "products"
    | "receipts"
    | "paymentVouchers"
    | "incomeRecords"
    | "expenseRecords"
    | "employeeDocuments"
    | "taxRecords";
  field: string;
}[] = [
  { table: "productCategories", field: "imageStorageId" },
  { table: "products", field: "imageStorageId" },
  { table: "receipts", field: "attachmentStorageId" },
  { table: "paymentVouchers", field: "attachmentStorageId" },
  { table: "incomeRecords", field: "attachmentStorageId" },
  { table: "expenseRecords", field: "attachmentStorageId" },
  { table: "employeeDocuments", field: "storageId" },
  { table: "taxRecords", field: "attachmentStorageId" },
];

/**
 * A storage ID is readable only when it was uploaded for this business or is
 * already referenced by a document of this business. Convex storage IDs are
 * unguessable, but unguessable is not an authorization boundary.
 */
export async function fileBelongsToBusiness(
  ctx: Ctx,
  businessId: Id<"businesses">,
  storageId: Id<"_storage">,
) {
  const registered = await ctx.db
    .query("fileUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();

  if (registered.some((row) => row.businessId === businessId)) return true;
  if (registered.some((row) => row.businessId !== businessId)) return false;

  for (const reference of REFERENCE_TABLES) {
    const row = await (ctx.db.query(reference.table) as any)
      .withIndex("by_business", (q: any) => q.eq("businessId", businessId))
      .filter((q: any) => q.eq(q.field(reference.field), storageId))
      .first();
    if (row) return true;
  }

  return false;
}

export async function assertFileForBusiness(
  ctx: Ctx,
  businessId: Id<"businesses">,
  storageId: Id<"_storage">,
) {
  if (!(await fileBelongsToBusiness(ctx, businessId, storageId))) {
    throw new ConvexError("این فایل به کسب‌وکار فعال تعلق ندارد.");
  }
}

export async function requireFileAccess(
  ctx: Ctx,
  businessId: Id<"businesses">,
  storageId: Id<"_storage">,
) {
  if (!(await fileBelongsToBusiness(ctx, businessId, storageId))) {
    throw new ConvexError("این فایل به کسب‌وکار فعال تعلق ندارد.");
  }
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new ConvexError("فایل موردنظر در فضای ذخیره‌سازی یافت نشد.");
  return url;
}
