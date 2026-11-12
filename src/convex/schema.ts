import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// Default user roles used by the auth template.
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/**
 * Roles inside a business workspace.
 * - owner: full control, can never be locked out
 * - admin: manages data and members
 * - accountant: writes operational documents
 * - viewer: read-only access
 */
export const memberRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("accountant"),
  v.literal("viewer"),
);
export type MemberRole = Infer<typeof memberRoleValidator>;

/** Invoice lifecycle. Financial documents are never hard-deleted. */
export const invoiceStatusValidator = v.union(
  v.literal("draft"), // پیش‌نویس — editable, not part of revenue
  v.literal("issued"), // صادرشده — final, counts as receivable
  v.literal("paid"), // پرداخت‌شده — settled
  v.literal("void"), // ابطال‌شده — kept for the audit trail, excluded from reports
);
export type InvoiceStatus = Infer<typeof invoiceStatusValidator>;

/** Payment method for real cash movements recorded by the app. */
export const paymentMethodValidator = v.union(
  v.literal("cash"),
  v.literal("bank"),
);
export type PaymentMethod = Infer<typeof paymentMethodValidator>;

/** Direction of a payment: money received from a customer or paid out. */
export const paymentDirectionValidator = v.union(
  v.literal("receipt"),
  v.literal("payment"),
);
export type PaymentDirection = Infer<typeof paymentDirectionValidator>;

/** Manual other-income / expense records used by the management dashboard. */
export const transactionKindValidator = v.union(
  v.literal("income"),
  v.literal("expense"),
);
export type TransactionKind = Infer<typeof transactionKindValidator>;

export const fiscalYearStatusValidator = v.union(
  v.literal("open"),
  v.literal("closed"),
);
export type FiscalYearStatus = Infer<typeof fiscalYearStatusValidator>;

/* -------------------------------------------------------------------- *
 * Phase 6 — treasury and cash management
 * -------------------------------------------------------------------- */

export const financialAccountTypeValidator = v.union(
  v.literal("bank"),
  v.literal("cash"),
);
export type FinancialAccountType = Infer<
  typeof financialAccountTypeValidator
>;

export const voucherStatusValidator = v.union(
  v.literal("draft"),
  v.literal("posted"),
  v.literal("cancelled"),
);
export type VoucherStatus = Infer<typeof voucherStatusValidator>;

/** Methods supported by receipts, payments and other cash operations. */
export const financeMethodValidator = v.union(
  v.literal("cash"),
  v.literal("card"),
  v.literal("bank_transfer"),
  v.literal("check"),
  v.literal("other"),
);
export type FinanceMethod = Infer<typeof financeMethodValidator>;

export const expenseCategoryValidator = v.union(
  v.literal("rent"),
  v.literal("salary"),
  v.literal("utilities"),
  v.literal("internet"),
  v.literal("transport"),
  v.literal("repairs"),
  v.literal("advertising"),
  v.literal("supplies"),
  v.literal("other"),
);
export type ExpenseCategory = Infer<typeof expenseCategoryValidator>;

export const expenseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("paid"),
  v.literal("cancelled"),
);
export type ExpenseStatus = Infer<typeof expenseStatusValidator>;

export const receivedCheckStatusValidator = v.union(
  v.literal("received"),
  v.literal("pending"),
  v.literal("assigned"),
  v.literal("collected"),
  v.literal("bounced"),
  v.literal("cancelled"),
);
export type ReceivedCheckStatus = Infer<
  typeof receivedCheckStatusValidator
>;

export const issuedCheckStatusValidator = v.union(
  v.literal("issued"),
  v.literal("delivered"),
  v.literal("collected"),
  v.literal("cancelled"),
  v.literal("bounced"),
);
export type IssuedCheckStatus = Infer<typeof issuedCheckStatusValidator>;

export const checkDirectionValidator = v.union(
  v.literal("received"),
  v.literal("issued"),
);

/* -------------------------------------------------------------------- *
 * Phase 8 — organisation, people, payroll, tax and fixed assets
 * -------------------------------------------------------------------- */

export const employmentTypeValidator = v.union(
  v.literal("full_time"),
  v.literal("part_time"),
  v.literal("contract"),
  v.literal("temporary"),
  v.literal("intern"),
);
export type EmploymentType = Infer<typeof employmentTypeValidator>;

export const employeeStatusValidator = v.union(
  v.literal("active"),
  v.literal("on_leave"),
  v.literal("suspended"),
  v.literal("terminated"),
);
export type EmployeeStatus = Infer<typeof employeeStatusValidator>;

export const contractStatusValidator = v.union(
  v.literal("active"),
  v.literal("ended"),
  v.literal("renewed"),
  v.literal("cancelled"),
);
export type ContractStatus = Infer<typeof contractStatusValidator>;

export const attendanceStatusValidator = v.union(
  v.literal("present"),
  v.literal("late"),
  v.literal("absent"),
  v.literal("leave"),
  v.literal("mission"),
  v.literal("holiday"),
);
export type AttendanceStatus = Infer<typeof attendanceStatusValidator>;

export const leaveTypeValidator = v.union(
  v.literal("annual"),
  v.literal("sick"),
  v.literal("unpaid"),
  v.literal("maternity"),
  v.literal("hajj"),
  v.literal("marriage"),
  v.literal("bereavement"),
  v.literal("other"),
);
export type LeaveType = Infer<typeof leaveTypeValidator>;

export const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
);
export type RequestStatus = Infer<typeof requestStatusValidator>;

export const payrollPeriodStatusValidator = v.union(
  v.literal("draft"),
  v.literal("calculated"),
  v.literal("approved"),
  v.literal("paid"),
);
export type PayrollPeriodStatus = Infer<
  typeof payrollPeriodStatusValidator
>;

export const payrollComponentKindValidator = v.union(
  v.literal("earning"),
  v.literal("deduction"),
  v.literal("employer"),
);
export type PayrollComponentKind = Infer<
  typeof payrollComponentKindValidator
>;

export const taxTypeValidator = v.union(
  v.literal("sales"),
  v.literal("purchase"),
  v.literal("payroll"),
  v.literal("income"),
  v.literal("other"),
);
export type TaxType = Infer<typeof taxTypeValidator>;

export const taxPeriodStatusValidator = v.union(
  v.literal("open"),
  v.literal("filed"),
  v.literal("paid"),
  v.literal("closed"),
);
export type TaxPeriodStatus = Infer<typeof taxPeriodStatusValidator>;

export const depreciationMethodValidator = v.union(
  v.literal("straight_line"),
  v.literal("declining_balance"),
  v.literal("custom"),
);
export type DepreciationMethod = Infer<
  typeof depreciationMethodValidator
>;

export const assetStatusValidator = v.union(
  v.literal("active"),
  v.literal("fully_depreciated"),
  v.literal("sold"),
  v.literal("disposed"),
);
export type AssetStatus = Infer<typeof assetStatusValidator>;

export const assetMovementTypeValidator = v.union(
  v.literal("purchase"),
  v.literal("transfer"),
  v.literal("repair"),
  v.literal("sale"),
  v.literal("disposal"),
  v.literal("depreciation"),
);
export type AssetMovementType = Infer<
  typeof assetMovementTypeValidator
>;

/* -------------------------------------------------------------------- *
 * Phase 11 — SaaS plans, subscriptions, billing and legal pages
 * -------------------------------------------------------------------- */

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("pending_payment"),
  v.literal("expired"),
  v.literal("cancelled"),
  v.literal("grace"),
);
export type SubscriptionStatus = Infer<
  typeof subscriptionStatusValidator
>;

