import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nextCounter, padSequence, requireMembership, writeAudit } from "./lib/tenant";
import { optionalString, requireInt } from "./lib/validation";
import { resolveDocumentScope } from "./lib/workspace";
import { assertDocumentDateInFiscalYear, getFiscalYear } from "./lib/accounting";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
  systemAccount,
} from "./lib/finance";
import {
  addCostLayer,
  consumeCost,
  quantityValue,
  recordStockMovement,
  warehouseForBusiness,
} from "./lib/inventory";
import { settlementMethodValidator } from "./schema";

const purchaseLineValidator = v.object({
  productId: v.id("products"),
  description: v.optional(v.string()),
  quantityMilli: v.number(),
  unitCost: v.number(),
  discount: v.optional(v.number()),
  taxRateBps: v.optional(v.number()),
});

const paymentValidator = v.object({
  method: settlementMethodValidator,
  amount: v.number(),
  bankAccountId: v.optional(v.id("bankAccounts")),
  cashFundId: v.optional(v.id("cashFunds")),
  trackingNumber: v.optional(v.string()),
});

function purchaseSummary(row: Doc<"purchaseInvoices">, supplierName: string) {
  return {
    _id: row._id as string,
    number: row.number,
    kind: row.kind,
    status: row.status,
    supplierId: row.supplierId as string,
    supplierName,
    warehouseId: row.warehouseId as string,
    issueDate: row.issueDate,
    dueDate: row.dueDate ?? null,
    subtotal: row.subtotal,
    discount: row.discount,
    taxAmount: row.taxAmount,
    extraCosts: row.extraCosts,
    total: row.total,
    paidAmount: row.paidAmount,
    returnedAmount: row.returnedAmount ?? 0,
    outstanding: Math.max(0, row.total - row.paidAmount - (row.returnedAmount ?? 0)),
    notes: row.notes ?? null,
    accountingDocumentId: row.accountingDocumentId as string | undefined,
  };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    supplierId: v.optional(v.id("suppliers")),
    kind: v.optional(v.union(v.literal("purchase"), v.literal("return"))),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [rows, suppliers] = await Promise.all([
      ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId))
        .order("desc")
        .take(Math.min(args.limit ?? 500, 1000)),
      ctx.db
        .query("suppliers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1500),
    ]);
    const names = new Map(suppliers.map((row) => [row._id as string, row.name]));
    const needle = args.search?.trim().toLowerCase();
    return rows
      .filter((row) => !args.supplierId || row.supplierId === args.supplierId)
      .filter((row) => !args.kind || row.kind === args.kind)
      .filter((row) => !args.from || row.issueDate >= args.from)
      .filter((row) => !args.to || row.issueDate <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return `${row.number} ${names.get(row.supplierId as string) ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .map((row) => purchaseSummary(row, names.get(row.supplierId as string) ?? "—"));
  },
});

export const get = query({
  args: { businessId: v.id("businesses"), invoiceId: v.id("purchaseInvoices") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("فاکتور خرید یافت نشد.");
    }
    const [supplier, items, warehouse, document] = await Promise.all([
      ctx.db.get(invoice.supplierId),
      ctx.db
        .query("purchaseInvoiceItems")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect(),
      ctx.db.get(invoice.warehouseId),
      invoice.accountingDocumentId ? ctx.db.get(invoice.accountingDocumentId) : Promise.resolve(null),
    ]);
    return {
      ...purchaseSummary(invoice, supplier?.name ?? "—"),
      supplier: supplier
        ? {
            _id: supplier._id as string,
            code: supplier.code,
            name: supplier.name,
            phone: supplier.phone ?? null,
            mobile: supplier.mobile ?? null,
            address: supplier.address ?? null,
          }
        : null,
      warehouseName: warehouse?.name ?? null,
      accountingNumber: document?.number ?? null,
      items: items
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          _id: item._id as string,
          productId: item.productId as string,
          description: item.description,
          quantityMilli: item.quantityMilli,
          unit: item.unit,
          unitCost: item.unitCost,
          discount: item.discount,
          taxRateBps: item.taxRateBps,
          taxAmount: item.taxAmount,
          lineTotal: item.lineTotal,
          landedUnitCost: item.landedUnitCost,
          returnedQuantityMilli: item.returnedQuantityMilli ?? 0,
        })),
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    supplierId: v.id("suppliers"),
    warehouseId: v.id("warehouses"),
    issueDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    lines: v.array(purchaseLineValidator),
    discount: v.optional(v.number()),
    extraCosts: v.optional(v.number()),
    taxRateBps: v.optional(v.number()),
    payments: v.optional(v.array(paymentValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(ctx, args.businessId, { write: true });
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.businessId !== args.businessId) throw new ConvexError("تأمین‌کننده یافت نشد.");
    if (!supplier.active) throw new ConvexError("تأمین‌کننده غیرفعال است.");
    const warehouse = await warehouseForBusiness(ctx, args.businessId, args.warehouseId);
    if (!args.lines.length) throw new ConvexError("حداقل یک ردیف خرید لازم است.");
    if (args.lines.length > 100) throw new ConvexError("حداکثر ۱۰۰ ردیف مجاز است.");
    const issueDate = args.issueDate ?? Date.now();
    if (!Number.isFinite(issueDate) || !Number.isInteger(issueDate)) throw new ConvexError("تاریخ خرید معتبر نیست.");
    const dueDate = args.dueDate ?? issueDate + 30 * 24 * 60 * 60 * 1000;
    const defaultTax = requireInt(args.taxRateBps ?? business.taxRateBps, "نرخ مالیات", { min: 0, max: 10000 });
    const computed = [];
    const productIds = args.lines.map((line) => line.productId);
    const products = await Promise.all(productIds.map((id) => ctx.db.get(id)));
    let subtotal = 0;
    let taxAmount = 0;
    for (const [index, line] of args.lines.entries()) {
      const product = products[index];
      if (!product || product.businessId !== args.businessId) throw new ConvexError("کالای یکی از ردیف‌ها یافت نشد.");
      if (!product.active) throw new ConvexError("کالای غیرفعال قابل خرید نیست.");
      if (product.productType === "service") throw new ConvexError("خدمات را نمی‌توان به موجودی خرید.");
      const qty = requireInt(line.quantityMilli, "تعداد خرید", { min: 1 });
      const unitCost = requireInt(line.unitCost, "بهای خرید", { min: 0 });
      const discount = requireInt(line.discount ?? 0, "تخفیف خرید", { min: 0 });
      const gross = quantityValue(qty, unitCost);
      if (discount > gross) throw new ConvexError("تخفیف ردیف از مبلغ خرید بیشتر است.");
      const net = gross - discount;
      const rate = requireInt(line.taxRateBps ?? defaultTax, "نرخ مالیات", { min: 0, max: 10000 });
      computed.push({ product, qty, unitCost, discount, rate, net, description: optionalString(line.description, "شرح", 200) || product.name });
      subtotal += net;
    }
    const invoiceDiscount = requireInt(args.discount ?? 0, "تخفیف فاکتور", { min: 0 });
    if (invoiceDiscount > subtotal) throw new ConvexError("تخفیف فاکتور از جمع خرید بیشتر است.");
    const extraCosts = requireInt(args.extraCosts ?? 0, "هزینه‌های جانبی", { min: 0 });
    const taxableRatio = subtotal > 0 ? (subtotal - invoiceDiscount) / subtotal : 0;
    const recoverable = Boolean(business.purchaseTaxRecoverable);
    const lines = computed.map((line) => {
      const taxable = Math.round(line.net * taxableRatio);
      const tax = Math.round((taxable * line.rate) / 10000);
      taxAmount += tax;
      const extraShare = subtotal > 0 ? Math.round((extraCosts * taxable) / subtotal) : 0;
      const landed = taxable + extraShare + (recoverable ? 0 : tax);
      return {
        ...line,
        taxable,
        tax,
        landed,
        landedUnitCost: Math.round((landed * 1000) / line.qty),
      };
    });
    const total = subtotal - invoiceDiscount + taxAmount + extraCosts;
    const payments = (args.payments ?? []).filter((payment) => payment.method !== "credit");
    let paidAmount = 0;
    for (const payment of payments) {
      const amount = requireInt(payment.amount, "مبلغ پرداخت", { min: 1 });
      paidAmount += amount;
    }
    if (paidAmount > total) throw new ConvexError("جمع پرداخت از مبلغ فاکتور خرید بیشتر است.");
    const scope = await resolveDocumentScope(ctx, args.businessId, issueDate);
    if (!scope.branchId || !scope.fiscalYearId) throw new ConvexError("شعبه یا دوره مالی خرید مشخص نیست.");
    const fiscalYear = await getFiscalYear(ctx, args.businessId, scope.fiscalYearId);
    assertDocumentDateInFiscalYear(fiscalYear, issueDate);
    const sequence = await nextCounter(ctx, args.businessId, "purchase-invoice");
    const number = padSequence(sequence, "PUR");
    const now = Date.now();
    const invoiceId = await ctx.db.insert("purchaseInvoices", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      supplierId: args.supplierId,
      warehouseId: warehouse._id,
      kind: "purchase",
      sequence,
      number,
      status: paidAmount >= total ? "paid" : "posted",
      issueDate,
      dueDate,
      subtotal,
      discount: invoiceDiscount,
      taxRateBps: defaultTax,
      taxAmount,
      extraCosts,
      total,
      paidAmount,
      paymentSummary: payments.length ? payments.map((payment) => `${payment.method}:${payment.amount}`).join(",") : "credit",
      notes: optionalString(args.notes, "توضیحات", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, line] of lines.entries()) {
      await ctx.db.insert("purchaseInvoiceItems", {
        businessId: args.businessId,
        invoiceId,
        productId: line.product._id,
        description: line.description,
        quantityMilli: line.qty,
        unit: line.product.unit,
        unitCost: line.unitCost,
        discount: line.discount,
        taxRateBps: line.rate,
        taxAmount: line.tax,
        lineTotal: line.net,
        landedUnitCost: line.landedUnitCost,
        returnedQuantityMilli: 0,
        position,
      });
    }
    const inventory = await systemAccount(ctx, args.businessId, "inventory", user._id);
    const payable = await systemAccount(ctx, args.businessId, "payable", user._id);
    const vat = recoverable && taxAmount > 0 ? await systemAccount(ctx, args.businessId, "vatReceivable", user._id) : null;
    const journalLines = [
      {
        accountId: inventory._id,
        description: `خرید ${number}`,
        debit: lines.reduce((sum, line) => sum + line.landed, 0),
        credit: 0,
      },
    ];
    if (vat && taxAmount > 0) journalLines.push({ accountId: vat._id, description: "مالیات خرید", debit: taxAmount, credit: 0 });
    const refs = [];
    for (const payment of payments) {
      const ref = await resolveFinancialAccount(ctx, args.businessId, {
        type: payment.method === "cash" ? "cash" : "bank",
        bankAccountId: payment.bankAccountId,
        cashFundId: payment.cashFundId,
      });
      refs.push({ ref, amount: payment.amount, method: payment.method });
      journalLines.push({ accountId: ref.accountId, description: `پرداخت خرید ${number}`, debit: 0, credit: payment.amount });
    }
    const payableAmount = total - paidAmount;
    if (payableAmount > 0) {
      journalLines.push({ accountId: payable._id, description: `بدهی خرید ${number}`, debit: 0, credit: payableAmount });
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: issueDate,
      description: `فاکتور خرید ${number} — ${supplier.name}`,
      sourceType: "purchase-invoice",
      sourceId: invoiceId as string,
      branchId: scope.branchId,
      lines: journalLines,
    });
    for (const item of refs) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        account: item.ref,
        direction: "out",
        amount: item.amount,
        occurredAt: issueDate,
        operationType: "purchase-invoice",
        operationId: `${invoiceId}:${item.method}`,
        description: `پرداخت خرید ${number}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    const docSeq = await nextCounter(ctx, args.businessId, "inventory-document");
    const stockDoc = await ctx.db.insert("inventoryDocuments", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      sequence: docSeq,
      number: padSequence(docSeq, "INV-DOC"),
      type: "receipt",
      status: "posted",
      toWarehouseId: warehouse._id,
      occurredAt: issueDate,
      description: `ورود کالای خرید ${number}`,
      sourceType: "purchase-invoice",
      sourceId: invoiceId as string,
      accountingDocumentId: journal.documentId,
      totalValue: lines.reduce((sum, line) => sum + line.landed, 0),
      createdBy: user._id,
      createdAt: now,
      postedAt: now,
    });
    for (const [position, line] of lines.entries()) {
      await ctx.db.insert("inventoryDocumentLines", {
        businessId: args.businessId,
        documentId: stockDoc,
        productId: line.product._id,
        quantityMilli: line.qty,
        unitCost: line.landedUnitCost,
        value: line.landed,
        position,
      });
      await addCostLayer(ctx, {
        businessId: args.businessId,
        warehouseId: warehouse._id,
        productId: line.product._id,
        quantityMilli: line.qty,
        unitCost: line.landedUnitCost,
        sourceType: "purchase-invoice",
        sourceId: invoiceId as string,
        occurredAt: issueDate,
      });
      await recordStockMovement(ctx, {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        warehouseId: warehouse._id,
        productId: line.product._id,
        direction: "in",
        quantityMilli: line.qty,
        unitCost: line.landedUnitCost,
        occurredAt: issueDate,
        operationType: "purchase-invoice",
        operationId: invoiceId as string,
        inventoryDocumentId: stockDoc,
        description: `خرید ${number}`,
        actorId: user._id,
      });
    }
    await ctx.db.patch(invoiceId, { accountingDocumentId: journal.documentId, postedAt: now });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "purchase.post",
      entity: "purchaseInvoices",
      entityId: invoiceId,
      summary: `ثبت خرید ${number} از ${supplier.name}`,
    });
    return { invoiceId, number, total, paidAmount, accountingDocumentId: journal.documentId };
  },
});

