import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMembership } from "./lib/tenant";

const TYPE_LABELS = {
  asset: "دارایی",
  liability: "بدهی",
  equity: "سرمایه",
  income: "درآمد",
  expense: "هزینه",
} as const;

const LEVEL_LABELS = {
  group: "گروه",
  ledger: "کل",
  subsidiary: "معین",
  detail: "تفصیلی",
} as const;

/**
 * Tenant-scoped global search over modules that actually exist. Journal and
 * chart results are real Phase 5 records; missing modules remain explicit gaps.
 */
export const global = query({
  args: {
    businessId: v.id("businesses"),
    term: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);

    const term = args.term.trim().toLowerCase();
    if (term.length < 2) {
      return {
        term,
        customers: [],
        invoices: [],
        accounts: [],
        documents: [],
        suppliers: [],
        products: [],
        modules: {
          suppliers: true,
          products: true,
          journals: true,
          accounts: true,
        },
      };
    }

    const [customers, invoices, accounts, documents, suppliers, products] = await Promise.all([
      ctx.db
        .query("customers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1000),
      ctx.db
        .query("invoices")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1000),
      ctx.db
        .query("accounts")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2000),
      ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_date", (q) =>
          q.eq("businessId", args.businessId),
        )
        .order("desc")
        .take(1000),
      ctx.db
        .query("suppliers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1000),
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1500),
    ]);

    const customerName = new Map<string, string>();
    for (const customer of customers) {
      customerName.set(customer._id as string, customer.name);
    }

    const matchedCustomers = customers
      .filter((customer) => !customer.archivedAt)
      .filter((customer) =>
        [customer.name, customer.code, customer.phone, customer.email, customer.nationalId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      )
      .slice(0, 6)
      .map((customer) => ({
        _id: customer._id as string,
        title: customer.name,
        subtitle: `${customer.code}${customer.phone ? ` · ${customer.phone}` : ""}`,
        href: `/dashboard/commerce/customers?customer=${customer._id}`,
      }));

    const matchedInvoices = invoices
      .filter((invoice) => {
        const number = invoice.number.toLowerCase();
        const name = (customerName.get(invoice.customerId as string) ?? "").toLowerCase();
        return number.includes(term) || name.includes(term);
      })
      .sort((a, b) => b.issueDate - a.issueDate)
      .slice(0, 6)
      .map((invoice) => ({
        _id: invoice._id as string,
        title: invoice.number,
        subtitle: customerName.get(invoice.customerId as string) ?? "مشتری نامشخص",
        status: invoice.status,
        total: invoice.total,
        date: invoice.issueDate,
        href: `/dashboard/invoices?invoice=${invoice._id}`,
      }));

    const matchedAccounts = accounts
      .filter((account) =>
        [account.code, account.name, account.linkedEntityName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      )
      .sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
      .slice(0, 6)
      .map((account) => ({
        _id: account._id as string,
        title: `${account.code} — ${account.name}`,
        subtitle: `${LEVEL_LABELS[account.level]} · ${TYPE_LABELS[account.type]}${
          account.active ? "" : " · غیرفعال"
        }`,
        postable: account.postable,
        href: `/dashboard/accounting/accounts?account=${account._id}`,
      }));

    const matchedDocuments = documents
      .filter(
        (document) =>
          document.number.toLowerCase().includes(term) ||
          document.description.toLowerCase().includes(term),
      )
      .slice(0, 6)
      .map((document) => ({
        _id: document._id as string,
        title: document.number,
        subtitle: document.description,
        status: document.status,
        kind: document.kind,
        totalDebit: document.totalDebit,
        totalCredit: document.totalCredit,
        date: document.documentDate,
        href: `/dashboard/accounting/documents/${document._id}`,
      }));

    const matchedSuppliers = suppliers
      .filter((supplier) =>
        [supplier.name, supplier.code, supplier.phone, supplier.mobile, supplier.nationalId, supplier.economicCode]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      )
      .slice(0, 6)
      .map((supplier) => ({
        _id: supplier._id as string,
        title: supplier.name,
        subtitle: `${supplier.code}${supplier.mobile ? ` · ${supplier.mobile}` : ""}`,
        href: `/dashboard/commerce/suppliers?supplier=${supplier._id}`,
      }));

    const matchedProducts = products
      .filter((product) =>
        [product.name, product.code, product.barcode, product.brand]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      )
      .slice(0, 6)
      .map((product) => ({
        _id: product._id as string,
        title: product.name,
        subtitle: `${product.code}${product.barcode ? ` · ${product.barcode}` : ""} · ${product.unit}`,
        href: `/dashboard/commerce/products?product=${product._id}`,
      }));

    return {
      term,
      customers: matchedCustomers,
      invoices: matchedInvoices,
      accounts: matchedAccounts,
      documents: matchedDocuments,
      suppliers: matchedSuppliers,
      products: matchedProducts,
      modules: {
        suppliers: true,
        products: true,
        journals: true,
        accounts: true,
      },
    };
  },
});