export const subscriptionPaymentStatusValidator = v.union(
  v.literal("unpaid"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("refunded"),
);
export type SubscriptionPaymentStatus = Infer<
  typeof subscriptionPaymentStatusValidator
>;

export const subscriptionInvoiceStatusValidator = v.union(
  v.literal("unpaid"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("refunded"),
);
export type SubscriptionInvoiceStatus = Infer<
  typeof subscriptionInvoiceStatusValidator
>;

export const subscriptionPaymentAttemptStatusValidator = v.union(
  v.literal("initiated"),
  v.literal("succeeded"),
  v.literal("failed"),
);
export type SubscriptionPaymentAttemptStatus = Infer<
  typeof subscriptionPaymentAttemptStatusValidator
>;

export const subscriptionEventTypeValidator = v.union(
  v.literal("created"),
  v.literal("payment_initiated"),
  v.literal("payment_failed"),
  v.literal("activated"),
  v.literal("renewed"),
  v.literal("expired"),
  v.literal("grace_started"),
  v.literal("cancelled"),
  v.literal("reactivated"),
  v.literal("manual_renewal"),
);
export type SubscriptionEventType = Infer<
  typeof subscriptionEventTypeValidator
>;

export const planLimitsValidator = v.object({
  maxUsers: v.number(),
  maxBranches: v.number(),
  maxWarehouses: v.number(),
  maxStorageMb: v.number(),
  allowedModules: v.array(v.string()),
  advancedFeatures: v.array(v.string()),
});
export type PlanLimits = Infer<typeof planLimitsValidator>;

/* -------------------------------------------------------------------- *
 * Phase 7 — commerce, inventory and purchasing
 * Quantities use thousandths (1.5 → 1500). Money remains integer units.
 * -------------------------------------------------------------------- */

export const personTypeValidator = v.union(
  v.literal("individual"),
  v.literal("legal"),
);
export type PersonType = Infer<typeof personTypeValidator>;

export const productTypeValidator = v.union(
  v.literal("physical"),
  v.literal("service"),
  v.literal("serial"),
  v.literal("expiry"),
);
export type ProductType = Infer<typeof productTypeValidator>;

export const valuationMethodValidator = v.union(
  v.literal("fifo"),
  v.literal("weighted_average"),
);
export type ValuationMethod = Infer<typeof valuationMethodValidator>;

export const inventoryDocumentTypeValidator = v.union(
  v.literal("receipt"),
  v.literal("issue"),
  v.literal("transfer"),
  v.literal("return_from_customer"),
  v.literal("return_to_supplier"),
  v.literal("adjustment"),
  v.literal("count"),
);
export type InventoryDocumentType = Infer<
  typeof inventoryDocumentTypeValidator
>;

export const inventoryDocumentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("posted"),
  v.literal("cancelled"),
);
export type InventoryDocumentStatus = Infer<
  typeof inventoryDocumentStatusValidator
>;

export const purchaseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("posted"),
  v.literal("paid"),
  v.literal("cancelled"),
);
export type PurchaseStatus = Infer<typeof purchaseStatusValidator>;

export const salesReturnStatusValidator = v.union(
  v.literal("posted"),
  v.literal("cancelled"),
);
export type SalesReturnStatus = Infer<typeof salesReturnStatusValidator>;

export const settlementMethodValidator = v.union(
  v.literal("cash"),
  v.literal("card"),
  v.literal("bank"),
  v.literal("credit"),
);
export type SettlementMethod = Infer<typeof settlementMethodValidator>;

/* -------------------------------------------------------------------- *
 * Double-entry accounting
 * Amounts are integer minor units of the business currency. This is the
 * exact-decimal strategy used across the app (no floating point money).
 * -------------------------------------------------------------------- */

export const accountLevelValidator = v.union(
  v.literal("group"), // گروه حساب
  v.literal("ledger"), // حساب کل
  v.literal("subsidiary"), // حساب معین
  v.literal("detail"), // حساب تفصیلی / قابل ثبت
);
export type AccountLevel = Infer<typeof accountLevelValidator>;

export const accountTypeValidator = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("income"),
  v.literal("expense"),
);
export type AccountType = Infer<typeof accountTypeValidator>;

export const accountNatureValidator = v.union(
  v.literal("debit"),
  v.literal("credit"),
);
export type AccountNature = Infer<typeof accountNatureValidator>;

export const accountDetailKindValidator = v.union(
  v.literal("none"),
  v.literal("customer"),
  v.literal("supplier"),
  v.literal("employee"),
  v.literal("other"),
);
export type AccountDetailKind = Infer<typeof accountDetailKindValidator>;

export const accountingDocumentStatusValidator = v.union(
  v.literal("draft"), // پیش‌نویس
  v.literal("pending"), // در انتظار تأیید
  v.literal("posted"), // قطعی
  v.literal("reversed"), // معکوس‌شده (سند اصلی حفظ می‌شود)
);
export type AccountingDocumentStatus = Infer<
  typeof accountingDocumentStatusValidator
>;

export const accountingDocumentKindValidator = v.union(
  v.literal("normal"),
  v.literal("opening"),
  v.literal("closing"),
);
export type AccountingDocumentKind = Infer<
  typeof accountingDocumentKindValidator
>;

