import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nextCounter, padSequence, requireMembership, writeAudit } from "./lib/tenant";
import { assertFileForBusiness } from "./lib/files";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { productTypeValidator } from "./schema";

async function loadProduct(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  productId: Id<"products">,
) {
  const product = await ctx.db.get(productId);
  if (!product || product.businessId !== businessId) {
    throw new ConvexError("کالا در این کسب‌وکار یافت نشد.");
  }
  return product;
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("productCategories")),
    includeInactive: v.optional(v.boolean()),
    lowStockOnly: v.optional(v.boolean()),
    warehouseId: v.optional(v.id("warehouses")),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [rows, categories, stockRows] = await Promise.all([
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .order("desc")
        .take(2500),
      ctx.db
        .query("productCategories")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(800),
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(6000),
    ]);
    const categoryNames = new Map(categories.map((row) => [row._id as string, row.name]));
    const stock = new Map<string, number>();
    for (const row of stockRows) {
      if (args.warehouseId && row.warehouseId !== args.warehouseId) continue;
      const key = row.productId as string;
      stock.set(key, (stock.get(key) ?? 0) + (row.direction === "in" ? row.quantityMilli : -row.quantityMilli));
    }
    const needle = args.search?.trim().toLowerCase();
    return rows
      .filter((row) => args.includeInactive || row.active)
      .filter((row) => !args.categoryId || row.categoryId === args.categoryId)
      .filter((row) => {
        if (!needle) return true;
        return [row.name, row.code, row.barcode, row.brand]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .map((row) => {
        const quantityMilli = stock.get(row._id as string) ?? 0;
        return {
          _id: row._id as string,
          code: row.code,
          barcode: row.barcode ?? null,
          name: row.name,
          categoryId: row.categoryId ? (row.categoryId as string) : null,
          categoryName: row.categoryId
            ? (categoryNames.get(row.categoryId as string) ?? null)
            : null,
          brand: row.brand ?? null,
          unit: row.unit,
          purchasePrice: row.purchasePrice,
          salePrice: row.salePrice,
          taxRateBps: row.taxRateBps,
          minStockMilli: row.minStockMilli,
          productType: row.productType,
          trackSerial: row.trackSerial,
          trackExpiry: row.trackExpiry,
          expiryDate: row.expiryDate ?? null,
          description: row.description ?? null,
          active: row.active,
          quantityMilli,
          lowStock: row.productType !== "service" && quantityMilli <= row.minStockMilli,
          createdAt: row.createdAt,
        };
      })
      .filter((row) => !args.lowStockOnly || row.lowStock);
  },
});

