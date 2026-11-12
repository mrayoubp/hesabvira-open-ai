import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireMembership } from "./lib/tenant";

const reportKindValidator = v.union(
  v.literal("sales-daily"),
  v.literal("sales-monthly"),
  v.literal("sales-yearly"),
  v.literal("sales-by-customer"),
  v.literal("sales-by-product"),
  v.literal("sales-by-branch"),
  v.literal("sales-by-user"),
  v.literal("sales-profit"),
  v.literal("sales-unpaid"),
  v.literal("purchase-daily"),
  v.literal("purchase-monthly"),
  v.literal("purchase-yearly"),
  v.literal("purchase-by-supplier"),
  v.literal("purchase-by-product"),
  v.literal("purchase-payables"),
  v.literal("purchase-returns"),
  v.literal("inventory-stock"),
  v.literal("inventory-low"),
  v.literal("inventory-movement"),
  v.literal("inventory-cardex"),
  v.literal("inventory-value"),
  v.literal("inventory-dead"),
  v.literal("inventory-expiring"),
);
type ReportKind = "sales-daily" | "sales-monthly" | "sales-yearly" | "sales-by-customer" | "sales-by-product" | "sales-by-branch" | "sales-by-user" | "sales-profit" | "sales-unpaid" | "purchase-daily" | "purchase-monthly" | "purchase-yearly" | "purchase-by-supplier" | "purchase-by-product" | "purchase-payables" | "purchase-returns" | "inventory-stock" | "inventory-low" | "inventory-movement" | "inventory-cardex" | "inventory-value" | "inventory-dead" | "inventory-expiring";

// Report rows are intentionally heterogeneous: labels plus numeric measures.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Column = { key: string; label: string; kind: "text" | "money" | "number" | "date" };

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}
function monthKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 7);
}
function yearKey(ts: number) {
  return String(new Date(ts).getUTCFullYear());
}
function groupKey(ts: number, kind: ReportKind) {
  if (kind === "sales-yearly" || kind === "purchase-yearly") return yearKey(ts);
  if (kind === "sales-monthly" || kind === "purchase-monthly") return monthKey(ts);
  return dayKey(ts);
}
function qty(value: number) {
  return Math.round(value) / 1000;
}

