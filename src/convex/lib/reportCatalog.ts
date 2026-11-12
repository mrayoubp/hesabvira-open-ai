/**
 * Phase 9 — shared report catalog.
 *
 * This file is intentionally data-only. The server resolves the report, checks
 * permissions and builds every row from the business's own records. The client
 * uses the same catalog for the report center so a card can never silently
 * point at a different server report.
 */

export const REPORT_CATEGORIES = [
  { key: "accounting", label: "حسابداری", description: "ترازنامه، سود و زیان، جریان نقد و دفاتر" },
  { key: "financial", label: "تحلیل مالی", description: "سودآوری، نقدینگی و مقایسه دوره‌ها" },
  { key: "sales", label: "فروش", description: "فروش، سود و عملکرد محصول و مشتری" },
  { key: "purchases", label: "خرید", description: "خرید، قیمت تمام‌شده و بدهی تأمین‌کنندگان" },
  { key: "inventory", label: "انبار", description: "ارزش، گردش، موجودی کم و کالای راکد" },
  { key: "customers", label: "مشتریان", description: "مطالبات، رفتار خرید و سالخوردگی بدهی" },
  { key: "suppliers", label: "تأمین‌کنندگان", description: "بدهی، سررسید و مقایسه خرید" },
  { key: "banking", label: "بانک", description: "گردش و مانده حساب‌های بانکی" },
  { key: "cash", label: "صندوق", description: "گردش، مانده و تنخواه صندوق‌ها" },
  { key: "payroll", label: "حقوق و دستمزد", description: "هزینه حقوق، بیمه و مالیات حقوق" },
  { key: "tax", label: "مالیات", description: "فروش، خرید، حقوق و بدهی مالیاتی" },
  { key: "assets", label: "دارایی ثابت", description: "ارزش دفتری، استهلاک و حرکات دارایی" },
  { key: "branches", label: "شعب", description: "مقایسه فروش، هزینه، سود و مانده شعب" },
  { key: "management", label: "مدیریتی", description: "شاخص‌ها، هشدارهای تحلیلی و نمای مدیران" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["key"];
export type ReportPermission =
  | "general"
  | "financial"
  | "payroll"
  | "tax"
  | "assets"
  | "sensitive";

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  category: ReportCategory;
  permission: ReportPermission;
  mode: "run" | "link";
  path?: string;
  badge?: string;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  // Accounting
  { key: "balance-sheet", title: "ترازنامه", description: "دارایی، بدهی و سرمایه بر پایه اسناد قطعی تا تاریخ گزارش", category: "accounting", permission: "financial", mode: "run" },
  { key: "income-statement", title: "صورت سود و زیان", description: "درآمد، بهای تمام‌شده، هزینه عملیاتی و سود خالص", category: "accounting", permission: "financial", mode: "run" },
  { key: "cash-flow-statement", title: "صورت جریان وجوه نقد", description: "ورود و خروج واقعی نقد و بانک به تفکیک عملیات", category: "accounting", permission: "financial", mode: "run" },
  { key: "trial-balance", title: "تراز آزمایشی", description: "گردش و مانده حساب‌ها با کنترل توازن", category: "accounting", permission: "financial", mode: "run" },
  { key: "journal", title: "دفتر روزنامه", description: "تمام ردیف‌های اسناد قطعی با لینک سند اصلی", category: "accounting", permission: "financial", mode: "run" },
  { key: "ledger", title: "دفتر کل", description: "گردش و مانده هر حساب کل با جزئیات", category: "accounting", permission: "financial", mode: "link", path: "/dashboard/accounting/ledger" },
  { key: "subsidiary", title: "دفتر معین", description: "ریز حساب‌های معین و تفصیلی", category: "accounting", permission: "financial", mode: "link", path: "/dashboard/accounting/subsidiary" },
  { key: "account-balances", title: "مانده حساب‌ها", description: "مانده بدهکار و بستانکار حساب‌های دفتر کل", category: "accounting", permission: "financial", mode: "run" },
  { key: "documents-posted", title: "اسناد قطعی", description: "فهرست اسناد تأییدشده و قابل استناد", category: "accounting", permission: "financial", mode: "run" },
  { key: "documents-draft", title: "اسناد پیش‌نویس و در انتظار", description: "اسنادی که هنوز قطعی نشده‌اند", category: "accounting", permission: "financial", mode: "run" },
  { key: "documents-correction", title: "اسناد اصلاحی و معکوس", description: "اصلاحات و ابطال‌های حسابداری با حفظ تاریخچه", category: "accounting", permission: "financial", mode: "run" },
  { key: "documents-opening-closing", title: "اسناد افتتاحیه و اختتامیه", description: "اسناد انتقال مانده و بستن دوره مالی", category: "accounting", permission: "financial", mode: "run" },
  { key: "document-register", title: "دفتر ثبت اسناد", description: "همه اسناد با وضعیت، منبع و شماره", category: "accounting", permission: "financial", mode: "run" },

  // Financial analysis
  { key: "profit-analysis", title: "تحلیل سود و زیان", description: "روند ماهانه، مقایسه با دوره قبل و حاشیه سود", category: "financial", permission: "financial", mode: "run" },
  { key: "cash-flow-forecast", title: "تحلیل و پیش‌بینی نقدینگی", description: "مانده نقد، ورود و خروج و سررسیدهای ثبت‌شده", category: "financial", permission: "financial", mode: "run" },
  { key: "financial-alerts", title: "هشدارهای تحلیلی", description: "تغییرات غیرعادی با شواهد و پیشنهاد بررسی", category: "management", permission: "financial", mode: "run" },
  { key: "management-kpi", title: "شاخص‌های مدیریتی", description: "فروش، سود، نقدینگی، مطالبات و بدهی در یک نگاه", category: "management", permission: "financial", mode: "run" },

  // Sales
  { key: "sales-by-customer", title: "فروش به تفکیک مشتری", description: "فروش، دریافت و مانده هر مشتری", category: "sales", permission: "general", mode: "run" },
  { key: "sales-by-product", title: "فروش به تفکیک کالا", description: "مقدار، فروش، بهای تمام‌شده و سود هر کالا", category: "sales", permission: "general", mode: "run" },
  { key: "sales-by-category", title: "فروش به تفکیک دسته‌بندی", description: "عملکرد دسته‌های کالا بر پایه ردیف فاکتورها", category: "sales", permission: "general", mode: "run" },
  { key: "sales-by-branch", title: "فروش به تفکیک شعبه", description: "مقایسه فروش و سود شعبه‌ها", category: "sales", permission: "general", mode: "run" },
  { key: "sales-by-user", title: "فروش به تفکیک کاربر", description: "فروش ثبت‌شده توسط هر کاربر", category: "sales", permission: "general", mode: "run" },
  { key: "sales-top-products", title: "کالاهای پرفروش", description: "بیشترین فروش و مقدار فروش‌رفته", category: "sales", permission: "general", mode: "run" },
  { key: "sales-slow-products", title: "کالاهای کم‌فروش", description: "کالاهای با کمترین گردش فروش", category: "sales", permission: "general", mode: "run" },
  { key: "invoice-average", title: "میانگین مبلغ فاکتور", description: "تعداد و میانگین فاکتورهای قطعی در بازه", category: "sales", permission: "general", mode: "run" },
  { key: "sales-margin", title: "حاشیه سود فروش", description: "فروش، برگشت، بهای تمام‌شده و حاشیه سود", category: "sales", permission: "financial", mode: "run" },

  // Purchases
  { key: "purchase-by-supplier", title: "خرید براساس تأمین‌کننده", description: "خرید، پرداخت و مانده هر تأمین‌کننده", category: "purchases", permission: "general", mode: "run" },
  { key: "purchase-by-product", title: "خرید براساس کالا", description: "مقدار و مبلغ خرید کالاها", category: "purchases", permission: "general", mode: "run" },
  { key: "purchase-price-comparison", title: "مقایسه قیمت خرید", description: "آخرین بهای واحد هر کالا در فاکتورهای خرید", category: "purchases", permission: "financial", mode: "run" },
  { key: "purchase-trend", title: "روند هزینه خرید", description: "روند ماهانه خرید و برگشت خرید", category: "purchases", permission: "general", mode: "run" },
  { key: "purchase-frequent", title: "کالاهای پرتکرار در خرید", description: "کالاهایی که بیشترین تکرار خرید دارند", category: "purchases", permission: "general", mode: "run" },

  // Inventory
  { key: "inventory-value", title: "ارزش موجودی", description: "ارزش واقعی موجودی بر پایه گردش انبار", category: "inventory", permission: "financial", mode: "run" },
  { key: "inventory-by-warehouse", title: "موجودی هر انبار", description: "تعداد و ارزش موجودی به تفکیک انبار", category: "inventory", permission: "general", mode: "run" },
  { key: "inventory-cardex", title: "کاردکس کالا", description: "گردش ورود، خروج و مانده هر کالا", category: "inventory", permission: "general", mode: "link", path: "/dashboard/commerce/reports" },
  { key: "inventory-low", title: "کالاهای کم‌موجودی", description: "کالاهای زیر حداقل موجودی", category: "inventory", permission: "general", mode: "run" },
  { key: "inventory-dead", title: "کالاهای بدون گردش", description: "موجودی‌های بدون خروج در ۹۰ روز اخیر", category: "inventory", permission: "general", mode: "run" },
  { key: "inventory-expiry", title: "کالاهای دارای تاریخ انقضا", description: "اقلام نزدیک انقضا و منقضی‌شده", category: "inventory", permission: "general", mode: "run" },
  { key: "inventory-profitability", title: "سودآوری کالا", description: "فروش، بهای تمام‌شده و سود هر کالا", category: "inventory", permission: "financial", mode: "run" },
  { key: "inventory-turnover", title: "گردش موجودی", description: "نسبت بهای فروش‌رفته به میانگین موجودی", category: "inventory", permission: "financial", mode: "run" },
  { key: "inventory-count-differences", title: "اختلاف انبارگردانی", description: "اسناد شمارش و اصلاح موجودی ثبت‌شده", category: "inventory", permission: "general", mode: "run" },

  // Customers
  { key: "customer-top", title: "مشتریان برتر", description: "بیشترین فروش و سود مشتریان", category: "customers", permission: "general", mode: "run" },
  { key: "customer-debt", title: "مشتریان بدهکار", description: "مانده مطالبات بر پایه فاکتورهای قطعی", category: "customers", permission: "sensitive", mode: "run" },
  { key: "customer-aging", title: "سالخوردگی مطالبات", description: "تقسیم مانده مطالبات بر اساس سررسید", category: "customers", permission: "sensitive", mode: "run" },
  { key: "customer-ledger", title: "گردش حساب مشتری", description: "فاکتور، دریافت و مانده هر مشتری", category: "customers", permission: "sensitive", mode: "run" },
  { key: "customer-trend", title: "روند خرید مشتریان", description: "فروش ماهانه به تفکیک مشتری", category: "customers", permission: "sensitive", mode: "run" },

  // Suppliers
  { key: "supplier-top", title: "تأمین‌کنندگان اصلی", description: "بیشترین خرید و تعداد فاکتور", category: "suppliers", permission: "general", mode: "run" },
  { key: "supplier-debt", title: "بدهی تأمین‌کنندگان", description: "مانده پرداخت‌نشده فاکتورهای خرید", category: "suppliers", permission: "sensitive", mode: "run" },
  { key: "supplier-due", title: "سررسید پرداخت تأمین‌کنندگان", description: "بدهی‌های سررسیدشده و نزدیک سررسید", category: "suppliers", permission: "sensitive", mode: "run" },
  { key: "supplier-ledger", title: "گردش حساب تأمین‌کننده", description: "خرید، پرداخت و مانده هر تأمین‌کننده", category: "suppliers", permission: "sensitive", mode: "run" },
  { key: "supplier-compare", title: "مقایسه خرید تأمین‌کنندگان", description: "سهم خرید، برگشت و خالص خرید", category: "suppliers", permission: "general", mode: "run" },

  // Bank and cash
  { key: "bank-summary", title: "گردش و مانده بانک", description: "مانده محاسبه‌شده و جریان هر حساب بانکی", category: "banking", permission: "financial", mode: "run" },
  { key: "cash-summary", title: "گردش و مانده صندوق", description: "مانده محاسبه‌شده و جریان صندوق‌ها", category: "cash", permission: "financial", mode: "run" },

  // Payroll, tax, assets, branches
  { key: "payroll-summary", title: "هزینه حقوق و دستمزد", description: "دوره‌های تأییدشده، بیمه، مالیات و خالص", category: "payroll", permission: "payroll", mode: "run" },
  { key: "tax-summary", title: "خلاصه مالیات", description: "مالیات فروش، خرید، حقوق و بدهی دوره‌ها", category: "tax", permission: "tax", mode: "run" },
  { key: "asset-summary", title: "ارزش دفتری دارایی‌ها", description: "بهای تمام‌شده، استهلاک و ارزش دفتری", category: "assets", permission: "assets", mode: "run" },
  { key: "branch-comparison", title: "مقایسه عملکرد شعب", description: "فروش، خرید، هزینه، سود، مطالبات و بدهی", category: "branches", permission: "sensitive", mode: "run" },
  { key: "branch-profit", title: "سود و زیان شعب", description: "درآمد و هزینه ثبت‌شده هر شعبه", category: "branches", permission: "sensitive", mode: "run" },
];

export const REPORT_BY_KEY = new Map(
  REPORT_CATALOG.map((report) => [report.key, report]),
);

export const RUN_REPORT_KEYS = new Set(
  REPORT_CATALOG.filter((report) => report.mode === "run").map(
    (report) => report.key,
  ),
);

export function reportDefinition(key: string) {
  return REPORT_BY_KEY.get(key) ?? null;
}

export function reportCategoryLabel(key: string) {
  return (
    REPORT_CATEGORIES.find((category) => category.key === key)?.label ?? key
  );
}
