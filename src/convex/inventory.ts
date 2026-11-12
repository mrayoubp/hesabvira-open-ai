import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nextCounter, padSequence, requireMembership, writeAudit } from "./lib/tenant";
import { optionalString, requireInt, requireString } from "./lib/validation";
import { resolveDocumentScope } from "./lib/workspace";
import { assertWarehouseCapacity } from "./lib/subscriptionAccess";
import { getFiscalYear, assertDocumentDateInFiscalYear } from "./lib/accounting";
import { postAutoJournal, systemAccount } from "./lib/finance";
import {
  addCostLayer,
  consumeCost,
  isStocked,
  quantityValue,
  recordStockMovement,
  stockAt,
  stockByProduct,
  warehouseForBusiness,
} from "./lib/inventory";
import {
  inventoryDocumentStatusValidator,
  inventoryDocumentTypeValidator,
  valuationMethodValidator,
} from "./schema";

async function activeProduct(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  productId: Id<"products">,
) {
  const product = await ctx.db.get(productId);
  if (!product || product.businessId !== businessId) {
    throw new ConvexError("کالا در این کسب‌وکار یافت نشد.");
  }
  if (!product.active) throw new ConvexError("کالای غیرفعال قابل استفاده نیست.");
  return product;
}

export const warehouses = query({
  args: { businessId: v.id("businesses"), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("warehouses")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("asc")
      .take(300);
    return rows
      .filter((row) => args.includeInactive || row.active)
      .map((row) => ({
        _id: row._id as string,
        code: row.code,
        name: row.name,
        branchId: row.branchId as string,
        responsibleName: row.responsibleName ?? null,
        address: row.address ?? null,
        isDefault: row.isDefault,
        active: row.active,
      }));
  },
});

export const createWarehouse = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.optional(v.string()),
    name: v.string(),
    branchId: v.optional(v.id("branches")),
    responsibleName: v.optional(v.string()),
    address: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    await assertWarehouseCapacity(ctx, args.businessId);
    let branchId = args.branchId;
    if (branchId) {
      const branch = await ctx.db.get(branchId);
      if (!branch || branch.businessId !== args.businessId) {
        throw new ConvexError("شعبه انبار یافت نشد.");
      }
    } else {
      const scope = await resolveDocumentScope(ctx, args.businessId, Date.now());
      branchId = scope.branchId;
    }
    if (!branchId) throw new ConvexError("شعبه انبار مشخص نیست.");
    const requestedCode = optionalString(args.code, "کد انبار", 40);
    let code = requestedCode;
    if (code) {
      const duplicate = await ctx.db
        .query("warehouses")
        .withIndex("by_business_code", (q) =>
          q.eq("businessId", args.businessId).eq("code", code as string),
        )
        .unique();
      if (duplicate) throw new ConvexError("کد انبار تکراری است.");
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "warehouse");
      code = padSequence(sequence, "WH");
    }
    const existing = await ctx.db
      .query("warehouses")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(300);
    const makeDefault = Boolean(args.isDefault) || existing.length === 0;
    if (makeDefault) {
      for (const row of existing.filter((row) => row.isDefault)) {
        await ctx.db.patch(row._id, { isDefault: false, updatedAt: Date.now() });
      }
    }
    const now = Date.now();
    const warehouseId = await ctx.db.insert("warehouses", {
      businessId: args.businessId,
      branchId,
      code,
      name: requireString(args.name, "نام انبار", { max: 120 }) as string,
      responsibleName: optionalString(args.responsibleName, "مسئول انبار", 120),
      address: optionalString(args.address, "نشانی", 400),
      isDefault: makeDefault,
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "warehouse.create",
      entity: "warehouses",
      entityId: warehouseId,
      summary: `ایجاد انبار ${code}`,
    });
    return { warehouseId, code };
  },
});

