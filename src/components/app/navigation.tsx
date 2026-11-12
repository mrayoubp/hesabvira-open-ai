import type { ComponentType } from "react";
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  Calculator,
  CreditCard,
  FileText,
  HandCoins,
  Landmark,
  Layers3,
  LayoutDashboard,
  ListTree,
  Network,
  Package,
  ReceiptText,
  Scale,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  soon?: boolean;
  /** owner/admin only */
  manageOnly?: boolean;
  /** show the live unread/attention count */
  count?: "notifications";
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "پیشخوان",
    items: [
      {
        label: "داشبورد",
        to: "/dashboard",
        icon: LayoutDashboard,
        end: true,
        count: "notifications",
      },
      {
        label: "مرکز گزارشات",
        to: "/dashboard/reports",
        icon: BarChart3,
      },
      {
        label: "ویرا AI",
        to: "/dashboard/ai",
        icon: Sparkles,
      },
      {
        label: "اشتراک من",
        to: "/dashboard/subscription",
        icon: CreditCard,
      },
    ],
  },
  {
    id: "sales",
    label: "فروش و دریافت",
    items: [
      {
        label: "فروش و فاکتورها",
        to: "/dashboard/commerce/sales",
        icon: ReceiptText,
      },
      {
        label: "مشتریان",
        to: "/dashboard/commerce/customers",
        icon: Users,
      },
      {
        label: "دریافت و پرداخت",
        to: "/dashboard/finance/receipts",
        icon: HandCoins,
      },
      {
        label: "درآمد و هزینه",
        to: "/dashboard/finance/income-expenses",
        icon: Scale,
      },
    ],
  },
  {
    id: "purchasing",
    label: "خرید و کالا",
    items: [
      {
        label: "خرید و فاکتورها",
        to: "/dashboard/commerce/purchases",
        icon: ShoppingCart,
      },
      {
        label: "تأمین‌کنندگان",
        to: "/dashboard/commerce/suppliers",
        icon: Truck,
      },
      {
        label: "کالاها و خدمات",
        to: "/dashboard/commerce/products",
        icon: Package,
      },
      {
        label: "انبارداری",
        to: "/dashboard/commerce/inventory",
        icon: Warehouse,
      },
      {
        label: "گزارش‌های فروش، خرید و انبار",
        to: "/dashboard/commerce/reports",
        icon: BarChart3,
      },
    ],
  },
  {
    id: "accounting",
    label: "حسابداری",
    items: [
      {
        label: "نمای کلی حسابداری",
        to: "/dashboard/accounting",
        icon: Calculator,
        end: true,
      },
      {
        label: "اسناد حسابداری",
        to: "/dashboard/accounting/documents",
        icon: FileText,
      },
      {
        label: "کدینگ حساب‌ها",
        to: "/dashboard/accounting/accounts",
        icon: ListTree,
      },
      {
        label: "دفتر روزنامه",
        to: "/dashboard/accounting/journal",
        icon: BookOpen,
      },
      {
        label: "دفتر کل",
        to: "/dashboard/accounting/ledger",
        icon: Scale,
      },
      {
        label: "دفتر معین",
        to: "/dashboard/accounting/subsidiary",
        icon: Layers3,
      },
      {
        label: "تراز آزمایشی",
        to: "/dashboard/accounting/trial-balance",
        icon: BarChart3,
      },
      {
        label: "گزارش‌ساز سفارشی",
        to: "/dashboard/reports/custom",
        icon: BarChart3,
      },
    ],
  },
  {
    id: "treasury",
    label: "مالی و خزانه",
    items: [
      {
        label: "داشبورد مالی",
        to: "/dashboard/finance",
        icon: Wallet,
        end: true,
      },
      {
        label: "بانک و صندوق",
        to: "/dashboard/finance/accounts",
        icon: Landmark,
      },
      {
        label: "دریافت وجه",
        to: "/dashboard/finance/receipts",
        icon: HandCoins,
      },
      {
        label: "پرداخت وجه",
        to: "/dashboard/finance/payments",
        icon: Banknote,
      },
      {
        label: "انتقال وجه",
        to: "/dashboard/finance/transfers",
        icon: ArrowLeftRight,
      },
      {
        label: "چک‌های دریافتی و پرداختی",
        to: "/dashboard/finance/checks",
        icon: ReceiptText,
      },
      {
        label: "درآمد و هزینه",
        to: "/dashboard/finance/income-expenses",
        icon: Scale,
      },
      {
        label: "مطالبات و بدهی‌ها",
        to: "/dashboard/finance/receivables",
        icon: Users,
      },
      {
        label: "گزارش‌های مالی",
        to: "/dashboard/finance/reports",
        icon: BarChart3,
      },
    ],
  },
  {
    id: "hr",
    label: "سازمان و منابع انسانی",
    items: [
      {
        label: "پرسنل و قراردادها",
        to: "/dashboard/hr/employees",
        icon: Users,
      },
      {
        label: "حضور، مرخصی و مأموریت",
        to: "/dashboard/hr/attendance",
        icon: CalendarCheck2,
      },
      {
        label: "حقوق و دستمزد",
        to: "/dashboard/hr/payroll",
        icon: Banknote,
      },
      {
        label: "مالیات",
        to: "/dashboard/hr/tax",
        icon: ReceiptText,
      },
      {
        label: "دارایی ثابت",
        to: "/dashboard/hr/assets",
        icon: Landmark,
      },
      {
        label: "شعب و ساختار سازمانی",
        to: "/dashboard/hr/organization",
        icon: Network,
      },
      {
        label: "گزارش‌های سازمانی",
        to: "/dashboard/hr/reports",
        icon: BarChart3,
      },
    ],
  },
  {
    id: "management",
    label: "مدیریت",
    items: [
      {
        label: "کاربران",
        to: "/dashboard/soon/users",
        icon: UserCog,
        soon: true,
        manageOnly: true,
      },
      {
        label: "وضعیت سیستم",
        to: "/dashboard/system",
        icon: Activity,
        manageOnly: true,
      },
      {
        label: "تنظیمات و بکاپ",
        to: "/dashboard/system?tab=settings",
        icon: Settings,
        manageOnly: true,
      },
    ],
  },
];

