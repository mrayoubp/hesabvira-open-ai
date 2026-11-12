import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { InventoryDocumentType, ValuationMethod } from "../schema";

type Ctx = QueryCtx | MutationCtx;
export const MAX_STOCK_ROWS = 6000;

export function isStocked(product: Pick<Doc<"products">, "productType">) {
  return product.productType !== "service";
}

export function quantityValue(quantityMilli: number, unitCost: number) {
  return Math.round((quantityMilli * unitCost) / 1000);
}

export async function warehouseForBusiness(
  ctx: Ctx,
  businessId: Id<"businesses">,
  warehouseId: Id<"warehouses">,
) {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse || warehouse.businessId !== businessId) {
    throw new ConvexError("انبار انتخاب‌شده در این کسب‌وکار یافت نشد.");
  }
  if (!warehouse.active) {
    throw new ConvexError("انبار غیرفعال قابل استفاده نیست.");
  }
  return warehouse;
}

export async function defaultWarehouse(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  const rows = await ctx.db
    .query("warehouses")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  return rows.find((row) => row.isDefault && row.active) ?? rows.find((row) => row.active);
}

export async function stockAt(
  ctx: Ctx,
  businessId: Id<"businesses">,
  productId: Id<"products">,
  warehouseId?: Id<"warehouses">,
) {
  const rows = await ctx.db
    .query("inventoryTransactions")
    .withIndex("by_business_product", (q) =>
      q.eq("businessId", businessId).eq("productId", productId),
    )
    .take(MAX_STOCK_ROWS);
  return rows
    .filter((row) => !warehouseId || row.warehouseId === warehouseId)
    .reduce(
      (sum, row) =>
        sum + (row.direction === "in" ? row.quantityMilli : -row.quantityMilli),
      0,
    );
}

export async function stockByProduct(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  const rows = await ctx.db
    .query("inventoryTransactions")
    .withIndex("by_business_occurred", (q) =>
      q.eq("businessId", businessId),
    )
    .take(MAX_STOCK_ROWS);
  const totals = new Map<string, { in: number; out: number; value: number }>();
  for (const row of rows) {
    const key = `${row.warehouseId as string}:${row.productId as string}`;
    const entry = totals.get(key) ?? { in: 0, out: 0, value: 0 };
    if (row.direction === "in") {
      entry.in += row.quantityMilli;
      entry.value += row.value;
    } else {
      entry.out += row.quantityMilli;
      entry.value -= row.value;
    }
    totals.set(key, entry);
  }
  return totals;
}

export async function addCostLayer(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    warehouseId: Id<"warehouses">;
    productId: Id<"products">;
    quantityMilli: number;
    unitCost: number;
    sourceType: string;
    sourceId: string;
    occurredAt: number;
  },
) {
  if (input.quantityMilli <= 0 || input.unitCost < 0) return null;
  return await ctx.db.insert("inventoryCostLayers", {
    ...input,
    remainingMilli: input.quantityMilli,
    createdAt: Date.now(),
  });
}

/**
 * Consumes real cost layers. FIFO charges each layer's own cost; weighted
 * average charges the current average value of remaining layers. The layers
 * are still reduced so the next period starts from the remaining stock.
 */
export async function consumeCost(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    warehouseId: Id<"warehouses">;
    productId: Id<"products">;
    quantityMilli: number;
    occurredAt: number;
    allowNegativeStock: boolean;
    valuationMethod: ValuationMethod;
    fallbackUnitCost: number;
  },
): Promise<{ costTotal: number; unitCost: number }> {
  const layers = await ctx.db
    .query("inventoryCostLayers")
    .withIndex("by_product_warehouse", (q) =>
      q
        .eq("productId", input.productId)
        .eq("warehouseId", input.warehouseId),
    )
    .take(4000);
  const open = layers
    .filter((layer) => layer.remainingMilli > 0)
    .sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt);
  const available = open.reduce((sum, layer) => sum + layer.remainingMilli, 0);
  if (input.quantityMilli > available && !input.allowNegativeStock) {
    throw new ConvexError(
      "موجودی انبار برای این خروج کافی نیست؛ موجودی منفی در تنظیمات کسب‌وکار مجاز نشده است.",
    );
  }

  let need = input.quantityMilli;
  let consumedValue = 0;
  const totalValue = open.reduce(
    (sum, layer) => sum + quantityValue(layer.remainingMilli, layer.unitCost),
    0,
  );
  const averageUnit =
    available > 0
      ? Math.round((totalValue * 1000) / available)
      : input.fallbackUnitCost;

  for (const layer of open) {
    if (need <= 0) break;
    const take = Math.min(need, layer.remainingMilli);
    const chargeUnit =
      input.valuationMethod === "fifo" ? layer.unitCost : averageUnit;
    consumedValue += quantityValue(take, chargeUnit);
    await ctx.db.patch(layer._id, {
      remainingMilli: layer.remainingMilli - take,
    });
    need -= take;
  }

  if (need > 0) {
    consumedValue += quantityValue(need, averageUnit || input.fallbackUnitCost);
  }

  return {
    costTotal: consumedValue,
    unitCost:
      input.quantityMilli > 0
        ? Math.round((consumedValue * 1000) / input.quantityMilli)
        : input.fallbackUnitCost,
  };
}

export async function recordStockMovement(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    branchId: Id<"branches">;
    fiscalYearId: Id<"fiscalYears">;
    warehouseId: Id<"warehouses">;
    productId: Id<"products">;
    direction: "in" | "out";
    quantityMilli: number;
    unitCost: number;
    occurredAt: number;
    operationType: string;
    operationId: string;
    inventoryDocumentId?: Id<"inventoryDocuments">;
    description: string;
    actorId: Id<"users">;
    serialNumbers?: string[];
    expiryDate?: number;
  },
) {
  const current = await stockAt(
    ctx,
    input.businessId,
    input.productId,
    input.warehouseId,
  );
  const balanceAfterMilli =
    current + (input.direction === "in" ? input.quantityMilli : -input.quantityMilli);
  return await ctx.db.insert("inventoryTransactions", {
    businessId: input.businessId,
    branchId: input.branchId,
    fiscalYearId: input.fiscalYearId,
    warehouseId: input.warehouseId,
    productId: input.productId,
    direction: input.direction,
    quantityMilli: input.quantityMilli,
    unitCost: input.unitCost,
    value: quantityValue(input.quantityMilli, input.unitCost),
    occurredAt: input.occurredAt,
    operationType: input.operationType,
    operationId: input.operationId,
    inventoryDocumentId: input.inventoryDocumentId,
    description: input.description,
    balanceAfterMilli,
    serialNumbers: input.serialNumbers,
    expiryDate: input.expiryDate,
    createdBy: input.actorId,
    createdAt: Date.now(),
  });
}

export function inventoryEffect(type: InventoryDocumentType) {
  if (
    type === "receipt" ||
    type === "return_from_customer" ||
    type === "count"
  ) {
    return "in" as const;
  }
  return "out" as const;
}
