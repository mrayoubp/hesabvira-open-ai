import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { BILLING_SETTINGS_KEY, DEFAULT_BILLING } from "./lib/billing";
import type { Infer } from "convex/values";
import type { planLimitsValidator } from "./schema";

type PlanLimits = Infer<typeof planLimitsValidator>;

const FULL_MODULES = [
  "accounting",
  "finance",
  "commerce",
  "hr",
  "reports",
  "ai",
];

const PLAN_SEEDS: Array<{
  code: string;
  name: string;
  description: string;
  durationMonths: number;
  priceToman: number;
  sortOrder: number;
  features: string[];
  limits: PlanLimits;
}> = [
  {
    code: "quarterly",
    name: "اشتراک سه‌ماهه",
    description:
      "دسترسی کامل به هسته حسابداری، مالی، فروش، خرید، انبار و گزارش‌های مدیریتی برای یک دوره سه‌ماهه.",
    durationMonths: 3,
    priceToman: 8_000_000,
    sortOrder: 1,
    features: [
      "دسترسی به تمام ماژول‌های حساب ویرا",
      "گزارش‌های مدیریتی و ویرا AI",
      "پشتیبان‌گیری و خروجی اطلاعات",
      "تمدید اشتراک پس از پایان اعتبار",
      "پشتیبانی از طریق تیکت و ایمیل",
    ],
    limits: {
      maxUsers: 5,
      maxBranches: 2,
      maxWarehouses: 3,
      maxStorageMb: 512,
      allowedModules: FULL_MODULES,
      advancedFeatures: ["ai", "backup", "audit"],
    },
  },
  {
    code: "annual",
    name: "اشتراک یک‌ساله",
    description:
      "همان دسترسی کامل، با ظرفیت بیشتر برای تیم‌ها و کسب‌وکارهای در حال رشد در یک دوره دوازده‌ماهه.",
    durationMonths: 12,
    priceToman: 18_500_000,
    sortOrder: 2,
    features: [
      "دسترسی به تمام ماژول‌های حساب ویرا",
      "ظرفیت بیشتر کاربران، شعب و انبارها",
      "گزارش‌های مدیریتی و ویرا AI",
      "پشتیبان‌گیری و خروجی اطلاعات",
      "تمدید اشتراک پس از پایان اعتبار",
    ],
    limits: {
      maxUsers: 15,
      maxBranches: 5,
      maxWarehouses: 10,
      maxStorageMb: 2048,
      allowedModules: FULL_MODULES,
      advancedFeatures: ["ai", "backup", "audit", "priority_support"],
    },
  },
];

