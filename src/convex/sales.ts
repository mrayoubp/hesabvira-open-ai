import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nextCounter, padSequence, requireMembership, writeAudit } from "./lib/tenant";
import { optionalString, requireInt, requireString } from "./lib/validation";
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
  isStocked,
  quantityValue,
  recordStockMovement,
  warehouseForBusiness,
} from "./lib/inventory";
import { settlementMethodValidator } from "./schema";

const saleLineValidator = v.object({
  productId: v.optional(v.id("products")),
  description: v.optional(v.string()),
  quantityMilli: v.number(),
  unitPrice: v.number(),
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

function summary(row: Doc<"invoices">, customerName: string) {
  const returned = row.returnedAmount ?? 0;
  const paid = row.paidAmount ?? 0;
  return {
    _id: row._id as string,
    number: row.number,
    status: row.status,
    customerId: row.customerId as string,
    customerName,
    issueDate: row.issueDate,
    dueDate: row.dueDate ?? null,
    subtotal: row.subtotal,
    discount: row.discount,
    taxRateBps: row.taxRateBps,
    taxAmount: row.taxAmount,
    shippingCost: row.shippingCost ?? 0,
    total: row.total,
    returnedAmount: returned,
    paidAmount: paid,
    outstanding: Math.max(0, row.total - returned - paid),
    costOfGoods: row.costOfGoods ?? 0,
    profit: row.total - returned - (row.costOfGoods ?? 0),
    notes: row.notes ?? null,
    accountingDocumentId: row.accountingDocumentId as string | undefined,
  };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    customerId: v.optional(v.id("customers")),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("issued"), v.literal("paid"), v.literal("void")),
    ),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_business_issue", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(Math.min(args.limit ?? 500, 1000));
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);
    const names = new Map(customers.map((row) => [row._id as string, row.name]));
    const needle = args.search?.trim().toLowerCase();
    return rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.fiscalYearId || row.fiscalYearId === args.fiscalYearId)
      .filter((row) => !args.customerId || row.customerId === args.customerId)
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.from || row.issueDate >= args.from)
      .filter((row) => !args.to || row.issueDate <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return `${row.number} ${names.get(row.customerId as string) ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .map((row) => summary(row, names.get(row.customerId as string) ?? "—"));
  },
});

export const get = query({
  args: { businessId: v.id("businesses"), invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("فاکتور فروش یافت نشد.");
    }
    const [customer, items, warehouse, document, returns] = await Promise.all([
      ctx.db.get(invoice.customerId),
      ctx.db
        .query("invoiceItems")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect(),
      invoice.warehouseId ? ctx.db.get(invoice.warehouseId) : Promise.resolve(null),
      invoice.accountingDocumentId
        ? ctx.db.get(invoice.accountingDocumentId)
        : Promise.resolve(null),
      ctx.db
        .query("salesReturns")
        .withIndex("by_business_invoice", (q) =>
          q.eq("businessId", args.businessId).eq("invoiceId", invoice._id),
        )
        .take(200),
    ]);
    const productIds = items.map((item) => item.productId).filter((id): id is Id<"products"> => Boolean(id));
    const products = await Promise.all(productIds.map((id) => ctx.db.get(id)));
    const productMap = new Map(
      products.filter((row): row is Doc<"products"> => Boolean(row)).map((row) => [row._id as string, row]),
    );
    return {
      ...summary(invoice, customer?.name ?? "—"),
      customer: customer
        ? {
            _id: customer._id as string,
            code: customer.code,
            name: customer.name,
            phone: customer.phone ?? null,
            mobile: customer.mobile ?? null,
            address: customer.address ?? null,
            nationalId: customer.nationalId ?? null,
            economicCode: customer.economicCode ?? null,
          }
        : null,
      warehouseName: warehouse?.name ?? null,
      accountingNumber: document?.number ?? null,
      items: items
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          _id: item._id as string,
          productId: item.productId ? (item.productId as string) : null,
          productCode: item.productId ? (productMap.get(item.productId as string)?.code ?? null) : null,
          description: item.description,
          quantityMilli: item.quantityMilli,
          unit: item.unit ?? productMap.get(item.productId as string)?.unit ?? "",
          unitPrice: item.unitPrice,
          discount: item.discount ?? 0,
          taxRateBps: item.taxRateBps ?? 0,
          taxAmount: item.taxAmount ?? 0,
          lineTotal: item.lineTotal,
          returnedQuantityMilli: item.returnedQuantityMilli ?? 0,
          costUnit: item.costUnit ?? 0,
        })),
      returns: returns.map((row) => ({
        _id: row._id as string,
        number: row.number,
        total: row.total,
        occurredAt: row.occurredAt,
        status: row.status,
      })),
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    warehouseId: v.id("warehouses"),
    status: v.union(v.literal("draft"), v.literal("issued")),
    issueDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    lines: v.array(saleLineValidator),
    discount: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    payments: v.optional(v.array(paymentValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(ctx, args.businessId, { write: true });
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری فاکتور یافت نشد.");
    }
    if ((customer.active ?? true) === false) throw new ConvexError("مشتری غیرفعال است.");
    const warehouse = await warehouseForBusiness(ctx, args.businessId, args.warehouseId);
    if (args.lines.length === 0) throw new ConvexError("حداقل یک ردیف فاکتور لازم است.");
    if (args.lines.length > 100) throw new ConvexError("حداکثر ۱۰۰ ردیف مجاز است.");
    const issueDate = args.issueDate ?? Date.now();
    const dueDate = args.dueDate ?? issueDate + 30 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(issueDate) || !Number.isInteger(issueDate)) {
      throw new ConvexError("تاریخ فاکتور معتبر نیست.");
    }
    const products: (Doc<"products"> | null)[] = [];
    const computed = [];
    let subtotal = 0;
    let taxAmount = 0;
    for (const [index, line] of args.lines.entries()) {
      const quantityMilli = requireInt(line.quantityMilli, "تعداد", { min: 1 });
      const unitPrice = requireInt(line.unitPrice, "قیمت واحد", { min: 0 });
      const lineDiscount = requireInt(line.discount ?? 0, "تخفیف ردیف", { min: 0 });
      const gross = quantityValue(quantityMilli, unitPrice);
      if (lineDiscount > gross) throw new ConvexError("تخفیف ردیف از مبلغ ردیف بیشتر است.");
      const product = line.productId ? await ctx.db.get(line.productId) : null;
      if (line.productId) {
        if (!product || product.businessId !== args.businessId) {
          throw new ConvexError("کالای یکی از ردیف‌ها یافت نشد.");
        }
        if (!product.active) throw new ConvexError("کالای غیرفعال قابل فروش نیست.");
      }
      const description =
        (product?.name ?? optionalString(line.description, "شرح ردیف", 200)) ||
        `ردیف ${index + 1}`;
      const net = gross - lineDiscount;
      const rate = requireInt(
        line.taxRateBps ?? product?.taxRateBps ?? business.taxRateBps,
        "نرخ مالیات",
        { min: 0, max: 10000 },
      );
      computed.push({
        product,
        description,
        quantityMilli,
        unitPrice,
        discount: lineDiscount,
        taxRateBps: rate,
        net,
        gross,
      });
      products.push(product);
      subtotal += net;
    }
    const invoiceDiscount = requireInt(args.discount ?? 0, "تخفیف فاکتور", { min: 0 });
    if (invoiceDiscount > subtotal) throw new ConvexError("تخفیف فاکتور از جمع ردیف‌ها بیشتر است.");
    const taxableRatio = subtotal > 0 ? (subtotal - invoiceDiscount) / subtotal : 0;
    const lines = computed.map((line) => {
      const taxable = Math.round(line.net * taxableRatio);
      const lineTax = Math.round((taxable * line.taxRateBps) / 10000);
      taxAmount += lineTax;
      return { ...line, taxable, taxAmount: lineTax, lineTotal: line.net };
    });
    const shippingCost = requireInt(args.shippingCost ?? 0, "هزینه حمل", { min: 0 });
    const total = subtotal - invoiceDiscount + taxAmount + shippingCost;
    const payments = (args.payments ?? []).filter((payment) => payment.method !== "credit");
    let paidAmount = 0;
    for (const payment of payments) {
      const amount = requireInt(payment.amount, "مبلغ پرداخت", { min: 1 });
      paidAmount += amount;
    }
    if (paidAmount > total) throw new ConvexError("جمع پرداخت‌ها از مبلغ فاکتور بیشتر است.");
    if (args.status === "draft" && paidAmount > 0) {
      throw new ConvexError("برای پیش‌فاکتور پرداخت ثبت نمی‌شود؛ ابتدا فاکتور را قطعی کنید.");
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, issueDate);
    if (!scope.branchId || !scope.fiscalYearId) throw new ConvexError("شعبه یا دوره مالی فاکتور مشخص نیست.");
    const fiscalYear = await getFiscalYear(ctx, args.businessId, scope.fiscalYearId);
    if (args.status === "issued") assertDocumentDateInFiscalYear(fiscalYear, issueDate);

    const sequence = await nextCounter(ctx, args.businessId, "invoice");
    const number = padSequence(sequence, "INV");
    const now = Date.now();
    const invoiceId = await ctx.db.insert("invoices", {
      businessId: args.businessId,
      customerId: args.customerId,
      sequence,
      number,
      status: args.status === "draft" ? "draft" : paidAmount >= total ? "paid" : "issued",
      issueDate,
      dueDate,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      warehouseId: warehouse._id,
      subtotal,
      discount: invoiceDiscount,
      taxRateBps: lines.length > 0 && lines.every((line) => line.taxRateBps === lines[0].taxRateBps) ? lines[0].taxRateBps : 0,
      taxAmount,
      shippingCost,
      total,
      paidAmount,
      costOfGoods: 0,
      paymentSummary: payments.length
        ? payments.map((payment) => `${payment.method}:${payment.amount}`).join(",")
        : "credit",
      notes: optionalString(args.notes, "توضیحات", 1000),
      issuedAt: args.status === "issued" ? now : undefined,
      paidAt: args.status === "issued" && paidAmount >= total ? now : undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    let costTotal = 0;
    const stockLines: { product: Doc<"products">; quantityMilli: number; costUnit: number }[] = [];
    if (args.status === "issued") {
      for (const line of lines) {
        if (!line.product || !isStocked(line.product)) continue;
        const cost = await consumeCost(ctx, {
          businessId: args.businessId,
          warehouseId: warehouse._id,
          productId: line.product._id,
          quantityMilli: line.quantityMilli,
          occurredAt: issueDate,
          allowNegativeStock: Boolean(business.allowNegativeStock),
          valuationMethod: business.inventoryValuationMethod ?? "weighted_average",
          fallbackUnitCost: line.product.purchasePrice,
        });
        costTotal += cost.costTotal;
        stockLines.push({ product: line.product, quantityMilli: line.quantityMilli, costUnit: cost.unitCost });
      }
    }

    for (const [position, line] of lines.entries()) {
      const stock = stockLines.find((row) => row.product._id === line.product?._id && row.quantityMilli === line.quantityMilli);
      await ctx.db.insert("invoiceItems", {
        businessId: args.businessId,
        invoiceId,
        description: line.description,
        productId: line.product?._id,
        warehouseId: warehouse._id,
        quantityMilli: line.quantityMilli,
        unit: line.product?.unit,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRateBps: line.taxRateBps,
        taxAmount: line.taxAmount,
        costUnit: stock?.costUnit,
        costTotal: stock ? quantityValue(line.quantityMilli, stock.costUnit) : 0,
        returnedQuantityMilli: 0,
        lineTotal: line.lineTotal,
        position,
      });
    }

    let accountingDocumentId: Id<"accountingDocuments"> | undefined;
    if (args.status === "issued") {
      await ctx.db.patch(invoiceId, { costOfGoods: costTotal });
      const sales = await systemAccount(ctx, args.businessId, "sales", user._id);
      const vat = taxAmount > 0 ? await systemAccount(ctx, args.businessId, "vatPayable", user._id) : null;
      const inventory = costTotal > 0 ? await systemAccount(ctx, args.businessId, "inventory", user._id) : null;
      const cogs = costTotal > 0 ? await systemAccount(ctx, args.businessId, "cogs", user._id) : null;
      const receivable = await systemAccount(ctx, args.businessId, "receivable", user._id);
      const journalLines = [];
      const refs = [];
      for (const payment of payments) {
        if (payment.amount <= 0) continue;
        const ref = await resolveFinancialAccount(ctx, args.businessId, {
          type: payment.method === "cash" ? "cash" : "bank",
          bankAccountId: payment.bankAccountId,
          cashFundId: payment.cashFundId,
        });
        refs.push({ ref, amount: payment.amount, method: payment.method });
        journalLines.push({
          accountId: ref.accountId,
          description: `دریافت فاکتور ${number}`,
          debit: payment.amount,
          credit: 0,
        });
      }
      const receivableAmount = total - paidAmount;
      if (receivableAmount > 0) {
        journalLines.push({
          accountId: receivable._id,
          description: `مطالبات فاکتور ${number}`,
          debit: receivableAmount,
          credit: 0,
        });
      }
      journalLines.push({
        accountId: sales._id,
        description: `فروش ${number}`,
        debit: 0,
        credit: subtotal - invoiceDiscount + shippingCost,
      });
      if (vat && taxAmount > 0) {
        journalLines.push({
          accountId: vat._id,
          description: `مالیات فروش ${number}`,
          debit: 0,
          credit: taxAmount,
        });
      }
      if (inventory && cogs && costTotal > 0) {
        journalLines.push({
          accountId: cogs._id,
          description: `بهای تمام‌شده ${number}`,
          debit: costTotal,
          credit: 0,
        });
        journalLines.push({
          accountId: inventory._id,
          description: `کاهش موجودی ${number}`,
          debit: 0,
          credit: costTotal,
        });
      }
      const journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: issueDate,
        description: `فاکتور فروش ${number} — ${customer.name}`,
        sourceType: "sales-invoice",
        sourceId: invoiceId as string,
        branchId: scope.branchId,
        lines: journalLines,
      });
      accountingDocumentId = journal.documentId;
      for (const item of refs) {
        await recordFinancialMovement(ctx, {
          businessId: args.businessId,
          branchId: scope.branchId as Id<"branches">,
          fiscalYearId: scope.fiscalYearId as Id<"fiscalYears">,
          account: item.ref,
          direction: "in",
          amount: item.amount,
          occurredAt: issueDate,
          operationType: "sales-invoice",
          operationId: `${invoiceId}:${item.method}`,
          description: `دریافت فاکتور ${number}`,
          accountingDocumentId: journal.documentId,
          actorId: user._id,
        });
      }
      if (stockLines.length > 0) {
        const docId = await nextCounter(ctx, args.businessId, "inventory-document");
        const stockDoc = await ctx.db.insert("inventoryDocuments", {
          businessId: args.businessId,
          branchId: scope.branchId,
          fiscalYearId: scope.fiscalYearId,
          sequence: docId,
          number: padSequence(docId, "INV-DOC"),
          type: "issue",
          status: "posted",
          fromWarehouseId: warehouse._id,
          occurredAt: issueDate,
          description: `خروج کالای فاکتور ${number}`,
          sourceType: "sales-invoice",
          sourceId: invoiceId as string,
          accountingDocumentId: journal.documentId,
          totalValue: costTotal,
          createdBy: user._id,
          createdAt: now,
          postedAt: now,
        });
        for (const [position, stock] of stockLines.entries()) {
          await ctx.db.insert("inventoryDocumentLines", {
            businessId: args.businessId,
            documentId: stockDoc,
            productId: stock.product._id,
            quantityMilli: stock.quantityMilli,
            unitCost: stock.costUnit,
            value: quantityValue(stock.quantityMilli, stock.costUnit),
            position,
          });
          await recordStockMovement(ctx, {
            businessId: args.businessId,
            branchId: scope.branchId,
            fiscalYearId: scope.fiscalYearId,
            warehouseId: warehouse._id,
            productId: stock.product._id,
            direction: "out",
            quantityMilli: stock.quantityMilli,
            unitCost: stock.costUnit,
            occurredAt: issueDate,
            operationType: "sales-invoice",
            operationId: invoiceId as string,
            inventoryDocumentId: stockDoc,
            description: `فروش ${number}`,
            actorId: user._id,
          });
        }
      }
      await ctx.db.patch(invoiceId, { accountingDocumentId });
    }

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.status === "issued" ? "invoice.issue" : "invoice.draft",
      entity: "invoices",
      entityId: invoiceId,
      summary: `${args.status === "issued" ? "صدور" : "پیش‌نویس"} فاکتور ${number}`,
    });
    return { invoiceId, number, total, paidAmount, accountingDocumentId };
  },
});

export const issueDraft = mutation({
  args: { businessId: v.id("businesses"), invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(ctx, args.businessId, { write: true });
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("پیش‌فاکتور فروش یافت نشد.");
    }
    if (invoice.status !== "draft") throw new ConvexError("فقط پیش‌فاکتور قابل صدور قطعی است.");
    if (!invoice.warehouseId) throw new ConvexError("انبار پیش‌فاکتور مشخص نیست.");
    const [customer, warehouse, items] = await Promise.all([
      ctx.db.get(invoice.customerId),
      ctx.db.get(invoice.warehouseId),
      ctx.db
        .query("invoiceItems")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect(),
    ]);
    if (!customer || customer.businessId !== args.businessId) throw new ConvexError("مشتری پیش‌فاکتور یافت نشد.");
    if (!warehouse || warehouse.businessId !== args.businessId) throw new ConvexError("انبار پیش‌فاکتور یافت نشد.");
    if (!items.length) throw new ConvexError("پیش‌فاکتور ردیفی ندارد.");
    const issueDate = invoice.issueDate;
    const scope = await resolveDocumentScope(ctx, args.businessId, issueDate);
    if (!scope.branchId || !scope.fiscalYearId) throw new ConvexError("شعبه یا دوره مالی مشخص نیست.");
    const fiscalYear = await getFiscalYear(ctx, args.businessId, scope.fiscalYearId);
    assertDocumentDateInFiscalYear(fiscalYear, issueDate);

    let costTotal = 0;
    const stockLines: { product: Doc<"products">; quantityMilli: number; costUnit: number }[] = [];
    for (const item of items.sort((a, b) => a.position - b.position)) {
      if (!item.productId) continue;
      const product = await ctx.db.get(item.productId);
      if (!product || product.businessId !== args.businessId) throw new ConvexError("کالای پیش‌فاکتور یافت نشد.");
      if (!isStocked(product)) continue;
      const cost = await consumeCost(ctx, {
        businessId: args.businessId,
        warehouseId: warehouse._id,
        productId: product._id,
        quantityMilli: item.quantityMilli,
        occurredAt: issueDate,
        allowNegativeStock: Boolean(business.allowNegativeStock),
        valuationMethod: business.inventoryValuationMethod ?? "weighted_average",
        fallbackUnitCost: product.purchasePrice,
      });
      costTotal += cost.costTotal;
      stockLines.push({ product, quantityMilli: item.quantityMilli, costUnit: cost.unitCost });
      await ctx.db.patch(item._id, {
        costUnit: cost.unitCost,
        costTotal: quantityValue(item.quantityMilli, cost.unitCost),
      });
    }

    const sales = await systemAccount(ctx, args.businessId, "sales", user._id);
    const vat = invoice.taxAmount > 0 ? await systemAccount(ctx, args.businessId, "vatPayable", user._id) : null;
    const inventory = costTotal > 0 ? await systemAccount(ctx, args.businessId, "inventory", user._id) : null;
    const cogs = costTotal > 0 ? await systemAccount(ctx, args.businessId, "cogs", user._id) : null;
    const receivable = await systemAccount(ctx, args.businessId, "receivable", user._id);
    const journalLines = [];
    if (invoice.total > 0) {
      journalLines.push({ accountId: receivable._id, description: `مطالبات فاکتور ${invoice.number}`, debit: invoice.total, credit: 0 });
    }
    journalLines.push({
      accountId: sales._id,
      description: `فروش ${invoice.number}`,
      debit: 0,
      credit: invoice.subtotal - invoice.discount + (invoice.shippingCost ?? 0),
    });
    if (vat && invoice.taxAmount > 0) {
      journalLines.push({ accountId: vat._id, description: `مالیات فروش ${invoice.number}`, debit: 0, credit: invoice.taxAmount });
    }
    if (inventory && cogs && costTotal > 0) {
      journalLines.push({ accountId: cogs._id, description: `بهای تمام‌شده ${invoice.number}`, debit: costTotal, credit: 0 });
      journalLines.push({ accountId: inventory._id, description: `کاهش موجودی ${invoice.number}`, debit: 0, credit: costTotal });
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: issueDate,
      description: `فاکتور فروش ${invoice.number} — ${customer.name}`,
      sourceType: "sales-invoice",
      sourceId: invoice._id as string,
      branchId: scope.branchId,
      lines: journalLines,
    });
    const now = Date.now();
    if (stockLines.length > 0) {
      const docSequence = await nextCounter(ctx, args.businessId, "inventory-document");
      const stockDoc = await ctx.db.insert("inventoryDocuments", {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        sequence: docSequence,
        number: padSequence(docSequence, "INV-DOC"),
        type: "issue",
        status: "posted",
        fromWarehouseId: warehouse._id,
        occurredAt: issueDate,
        description: `خروج کالای فاکتور ${invoice.number}`,
        sourceType: "sales-invoice",
        sourceId: invoice._id as string,
        accountingDocumentId: journal.documentId,
        totalValue: costTotal,
        createdBy: user._id,
        createdAt: now,
        postedAt: now,
      });
      for (const [position, stock] of stockLines.entries()) {
        await ctx.db.insert("inventoryDocumentLines", {
          businessId: args.businessId,
          documentId: stockDoc,
          productId: stock.product._id,
          quantityMilli: stock.quantityMilli,
          unitCost: stock.costUnit,
          value: quantityValue(stock.quantityMilli, stock.costUnit),
          position,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: scope.branchId,
          fiscalYearId: scope.fiscalYearId,
          warehouseId: warehouse._id,
          productId: stock.product._id,
          direction: "out",
          quantityMilli: stock.quantityMilli,
          unitCost: stock.costUnit,
          occurredAt: issueDate,
          operationType: "sales-invoice",
          operationId: invoice._id as string,
          inventoryDocumentId: stockDoc,
          description: `فروش ${invoice.number}`,
          actorId: user._id,
        });
      }
    }
    await ctx.db.patch(invoice._id, {
      status: "issued",
      costOfGoods: costTotal,
      accountingDocumentId: journal.documentId,
      paymentSummary: "credit",
      issuedAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "invoice.issue",
      entity: "invoices",
      entityId: invoice._id,
      summary: `صدور قطعی پیش‌فاکتور ${invoice.number}`,
    });
    return { invoiceId: invoice._id, number: invoice.number, total: invoice.total, accountingDocumentId: journal.documentId };
  },
});

export const createReturn = mutation({
  args: {
    businessId: v.id("businesses"),
    invoiceId: v.id("invoices"),
    lines: v.array(
      v.object({
        invoiceItemId: v.id("invoiceItems"),
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
    if (!invoice || invoice.businessId !== args.businessId) throw new ConvexError("فاکتور فروش یافت نشد.");
    if (invoice.status === "draft" || invoice.status === "void") {
      throw new ConvexError("برگشت فقط برای فاکتور قطعی مجاز است.");
    }
    if (!args.lines.length) throw new ConvexError("حداقل یک ردیف برگشت لازم است.");
    const occurredAt = args.occurredAt ?? Date.now();
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) throw new ConvexError("شعبه یا دوره مالی مشخص نیست.");
    const fiscalYear = await getFiscalYear(ctx, args.businessId, scope.fiscalYearId);
    assertDocumentDateInFiscalYear(fiscalYear, occurredAt);
    const [items, customer, warehouse] = await Promise.all([
      ctx.db.query("invoiceItems").withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id)).collect(),
      ctx.db.get(invoice.customerId),
      invoice.warehouseId ? ctx.db.get(invoice.warehouseId) : Promise.resolve(null),
    ]);
    const itemMap = new Map(items.map((item) => [item._id as string, item]));
    let subtotal = 0;
    let taxAmount = 0;
    let costOfGoods = 0;
    const stocks: { productId: Id<"products">; quantityMilli: number; costUnit: number }[] = [];
    const selected = [];
    for (const line of args.lines) {
      const item = itemMap.get(line.invoiceItemId as string);
      if (!item) throw new ConvexError("ردیف فاکتور یافت نشد.");
      const qty = requireInt(line.quantityMilli, "تعداد برگشت", { min: 1 });
      const available = item.quantityMilli - (item.returnedQuantityMilli ?? 0);
      if (qty > available) throw new ConvexError("تعداد برگشت از باقی‌مانده ردیف بیشتر است.");
      const ratio = qty / item.quantityMilli;
      const net = Math.round(item.lineTotal * ratio);
      const tax = Math.round((item.taxAmount ?? 0) * ratio);
      const cost = quantityValue(qty, item.costUnit ?? 0);
      subtotal += net;
      taxAmount += tax;
      costOfGoods += cost;
      selected.push({ item, qty, net, tax });
      if (item.productId) stocks.push({ productId: item.productId, quantityMilli: qty, costUnit: item.costUnit ?? 0 });
    }
    const total = subtotal + taxAmount;
    if (total <= 0) throw new ConvexError("مبلغ برگشت معتبر نیست.");
    const sequence = await nextCounter(ctx, args.businessId, "sales-return");
    const number = padSequence(sequence, "SRT");
    const now = Date.now();
    const returnId = await ctx.db.insert("salesReturns", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      invoiceId: invoice._id,
      customerId: invoice.customerId,
      warehouseId: invoice.warehouseId,
      sequence,
      number,
      status: "posted",
      occurredAt,
      subtotal,
      taxAmount,
      total,
      refundMethod: args.refundMethod,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
      costOfGoods,
      notes: optionalString(args.notes, "توضیحات", 800),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, row] of selected.entries()) {
      await ctx.db.insert("salesReturnItems", {
        businessId: args.businessId,
        returnId,
        invoiceItemId: row.item._id,
        productId: row.item.productId,
        quantityMilli: row.qty,
        unitPrice: row.item.unitPrice,
        taxRateBps: row.item.taxRateBps ?? 0,
        taxAmount: row.tax,
        lineTotal: row.net,
        costUnit: row.item.costUnit ?? 0,
        costTotal: quantityValue(row.qty, row.item.costUnit ?? 0),
        position,
      });
      await ctx.db.patch(row.item._id, {
        returnedQuantityMilli: (row.item.returnedQuantityMilli ?? 0) + row.qty,
      });
    }
    const refundRef =
      args.refundMethod === "credit"
        ? null
        : await resolveFinancialAccount(ctx, args.businessId, {
            type: args.refundMethod === "cash" ? "cash" : "bank",
            bankAccountId: args.bankAccountId,
            cashFundId: args.cashFundId,
          });
    const sales = await systemAccount(ctx, args.businessId, "sales", user._id);
    const vat = taxAmount > 0 ? await systemAccount(ctx, args.businessId, "vatPayable", user._id) : null;
    const receivable = args.refundMethod === "credit" ? await systemAccount(ctx, args.businessId, "receivable", user._id) : null;
    const inventory = costOfGoods > 0 ? await systemAccount(ctx, args.businessId, "inventory", user._id) : null;
    const cogs = costOfGoods > 0 ? await systemAccount(ctx, args.businessId, "cogs", user._id) : null;
    const journalLines = [
      { accountId: sales._id, description: `برگشت از فروش ${number}`, debit: subtotal, credit: 0 },
    ];
    if (vat && taxAmount > 0) journalLines.push({ accountId: vat._id, description: "برگشت مالیات فروش", debit: taxAmount, credit: 0 });
    const refundAccountId = refundRef?.accountId ?? receivable?._id;
    if (!refundAccountId) {
      throw new ConvexError("حساب بازگشت وجه برگشت فروش مشخص نیست.");
    }
    journalLines.push({
      accountId: refundAccountId,
      description: `بازگشت وجه ${number}`,
      debit: 0,
      credit: total,
    });
    if (inventory && cogs && costOfGoods > 0) {
      journalLines.push({ accountId: inventory._id, description: `بازگشت موجودی ${number}`, debit: costOfGoods, credit: 0 });
      journalLines.push({ accountId: cogs._id, description: "برگشت بهای تمام‌شده", debit: 0, credit: costOfGoods });
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt,
      description: `برگشت از فروش ${number} — ${customer?.name ?? "مشتری"}`,
      sourceType: "sales-return",
      sourceId: returnId as string,
      branchId: scope.branchId,
      lines: journalLines,
    });
    if (refundRef) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        account: refundRef,
        direction: "out",
        amount: total,
        occurredAt,
        operationType: "sales-return",
        operationId: returnId as string,
        description: `بازگشت وجه ${number}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    if (stocks.length > 0 && warehouse) {
      const docSeq = await nextCounter(ctx, args.businessId, "inventory-document");
      const stockDoc = await ctx.db.insert("inventoryDocuments", {
        businessId: args.businessId,
        branchId: scope.branchId,
        fiscalYearId: scope.fiscalYearId,
        sequence: docSeq,
        number: padSequence(docSeq, "INV-DOC"),
        type: "return_from_customer",
        status: "posted",
        toWarehouseId: warehouse._id,
        occurredAt,
        description: `برگشت از فروش ${number}`,
        sourceType: "sales-return",
        sourceId: returnId as string,
        accountingDocumentId: journal.documentId,
        totalValue: costOfGoods,
        createdBy: user._id,
        createdAt: now,
        postedAt: now,
      });
      for (const [position, stock] of stocks.entries()) {
        await ctx.db.insert("inventoryDocumentLines", {
          businessId: args.businessId,
          documentId: stockDoc,
          productId: stock.productId,
          quantityMilli: stock.quantityMilli,
          unitCost: stock.costUnit,
          value: quantityValue(stock.quantityMilli, stock.costUnit),
          position,
        });
        await addCostLayer(ctx, {
          businessId: args.businessId,
          warehouseId: warehouse._id,
          productId: stock.productId,
          quantityMilli: stock.quantityMilli,
          unitCost: stock.costUnit,
          sourceType: "sales-return",
          sourceId: returnId as string,
          occurredAt,
        });
        await recordStockMovement(ctx, {
          businessId: args.businessId,
          branchId: scope.branchId,
          fiscalYearId: scope.fiscalYearId,
          warehouseId: warehouse._id,
          productId: stock.productId,
          direction: "in",
          quantityMilli: stock.quantityMilli,
          unitCost: stock.costUnit,
          occurredAt,
          operationType: "sales-return",
          operationId: returnId as string,
          inventoryDocumentId: stockDoc,
          description: `برگشت از فروش ${number}`,
          actorId: user._id,
        });
      }
    }
    const newReturned = (invoice.returnedAmount ?? 0) + total;
    let paidAmount = invoice.paidAmount ?? 0;
    if (refundRef) {
      paidAmount = Math.max(0, paidAmount - total);
    }
    await ctx.db.patch(invoice._id, {
      returnedAmount: newReturned,
      paidAmount,
      status: paidAmount >= invoice.total - newReturned ? "paid" : "issued",
      updatedAt: now,
    });
    await ctx.db.patch(returnId, { accountingDocumentId: journal.documentId });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "sales.return",
      entity: "salesReturns",
      entityId: returnId,
      summary: `برگشت از فروش ${number} برای ${invoice.number}`,
    });
    return { returnId, number, total, accountingDocumentId: journal.documentId };
  },
});

export const returns = query({
  args: {
    businessId: v.id("businesses"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("salesReturns")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(Math.min(args.limit ?? 200, 500));
    const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))];
    const invoices = await Promise.all(invoiceIds.map((id) => ctx.db.get(id)));
    const numbers = new Map(invoices.filter((row): row is Doc<"invoices"> => Boolean(row)).map((row) => [row._id as string, row.number]));
    return rows
      .filter((row) => !args.from || row.occurredAt >= args.from)
      .filter((row) => !args.to || row.occurredAt <= args.to)
      .map((row) => ({
        _id: row._id as string,
        number: row.number,
        invoiceId: row.invoiceId as string,
        invoiceNumber: numbers.get(row.invoiceId as string) ?? "—",
        total: row.total,
        occurredAt: row.occurredAt,
        status: row.status,
        accountingDocumentId: row.accountingDocumentId ? (row.accountingDocumentId as string) : null,
      }));
  },
});