const schema = defineSchema(
  {
    // Default auth tables brought in by Convex Auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // do not remove
      isAnonymous: v.optional(v.boolean()), // do not remove

      role: v.optional(roleValidator), // platform role. do not remove
      phone: v.optional(v.string()),
    }).index("email", ["email"]), // do not remove or modify

    /* ------------------------------------------------------------------ *
     * Tenancy
     * Every operational table carries `businessId`. Access is always
     * re-verified on the server through `businessMembers`.
     * ------------------------------------------------------------------ */

    businesses: defineTable({
      name: v.string(),
      slug: v.string(),
      legalName: v.optional(v.string()),
      currency: v.string(), // ISO-ish code, default "IRT" (تومان)
      currencyDecimals: v.number(), // 0 for تومان/ریال
      taxRateBps: v.number(), // default tax rate in basis points (900 = ۹٪)
      inventoryValuationMethod: v.optional(valuationMethodValidator),
      allowNegativeStock: v.optional(v.boolean()),
      purchaseTaxRecoverable: v.optional(v.boolean()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      archivedAt: v.optional(v.number()),
      /**
       * Phase 11 — new SaaS workspaces are marked true. Legacy workspaces
       * (created before subscriptions) remain grandfathered while their data
       * and read access are preserved.
       */
      subscriptionRequired: v.optional(v.boolean()),
      businessType: v.optional(v.string()),
      city: v.optional(v.string()),
      economicCode: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      onboardingKey: v.optional(v.string()),
    })
      .index("by_slug", ["slug"])
      .index("by_onboarding_key", ["onboardingKey"]),

    businessMembers: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      role: memberRoleValidator,
      displayName: v.optional(v.string()),
      /** Phase 8 — explicit granular permissions in addition to the role. */
      permissions: v.optional(v.array(v.string())),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_user", ["userId"])
      .index("by_business_user", ["businessId", "userId"]),

    /* ------------------------------------------------------------------ *
     * Organisation context: branches and fiscal years
     * Every business gets a primary branch and a current fiscal year.
     * Operational documents keep these IDs for scoped reporting.
     * ------------------------------------------------------------------ */

    branches: defineTable({
      businessId: v.id("businesses"),
      name: v.string(),
      code: v.string(),
      isPrimary: v.boolean(),
      /** Phase 8 organisation profile. */
      address: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      managerName: v.optional(v.string()),
      managerEmployeeId: v.optional(v.id("employees")),
      active: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
      archivedAt: v.optional(v.number()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"]),

    fiscalYears: defineTable({
      businessId: v.id("businesses"),
      name: v.string(),
      startAt: v.number(),
      endAt: v.number(),
      status: fiscalYearStatusValidator,
      createdAt: v.number(),
      closedAt: v.optional(v.number()),
      closedBy: v.optional(v.id("users")),
      /** Configurable document number pattern for this fiscal year. */
      documentNumberPrefix: v.optional(v.string()),
      documentNumberPadding: v.optional(v.number()),
      openingDocumentId: v.optional(v.id("accountingDocuments")),
      closingDocumentId: v.optional(v.id("accountingDocuments")),
    })
      .index("by_business", ["businessId"])
      .index("by_business_start", ["businessId", "startAt"]),

    /* ------------------------------------------------------------------ *
     * Customers — v1 core
     * ------------------------------------------------------------------ */

    customers: defineTable({
      businessId: v.id("businesses"),
      code: v.string(), // display code, unique per business: C-0001
      name: v.string(),
      personType: v.optional(personTypeValidator),
      phone: v.optional(v.string()),
      mobile: v.optional(v.string()),
      email: v.optional(v.string()),
      nationalId: v.optional(v.string()),
      economicCode: v.optional(v.string()),
      postalCode: v.optional(v.string()),
      address: v.optional(v.string()),
      creditLimit: v.optional(v.number()),
      active: v.optional(v.boolean()),
      note: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      archivedAt: v.optional(v.number()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_name", ["businessId", "name"]),

    suppliers: defineTable({
      businessId: v.id("businesses"),
      code: v.string(),
      name: v.string(),
      personType: personTypeValidator,
      phone: v.optional(v.string()),
      mobile: v.optional(v.string()),
      email: v.optional(v.string()),
      nationalId: v.optional(v.string()),
      economicCode: v.optional(v.string()),
      postalCode: v.optional(v.string()),
      address: v.optional(v.string()),
      bankAccountNumber: v.optional(v.string()),
      bankName: v.optional(v.string()),
      iban: v.optional(v.string()),
      creditLimit: v.number(),
      note: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_name", ["businessId", "name"]),

    productCategories: defineTable({
      businessId: v.id("businesses"),
      code: v.string(),
      name: v.string(),
      parentId: v.optional(v.id("productCategories")),
      imageStorageId: v.optional(v.id("_storage")),
      description: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_parent", ["businessId", "parentId"]),

    products: defineTable({
      businessId: v.id("businesses"),
      code: v.string(),
      barcode: v.optional(v.string()),
      name: v.string(),
      imageStorageId: v.optional(v.id("_storage")),
      categoryId: v.optional(v.id("productCategories")),
      brand: v.optional(v.string()),
      unit: v.string(),
      purchasePrice: v.number(),
      salePrice: v.number(),
      taxRateBps: v.number(),
      minStockMilli: v.number(),
      productType: productTypeValidator,
      trackSerial: v.boolean(),
      trackExpiry: v.boolean(),
      expiryDate: v.optional(v.number()),
      description: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_barcode", ["businessId", "barcode"])
      .index("by_business_category", ["businessId", "categoryId"])
      .index("by_business_active", ["businessId", "active"]),

    productPriceHistory: defineTable({
      businessId: v.id("businesses"),
      productId: v.id("products"),
      purchasePrice: v.number(),
      salePrice: v.number(),
      changedBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_product", ["productId"]),

    warehouses: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      code: v.string(),
      name: v.string(),
      responsibleName: v.optional(v.string()),
      address: v.optional(v.string()),
      isDefault: v.boolean(),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_default", ["businessId", "isDefault"])
      .index("by_business_branch", ["businessId", "branchId"]),

    /* ------------------------------------------------------------------ *
     * Invoices — v1 core, extended in Phase 7 for product lines and COGS.
     * Amounts are integers in the business currency's smallest unit.
     * Quantities are integers in thousandths (1.5 → 1500) to avoid floats.
     * ------------------------------------------------------------------ */

    invoices: defineTable({
      businessId: v.id("businesses"),
      customerId: v.id("customers"),
      sequence: v.number(), // per-business counter, never reused
      number: v.string(), // display number: INV-0001
      status: invoiceStatusValidator,
      issueDate: v.number(), // UTC ms; display layer formats Jalali
      dueDate: v.optional(v.number()),
      subtotal: v.number(),
      discount: v.number(),
      taxRateBps: v.number(),
      taxAmount: v.number(),
      shippingCost: v.optional(v.number()),
      costOfGoods: v.optional(v.number()),
      returnedAmount: v.optional(v.number()),
      warehouseId: v.optional(v.id("warehouses")),
      paymentSummary: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      total: v.number(),
      notes: v.optional(v.string()),
      branchId: v.optional(v.id("branches")),
      fiscalYearId: v.optional(v.id("fiscalYears")),
      /** Sum of real receipts recorded against this invoice. */
      paidAmount: v.optional(v.number()),
      issuedAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
      voidedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_sequence", ["businessId", "sequence"])
      .index("by_business_issue", ["businessId", "issueDate"])
      .index("by_customer", ["customerId"]),

    invoiceItems: defineTable({
      businessId: v.id("businesses"),
      invoiceId: v.id("invoices"),
      description: v.string(),
      productId: v.optional(v.id("products")),
      warehouseId: v.optional(v.id("warehouses")),
      quantityMilli: v.number(),
      unit: v.optional(v.string()),
      unitPrice: v.number(),
      discount: v.optional(v.number()),
      taxRateBps: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      costUnit: v.optional(v.number()),
      costTotal: v.optional(v.number()),
      returnedQuantityMilli: v.optional(v.number()),
      lineTotal: v.number(),
      position: v.number(),
    })
      .index("by_invoice", ["invoiceId"])
      .index("by_business", ["businessId"])
      .index("by_business_product", ["businessId", "productId"]),

    salesReturns: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      invoiceId: v.id("invoices"),
      customerId: v.id("customers"),
      warehouseId: v.optional(v.id("warehouses")),
      sequence: v.number(),
      number: v.string(),
      status: salesReturnStatusValidator,
      occurredAt: v.number(),
      subtotal: v.number(),
      taxAmount: v.number(),
      total: v.number(),
      refundMethod: v.union(v.literal("credit"), v.literal("cash"), v.literal("bank")),
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      costOfGoods: v.number(),
      notes: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business_invoice", ["businessId", "invoiceId"])
      .index("by_business_number", ["businessId", "number"]),

    salesReturnItems: defineTable({
      businessId: v.id("businesses"),
      returnId: v.id("salesReturns"),
      invoiceItemId: v.id("invoiceItems"),
      productId: v.optional(v.id("products")),
      quantityMilli: v.number(),
      unitPrice: v.number(),
      taxRateBps: v.number(),
      taxAmount: v.number(),
      lineTotal: v.number(),
      costUnit: v.number(),
      costTotal: v.number(),
      position: v.number(),
    })
      .index("by_return", ["returnId"])
      .index("by_business", ["businessId"]),

    purchaseInvoices: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      supplierId: v.id("suppliers"),
      warehouseId: v.id("warehouses"),
      parentId: v.optional(v.id("purchaseInvoices")),
      kind: v.union(v.literal("purchase"), v.literal("return")),
      sequence: v.number(),
      number: v.string(),
      status: purchaseStatusValidator,
      issueDate: v.number(),
      dueDate: v.optional(v.number()),
      subtotal: v.number(),
      discount: v.number(),
      taxRateBps: v.number(),
      taxAmount: v.number(),
      extraCosts: v.number(),
      total: v.number(),
      paidAmount: v.number(),
      returnedAmount: v.optional(v.number()),
      paymentSummary: v.optional(v.string()),
      notes: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      postedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_date", ["businessId", "issueDate"])
      .index("by_business_supplier", ["businessId", "supplierId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "number"])
      .index("by_business_parent", ["businessId", "parentId"]),

    purchaseInvoiceItems: defineTable({
      businessId: v.id("businesses"),
      invoiceId: v.id("purchaseInvoices"),
      productId: v.id("products"),
      description: v.string(),
      quantityMilli: v.number(),
      unit: v.string(),
      unitCost: v.number(),
      discount: v.number(),
      taxRateBps: v.number(),
      taxAmount: v.number(),
      lineTotal: v.number(),
      landedUnitCost: v.number(),
      returnedQuantityMilli: v.optional(v.number()),
      position: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_invoice", ["invoiceId"])
      .index("by_business_product", ["businessId", "productId"]),

    inventoryDocuments: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      sequence: v.number(),
      number: v.string(),
      type: inventoryDocumentTypeValidator,
      status: inventoryDocumentStatusValidator,
      adjustmentDirection: v.optional(v.union(v.literal("in"), v.literal("out"))),
      fromWarehouseId: v.optional(v.id("warehouses")),
      toWarehouseId: v.optional(v.id("warehouses")),
      occurredAt: v.number(),
      description: v.string(),
      sourceType: v.optional(v.string()),
      sourceId: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      totalValue: v.number(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      postedAt: v.optional(v.number()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_date", ["businessId", "occurredAt"])
      .index("by_business_type", ["businessId", "type"])
      .index("by_business_number", ["businessId", "number"])
      .index("by_business_source", ["businessId", "sourceType", "sourceId"]),

    inventoryDocumentLines: defineTable({
      businessId: v.id("businesses"),
      documentId: v.id("inventoryDocuments"),
      productId: v.id("products"),
      quantityMilli: v.number(),
      unitCost: v.number(),
      value: v.number(),
      serialNumbers: v.optional(v.array(v.string())),
      expiryDate: v.optional(v.number()),
      description: v.optional(v.string()),
      position: v.number(),
    })
      .index("by_document", ["documentId"])
      .index("by_business", ["businessId"]),

    inventoryTransactions: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      warehouseId: v.id("warehouses"),
      productId: v.id("products"),
      direction: v.union(v.literal("in"), v.literal("out")),
      quantityMilli: v.number(),
      unitCost: v.number(),
      value: v.number(),
      occurredAt: v.number(),
      operationType: v.string(),
      operationId: v.string(),
      inventoryDocumentId: v.optional(v.id("inventoryDocuments")),
      description: v.string(),
      balanceAfterMilli: v.number(),
      serialNumbers: v.optional(v.array(v.string())),
      expiryDate: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_warehouse_product", ["warehouseId", "productId", "occurredAt"])
      .index("by_business_product", ["businessId", "productId", "occurredAt"])
      .index("by_business_operation", ["businessId", "operationType", "operationId"]),

    inventoryCostLayers: defineTable({
      businessId: v.id("businesses"),
      warehouseId: v.id("warehouses"),
      productId: v.id("products"),
      sourceType: v.string(),
      sourceId: v.string(),
      quantityMilli: v.number(),
      remainingMilli: v.number(),
      unitCost: v.number(),
      occurredAt: v.number(),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_product_warehouse", ["productId", "warehouseId", "occurredAt"])
      .index("by_business_source", ["businessId", "sourceType", "sourceId"]),

    /* ------------------------------------------------------------------ *
     * Cash movements and management income/expense records
     * These are operational management records, not a double-entry journal.
     * ------------------------------------------------------------------ */

    payments: defineTable({
      businessId: v.id("businesses"),
      branchId: v.optional(v.id("branches")),
      fiscalYearId: v.optional(v.id("fiscalYears")),
      direction: paymentDirectionValidator,
      invoiceId: v.optional(v.id("invoices")),
      partyType: v.union(
        v.literal("customer"),
        v.literal("supplier"),
        v.literal("other"),
      ),
      partyId: v.optional(v.string()),
      partyName: v.string(),
      amount: v.number(),
      method: paymentMethodValidator,
      occurredAt: v.number(),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_invoice", ["invoiceId"]),

    transactions: defineTable({
      businessId: v.id("businesses"),
      branchId: v.optional(v.id("branches")),
      fiscalYearId: v.optional(v.id("fiscalYears")),
      kind: transactionKindValidator,
      title: v.string(),
      amount: v.number(),
      category: v.optional(v.string()),
      method: v.union(
        v.literal("cash"),
        v.literal("bank"),
        v.literal("accrual"),
      ),
      occurredAt: v.number(),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"]),

    /* ------------------------------------------------------------------ *
     * Chart of accounts
     * code is unique per business across the whole tree (stricter than the
     * required per-level uniqueness, which prevents ambiguous lookups).
     * ------------------------------------------------------------------ */

    accounts: defineTable({
      businessId: v.id("businesses"),
      code: v.string(),
      name: v.string(),
      level: accountLevelValidator,
      type: accountTypeValidator,
      nature: accountNatureValidator,
      parentId: v.optional(v.id("accounts")),
      postable: v.boolean(),
      detailKind: accountDetailKindValidator,
      linkedEntityId: v.optional(v.string()),
      linkedEntityName: v.optional(v.string()),
      systemKey: v.optional(v.string()),
      description: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      archivedAt: v.optional(v.number()),
      active: v.boolean(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_type", ["businessId", "type"])
      .index("by_business_parent", ["businessId", "parentId"])
      .index("by_business_active", ["businessId", "active"])
      .index("by_business_system", ["businessId", "systemKey"]),

    accountingDocuments: defineTable({
      businessId: v.id("businesses"),
      fiscalYearId: v.id("fiscalYears"),
      branchId: v.id("branches"),
      number: v.string(),
      sequence: v.number(),
      documentDate: v.number(),
      description: v.string(),
      status: accountingDocumentStatusValidator,
      kind: accountingDocumentKindValidator,
      totalDebit: v.number(),
      totalCredit: v.number(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      submittedAt: v.optional(v.number()),
      postedAt: v.optional(v.number()),
      reversedAt: v.optional(v.number()),
      reversalOfId: v.optional(v.id("accountingDocuments")),
      correctionOfId: v.optional(v.id("accountingDocuments")),
      reversedByDocumentId: v.optional(v.id("accountingDocuments")),
      /** Phase 6 link to the confirmed operational document. */
      sourceType: v.optional(v.string()),
      sourceId: v.optional(v.string()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_number", ["businessId", "number"])
      .index("by_business_date", ["businessId", "documentDate"])
      .index("by_business_fiscal", ["businessId", "fiscalYearId"])
      .index("by_business_fiscal_date", [
        "businessId",
        "fiscalYearId",
        "documentDate",
      ])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_fiscal_status", [
        "businessId",
        "fiscalYearId",
        "status",
      ])
      .index("by_reversal_of", ["reversalOfId"])
      .index("by_business_source", ["businessId", "sourceType", "sourceId"]),

    accountingDocumentLines: defineTable({
      businessId: v.id("businesses"),
      documentId: v.id("accountingDocuments"),
      accountId: v.id("accounts"),
      description: v.string(),
      debit: v.number(),
      credit: v.number(),
      position: v.number(),
    })
      .index("by_document", ["documentId"])
      .index("by_business", ["businessId"])
      .index("by_business_account", ["businessId", "accountId"]),

    accountingAuditLogs: defineTable({
      businessId: v.id("businesses"),
      documentId: v.id("accountingDocuments"),
      actorId: v.id("users"),
      action: v.string(),
      summary: v.string(),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_document", ["documentId"]),

    /* ------------------------------------------------------------------ *
     * Phase 6 — bank accounts, cash funds and their real movement ledger
     * ------------------------------------------------------------------ */

    bankAccounts: defineTable({
      businessId: v.id("businesses"),
      branchId: v.optional(v.id("branches")),
      name: v.string(),
      bankName: v.string(),
      accountNumber: v.string(),
      iban: v.optional(v.string()),
      holderName: v.string(),
      bankBranch: v.optional(v.string()),
      notes: v.optional(v.string()),
      /** Detail GL account dedicated to this bank account. */
      accountId: v.id("accounts"),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_active", ["businessId", "active"])
      .index("by_business_account_number", ["businessId", "accountNumber"]),

    cashFunds: defineTable({
      businessId: v.id("businesses"),
      branchId: v.optional(v.id("branches")),
      name: v.string(),
      responsibleName: v.optional(v.string()),
      notes: v.optional(v.string()),
      /** Detail GL account dedicated to this cash fund. */
      accountId: v.id("accounts"),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_active", ["businessId", "active"]),

    financialTransactions: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      accountType: financialAccountTypeValidator,
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      direction: v.union(v.literal("in"), v.literal("out")),
      amount: v.number(),
      occurredAt: v.number(),
      operationType: v.string(),
      operationId: v.optional(v.string()),
      description: v.string(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_bank_occurred", ["bankAccountId", "occurredAt"])
      .index("by_cash_occurred", ["cashFundId", "occurredAt"])
      .index("by_business_operation", [
        "businessId",
        "operationType",
        "operationId",
      ]),

    cashClosings: defineTable({
      businessId: v.id("businesses"),
      cashFundId: v.id("cashFunds"),
      closeDate: v.number(),
      expectedBalance: v.number(),
      countedBalance: v.number(),
      difference: v.number(),
      note: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_fund_date", ["cashFundId", "closeDate"]),

    /* ------------------------------------------------------------------ *
     * Phase 6 — receipts, payment vouchers and transfers
     * ------------------------------------------------------------------ */

    receipts: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      number: v.string(),
      sequence: v.number(),
      status: voucherStatusValidator,
      partyType: v.union(v.literal("customer"), v.literal("other")),
      customerId: v.optional(v.id("customers")),
      partyName: v.string(),
      invoiceId: v.optional(v.id("invoices")),
      amount: v.number(),
      method: financeMethodValidator,
      destinationType: financialAccountTypeValidator,
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      trackingNumber: v.optional(v.string()),
      description: v.string(),
      attachmentStorageId: v.optional(v.id("_storage")),
      attachmentName: v.optional(v.string()),
      occurredAt: v.number(),
      checkId: v.optional(v.id("receivedChecks")),
      checkDueDate: v.optional(v.number()),
      checkBankName: v.optional(v.string()),
      checkBankBranch: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      postedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "number"]),

    paymentVouchers: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      number: v.string(),
      sequence: v.number(),
      status: voucherStatusValidator,
      partyType: v.union(v.literal("supplier"), v.literal("other")),
      partyName: v.string(),
      expenseId: v.optional(v.id("expenseRecords")),
      supplierId: v.optional(v.id("suppliers")),
      purchaseInvoiceId: v.optional(v.id("purchaseInvoices")),
      amount: v.number(),
      method: financeMethodValidator,
      sourceType: financialAccountTypeValidator,
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      trackingNumber: v.optional(v.string()),
      description: v.string(),
      attachmentStorageId: v.optional(v.id("_storage")),
      attachmentName: v.optional(v.string()),
      occurredAt: v.number(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      postedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "number"])
      .index("by_expense", ["expenseId"]),

    fundTransfers: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      number: v.string(),
      sequence: v.number(),
      fromType: financialAccountTypeValidator,
      fromBankAccountId: v.optional(v.id("bankAccounts")),
      fromCashFundId: v.optional(v.id("cashFunds")),
      toType: financialAccountTypeValidator,
      toBankAccountId: v.optional(v.id("bankAccounts")),
      toCashFundId: v.optional(v.id("cashFunds")),
      amount: v.number(),
      fee: v.number(),
      occurredAt: v.number(),
      description: v.string(),
      accountingDocumentId: v.id("accountingDocuments"),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business", ["businessId"]),

    /* ------------------------------------------------------------------ *
     * Phase 6 — received and issued cheques
     * ------------------------------------------------------------------ */

    receivedChecks: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      checkNumber: v.string(),
      amount: v.number(),
      issueDate: v.number(),
      dueDate: v.number(),
      bankName: v.string(),
      bankBranch: v.optional(v.string()),
      issuerName: v.string(),
      customerId: v.optional(v.id("customers")),
      description: v.optional(v.string()),
      status: receivedCheckStatusValidator,
      collectedBankAccountId: v.optional(v.id("bankAccounts")),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      lastAccountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_due", ["businessId", "dueDate"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "checkNumber"]),

    issuedChecks: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      bankAccountId: v.id("bankAccounts"),
      checkNumber: v.string(),
      amount: v.number(),
      payeeName: v.string(),
      issueDate: v.number(),
      dueDate: v.number(),
      status: issuedCheckStatusValidator,
      description: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      lastAccountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_due", ["businessId", "dueDate"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "checkNumber"]),

    checkStatusHistory: defineTable({
      businessId: v.id("businesses"),
      checkType: checkDirectionValidator,
      checkId: v.string(),
      fromStatus: v.optional(v.string()),
      toStatus: v.string(),
      note: v.optional(v.string()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      actorId: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_check", ["checkType", "checkId"]),

    /* ------------------------------------------------------------------ *
     * Phase 6 — income and expense records
     * ------------------------------------------------------------------ */

    incomeRecords: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      number: v.string(),
      sequence: v.number(),
      status: voucherStatusValidator,
      category: v.string(),
      customerId: v.optional(v.id("customers")),
      partyName: v.optional(v.string()),
      amount: v.number(),
      method: financeMethodValidator,
      destinationType: financialAccountTypeValidator,
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      description: v.string(),
      attachmentStorageId: v.optional(v.id("_storage")),
      attachmentName: v.optional(v.string()),
      occurredAt: v.number(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      postedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "number"]),

    expenseRecords: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      fiscalYearId: v.id("fiscalYears"),
      number: v.string(),
      sequence: v.number(),
      status: expenseStatusValidator,
      category: expenseCategoryValidator,
      supplierName: v.optional(v.string()),
      amount: v.number(),
      paidAmount: v.number(),
      dueDate: v.optional(v.number()),
      description: v.string(),
      attachmentStorageId: v.optional(v.id("_storage")),
      attachmentName: v.optional(v.string()),
      occurredAt: v.number(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      approvedAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_occurred", ["businessId", "occurredAt"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_number", ["businessId", "number"]),

    /* ------------------------------------------------------------------ *
     * Phase 8 — organisational structure, employees and employment
     * ------------------------------------------------------------------ */

    organizationalUnits: defineTable({
      businessId: v.id("businesses"),
      branchId: v.optional(v.id("branches")),
      name: v.string(),
      code: v.string(),
      parentId: v.optional(v.id("organizationalUnits")),
      managerEmployeeId: v.optional(v.id("employees")),
      description: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      archivedAt: v.optional(v.number()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_parent", ["businessId", "parentId"])
      .index("by_business_active", ["businessId", "active"]),

    jobPositions: defineTable({
      businessId: v.id("businesses"),
      name: v.string(),
      code: v.string(),
      orgUnitId: v.optional(v.id("organizationalUnits")),
      description: v.optional(v.string()),
      active: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"]),

    employees: defineTable({
      businessId: v.id("businesses"),
      /** Optional link to a signed-in user for self-service leave requests. */
      userId: v.optional(v.id("users")),
      code: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      nationalId: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      birthDate: v.optional(v.number()),
      hireDate: v.number(),
      terminationDate: v.optional(v.number()),
      jobTitle: v.string(),
      positionId: v.optional(v.id("jobPositions")),
      orgUnitId: v.optional(v.id("organizationalUnits")),
      branchId: v.id("branches"),
      employmentType: employmentTypeValidator,
      status: employeeStatusValidator,
      bankName: v.optional(v.string()),
      bankAccount: v.optional(v.string()),
      iban: v.optional(v.string()),
      insuranceNumber: v.optional(v.string()),
      address: v.optional(v.string()),
      emergencyContact: v.optional(v.string()),
      leaveEntitlementDays: v.number(),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_national", ["businessId", "nationalId"])
      .index("by_business_branch", ["businessId", "branchId"])
      .index("by_business_unit", ["businessId", "orgUnitId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_user", ["businessId", "userId"]),

    employeeJobHistory: defineTable({
      businessId: v.id("businesses"),
      employeeId: v.id("employees"),
      jobTitle: v.string(),
      orgUnitId: v.optional(v.id("organizationalUnits")),
      branchId: v.id("branches"),
      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
      note: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business", ["businessId"]),

    employeeDocuments: defineTable({
      businessId: v.id("businesses"),
      employeeId: v.id("employees"),
      title: v.string(),
      category: v.string(),
      storageId: v.id("_storage"),
      fileName: v.string(),
      mimeType: v.optional(v.string()),
      size: v.optional(v.number()),
      description: v.optional(v.string()),
      uploadedBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business", ["businessId"]),

    employmentContracts: defineTable({
      businessId: v.id("businesses"),
      employeeId: v.id("employees"),
      number: v.string(),
      type: employmentTypeValidator,
      startDate: v.number(),
      endDate: v.optional(v.number()),
      baseSalary: v.number(),
      benefits: v.number(),
      paymentTerms: v.string(),
      status: contractStatusValidator,
      previousContractId: v.optional(v.id("employmentContracts")),
      notes: v.optional(v.string()),
      endedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_end", ["businessId", "endDate"]),

    /* ------------------------------------------------------------------ *
     * Phase 8 — attendance, leave and missions
     * ------------------------------------------------------------------ */

    attendanceSettings: defineTable({
      businessId: v.id("businesses"),
      workStartMinute: v.number(),
      workEndMinute: v.number(),
      graceMinutes: v.number(),
      expectedDailyMinutes: v.number(),
      workDays: v.array(v.number()),
      updatedBy: v.id("users"),
      updatedAt: v.number(),
    }).index("by_business", ["businessId"]),

    attendanceRecords: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      employeeId: v.id("employees"),
      date: v.number(),
      checkInMinute: v.optional(v.number()),
      checkOutMinute: v.optional(v.number()),
      workMinutes: v.number(),
      expectedMinutes: v.number(),
      lateMinutes: v.number(),
      overtimeMinutes: v.number(),
      absenceMinutes: v.number(),
      status: attendanceStatusValidator,
      source: v.union(
        v.literal("manual"),
        v.literal("import"),
        v.literal("device"),
        v.literal("api"),
      ),
      note: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_date", ["businessId", "date"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_employee_date", ["employeeId", "date"]),

    leaveRequests: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      employeeId: v.id("employees"),
      type: leaveTypeValidator,
      startDate: v.number(),
      endDate: v.number(),
      days: v.number(),
      reason: v.string(),
      status: requestStatusValidator,
      decidedBy: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_employee_start", ["employeeId", "startDate"]),

    leaveRequestHistory: defineTable({
      businessId: v.id("businesses"),
      requestId: v.id("leaveRequests"),
      fromStatus: v.optional(requestStatusValidator),
      toStatus: requestStatusValidator,
      note: v.optional(v.string()),
      actorId: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_request", ["requestId"])
      .index("by_business", ["businessId"]),

    missions: defineTable({
      businessId: v.id("businesses"),
      branchId: v.id("branches"),
      employeeId: v.id("employees"),
      startDate: v.number(),
      endDate: v.number(),
      destination: v.string(),
      purpose: v.string(),
      status: requestStatusValidator,
      decidedBy: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_employee", ["businessId", "employeeId"]),

    /* ------------------------------------------------------------------ *
     * Phase 8 — employee loans, advances and payroll
     * ------------------------------------------------------------------ */

    employeeLoans: defineTable({
      businessId: v.id("businesses"),
      employeeId: v.id("employees"),
      type: v.union(v.literal("loan"), v.literal("advance")),
      amount: v.number(),
      paidAt: v.number(),
      installments: v.number(),
      installmentAmount: v.number(),
      status: v.union(
        v.literal("active"),
        v.literal("settled"),
        v.literal("cancelled"),
      ),
      sourceType: financialAccountTypeValidator,
      bankAccountId: v.optional(v.id("bankAccounts")),
      cashFundId: v.optional(v.id("cashFunds")),
      description: v.optional(v.string()),
      accountingDocumentId: v.id("accountingDocuments"),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business_status", ["businessId", "status"]),

    loanInstallments: defineTable({
      businessId: v.id("businesses"),
      loanId: v.id("employeeLoans"),
      employeeId: v.id("employees"),
      number: v.number(),
      dueDate: v.number(),
      amount: v.number(),
      status: v.union(
        v.literal("pending"),
        v.literal("deducted"),
        v.literal("paid"),
      ),
      payrollPeriodId: v.optional(v.id("payrollPeriods")),
      paidAt: v.optional(v.number()),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_loan", ["loanId"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business_status_due", ["businessId", "status", "dueDate"]),

    payrollSettings: defineTable({
      businessId: v.id("businesses"),
      year: v.number(),
      jurisdiction: v.string(),
      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
      employeeInsuranceBps: v.number(),
      employerInsuranceBps: v.number(),
      taxExemption: v.number(),
      taxBrackets: v.array(
        v.object({ upTo: v.number(), rateBps: v.number() }),
      ),
      housingAllowance: v.number(),
      foodAllowance: v.number(),
      overtimeMultiplierBps: v.number(),
      monthlyWorkDays: v.number(),
      sourceTitle: v.string(),
      sourceUrl: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_year", ["businessId", "year"])
      .index("by_business_active", ["businessId", "active"]),

    payrollPeriods: defineTable({
      businessId: v.id("businesses"),
      year: v.number(),
      month: v.number(),
      title: v.string(),
      startAt: v.number(),
      endAt: v.number(),
      settingsId: v.id("payrollSettings"),
      status: payrollPeriodStatusValidator,
      employeeCount: v.number(),
      grossTotal: v.number(),
      employeeInsuranceTotal: v.number(),
      employerInsuranceTotal: v.number(),
      taxTotal: v.number(),
      loanDeductionTotal: v.number(),
      otherDeductionTotal: v.number(),
      netTotal: v.number(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      paymentDocumentId: v.optional(v.id("accountingDocuments")),
      calculatedAt: v.optional(v.number()),
      approvedAt: v.optional(v.number()),
      approvedBy: v.optional(v.id("users")),
      paidAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_year_month", ["businessId", "year", "month"])
      .index("by_business_status", ["businessId", "status"]),

    payrollRecords: defineTable({
      businessId: v.id("businesses"),
      periodId: v.id("payrollPeriods"),
      employeeId: v.id("employees"),
      contractId: v.id("employmentContracts"),
      branchId: v.id("branches"),
      orgUnitId: v.optional(v.id("organizationalUnits")),
      baseSalary: v.number(),
      housingAllowance: v.number(),
      foodAllowance: v.number(),
      overtimeMinutes: v.number(),
      overtimePay: v.number(),
      bonus: v.number(),
      commission: v.number(),
      otherEarnings: v.number(),
      gross: v.number(),
      insuranceEmployee: v.number(),
      tax: v.number(),
      advanceDeduction: v.number(),
      loanDeduction: v.number(),
      otherDeductions: v.number(),
      net: v.number(),
      employerInsurance: v.number(),
      loanInstallmentIds: v.array(v.id("loanInstallments")),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_period", ["periodId"])
      .index("by_business_employee", ["businessId", "employeeId"])
      .index("by_business_branch", ["businessId", "branchId"]),

    payrollComponents: defineTable({
      businessId: v.id("businesses"),
      periodId: v.id("payrollPeriods"),
      recordId: v.id("payrollRecords"),
      employeeId: v.id("employees"),
      label: v.string(),
      kind: payrollComponentKindValidator,
      amount: v.number(),
      taxable: v.boolean(),
      insurable: v.boolean(),
      position: v.number(),
    })
      .index("by_record", ["recordId"])
      .index("by_period", ["periodId"])
      .index("by_business", ["businessId"]),

    /* ------------------------------------------------------------------ *
     * Phase 8 — tax configuration, periods and reviewed records
     * ------------------------------------------------------------------ */

    taxSettings: defineTable({
      businessId: v.id("businesses"),
      name: v.string(),
      taxType: taxTypeValidator,
      jurisdiction: v.string(),
      rateBps: v.number(),
      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
      sourceTitle: v.string(),
      sourceUrl: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_type", ["businessId", "taxType"]),

    taxPeriods: defineTable({
      businessId: v.id("businesses"),
      fiscalYearId: v.id("fiscalYears"),
      title: v.string(),
      startAt: v.number(),
      endAt: v.number(),
      dueDate: v.number(),
      status: taxPeriodStatusValidator,
      filedAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_business_due", ["businessId", "dueDate"]),

    taxRecords: defineTable({
      businessId: v.id("businesses"),
      periodId: v.id("taxPeriods"),
      taxType: taxTypeValidator,
      taxableBase: v.number(),
      taxAmount: v.number(),
      description: v.string(),
      sourceReference: v.optional(v.string()),
      attachmentStorageId: v.optional(v.id("_storage")),
      attachmentName: v.optional(v.string()),
      reviewed: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_period", ["businessId", "periodId"])
      .index("by_business_type", ["businessId", "taxType"]),

    /* ------------------------------------------------------------------ *
     * Phase 8 — fixed assets and depreciation
     * ------------------------------------------------------------------ */

    fixedAssets: defineTable({
      businessId: v.id("businesses"),
      code: v.string(),
      name: v.string(),
      group: v.string(),
      branchId: v.id("branches"),
      location: v.string(),
      custodian: v.optional(v.string()),
      purchaseDate: v.number(),
      cost: v.number(),
      usefulLifeMonths: v.number(),
      salvageValue: v.number(),
      method: depreciationMethodValidator,
      decliningRateBps: v.optional(v.number()),
      customMonthlyAmount: v.optional(v.number()),
      status: assetStatusValidator,
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      disposedAt: v.optional(v.number()),
    })
      .index("by_business", ["businessId"])
      .index("by_business_code", ["businessId", "code"])
      .index("by_business_branch", ["businessId", "branchId"])
      .index("by_business_status", ["businessId", "status"]),

    assetDepreciations: defineTable({
      businessId: v.id("businesses"),
      assetId: v.id("fixedAssets"),
      branchId: v.id("branches"),
      periodKey: v.string(),
      periodStart: v.number(),
      periodEnd: v.number(),
      amount: v.number(),
      accumulatedAfter: v.number(),
      bookValueAfter: v.number(),
      status: v.literal("posted"),
      accountingDocumentId: v.id("accountingDocuments"),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_asset", ["businessId", "assetId"])
      .index("by_asset_period", ["assetId", "periodKey"])
      .index("by_business_period", ["businessId", "periodKey"]),

    assetMovements: defineTable({
      businessId: v.id("businesses"),
      assetId: v.id("fixedAssets"),
      type: assetMovementTypeValidator,
      occurredAt: v.number(),
      fromBranchId: v.optional(v.id("branches")),
      toBranchId: v.optional(v.id("branches")),
      amount: v.number(),
      description: v.string(),
      accountingDocumentId: v.optional(v.id("accountingDocuments")),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_asset", ["businessId", "assetId"])
      .index("by_business_occurred", ["businessId", "occurredAt"]),

    notificationReads: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      key: v.string(),
      readAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_user", ["businessId", "userId"])
      .index("by_business_user_key", ["businessId", "userId", "key"]),

    /* ------------------------------------------------------------------ *
     * Phase 9 — report center, saved reports, audit and AI assistant
     * ------------------------------------------------------------------ */

    savedReports: defineTable({
      businessId: v.id("businesses"),
      createdBy: v.id("users"),
      title: v.string(),
      description: v.optional(v.string()),
      reportKey: v.string(),
      module: v.string(),
      /** Validated JSON: fields, filters, sort, grouping and totals. */
      config: v.string(),
      pinned: v.boolean(),
      lastRunAt: v.optional(v.number()),
      runCount: v.number(),
      archivedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_user", ["businessId", "createdBy"])
      .index("by_business_user_created", ["businessId", "createdBy", "createdAt"]),

    reportHistory: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      reportKey: v.string(),
      title: v.string(),
      category: v.string(),
      from: v.optional(v.number()),
      to: v.optional(v.number()),
      branchId: v.optional(v.id("branches")),
      fiscalYearId: v.optional(v.id("fiscalYears")),
      filters: v.optional(v.string()),
      rowCount: v.number(),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_user_created", ["businessId", "userId", "createdAt"])
      .index("by_business_created", ["businessId", "createdAt"]),

    reportExportLogs: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      reportKey: v.string(),
      title: v.string(),
      format: v.union(v.literal("xlsx"), v.literal("pdf"), v.literal("print")),
      rowCount: v.number(),
      filters: v.optional(v.string()),
      status: v.union(v.literal("success"), v.literal("failed")),
      error: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_user_created", ["businessId", "userId", "createdAt"])
      .index("by_business_created", ["businessId", "createdAt"]),

    aiConversations: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      title: v.string(),
      lastMessageAt: v.number(),
      messageCount: v.number(),
      archivedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business_user_updated", ["businessId", "userId", "updatedAt"])
      .index("by_business", ["businessId"]),

    aiMessages: defineTable({
      businessId: v.id("businesses"),
      conversationId: v.id("aiConversations"),
      userId: v.id("users"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      citations: v.array(
        v.object({
          label: v.string(),
          reportKey: v.optional(v.string()),
          detail: v.optional(v.string()),
        }),
      ),
      provider: v.optional(v.string()),
      model: v.optional(v.string()),
      totalTokens: v.optional(v.number()),
      error: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_conversation_created", ["conversationId", "createdAt"]),

    financialAlerts: defineTable({
      businessId: v.id("businesses"),
      userId: v.id("users"),
      alertKey: v.string(),
      severity: v.union(
        v.literal("info"),
        v.literal("warning"),
        v.literal("critical"),
      ),
      category: v.string(),
      title: v.string(),
      reason: v.string(),
      evidence: v.string(),
      from: v.number(),
      to: v.number(),
      branchId: v.optional(v.id("branches")),
      dismissedAt: v.number(),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_user", ["businessId", "userId"])
      .index("by_business_user_key", ["businessId", "userId", "alertKey"]),

    /* ------------------------------------------------------------------ *
     * Phase 10 — security, settings, monitoring, health and backups
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Phase 11 — subscription plans, invoices, payment attempts and events
     * Plan prices are integer Toman amounts. They are seeded once and may be
     * edited only by a platform administrator; no price is hardcoded in UI.
     * ------------------------------------------------------------------ */

    plans: defineTable({
      code: v.string(),
      name: v.string(),
      description: v.string(),
      durationMonths: v.number(),
      priceToman: v.number(),
      active: v.boolean(),
      sortOrder: v.number(),
      features: v.array(v.string()),
      limits: planLimitsValidator,
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_code", ["code"])
      .index("by_active", ["active"]),

    subscriptions: defineTable({
      businessId: v.id("businesses"),
      planId: v.id("plans"),
      planCode: v.string(),
      planName: v.string(),
      durationMonths: v.number(),
      priceToman: v.number(),
      status: subscriptionStatusValidator,
      paymentStatus: subscriptionPaymentStatusValidator,
      startAt: v.optional(v.number()),
      endAt: v.optional(v.number()),
      renewalAt: v.optional(v.number()),
      lastPaymentAt: v.optional(v.number()),
      lastInvoiceId: v.optional(v.id("subscriptionInvoices")),
      cancelledAt: v.optional(v.number()),
      cancelReason: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_status", ["businessId", "status"])
      .index("by_status_end", ["status", "endAt"])
      .index("by_end", ["endAt"]),

    subscriptionInvoices: defineTable({
      businessId: v.id("businesses"),
      subscriptionId: v.id("subscriptions"),
      planId: v.id("plans"),
      number: v.string(),
      amountToman: v.number(),
      currency: v.string(),
      status: subscriptionInvoiceStatusValidator,
      kind: v.union(v.literal("new"), v.literal("renewal")),
      periodStart: v.number(),
      periodEnd: v.number(),
      issuedAt: v.number(),
      dueAt: v.number(),
      paidAt: v.optional(v.number()),
      gateway: v.optional(v.string()),
      gatewayRef: v.optional(v.string()),
      description: v.string(),
      createdBy: v.id("users"),
      paidBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_business_issued", ["businessId", "issuedAt"])
      .index("by_subscription", ["subscriptionId"])
      .index("by_status_issued", ["status", "issuedAt"])
      .index("by_number", ["number"]),

    subscriptionPayments: defineTable({
      businessId: v.id("businesses"),
      subscriptionId: v.id("subscriptions"),
      invoiceId: v.id("subscriptionInvoices"),
      amountToman: v.number(),
      status: subscriptionPaymentAttemptStatusValidator,
      provider: v.string(),
      providerRef: v.optional(v.string()),
      authority: v.optional(v.string()),
      signatureVerified: v.boolean(),
      idempotencyKey: v.string(),
      failureReason: v.optional(v.string()),
      initiatedBy: v.id("users"),
      createdAt: v.number(),
      verifiedAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
    })
      .index("by_invoice", ["invoiceId"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_provider_ref", ["providerRef"])
      .index("by_authority", ["authority"]),

    subscriptionEvents: defineTable({
      businessId: v.id("businesses"),
      subscriptionId: v.id("subscriptions"),
      type: subscriptionEventTypeValidator,
      fromStatus: v.optional(subscriptionStatusValidator),
      toStatus: v.optional(subscriptionStatusValidator),
      amountToman: v.optional(v.number()),
      actorId: v.optional(v.id("users")),
      reason: v.optional(v.string()),
      invoiceId: v.optional(v.id("subscriptionInvoices")),
      createdAt: v.number(),
    })
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_subscription_created", ["subscriptionId", "createdAt"]),

    billingSettings: defineTable({
      key: v.string(),
      testMode: v.boolean(),
      provider: v.union(
        v.literal("test"),
        v.literal("zarinpal"),
        v.literal("none"),
      ),
      gatewayLabel: v.string(),
      graceDays: v.number(),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    legalPages: defineTable({
      slug: v.string(),
      title: v.string(),
      content: v.string(),
      version: v.number(),
      active: v.boolean(),
      updatedBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_active", ["active"]),

    platformAuditLogs: defineTable({
      adminId: v.id("users"),
      action: v.string(),
      targetType: v.string(),
      targetId: v.string(),
      targetBusinessId: v.optional(v.id("businesses")),
      summary: v.string(),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_target_business", ["targetBusinessId", "createdAt"]),

    businessSettings: defineTable({
      businessId: v.id("businesses"),
      displayName: v.optional(v.string()),
      legalName: v.optional(v.string()),
      logoStorageId: v.optional(v.id("_storage")),
      calendar: v.union(v.literal("jalali"), v.literal("gregorian")),
      timezone: v.string(),
      invoiceFooter: v.optional(v.string()),
      printOrientation: v.union(v.literal("portrait"), v.literal("landscape")),
      notificationsEnabled: v.boolean(),
      lowStockAlerts: v.boolean(),
      backupEnabled: v.boolean(),
      backupFrequency: v.union(
        v.literal("daily"),
        v.literal("weekly"),
        v.literal("monthly"),
      ),
      backupHourUtc: v.number(),
      backupRetentionDays: v.number(),
      updatedBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_business", ["businessId"]),

    backupJobs: defineTable({
      businessId: v.id("businesses"),
      createdBy: v.id("users"),
      trigger: v.union(
        v.literal("manual"),
        v.literal("scheduled"),
        v.literal("pre_restore"),
      ),
      status: v.union(
        v.literal("running"),
        v.literal("success"),
        v.literal("failed"),
      ),
      storageId: v.optional(v.id("_storage")),
      filename: v.string(),
      sizeBytes: v.optional(v.number()),
      checksum: v.optional(v.string()),
      rowCount: v.number(),
      tableCounts: v.optional(v.string()),
      error: v.optional(v.string()),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
      prunedAt: v.optional(v.number()),
      restoredAt: v.optional(v.number()),
      restoredBusinessId: v.optional(v.id("businesses")),
    })
      .index("by_business", ["businessId"])
      .index("by_business_created", ["businessId", "startedAt"])
      .index("by_business_status", ["businessId", "status"]),

    securityEvents: defineTable({
      businessId: v.optional(v.id("businesses")),
      userId: v.optional(v.id("users")),
      action: v.string(),
      result: v.union(v.literal("success"), v.literal("failure")),
      detail: v.optional(v.string()),
      userAgent: v.optional(v.string()),
      errorId: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_created", ["createdAt"]),

    systemErrors: defineTable({
      businessId: v.optional(v.id("businesses")),
      userId: v.optional(v.id("users")),
      source: v.union(v.literal("client"), v.literal("server")),
      errorId: v.string(),
      fingerprint: v.string(),
      message: v.string(),
      route: v.optional(v.string()),
      digest: v.optional(v.string()),
      resolvedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_business_created", ["businessId", "createdAt"])
      .index("by_created", ["createdAt"])
      .index("by_fingerprint", ["fingerprint"]),

    healthChecks: defineTable({
      businessId: v.id("businesses"),
      checkedBy: v.id("users"),
      status: v.union(
        v.literal("healthy"),
        v.literal("degraded"),
        v.literal("unhealthy"),
      ),
      checks: v.string(),
      latencyMs: v.number(),
      version: v.string(),
      createdAt: v.number(),
    }).index("by_business_created", ["businessId", "createdAt"]),

    fileUploads: defineTable({
      businessId: v.id("businesses"),
      storageId: v.id("_storage"),
      name: v.string(),
      mimeType: v.optional(v.string()),
      size: v.optional(v.number()),
      uploadedBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_storage", ["storageId"])
      .index("by_business_storage", ["businessId", "storageId"]),

    rateLimits: defineTable({
      key: v.string(),
      action: v.string(),
      userId: v.id("users"),
      businessId: v.optional(v.id("businesses")),
      windowStart: v.number(),
      count: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    /* ------------------------------------------------------------------ *
     * Infrastructure
     * ------------------------------------------------------------------ */

    counters: defineTable({
      businessId: v.id("businesses"),
      key: v.string(), // "invoice" | "customer"
      value: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_key", ["businessId", "key"]),

    auditLogs: defineTable({
      businessId: v.id("businesses"),
      actorId: v.id("users"),
      action: v.string(), // customer.create, invoice.issue, account.create, ...
      entity: v.string(),
      entityId: v.string(),
      summary: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_business", ["businessId"])
      .index("by_business_created", ["businessId", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