export const createReturn = mutation({
  args: {
    businessId: v.id("businesses"),
    invoiceId: v.id("purchaseInvoices"),
    lines: v.array(
      v.object({
        purchaseItemId: v.id("purchaseInvoiceItems"),
        quantityMilli: v.number(),
      }),
    ),
    occurredAt: v.optional(v.number()),
    refundMethod: v.union(v.literal("credit"), v.literal("cash"), v.literal("bank")),
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(ctx, args.businessId, { write: true });
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) throw new ConvexError("فاکتور خرید یافت نشد.");
    if (invoice.kind !== "purchase" || invoice.status === "draft" || invoice.status === "cancelled") {
      throw new ConvexError("برگشت فقط برای خرید قطعی مجاز است.");
    }
    if (!args.lines.length) throw new ConvexError("حداقل یک ردیف برگشت لازم است.");
    const occurredAt = args.occurredAt ?? Date.now();
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) throw new ConvexError("شعبه یا دوره مالی مشخص نیست.");
    const fiscalYear = await getFiscalYear(ctx, args.businessId, scope.fiscalYearId);
    assertDocumentDateInFiscalYear(fiscalYear, occurredAt);
    const [supplier, items, warehouse] = await Promise.all([
      ctx.db.get(invoice.supplierId),
      ctx.db.query("purchaseInvoiceItems").withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id)).collect(),
      ctx.db.get(invoice.warehouseId),
    ]);
    if (!warehouse) throw new ConvexError("انبار خرید یافت نشد.");
    const itemMap = new Map(items.map((item) => [item._id as string, item]));
    let subtotal = 0;
    let taxAmount = 0;
    let costOfGoods = 0;
    const selected = [];
    for (const line of args.lines) {
      const item = itemMap.get(line.purchaseItemId as string);
      if (!item) throw new ConvexError("ردیف خرید یافت نشد.");
      const qty = requireInt(line.quantityMilli, "تعداد برگشت", { min: 1 });
      if (qty > item.quantityMilli - (item.returnedQuantityMilli ?? 0)) {
        throw new ConvexError("تعداد برگشت از باقی‌مانده خرید بیشتر است.");
      }
      const ratio = qty / item.quantityMilli;
      const net = Math.round(item.lineTotal * ratio);
      const tax = Math.round(item.taxAmount * ratio);
      const cost = await consumeCost(ctx, {
        businessId: args.businessId,
        warehouseId: warehouse._id,
        productId: item.productId,
        quantityMilli: qty,
        occurredAt,
        allowNegativeStock: Boolean(business.allowNegativeStock),
        valuationMethod: business.inventoryValuationMethod ?? "weighted_average",
        fallbackUnitCost: item.landedUnitCost,
      });
      subtotal += net;
      taxAmount += tax;
      costOfGoods += cost.costTotal;
      selected.push({ item, qty, net, tax, cost });
    }
    const total = subtotal + taxAmount;
    const sequence = await nextCounter(ctx, args.businessId, "purchase-return");
    const number = padSequence(sequence, "PRT");
    const now = Date.now();
    const returnId = await ctx.db.insert("purchaseInvoices", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      supplierId: invoice.supplierId,
      warehouseId: warehouse._id,
      parentId: invoice._id,
      kind: "return",
      sequence,
      number,
      status: "posted",
      issueDate: occurredAt,
      dueDate: occurredAt,
      subtotal,
      discount: 0,
      taxRateBps: 0,
      taxAmount,
      extraCosts: 0,
      total,
      paidAmount: 0,
      notes: optionalString(args.notes, "توضیحات", 800),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, row] of selected.entries()) {
      await ctx.db.insert("purchaseInvoiceItems", {
        businessId: args.businessId,
        invoiceId: returnId,
        productId: row.item.productId,
        description: row.item.description,
        quantityMilli: row.qty,
        unit: row.item.unit,
        unitCost: row.item.unitCost,
        discount: 0,
        taxRateBps: row.item.taxRateBps,
        taxAmount: row.tax,
        lineTotal: row.net,
        landedUnitCost: row.cost.unitCost,
        returnedQuantityMilli: 0,
        position,
      });
      await ctx.db.patch(row.item._id, {
        returnedQuantityMilli: (row.item.returnedQuantityMilli ?? 0) + row.qty,
      });
    }
    const payable = await systemAccount(ctx, args.businessId, "payable", user._id);
    const inventory = await systemAccount(ctx, args.businessId, "inventory", user._id);
    const vat = business.purchaseTaxRecoverable && taxAmount > 0 ? await systemAccount(ctx, args.businessId, "vatReceivable", user._id) : null;
    const otherIncome = await systemAccount(ctx, args.businessId, "otherIncome", user._id);
    const otherExpense = await systemAccount(ctx, args.businessId, "otherExpense", user._id);
    const journalLines = [];
    let incomingRef: Awaited<ReturnType<typeof resolveFinancialAccount>> | null = null;
    if (args.refundMethod === "credit") {
      journalLines.push({ accountId: payable._id, description: `بدهی برگشت خرید ${number}`, debit: total, credit: 0 });
    } else {
      incomingRef = await resolveFinancialAccount(ctx, args.businessId, {
        type: args.refundMethod === "cash" ? "cash" : "bank",
        bankAccountId: args.bankAccountId,
        cashFundId: args.cashFundId,
      });
      journalLines.push({ accountId: incomingRef.accountId, description: `دریافت برگشت خرید ${number}`, debit: total, credit: 0 });
    }
    journalLines.push({ accountId: inventory._id, description: `خروج برگشت خرید ${number}`, debit: 0, credit: costOfGoods });
    if (vat && taxAmount > 0) {
      journalLines.push({ accountId: vat._id, description: "برگشت مالیات خرید", debit: 0, credit: taxAmount });
    }
    const difference = total - costOfGoods - (vat ? taxAmount : 0);
    if (difference > 0) {
      journalLines.push({ accountId: otherIncome._id, description: "تفاوت ارزش برگشت خرید", debit: 0, credit: difference });
    } else if (difference < 0) {
      journalLines.push({ accountId: otherExpense._id, description: "تفاوت ارزش برگشت خرید", debit: -difference, credit: 0 });
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt,
      description: `برگشت به تأمین‌کننده ${number} — ${supplier?.name ?? ""}`,
      sourceType: "purchase-return",
      sourceId: returnId as string,
      branchId: scope.branchId,
      lines: journalLines,
    });
    if (incomingRef) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        account: incomingRef,
        direction: "in",
        amount: total,
        occurredAt,
        operationType: "purchase-return",
        operationId: returnId as string,
        description: `دریافت برگشت خرید ${number}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    const docSeq = await nextCounter(ctx, args.businessId, "inventory-document");
    const stockDoc = await ctx.db.insert("inventoryDocuments", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      sequence: docSeq,
      number: padSequence(docSeq, "INV-DOC"),
      type: "return_to_supplier",
      status: "posted",
      fromWarehouseId: warehouse._id,
      occurredAt,
      description: `برگشت به تأمین‌کننده ${number}`,
      sourceType: "purchase-return",
      sourceId: returnId as string,
      accountingDocumentId: journal.documentId,
      totalValue: costOfGoods,
      createdBy: user._id,
      createdAt: now,
      postedAt: now,
    });
    for (const [position, row] of selected.entries()) {
      await ctx.db.insert("inventoryDocumentLines", {
        businessId: args.businessId,
        documentId: stockDoc,
        productId: row.item.productId,
        quantityMilli: row.qty,
        unitCost: row.cost.unitCost,
        value: row.cost.costTotal,
        position,
      });
      await recordStockMovement(ctx, {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        warehouseId: warehouse._id,
        productId: row.item.productId,
        direction: "out",
        quantityMilli: row.qty,
        unitCost: row.cost.unitCost,
        occurredAt,
        operationType: "purchase-return",
        operationId: returnId as string,
        inventoryDocumentId: stockDoc,
        description: `برگشت خرید ${number}`,
        actorId: user._id,
      });
    }
    await ctx.db.patch(invoice._id, {
      returnedAmount: (invoice.returnedAmount ?? 0) + total,
      updatedAt: now,
    });
    await ctx.db.patch(returnId, { accountingDocumentId: journal.documentId, postedAt: now });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "purchase.return",
      entity: "purchaseInvoices",
      entityId: returnId,
      summary: `برگشت خرید ${number} برای ${invoice.number}`,
    });
    return { returnId, number, total, accountingDocumentId: journal.documentId };
  },
});