export const get = query({
  args: { businessId: v.id("businesses"), productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const product = await loadProduct(ctx, args.businessId, args.productId);
    const [category, priceHistory, allTransactions, transactions] = await Promise.all([
      product.categoryId ? ctx.db.get(product.categoryId) : Promise.resolve(null),
      ctx.db
        .query("productPriceHistory")
        .withIndex("by_product", (q) => q.eq("productId", args.productId))
        .order("desc")
        .take(50),
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_business_product", (q) =>
          q.eq("businessId", args.businessId).eq("productId", args.productId),
        )
        .take(8000),
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_business_product", (q) =>
          q.eq("businessId", args.businessId).eq("productId", args.productId),
        )
        .order("desc")
        .take(100),
    ]);
    const imageUrl = product.imageStorageId
      ? await ctx.storage.getUrl(product.imageStorageId)
      : null;
    return {
      ...product,
      _id: product._id as string,
      categoryName: category?.name ?? null,
      imageUrl,
      quantityMilli: allTransactions.reduce(
        (sum, row) => sum + (row.direction === "in" ? row.quantityMilli : -row.quantityMilli),
        0,
      ),
      priceHistory: priceHistory.map((row) => ({
        _id: row._id as string,
        purchasePrice: row.purchasePrice,
        salePrice: row.salePrice,
        createdAt: row.createdAt,
      })),
      transactions: transactions.map((row) => ({
        _id: row._id as string,
        direction: row.direction,
        quantityMilli: row.quantityMilli,
        unitCost: row.unitCost,
        occurredAt: row.occurredAt,
        description: row.description,
        warehouseId: row.warehouseId as string,
      })),
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.optional(v.string()),
    barcode: v.optional(v.string()),
    name: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    categoryId: v.optional(v.id("productCategories")),
    brand: v.optional(v.string()),
    unit: v.string(),
    purchasePrice: v.number(),
    salePrice: v.number(),
    taxRateBps: v.number(),
    minStockMilli: v.optional(v.number()),
    productType: productTypeValidator,
    trackSerial: v.optional(v.boolean()),
    trackExpiry: v.optional(v.boolean()),
    expiryDate: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    if (args.imageStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.imageStorageId);
    }
    const requestedCode = optionalString(args.code, "کد کالا", 40);
    let code = requestedCode;
    if (code) {
      const duplicate = await ctx.db
        .query("products")
        .withIndex("by_business_code", (q) =>
          q.eq("businessId", args.businessId).eq("code", code as string),
        )
        .unique();
      if (duplicate) throw new ConvexError("کد کالا تکراری است.");
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "product");
      code = padSequence(sequence, "PRD");
    }
    const barcode = optionalString(args.barcode, "بارکد", 60);
    if (barcode) {
      const duplicate = await ctx.db
        .query("products")
        .withIndex("by_business_barcode", (q) =>
          q.eq("businessId", args.businessId).eq("barcode", barcode),
        )
        .unique();
      if (duplicate) throw new ConvexError("این بارکد قبلاً ثبت شده است.");
    }
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.businessId !== args.businessId) {
        throw new ConvexError("دسته‌بندی انتخاب‌شده یافت نشد.");
      }
    }
    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      businessId: args.businessId,
      code,
      barcode,
      name: requireString(args.name, "نام کالا", { max: 180 }) as string,
      imageStorageId: args.imageStorageId,
      categoryId: args.categoryId,
      brand: optionalString(args.brand, "برند", 100),
      unit: requireString(args.unit, "واحد", { max: 40 }) as string,
      purchasePrice: requireInt(args.purchasePrice, "قیمت خرید", { min: 0 }),
      salePrice: requireInt(args.salePrice, "قیمت فروش", { min: 0 }),
      taxRateBps: requireInt(args.taxRateBps, "نرخ مالیات", { min: 0, max: 10000 }),
      minStockMilli: requireInt(args.minStockMilli ?? 0, "حداقل موجودی", { min: 0 }),
      productType: args.productType,
      trackSerial: args.productType === "serial" || Boolean(args.trackSerial),
      trackExpiry: args.productType === "expiry" || Boolean(args.trackExpiry),
      expiryDate: args.expiryDate,
      description: optionalString(args.description, "توضیحات", 800),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("productPriceHistory", {
      businessId: args.businessId,
      productId,
      purchasePrice: args.purchasePrice,
      salePrice: args.salePrice,
      changedBy: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "product.create",
      entity: "products",
      entityId: productId,
      summary: `ثبت کالا ${code}`,
    });
    return { productId, code };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    code: v.optional(v.string()),
    barcode: v.optional(v.string()),
    name: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    categoryId: v.optional(v.id("productCategories")),
    brand: v.optional(v.string()),
    unit: v.string(),
    purchasePrice: v.number(),
    salePrice: v.number(),
    taxRateBps: v.number(),
    minStockMilli: v.optional(v.number()),
    productType: productTypeValidator,
    trackSerial: v.optional(v.boolean()),
    trackExpiry: v.optional(v.boolean()),
    expiryDate: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    if (args.imageStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.imageStorageId);
    }
    const product = await loadProduct(ctx, args.businessId, args.productId);
    let code = product.code;
    if (args.code !== undefined) {
      const requested = requireString(args.code, "کد کالا", { max: 40 }) as string;
      if (requested !== product.code) {
        const duplicate = await ctx.db
          .query("products")
          .withIndex("by_business_code", (q) =>
            q.eq("businessId", args.businessId).eq("code", requested),
          )
          .unique();
        if (duplicate) throw new ConvexError("کد کالا تکراری است.");
        code = requested;
      }
    }
    const barcode = optionalString(args.barcode, "بارکد", 60);
    if (barcode && barcode !== product.barcode) {
      const duplicate = await ctx.db
        .query("products")
        .withIndex("by_business_barcode", (q) =>
          q.eq("businessId", args.businessId).eq("barcode", barcode),
        )
        .unique();
      if (duplicate) throw new ConvexError("این بارکد قبلاً ثبت شده است.");
    }
    const now = Date.now();
    await ctx.db.patch(product._id, {
      code,
      barcode,
      name: requireString(args.name, "نام کالا", { max: 180 }) as string,
      imageStorageId: args.imageStorageId,
      categoryId: args.categoryId,
      brand: optionalString(args.brand, "برند", 100),
      unit: requireString(args.unit, "واحد", { max: 40 }) as string,
      purchasePrice: requireInt(args.purchasePrice, "قیمت خرید", { min: 0 }),
      salePrice: requireInt(args.salePrice, "قیمت فروش", { min: 0 }),
      taxRateBps: requireInt(args.taxRateBps, "نرخ مالیات", { min: 0, max: 10000 }),
      minStockMilli: requireInt(args.minStockMilli ?? product.minStockMilli, "حداقل موجودی", { min: 0 }),
      productType: args.productType,
      trackSerial: args.productType === "serial" || Boolean(args.trackSerial),
      trackExpiry: args.productType === "expiry" || Boolean(args.trackExpiry),
      expiryDate: args.expiryDate,
      description: optionalString(args.description, "توضیحات", 800),
      updatedAt: now,
    });
    if (
      args.purchasePrice !== product.purchasePrice ||
      args.salePrice !== product.salePrice
    ) {
      await ctx.db.insert("productPriceHistory", {
        businessId: args.businessId,
        productId: product._id,
        purchasePrice: args.purchasePrice,
        salePrice: args.salePrice,
        changedBy: user._id,
        createdAt: now,
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "product.update",
      entity: "products",
      entityId: product._id,
      summary: `ویرایش کالا ${code}`,
    });
    return { productId: product._id };
  },
});