export const updateWarehouse = mutation({
  args: {
    businessId: v.id("businesses"),
    warehouseId: v.id("warehouses"),
    name: v.string(),
    responsibleName: v.optional(v.string()),
    address: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId, { write: true });
    const warehouse = await warehouseForBusiness(ctx, args.businessId, args.warehouseId);
    if (args.isDefault) {
      const rows = await ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(300);
      for (const row of rows.filter((row) => row.isDefault && row._id !== warehouse._id)) {
        await ctx.db.patch(row._id, { isDefault: false, updatedAt: Date.now() });
      }
    }
    await ctx.db.patch(warehouse._id, {
      name: requireString(args.name, "نام انبار", { max: 120 }) as string,
      responsibleName: optionalString(args.responsibleName, "مسئول انبار", 120),
      address: optionalString(args.address, "نشانی", 400),
      isDefault: args.isDefault ?? warehouse.isDefault,
      active: args.active ?? warehouse.active,
      updatedAt: Date.now(),
    });
    return { warehouseId: warehouse._id };
  },
});

export const balances = query({
  args: {
    businessId: v.id("businesses"),
    warehouseId: v.optional(v.id("warehouses")),
    lowStockOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [products, warehouses, totals] = await Promise.all([
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2500),
      ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(300),
      stockByProduct(ctx, args.businessId),
    ]);
    const productMap = new Map(products.map((row) => [row._id as string, row]));
    const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
    const grouped = new Map<
      string,
      { productId: string; warehouseId: string; quantityMilli: number; value: number }
    >();
    for (const [key, value] of totals) {
      const [warehouseId, productId] = key.split(":");
      if (args.warehouseId && warehouseId !== args.warehouseId) continue;
      const quantityMilli = value.in - value.out;
      const entry = grouped.get(key) ?? { productId, warehouseId, quantityMilli: 0, value: 0 };
      entry.quantityMilli += quantityMilli;
      entry.value += value.value;
      grouped.set(key, entry);
    }
    const needle = args.search?.trim().toLowerCase();
    const rows = [...grouped.values()]
      .map((row) => {
        const product = productMap.get(row.productId);
        const warehouse = warehouseMap.get(row.warehouseId);
        return {
          productId: row.productId,
          warehouseId: row.warehouseId,
          productCode: product?.code ?? "—",
          productName: product?.name ?? "—",
          unit: product?.unit ?? "",
          warehouseName: warehouse?.name ?? "—",
          quantityMilli: row.quantityMilli,
          averageCost:
            row.quantityMilli > 0
              ? Math.round((row.value * 1000) / row.quantityMilli)
              : (product?.purchasePrice ?? 0),
          value: Math.abs(row.value),
          minStockMilli: product?.minStockMilli ?? 0,
          lowStock:
            Boolean(product && product.productType !== "service") &&
            row.quantityMilli <= (product?.minStockMilli ?? 0),
        };
      })
      .filter((row) => row.productName !== "—")
      .filter((row) => !needle || `${row.productName} ${row.productCode}`.toLowerCase().includes(needle))
      .filter((row) => !args.lowStockOnly || row.lowStock)
      .sort((a, b) => a.productName.localeCompare(b.productName, "fa"));
    return {
      rows,
      totalQuantityMilli: rows.reduce((sum, row) => sum + row.quantityMilli, 0),
      totalValue: rows.reduce((sum, row) => sum + row.value, 0),
      lowStockCount: rows.filter((row) => row.lowStock).length,
    };
  },
});

export const productCardex = query({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    warehouseId: v.optional(v.id("warehouses")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const product = await activeProduct(ctx, args.businessId, args.productId);
    const rows = await ctx.db
      .query("inventoryTransactions")
      .withIndex("by_business_product", (q) =>
        q.eq("businessId", args.businessId).eq("productId", args.productId),
      )
      .order("asc")
      .take(5000);
    let running = 0;
    return rows
      .filter((row) => !args.warehouseId || row.warehouseId === args.warehouseId)
      .map((row) => {
        running += row.direction === "in" ? row.quantityMilli : -row.quantityMilli;
        return {
          _id: row._id as string,
          occurredAt: row.occurredAt,
          warehouseId: row.warehouseId as string,
          direction: row.direction,
          quantityMilli: row.quantityMilli,
          unitCost: row.unitCost,
          value: row.value,
          description: row.description,
          operationType: row.operationType,
          runningMilli: running,
        };
      })
      .filter((row) => (!args.from || row.occurredAt >= args.from) && (!args.to || row.occurredAt <= args.to))
      .reverse()
      .map((row) => ({ ...row, productName: product.name, productCode: product.code }));
  },
});