export const COMING_SOON_INFO: Record<
  string,
  { title: string; description: string; bullets: string[] }
> = {
  accounting: {
    title: "نمای کلی حسابداری",
    description:
      "دفتر کل، معین و تفصیلی؛ این بخش به موتور حسابداری دوبل متصل خواهد شد.",
    bullets: ["کدینگ استاندارد حساب‌ها", "تراز آزمایشی", "گزارش سود و زیان رسمی"],
  },
  journal: {
    title: "اسناد حسابداری",
    description:
      "ثبت سند دوطرفه با کنترل توازن، مراحل پیش‌نویس و قطعی و ردپای کامل تغییرات.",
    bullets: ["سند متوازن", "آرتیکل‌های بدهکار و بستانکار", "ابطال با حفظ اثر حسابرسی"],
  },
  "chart-of-accounts": {
    title: "کدینگ حساب‌ها",
    description:
      "درخت حساب‌های استاندارد با امکان تعریف حساب‌های تفصیلی متناسب با کسب‌وکار.",
    bullets: ["حساب‌های کل و معین", "تفصیلی مشتری و تأمین‌کننده", "کنترل حساب‌های سیستمی"],
  },
  purchases: {
    title: "فاکتور خرید",
    description:
      "ثبت خرید از تأمین‌کننده، محاسبه مالیات و اتصال آن به موجودی و بدهی‌ها.",
    bullets: ["فاکتور خرید", "برگشت از خرید", "بدهی تأمین‌کننده"],
  },
  suppliers: {
    title: "تأمین‌کنندگان",
    description:
      "پرونده تأمین‌کننده، مانده حساب و تاریخچه خرید و پرداخت در یک‌جا.",
    bullets: ["کد اختصاصی", "مانده بدهی", "گزارش صورت حساب"],
  },
  products: {
    title: "کالاها و خدمات",
    description:
      "کاتالوگ کالا و خدمت با قیمت فروش، واحد شمارش و دسته‌بندی قابل جستجو.",
    bullets: ["کد و بارکد", "قیمت خرید و فروش", "تفکیک کالا و خدمت"],
  },
  inventory: {
    title: "انبارداری",
    description:
      "ورود و خروج کالا، کاردکس و هشدار موجودی کم بر پایه اسناد واقعی.",
    bullets: ["کاردکس", "انتقال بین شعبه‌ها", "هشدار موجودی"],
  },
  treasury: {
    title: "بانک و صندوق",
    description:
      "تعریف حساب بانکی و صندوق، تطبیق تراکنش‌ها و مدیریت چک‌ها.",
    bullets: ["مغایرت‌گیری بانکی", "مدیریت چک", "انتقال بین حساب‌ها"],
  },
  payroll: {
    title: "حقوق و دستمزد",
    description:
      "پرونده پرسنل، لیست حقوق، کسورات و ثبت سند حقوق در یک چرخه.",
    bullets: ["لیست حقوق ماهانه", "بیمه و مالیات", "سند خودکار"],
  },
  "fixed-assets": {
    title: "دارایی‌های ثابت",
    description:
      "ثبت دارایی، محاسبه استهلاک و خروج دارایی با آثار مالی دقیق.",
    bullets: ["استهلاک دوره‌ای", "تاریخ بهره‌برداری", "فروش یا کنارگذاری"],
  },
  reports: {
    title: "گزارشات مالی",
    description:
      "ترازنامه، سود و زیان، جریان نقد و گزارش‌های تحلیلی قابل فیلتر.",
    bullets: ["گزارش دوره‌ای", "خروجی قابل چاپ", "مقایسه دوره‌ها"],
  },
  users: {
    title: "کاربران و نقش‌ها",
    description:
      "دعوت همکار، تعریف نقش و محدودکردن دسترسی به اطلاعات مالی.",
    bullets: ["نقش‌های سازمانی", "دسترسی شعبه", "گزارش فعالیت"],
  },
  settings: {
    title: "تنظیمات کسب‌وکار",
    description:
      "ویرایش اطلاعات کسب‌وکار، شعبه‌ها، دوره مالی و سلیقه نمایش.",
    bullets: ["اطلاعات کسب‌وکار", "شعبه و دوره مالی", "مالیات پیش‌فرض"],
  },
};