export const setActive = mutation({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const product = await loadProduct(ctx, args.businessId, args.productId);
    await ctx.db.patch(product._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "product.activate" : "product.deactivate",
      entity: "products",
      entityId: product._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} ${product.code}`,
    });
    return { productId: product._id };
  },
});

export const lookupBarcode = query({
  args: { businessId: v.id("businesses"), barcode: v.string() },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    return await ctx.db
      .query("products")
      .withIndex("by_business_barcode", (q) =>
        q.eq("businessId", args.businessId).eq("barcode", args.barcode.trim()),
      )
      .unique();
  },
});

export const categories = query({
  args: {
    businessId: v.id("businesses"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("productCategories")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("asc")
      .take(800);
    return rows
      .filter((row) => args.includeInactive || row.active)
      .map((row) => ({
        _id: row._id as string,
        code: row.code,
        name: row.name,
        parentId: row.parentId ? (row.parentId as string) : null,
        description: row.description ?? null,
        active: row.active,
      }));
  },
});

export const createCategory = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    parentId: v.optional(v.id("productCategories")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.businessId !== args.businessId) {
        throw new ConvexError("دسته والد یافت نشد.");
      }
    }
    const sequence = await nextCounter(ctx, args.businessId, "product-category");
    const code = padSequence(sequence, "CAT");
    const now = Date.now();
    const categoryId = await ctx.db.insert("productCategories", {
      businessId: args.businessId,
      code,
      name: requireString(args.name, "نام دسته", { max: 120 }) as string,
      parentId: args.parentId,
      description: optionalString(args.description, "توضیحات", 400),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return { categoryId, code };
  },
});

export const updateCategory = mutation({
  args: {
    businessId: v.id("businesses"),
    categoryId: v.id("productCategories"),
    name: v.string(),
    parentId: v.optional(v.id("productCategories")),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const category = await ctx.db.get(args.categoryId);
    if (!category || category.businessId !== args.businessId) {
      throw new ConvexError("دسته‌بندی یافت نشد.");
    }
    if (args.parentId === args.categoryId) {
      throw new ConvexError("دسته نمی‌تواند والد خودش باشد.");
    }
    await ctx.db.patch(category._id, {
      name: requireString(args.name, "نام دسته", { max: 120 }) as string,
      parentId: args.parentId,
      description: optionalString(args.description, "توضیحات", 400),
      active: args.active ?? category.active,
      updatedAt: Date.now(),
    });
    return { categoryId: category._id };
  },
});