export const documents = query({
  args: {
    businessId: v.id("businesses"),
    type: v.optional(inventoryDocumentTypeValidator),
    status: v.optional(inventoryDocumentStatusValidator),
    warehouseId: v.optional(v.id("warehouses")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("inventoryDocuments")
      .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(Math.min(args.limit ?? 200, 500));
    const warehouseIds = [
      ...new Set(
        rows.flatMap((row) => [row.fromWarehouseId, row.toWarehouseId]).filter((id): id is Id<"warehouses"> => Boolean(id)),
      ),
    ];
    const warehouses = await Promise.all(warehouseIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      warehouses.filter((row): row is Doc<"warehouses"> => Boolean(row)).map((row) => [row._id as string, row.name]),
    );
    return rows
      .filter((row) => !args.type || row.type === args.type)
      .filter((row) => !args.status || row.status === args.status)
      .filter(
        (row) =>
          !args.warehouseId ||
          row.fromWarehouseId === args.warehouseId ||
          row.toWarehouseId === args.warehouseId,
      )
      .map((row) => ({
        _id: row._id as string,
        number: row.number,
        type: row.type,
        status: row.status,
        fromWarehouseId: row.fromWarehouseId ? (row.fromWarehouseId as string) : null,
        toWarehouseId: row.toWarehouseId ? (row.toWarehouseId as string) : null,
        fromWarehouseName: row.fromWarehouseId ? (names.get(row.fromWarehouseId as string) ?? null) : null,
        toWarehouseName: row.toWarehouseId ? (names.get(row.toWarehouseId as string) ?? null) : null,
        occurredAt: row.occurredAt,
        description: row.description,
        totalValue: row.totalValue,
        accountingDocumentId: row.accountingDocumentId ? (row.accountingDocumentId as string) : null,
      }));
  },
});

export const getDocument = query({
  args: { businessId: v.id("businesses"), documentId: v.id("inventoryDocuments") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.businessId !== args.businessId) {
      throw new ConvexError("سند انبار یافت نشد.");
    }
    const [lines, products, warehouses] = await Promise.all([
      ctx.db
        .query("inventoryDocumentLines")
        .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2500),
      ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(300),
    ]);
    const productMap = new Map(products.map((row) => [row._id as string, row]));
    const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
    return {
      ...document,
      _id: document._id as string,
      fromWarehouseName: document.fromWarehouseId
        ? (warehouseMap.get(document.fromWarehouseId as string)?.name ?? null)
        : null,
      toWarehouseName: document.toWarehouseId
        ? (warehouseMap.get(document.toWarehouseId as string)?.name ?? null)
        : null,
      lines: lines
        .sort((a, b) => a.position - b.position)
        .map((line) => ({
          ...line,
          _id: line._id as string,
          productName: productMap.get(line.productId as string)?.name ?? "—",
          productCode: productMap.get(line.productId as string)?.code ?? "—",
          unit: productMap.get(line.productId as string)?.unit ?? "",
        })),
    };
  },
});

