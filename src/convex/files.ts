import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  fileBelongsToBusiness,
  requireFileAccess,
} from "./lib/files";
import { enforceRateLimit, writeSecurityEvent } from "./lib/security";
import { assertStorageCapacity } from "./lib/subscriptionAccess";

/** Upload URL for receipts, invoices, expense vouchers and other documents. */
export const generateUploadUrl = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    await enforceRateLimit(ctx, {
      userId: user._id,
      businessId: args.businessId,
      action: "files.upload-url",
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Binds an uploaded blob to the active business. Without this record a storage
 * ID is not readable through the generic file endpoint, so a member of another
 * tenant cannot reuse a leaked ID.
 */
export const registerUpload = mutation({
  args: {
    businessId: v.id("businesses"),
    storageId: v.id("_storage"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const metadata = await ctx.storage.getMetadata(args.storageId);
    if (!metadata) throw new ConvexError("فایل آپلودشده پیدا نشد.");

    const existing = await ctx.db
      .query("fileUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .collect();
    if (existing.some((row) => row.businessId !== args.businessId)) {
      throw new ConvexError("این فایل قبلاً به کسب‌وکار دیگری متصل شده است.");
    }
    if (existing.some((row) => row.businessId === args.businessId)) {
      return existing[0]._id;
    }

    await assertStorageCapacity(
      ctx,
      args.businessId,
      metadata.size ?? 0,
    );
    const name = args.name.trim().slice(0, 180) || "پیوست";
    const id = await ctx.db.insert("fileUploads", {
      businessId: args.businessId,
      storageId: args.storageId,
      name,
      mimeType: metadata.contentType ?? undefined,
      size: metadata.size,
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "file.upload",
      entity: "fileUploads",
      entityId: id,
      summary: `آپلود فایل «${name}»`,
    });
    await writeSecurityEvent(ctx, {
      userId: user._id,
      businessId: args.businessId,
      action: "file.upload",
      detail: name,
    });
    return id;
  },
});

export const assertBusinessFile = mutation({
  args: {
    businessId: v.id("businesses"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId, { write: true });
    if (!(await fileBelongsToBusiness(ctx, args.businessId, args.storageId))) {
      throw new ConvexError("این فایل به کسب‌وکار فعال تعلق ندارد.");
    }
    return true;
  },
});

export const url = query({
  args: {
    businessId: v.id("businesses"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    return await requireFileAccess(ctx, args.businessId, args.storageId);
  },
});