export const QUICK_ACTIONS = [
  {
    label: "فاکتور فروش",
    to: "/dashboard/invoices/new",
    icon: ReceiptText,
    soon: false,
    write: true,
  },
  {
    label: "افزودن مشتری",
    to: "/dashboard/customers?new=1",
    icon: Users,
    soon: false,
    write: true,
  },
  {
    label: "ثبت دریافت",
    to: "/dashboard/finance/receipts",
    icon: HandCoins,
    soon: false,
    write: true,
  },
  {
    label: "ثبت هزینه",
    to: "/dashboard/finance/income-expenses?tab=expenses",
    icon: Scale,
    soon: false,
    write: true,
  },
  {
    label: "ثبت درآمد",
    to: "/dashboard/finance/income-expenses?tab=income",
    icon: Banknote,
    soon: false,
    write: true,
  },
  {
    label: "فاکتور خرید",
    to: "/dashboard/commerce/purchases",
    icon: ShoppingCart,
    soon: false,
    write: true,
  },
  {
    label: "سند حسابداری",
    to: "/dashboard/accounting/documents/new",
    icon: BookOpen,
    soon: false,
    write: true,
  },
  {
    label: "ثبت پرداخت",
    to: "/dashboard/finance/payments",
    icon: HandCoins,
    soon: false,
    write: true,
  },
  {
    label: "انتقال وجه",
    to: "/dashboard/finance/transfers",
    icon: ArrowLeftRight,
    soon: false,
    write: true,
  },
  {
    label: "افزودن تأمین‌کننده",
    to: "/dashboard/commerce/suppliers?new=1",
    icon: Truck,
    soon: false,
    write: true,
  },
  {
    label: "افزودن کالا",
    to: "/dashboard/commerce/products?new=1",
    icon: Package,
    soon: false,
    write: true,
  },
];

export const COMING_SOON_PAYMENTS = {
  title: "پرداخت به تأمین‌کننده",
  description:
    "پرداخت‌ها پس از فعال‌سازی پرونده تأمین‌کننده در همین بخش ثبت می‌شوند.",
  bullets: ["پرداخت نقدی و بانکی", "اتصال به فاکتور خرید", "مانده تأمین‌کننده"],
};

export const ROADMAP_ICON = Sparkles;