export const createDocument = mutation({
  args: {
    businessId: v.id("businesses"),
    type: inventoryDocumentTypeValidator,
    fromWarehouseId: v.optional(v.id("warehouses")),
    toWarehouseId: v.optional(v.id("warehouses")),
    occurredAt: v.number(),
    description: v.string(),
    adjustmentDirection: v.optional(v.union(v.literal("in"), v.literal("out"))),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantityMilli: v.number(),
        unitCost: v.optional(v.number()),
        serialNumbers: v.optional(v.array(v.string())),
        expiryDate: v.optional(v.number()),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    if (!Number.isFinite(args.occurredAt) || !Number.isInteger(args.occurredAt)) {
      throw new ConvexError("تاریخ سند انبار معتبر نیست.");
    }
    if (args.lines.length === 0) throw new ConvexError("سند انبار باید حداقل یک ردیف داشته باشد.");
    if (args.lines.length > 100) throw new ConvexError("حداکثر ۱۰۰ ردیف در سند انبار مجاز است.");
    if (args.type === "transfer") {
      if (!args.fromWarehouseId || !args.toWarehouseId) {
        throw new ConvexError("انبار مبدأ و مقصد انتقال را انتخاب کنید.");
      }
      if (args.fromWarehouseId === args.toWarehouseId) {
        throw new ConvexError("انبار مبدأ و مقصد نمی‌توانند یکی باشند.");
      }
      await warehouseForBusiness(ctx, args.businessId, args.fromWarehouseId);
      await warehouseForBusiness(ctx, args.businessId, args.toWarehouseId);
    } else if (!args.toWarehouseId && !args.fromWarehouseId) {
      throw new ConvexError("انبار سند را انتخاب کنید.");
    }
    if (args.type === "adjustment" || args.type === "count") {
      if (!args.adjustmentDirection) {
        throw new ConvexError("جهت اصلاح موجودی را مشخص کنید.");
      }
    }
    const products = await Promise.all(
      args.lines.map((line) => activeProduct(ctx, args.businessId, line.productId)),
    );
    for (const [index, line] of args.lines.entries()) {
      requireInt(line.quantityMilli, "تعداد", { min: 1 });
      if (!isStocked(products[index])) {
        throw new ConvexError("خدمات را نمی‌توان در سند انبار ثبت کرد.");
      }
      if (products[index].trackSerial) {
        const units = line.quantityMilli / 1000;
        if (!Number.isInteger(units)) {
          throw new ConvexError("تعداد کالای سریال‌دار باید صحیح باشد.");
        }
        if (!line.serialNumbers || line.serialNumbers.length !== units) {
          throw new ConvexError("تعداد سریال‌ها باید با تعداد کالا برابر باشد.");
        }
      }
      if (products[index].trackExpiry && !line.expiryDate) {
        throw new ConvexError("برای کالای دارای انقضا، تاریخ انقضا الزامی است.");
      }
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, args.occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی سند انبار مشخص نیست.");
    }
    const sequence = await nextCounter(ctx, args.businessId, "inventory-document");
    const number = padSequence(sequence, "INV-DOC");
    const now = Date.now();
    const documentId = await ctx.db.insert("inventoryDocuments", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      sequence,
      number,
      type: args.type,
      status: "draft",
      adjustmentDirection: args.adjustmentDirection,
      fromWarehouseId:
        args.type === "transfer" ? args.fromWarehouseId : args.fromWarehouseId,
      toWarehouseId: args.toWarehouseId,
      occurredAt: args.occurredAt,
      description: requireString(args.description, "شرح سند", { max: 500 }) as string,
      totalValue: 0,
      createdBy: user._id,
      createdAt: now,
    });
    for (const [position, line] of args.lines.entries()) {
      const product = products[position];
      const unitCost = requireInt(
        line.unitCost ?? product.purchasePrice,
        "بهای واحد",
        { min: 0 },
      );
      await ctx.db.insert("inventoryDocumentLines", {
        businessId: args.businessId,
        documentId,
        productId: line.productId,
        quantityMilli: line.quantityMilli,
        unitCost,
        value: quantityValue(line.quantityMilli, unitCost),
        serialNumbers: line.serialNumbers,
        expiryDate: line.expiryDate,
        description: optionalString(line.description, "شرح ردیف", 300),
        position,
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "inventory.draft",
      entity: "inventoryDocuments",
      entityId: documentId,
      summary: `پیش‌نویس سند انبار ${number}`,
    });
    return { documentId, number };
  },
});