const LEGAL_SEEDS = [
  {
    slug: "terms",
    title: "قوانین و شرایط استفاده",
    content: `حساب ویرا یک سامانه ابری مدیریت مالی و حسابداری برای کسب‌وکارهاست. با ساخت حساب کاربری، تایید می‌کنید که اطلاعات هویتی و کسب‌وکار واردشده صحیح است و اجازه دارید از طرف آن کسب‌وکار در حساب ویرا فعالیت کنید.

هر فضای کاری مستقل است. مسئولیت حفظ دسترسی اعضای تیم، صحت اسناد ثبت‌شده و رعایت قوانین مالیاتی و تجاری بر عهده صاحب کسب‌وکار است. حساب ویرا داده‌ها را به‌عنوان امانت نگه‌داری می‌کند و بدون مجوز قانونی یا دستور مقام صالح، آن‌ها را در اختیار شخص ثالث قرار نمی‌دهد.

استفاده از سامانه برای فعالیت غیرقانونی، نقض حقوق دیگران یا تلاش برای دسترسی به داده کسب‌وکار دیگر ممنوع است و می‌تواند به تعلیق حساب منجر شود. شرایط استفاده ممکن است با اعلام قبلی به‌روزرسانی شود؛ نسخه معتبر همان نسخه منتشرشده در همین صفحه است.`,
  },
  {
    slug: "privacy",
    title: "سیاست حفظ حریم خصوصی",
    content: `اطلاعات کسب‌وکار، اسناد مالی، فاکتورها، اطلاعات پرسنل و گزارش‌های هر مشتری فقط در فضای کاری همان مشتری ذخیره و پردازش می‌شود. دسترسی به این اطلاعات در هر درخواست سمت سرور و بر اساس عضویت و نقش کاربر بررسی می‌شود.

اطلاعات پرداخت و کلیدهای درگاه در سمت سرور نگه‌داری می‌شوند و در بسته‌ی برنامه به مرورگر ارسال نمی‌شوند. برای احراز هویت از کد یک‌بارمصرف ایمیلی استفاده می‌شود و رمز عبور خام ذخیره نمی‌شود.

داده‌های عملیاتی برای ارائه سرویس، پشتیبان‌گیری، رفع خطا و الزامات قانونی استفاده می‌شوند. مشتری می‌تواند درخواست خروجی یا حذف حساب را از طریق پشتیبانی ثبت کند؛ حذف داده‌های مالی قطعی تنها پس از بررسی تعهدات قانونی و با ثبت رویداد انجام می‌شود.`,
  },
  {
    slug: "renewal",
    title: "شرایط تمدید و لغو اشتراک",
    content: `اشتراک سه‌ماهه سه ماه و اشتراک یک‌ساله دوازده ماه از تاریخ تایید پرداخت اعتبار دارد. پس از پایان اعتبار، حساب به وضعیت «منقضی‌شده» می‌رود و امکان مشاهده، دریافت خروجی و پشتیبان‌گیری همچنان باقی می‌ماند؛ اما ثبت سند و اطلاعات جدید تا تمدید محدود می‌شود.

تمدید می‌تواند پیش از پایان دوره یا در مهلت تمدید انجام شود. با تایید پرداخت، دوره جدید از تاریخ پایان دوره قبلی (در صورت فعال بودن) یا از زمان پرداخت (در صورت منقضی بودن) آغاز می‌شود. فاکتور هر تمدید در بخش «اشتراک من» ثبت می‌شود.

لغو اشتراک به معنای توقف تمدید است و داده مالی مشتری را حذف نمی‌کند. درخواست لغو از طریق پشتیبانی یا گزینه لغو در صفحه اشتراک ثبت می‌شود. تعلیق اداری حساب فقط با ثبت دلیل و قابل پیگیری انجام می‌شود.`,
  },
  {
    slug: "refund",
    title: "شرایط بازپرداخت وجه",
    content: `پرداخت هر فاکتور فقط پس از تایید سمت سرور پذیرفته می‌شود. اگر پرداخت از درگاه کسر شود اما اشتراک فعال نشود، ابتدا وضعیت پرداخت از طریق پشتیبانی یا بررسی خودکار درگاه پیگیری می‌شود و مبلغ تکراری به حساب پرداخت‌کننده بازمی‌گردد.

درخواست بازپرداخت دوره استفاده‌نشده باید حداکثر ۷ روز پس از پرداخت و پیش از استفاده عملیاتی از فضای کاری ثبت شود. پس از استفاده از سرویس یا پایان مهلت، بازپرداخت تابع بررسی پشتیبانی و شرایط درگاه پرداخت خواهد بود. هر بازپرداخت با شناسه فاکتور، شناسه پرداخت و دلیل در سوابق مالی ثبت می‌شود.

تا زمان اتصال درگاه واقعی، پرداخت‌های این محیط آزمایشی هستند و هیچ وجه واقعی دریافت یا بازپرداخت نمی‌شود.`,
  },
  {
    slug: "support",
    title: "راه‌های ارتباط با پشتیبانی",
    content: `برای سؤال درباره تعرفه، پرداخت، تمدید یا مشکلات فنی از این کانال‌ها استفاده کنید:

ایمیل: hello@hesabvira.ir
پشتیبانی داخل برنامه: بخش «اشتراک من» → لینک «پشتیبانی»
ساعات پاسخ‌گویی: روزهای کاری، حداکثر یک روز کاری

برای پیگیری سریع‌تر، نام کسب‌وکار، شماره فاکتور اشتراک و توضیح کوتاه مشکل را ارسال کنید. هرگز اطلاعات کارت بانکی، رمز یک‌بارمصرف یا کلیدهای API را برای پشتیبانی ارسال نکنید.`,
  },
];

export async function seedDefaultsData(ctx: MutationCtx) {
  const now = Date.now();
  let createdPlans = 0;
  for (const seed of PLAN_SEEDS) {
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_code", (q) => q.eq("code", seed.code))
      .unique();
    if (existing) continue;
    await ctx.db.insert("plans", {
      ...seed,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    createdPlans += 1;
  }

  let createdLegal = 0;
  for (const seed of LEGAL_SEEDS) {
    const existing = await ctx.db
      .query("legalPages")
      .withIndex("by_slug", (q) => q.eq("slug", seed.slug))
      .unique();
    if (existing) {
      // One-time correction for the initial support copy. Do not overwrite
      // admin-edited legal content on later seed runs.
      if (
        seed.slug === "support" &&
        existing.content.includes("سپس ثبت درخواست")
      ) {
        await ctx.db.patch(existing._id, {
          content: seed.content,
          version: existing.version + 1,
          updatedAt: now,
        });
      }
      continue;
    }
    await ctx.db.insert("legalPages", {
      ...seed,
      version: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    createdLegal += 1;
  }

  let createdBilling = false;
  const billing = await ctx.db
    .query("billingSettings")
    .withIndex("by_key", (q) => q.eq("key", BILLING_SETTINGS_KEY))
    .unique();
  if (!billing) {
    await ctx.db.insert("billingSettings", {
      key: BILLING_SETTINGS_KEY,
      ...DEFAULT_BILLING,
      updatedAt: now,
    });
    createdBilling = true;
  }

  return { createdPlans, createdLegal, createdBilling };
}

/** Internal bootstrap invoked from the admin panel or a Convex CLI run. */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => seedDefaultsData(ctx),
});