export const report = query({
  args: {
    businessId: v.id("businesses"),
    kind: reportKindValidator,
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    productId: v.optional(v.id("products")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { business } = await requireMembership(ctx, args.businessId);
    const to = args.to ?? Date.now();
    const from = args.from ?? to - 365 * DAY;
    const [invoices, invoiceItems, salesReturns, salesReturnItems, purchases, purchaseItems, products, categories, warehouses, branches, users, stock, customers, suppliers] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", args.businessId)).take(5000),
      ctx.db.query("invoiceItems").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(12000),
      ctx.db.query("salesReturns").withIndex("by_business_occurred", (q) => q.eq("businessId", args.businessId)).take(3000),
      ctx.db.query("salesReturnItems").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(8000),
      ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", args.businessId)).take(5000),
      ctx.db.query("purchaseInvoiceItems").withIndex("by_business_product", (q) => q.eq("businessId", args.businessId)).take(12000),
      ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(2500),
      ctx.db.query("productCategories").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(800),
      ctx.db.query("warehouses").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(300),
      ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(100),
      ctx.db.query("users").take(1000),
      ctx.db.query("inventoryTransactions").withIndex("by_business_occurred", (q) => q.eq("businessId", args.businessId)).take(12000),
      ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(2000),
      ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).take(1500),
    ]);
    const productMap = new Map(products.map((row) => [row._id as string, row]));
    const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
    const branchMap = new Map(branches.map((row) => [row._id as string, row]));
    const customerMap = new Map(customers.map((row) => [row._id as string, row]));
    const supplierMap = new Map(suppliers.map((row) => [row._id as string, row]));
    const userMap = new Map(users.map((row) => [row._id as string, row]));
    const categoryMap = new Map(categories.map((row) => [row._id as string, row]));
    const inScopeInvoice = (row: Doc<"invoices">) =>
      row.status !== "draft" && row.status !== "void" && row.issueDate >= from && row.issueDate <= to && (!args.branchId || row.branchId === args.branchId) && (!args.warehouseId || row.warehouseId === args.warehouseId);
    const scopedInvoices = invoices.filter(inScopeInvoice);
    const invoiceMap = new Map(invoices.map((row) => [row._id as string, row]));
    const inScopePurchase = (row: Doc<"purchaseInvoices">) =>
      row.status !== "draft" && row.status !== "cancelled" && row.issueDate >= from && row.issueDate <= to && (!args.branchId || row.branchId === args.branchId) && (!args.warehouseId || row.warehouseId === args.warehouseId);
    const scopedPurchases = purchases.filter(inScopePurchase);
    const scopedReturns = salesReturns.filter((row) => row.occurredAt >= from && row.occurredAt <= to && (!args.branchId || row.branchId === args.branchId));
    const purchaseReturns = scopedPurchases.filter((row) => row.kind === "return");
    const purchasesOnly = scopedPurchases.filter((row) => row.kind === "purchase");

    let columns: Column[] = [];
    let rows: Row[] = [];

    if (args.kind.startsWith("sales-")) {
      if (args.kind === "sales-daily" || args.kind === "sales-monthly" || args.kind === "sales-yearly") {
        columns = [
          { key: "period", label: "دوره", kind: "text" },
          { key: "count", label: "تعداد فاکتور", kind: "number" },
          { key: "sales", label: "فروش", kind: "money" },
          { key: "returns", label: "برگشت", kind: "money" },
          { key: "tax", label: "مالیات", kind: "money" },
          { key: "profit", label: "سود", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const invoice of scopedInvoices) {
          const key = groupKey(invoice.issueDate, args.kind);
          const entry = map.get(key) ?? { period: key, count: 0, sales: 0, returns: 0, tax: 0, profit: 0 };
          entry.count += 1;
          entry.sales += invoice.total;
          entry.tax += invoice.taxAmount;
          entry.profit += invoice.total - (invoice.costOfGoods ?? 0);
          map.set(key, entry);
        }
        for (const ret of scopedReturns) {
          const key = groupKey(ret.occurredAt, args.kind);
          const entry = map.get(key) ?? { period: key, count: 0, sales: 0, returns: 0, tax: 0, profit: 0 };
          entry.returns += ret.total;
          entry.profit -= ret.total - ret.costOfGoods;
          map.set(key, entry);
        }
        rows = [...map.values()].sort((a, b) => String(b.period).localeCompare(String(a.period)));
      } else if (args.kind === "sales-by-customer") {
        columns = [
          { key: "name", label: "مشتری", kind: "text" },
          { key: "count", label: "تعداد فاکتور", kind: "number" },
          { key: "sales", label: "فروش", kind: "money" },
          { key: "returns", label: "برگشت", kind: "money" },
          { key: "paid", label: "دریافت", kind: "money" },
          { key: "outstanding", label: "مانده", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const invoice of scopedInvoices) {
          const key = invoice.customerId as string;
          const entry = map.get(key) ?? { name: customerMap.get(key)?.name ?? "—", count: 0, sales: 0, returns: 0, paid: 0, outstanding: 0 };
          entry.count += 1;
          entry.sales += invoice.total;
          entry.paid += invoice.paidAmount ?? 0;
          entry.outstanding += Math.max(0, invoice.total - (invoice.returnedAmount ?? 0) - (invoice.paidAmount ?? 0));
          map.set(key, entry);
        }
        for (const ret of scopedReturns) {
          const key = ret.customerId as string;
          const entry = map.get(key) ?? { name: customerMap.get(key)?.name ?? "—", count: 0, sales: 0, returns: 0, paid: 0, outstanding: 0 };
          entry.returns += ret.total;
          map.set(key, entry);
        }
        rows = [...map.values()];
      } else if (args.kind === "sales-by-product" || args.kind === "sales-profit") {
        const byInvoice = args.kind === "sales-profit";
        columns = byInvoice
          ? [
              { key: "number", label: "فاکتور", kind: "text" },
              { key: "date", label: "تاریخ", kind: "date" },
              { key: "name", label: "مشتری", kind: "text" },
              { key: "sales", label: "فروش", kind: "money" },
              { key: "cogs", label: "بهای تمام‌شده", kind: "money" },
              { key: "profit", label: "سود", kind: "money" },
            ]
          : [
              { key: "name", label: "کالا", kind: "text" },
              { key: "quantity", label: "تعداد", kind: "number" },
              { key: "sales", label: "فروش", kind: "money" },
              { key: "cogs", label: "بهای تمام‌شده", kind: "money" },
              { key: "profit", label: "سود", kind: "money" },
            ];
        if (byInvoice) {
          rows = scopedInvoices.map((invoice) => ({
            number: invoice.number,
            date: invoice.issueDate,
            name: customerMap.get(invoice.customerId as string)?.name ?? "—",
            sales: invoice.total - (invoice.returnedAmount ?? 0),
            cogs: invoice.costOfGoods ?? 0,
            profit: invoice.total - (invoice.returnedAmount ?? 0) - (invoice.costOfGoods ?? 0),
          }));
        } else {
          const visibleInvoices = new Set(scopedInvoices.map((row) => row._id as string));
          const map = new Map<string, Row>();
          for (const item of invoiceItems) {
            if (!item.productId || !visibleInvoices.has(item.invoiceId as string)) continue;
            const key = item.productId as string;
            const entry = map.get(key) ?? { name: productMap.get(key)?.name ?? "—", quantity: 0, sales: 0, cogs: 0, profit: 0 };
            entry.quantity += item.quantityMilli;
            entry.sales += item.lineTotal;
            entry.cogs += item.costTotal ?? 0;
            entry.profit += item.lineTotal - (item.costTotal ?? 0);
            map.set(key, entry);
          }
          for (const item of salesReturnItems) {
            const ret = scopedReturns.find((row) => row._id === item.returnId);
            if (!ret || !item.productId) continue;
            const entry = map.get(item.productId as string);
            if (!entry) continue;
            entry.quantity -= item.quantityMilli;
            entry.sales -= item.lineTotal;
            entry.cogs -= item.costTotal;
            entry.profit -= item.lineTotal - item.costTotal;
          }
          rows = [...map.values()].map((row) => ({ ...row, quantity: qty(Number(row.quantity)) }));
        }
      } else if (args.kind === "sales-by-branch") {
        columns = [
          { key: "name", label: "شعبه", kind: "text" },
          { key: "count", label: "تعداد فاکتور", kind: "number" },
          { key: "sales", label: "فروش", kind: "money" },
          { key: "profit", label: "سود", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const invoice of scopedInvoices) {
          const key = (invoice.branchId as string) ?? "—";
          const entry = map.get(key) ?? { name: branchMap.get(key)?.name ?? "شعبه اصلی", count: 0, sales: 0, profit: 0 };
          entry.count += 1;
          entry.sales += invoice.total;
          entry.profit += invoice.total - (invoice.costOfGoods ?? 0);
          map.set(key, entry);
        }
        rows = [...map.values()];
      } else if (args.kind === "sales-by-user") {
        columns = [
          { key: "name", label: "کاربر", kind: "text" },
          { key: "count", label: "تعداد فاکتور", kind: "number" },
          { key: "sales", label: "فروش", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const invoice of scopedInvoices) {
          const key = invoice.createdBy as string;
          const entry = map.get(key) ?? { name: userMap.get(key)?.name ?? userMap.get(key)?.email ?? "کاربر", count: 0, sales: 0 };
          entry.count += 1;
          entry.sales += invoice.total;
          map.set(key, entry);
        }
        rows = [...map.values()];
      } else {
        columns = [
          { key: "number", label: "فاکتور", kind: "text" },
          { key: "name", label: "مشتری", kind: "text" },
          { key: "date", label: "تاریخ", kind: "date" },
          { key: "due", label: "سررسید", kind: "date" },
          { key: "total", label: "مبلغ", kind: "money" },
          { key: "paid", label: "پرداخت‌شده", kind: "money" },
          { key: "outstanding", label: "مانده", kind: "money" },
        ];
        rows = scopedInvoices
          .filter((row) => row.status !== "paid" && row.total - (row.returnedAmount ?? 0) - (row.paidAmount ?? 0) > 0)
          .map((row) => ({
            number: row.number,
            name: customerMap.get(row.customerId as string)?.name ?? "—",
            date: row.issueDate,
            due: row.dueDate ?? 0,
            total: row.total,
            paid: row.paidAmount ?? 0,
            outstanding: Math.max(0, row.total - (row.returnedAmount ?? 0) - (row.paidAmount ?? 0)),
          }));
      }
    } else if (args.kind.startsWith("purchase-")) {
      if (args.kind === "purchase-daily" || args.kind === "purchase-monthly" || args.kind === "purchase-yearly") {
        columns = [
          { key: "period", label: "دوره", kind: "text" },
          { key: "count", label: "تعداد خرید", kind: "number" },
          { key: "purchases", label: "خرید", kind: "money" },
          { key: "returns", label: "برگشت", kind: "money" },
          { key: "tax", label: "مالیات", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const purchase of purchasesOnly) {
          const key = groupKey(purchase.issueDate, args.kind);
          const entry = map.get(key) ?? { period: key, count: 0, purchases: 0, returns: 0, tax: 0 };
          entry.count += 1;
          entry.purchases += purchase.total;
          entry.tax += purchase.taxAmount;
          map.set(key, entry);
        }
        for (const ret of purchaseReturns) {
          const key = groupKey(ret.issueDate, args.kind);
          const entry = map.get(key) ?? { period: key, count: 0, purchases: 0, returns: 0, tax: 0 };
          entry.returns += ret.total;
          map.set(key, entry);
        }
        rows = [...map.values()].sort((a, b) => String(b.period).localeCompare(String(a.period)));
      } else if (args.kind === "purchase-by-supplier") {
        columns = [
          { key: "name", label: "تأمین‌کننده", kind: "text" },
          { key: "count", label: "تعداد خرید", kind: "number" },
          { key: "purchases", label: "خرید", kind: "money" },
          { key: "returns", label: "برگشت", kind: "money" },
          { key: "paid", label: "پرداخت", kind: "money" },
          { key: "outstanding", label: "مانده", kind: "money" },
        ];
        const map = new Map<string, Row>();
        for (const purchase of purchasesOnly) {
          const key = purchase.supplierId as string;
          const entry = map.get(key) ?? { name: supplierMap.get(key)?.name ?? "—", count: 0, purchases: 0, returns: 0, paid: 0, outstanding: 0 };
          entry.count += 1;
          entry.purchases += purchase.total;
          entry.paid += purchase.paidAmount;
          entry.outstanding += Math.max(0, purchase.total - purchase.paidAmount - (purchase.returnedAmount ?? 0));
          map.set(key, entry);
        }
        for (const ret of purchaseReturns) {
          const key = ret.supplierId as string;
          const entry = map.get(key);
          if (entry) entry.returns += ret.total;
        }
        rows = [...map.values()];
      } else if (args.kind === "purchase-by-product") {
        columns = [
          { key: "name", label: "کالا", kind: "text" },
          { key: "quantity", label: "تعداد", kind: "number" },
          { key: "purchases", label: "خرید", kind: "money" },
        ];
        const visible = new Set(purchasesOnly.map((row) => row._id as string));
        const map = new Map<string, Row>();
        for (const item of purchaseItems) {
          if (!visible.has(item.invoiceId as string)) continue;
          const key = item.productId as string;
          const entry = map.get(key) ?? { name: productMap.get(key)?.name ?? "—", quantity: 0, purchases: 0 };
          entry.quantity += item.quantityMilli;
          entry.purchases += item.lineTotal;
          map.set(key, entry);
        }
        rows = [...map.values()].map((row) => ({ ...row, quantity: qty(Number(row.quantity)) }));
      } else if (args.kind === "purchase-payables") {
        columns = [
          { key: "number", label: "فاکتور خرید", kind: "text" },
          { key: "name", label: "تأمین‌کننده", kind: "text" },
          { key: "date", label: "تاریخ", kind: "date" },
          { key: "due", label: "سررسید", kind: "date" },
          { key: "total", label: "مبلغ", kind: "money" },
          { key: "paid", label: "پرداخت", kind: "money" },
          { key: "outstanding", label: "مانده", kind: "money" },
        ];
        rows = purchasesOnly
          .filter((row) => row.total - row.paidAmount - (row.returnedAmount ?? 0) > 0)
          .map((row) => ({
            number: row.number,
            name: supplierMap.get(row.supplierId as string)?.name ?? "—",
            date: row.issueDate,
            due: row.dueDate ?? 0,
            total: row.total,
            paid: row.paidAmount,
            outstanding: Math.max(0, row.total - row.paidAmount - (row.returnedAmount ?? 0)),
          }));
      } else {
        columns = [
          { key: "number", label: "برگشت خرید", kind: "text" },
          { key: "parent", label: "فاکتور اصلی", kind: "text" },
          { key: "name", label: "تأمین‌کننده", kind: "text" },
          { key: "date", label: "تاریخ", kind: "date" },
          { key: "total", label: "مبلغ", kind: "money" },
        ];
        rows = purchaseReturns.map((row) => ({
          number: row.number,
          parent: row.parentId ? (purchaseItems.find((item) => item.invoiceId === row.parentId)?.description ?? "—") : "—",
          name: supplierMap.get(row.supplierId as string)?.name ?? "—",
          date: row.issueDate,
          total: row.total,
        }));
      }
    } else {
      const scopedStock = stock.filter((row) => row.occurredAt >= from && row.occurredAt <= to && (!args.warehouseId || row.warehouseId === args.warehouseId) && (!args.productId || row.productId === args.productId));
      if (args.kind === "inventory-movement") {
        columns = [
          { key: "date", label: "تاریخ", kind: "date" },
          { key: "name", label: "کالا", kind: "text" },
          { key: "warehouse", label: "انبار", kind: "text" },
          { key: "direction", label: "نوع", kind: "text" },
          { key: "quantity", label: "تعداد", kind: "number" },
          { key: "value", label: "ارزش", kind: "money" },
          { key: "description", label: "شرح", kind: "text" },
        ];
        rows = scopedStock
          .sort((a, b) => b.occurredAt - a.occurredAt)
          .slice(0, 2000)
          .map((row) => ({
            date: row.occurredAt,
            name: productMap.get(row.productId as string)?.name ?? "—",
            warehouse: warehouseMap.get(row.warehouseId as string)?.name ?? "—",
            direction: row.direction === "in" ? "ورود" : "خروج",
            quantity: qty(row.quantityMilli),
            value: row.value,
            description: row.description,
          }));
      } else if (args.kind === "inventory-cardex") {
        columns = [
          { key: "date", label: "تاریخ", kind: "date" },
          { key: "name", label: "کالا", kind: "text" },
          { key: "warehouse", label: "انبار", kind: "text" },
          { key: "in", label: "ورود", kind: "number" },
          { key: "out", label: "خروج", kind: "number" },
          { key: "balance", label: "مانده", kind: "number" },
          { key: "value", label: "ارزش", kind: "money" },
        ];
        const running = new Map<string, number>();
        rows = [...stock].sort((a, b) => a.occurredAt - b.occurredAt).filter((row) => !args.warehouseId || row.warehouseId === args.warehouseId).filter((row) => !args.productId || row.productId === args.productId).map((row) => {
          const key = `${row.warehouseId}:${row.productId}`;
          const balance = (running.get(key) ?? 0) + (row.direction === "in" ? row.quantityMilli : -row.quantityMilli);
          running.set(key, balance);
          return {
            date: row.occurredAt,
            name: productMap.get(row.productId as string)?.name ?? "—",
            warehouse: warehouseMap.get(row.warehouseId as string)?.name ?? "—",
            in: row.direction === "in" ? qty(row.quantityMilli) : 0,
            out: row.direction === "out" ? qty(row.quantityMilli) : 0,
            balance: qty(balance),
            value: row.value,
          };
        }).filter((row) => Number(row.date) >= from && Number(row.date) <= to).reverse().slice(0, 2000);
      } else {
        const balances = new Map<string, { productId: string; warehouseId: string; quantity: number; value: number; lastOut: number }>();
        for (const row of stock) {
          const key = `${row.warehouseId}:${row.productId}`;
          const entry = balances.get(key) ?? { productId: row.productId as string, warehouseId: row.warehouseId as string, quantity: 0, value: 0, lastOut: 0 };
          entry.quantity += row.direction === "in" ? row.quantityMilli : -row.quantityMilli;
          entry.value += row.direction === "in" ? row.value : -row.value;
          if (row.direction === "out") entry.lastOut = Math.max(entry.lastOut, row.occurredAt);
          balances.set(key, entry);
        }
        const stockRows = [...balances.values()]
          .filter((row) => (!args.warehouseId || row.warehouseId === args.warehouseId) && (!args.productId || row.productId === args.productId))
          .map((row) => {
            const product = productMap.get(row.productId);
            const warehouse = warehouseMap.get(row.warehouseId);
            return {
              name: product?.name ?? "—",
              category: product?.categoryId ? (categoryMap.get(product.categoryId as string)?.name ?? "—") : "—",
              warehouse: warehouse?.name ?? "—",
              quantity: qty(row.quantity),
              averageCost: row.quantity > 0 ? Math.round((row.value * 1000) / row.quantity) : 0,
              value: Math.max(0, row.value),
              minStock: qty(product?.minStockMilli ?? 0),
              lastOut: row.lastOut,
              productId: row.productId,
            };
          });
        if (args.kind === "inventory-low") {
          columns = [
            { key: "name", label: "کالا", kind: "text" },
            { key: "category", label: "دسته", kind: "text" },
            { key: "warehouse", label: "انبار", kind: "text" },
            { key: "quantity", label: "موجودی", kind: "number" },
            { key: "minStock", label: "حداقل", kind: "number" },
          ];
          rows = stockRows.filter((row) => row.quantity <= row.minStock);
        } else if (args.kind === "inventory-value") {
          columns = [
            { key: "name", label: "کالا", kind: "text" },
            { key: "warehouse", label: "انبار", kind: "text" },
            { key: "quantity", label: "تعداد", kind: "number" },
            { key: "averageCost", label: "میانگین بهای واحد", kind: "money" },
            { key: "value", label: "ارزش موجودی", kind: "money" },
          ];
          rows = stockRows.filter((row) => row.quantity > 0);
        } else if (args.kind === "inventory-dead") {
          columns = [
            { key: "name", label: "کالا", kind: "text" },
            { key: "warehouse", label: "انبار", kind: "text" },
            { key: "quantity", label: "موجودی", kind: "number" },
            { key: "lastOut", label: "آخرین خروج", kind: "date" },
            { key: "value", label: "ارزش", kind: "money" },
          ];
          rows = stockRows.filter((row) => row.quantity > 0 && (row.lastOut === 0 || row.lastOut < Date.now() - 90 * DAY));
        } else if (args.kind === "inventory-expiring") {
          columns = [
            { key: "name", label: "کالا", kind: "text" },
            { key: "warehouse", label: "انبار", kind: "text" },
            { key: "quantity", label: "موجودی", kind: "number" },
            { key: "expiry", label: "تاریخ انقضا", kind: "date" },
          ];
          rows = products
            .filter((product) => product.trackExpiry && product.expiryDate && product.expiryDate <= Date.now() + 180 * DAY)
            .map((product) => ({
              name: product.name,
              warehouse: "همه انبارها",
              quantity: qty(stock.filter((row) => row.productId === product._id).reduce((sum, row) => sum + (row.direction === "in" ? row.quantityMilli : -row.quantityMilli), 0)),
              expiry: product.expiryDate ?? 0,
            }))
            .filter((row) => Number(row.quantity) > 0);
        } else {
          columns = [
            { key: "name", label: "کالا", kind: "text" },
            { key: "category", label: "دسته", kind: "text" },
            { key: "warehouse", label: "انبار", kind: "text" },
            { key: "quantity", label: "موجودی", kind: "number" },
            { key: "averageCost", label: "بهای میانگین", kind: "money" },
            { key: "value", label: "ارزش", kind: "money" },
          ];
          rows = stockRows;
        }
      }
    }

    const search = args.search?.trim().toLowerCase();
    if (search) {
      rows = rows.filter((row) => Object.entries(row).some(([key, value]) => typeof value === "string" && key !== "date" && value.toLowerCase().includes(search)));
    }
    const numericKeys = columns.filter((column) => column.kind === "money" || column.kind === "number").map((column) => column.key);
    const totals: Row = {};
    for (const key of numericKeys) totals[key] = rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
    return {
      kind: args.kind,
      title: args.kind,
      from,
      to,
      currency: business.currency,
      columns,
      rows: rows.slice(0, 3000),
      total: rows.length,
      totals,
    };
  },
});