export const postDocument = mutation({
  args: { businessId: v.id("businesses"), documentId: v.id("inventoryDocuments") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const { business } = await requireMembership(ctx, args.businessId);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.businessId !== args.businessId) {
      throw new ConvexError("سند انبار یافت نشد.");
    }
    if (document.status !== "draft") {
      throw new ConvexError("این سند انبار قبلاً ثبت یا لغو شده است.");
    }
    const fiscalYear = await getFiscalYear(ctx, args.businessId, document.fiscalYearId);
    assertDocumentDateInFiscalYear(fiscalYear, document.occurredAt);
    const [lines, products, fromWarehouse, toWarehouse] = await Promise.all([
      ctx.db
        .query("inventoryDocumentLines")
        .withIndex("by_document", (q) => q.eq("documentId", document._id))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2500),
      document.fromWarehouseId
        ? ctx.db.get(document.fromWarehouseId)
        : Promise.resolve(null),
      document.toWarehouseId ? ctx.db.get(document.toWarehouseId) : Promise.resolve(null),
    ]);
    const productMap = new Map(products.map((row) => [row._id as string, row]));
    const method = business.inventoryValuationMethod ?? "weighted_average";
    const allowNegative = Boolean(business.allowNegativeStock);
    let totalValue = 0;
    const inbound =
      document.type === "receipt" ||
      document.type === "return_from_customer" ||
      ((document.type === "adjustment" || document.type === "count") &&
        document.adjustmentDirection !== "out");
    for (const line of lines.sort((a, b) => a.position - b.position)) {
      const product = productMap.get(line.productId as string);
      if (!product) throw new ConvexError("کالای یکی از ردیف‌ها یافت نشد.");
      if (document.type === "transfer") {
        if (!fromWarehouse || !toWarehouse) throw new ConvexError("انبارهای انتقال کامل نیستند.");
        const cost = await consumeCost(ctx, {
          businessId: args.businessId,
          warehouseId: fromWarehouse._id,
          productId: product._id,
          quantityMilli: line.quantityMilli,
          occurredAt: document.occurredAt,
          allowNegativeStock: allowNegative,
          valuationMethod: method,
          fallbackUnitCost: product.purchasePrice,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: document.branchId,
          fiscalYearId: document.fiscalYearId,
          warehouseId: fromWarehouse._id,
          productId: product._id,
          direction: "out",
          quantityMilli: line.quantityMilli,
          unitCost: cost.unitCost,
          occurredAt: document.occurredAt,
          operationType: "transfer",
          operationId: document._id as string,
          inventoryDocumentId: document._id,
          description: `انتقال ${document.number} به ${toWarehouse.name}`,
          actorId: user._id,
          serialNumbers: line.serialNumbers,
          expiryDate: line.expiryDate,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: document.branchId,
          fiscalYearId: document.fiscalYearId,
          warehouseId: toWarehouse._id,
          productId: product._id,
          direction: "in",
          quantityMilli: line.quantityMilli,
          unitCost: cost.unitCost,
          occurredAt: document.occurredAt,
          operationType: "transfer",
          operationId: document._id as string,
          inventoryDocumentId: document._id,
          description: `انتقال ${document.number} از ${fromWarehouse.name}`,
          actorId: user._id,
          serialNumbers: line.serialNumbers,
          expiryDate: line.expiryDate,
        });
        await addCostLayer(ctx, {
          businessId: args.businessId,
          warehouseId: toWarehouse._id,
          productId: product._id,
          quantityMilli: line.quantityMilli,
          unitCost: cost.unitCost,
          sourceType: "inventory-document",
          sourceId: document._id as string,
          occurredAt: document.occurredAt,
        });
        totalValue += cost.costTotal;
        continue;
      }

      const warehouseId = toWarehouse?._id ?? fromWarehouse?._id;
      if (!warehouseId) throw new ConvexError("انبار سند مشخص نیست.");
      const outbound =
        document.type === "issue" ||
        document.type === "return_to_supplier" ||
        ((document.type === "adjustment" || document.type === "count") &&
          document.adjustmentDirection === "out");
      if (!outbound) {
        await addCostLayer(ctx, {
          businessId: args.businessId,
          warehouseId,
          productId: product._id,
          quantityMilli: line.quantityMilli,
          unitCost: line.unitCost,
          sourceType: "inventory-document",
          sourceId: document._id as string,
          occurredAt: document.occurredAt,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: document.branchId,
          fiscalYearId: document.fiscalYearId,
          warehouseId,
          productId: product._id,
          direction: "in",
          quantityMilli: line.quantityMilli,
          unitCost: line.unitCost,
          occurredAt: document.occurredAt,
          operationType: document.type,
          operationId: document._id as string,
          inventoryDocumentId: document._id,
          description: document.description,
          actorId: user._id,
          serialNumbers: line.serialNumbers,
          expiryDate: line.expiryDate,
        });
        totalValue += line.value;
      } else {
        const cost = await consumeCost(ctx, {
          businessId: args.businessId,
          warehouseId,
          productId: product._id,
          quantityMilli: line.quantityMilli,
          occurredAt: document.occurredAt,
          allowNegativeStock: allowNegative,
          valuationMethod: method,
          fallbackUnitCost: product.purchasePrice,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: document.branchId,
          fiscalYearId: document.fiscalYearId,
          warehouseId,
          productId: product._id,
          direction: "out",
          quantityMilli: line.quantityMilli,
          unitCost: cost.unitCost,
          occurredAt: document.occurredAt,
          operationType: document.type,
          operationId: document._id as string,
          inventoryDocumentId: document._id,
          description: document.description,
          actorId: user._id,
          serialNumbers: line.serialNumbers,
          expiryDate: line.expiryDate,
        });
        totalValue += cost.costTotal;
      }
    }

    let accountingDocumentId: Id<"accountingDocuments"> | undefined;
    if (document.type !== "transfer" && totalValue > 0) {
      const inventory = await systemAccount(ctx, args.businessId, "inventory", user._id);
      const offset = await systemAccount(
        ctx,
        args.businessId,
        inbound ? "capital" : "otherExpense",
        user._id,
      );
      const journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: document.occurredAt,
        description: `سند انبار ${document.number} — ${document.description}`,
        sourceType: "inventory-document",
        sourceId: document._id as string,
        branchId: document.branchId,
        lines: inbound
          ? [
              { accountId: inventory._id, description: "افزایش موجودی", debit: totalValue, credit: 0 },
              { accountId: offset._id, description: "طرف سند موجودی", debit: 0, credit: totalValue },
            ]
          : [
              { accountId: offset._id, description: "کاهش موجودی", debit: totalValue, credit: 0 },
              { accountId: inventory._id, description: "کاهش موجودی", debit: 0, credit: totalValue },
            ],
      });
      accountingDocumentId = journal.documentId;
    }

    await ctx.db.patch(document._id, {
      status: "posted",
      postedAt: Date.now(),
      totalValue,
      accountingDocumentId,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "inventory.post",
      entity: "inventoryDocuments",
      entityId: document._id,
      summary: `ثبت سند انبار ${document.number}`,
    });
    return { documentId: document._id, accountingDocumentId };
  },
});

export const settings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { business } = await requireMembership(ctx, args.businessId);
    return {
      valuationMethod: business.inventoryValuationMethod ?? "weighted_average",
      allowNegativeStock: Boolean(business.allowNegativeStock),
    };
  },
});

export const updateValuationMethod = mutation({
  args: {
    businessId: v.id("businesses"),
    method: valuationMethodValidator,
    allowNegativeStock: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { manage: true });
    await ctx.db.patch(args.businessId, {
      inventoryValuationMethod: args.method,
      allowNegativeStock: args.allowNegativeStock,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "inventory.settings",
      entity: "businesses",
      entityId: args.businessId,
      summary: `روش ارزش‌گذاری موجودی: ${args.method}`,
    });
    return { method: args.method };
  },
});
