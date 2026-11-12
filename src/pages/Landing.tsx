import { Brand } from "@/components/app/Brand";
import { HeroScene } from "@/components/landing/HeroScene";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatNumber } from "@/lib/format";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  Landmark,
  Layers3,
  Mail,
  Menu,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Warehouse,
  X,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const navLinks = [
  { href: "#features", label: "امکانات" },
  { href: "#modules", label: "ماژول‌ها" },
  { href: "#reports", label: "گزارش و AI" },
  { href: "#pricing", label: "تعرفه‌ها" },
  { href: "#faq", label: "سؤالات" },
];

const modules = [
  {
    icon: BookOpen,
    title: "حسابداری دوبل",
    text: "کدینگ چندسطحی، سند متوازن، دفتر روزنامه، دفتر کل و معین، تراز آزمایشی و بستن دوره.",
    tone: "brand",
  },
  {
    icon: Wallet,
    title: "مالی و خزانه",
    text: "بانک و صندوق، دریافت، پرداخت، انتقال، چک، درآمد و هزینه و مغایرت‌گیری.",
    tone: "gold",
  },
  {
    icon: ReceiptText,
    title: "فروش و فاکتور",
    text: "فاکتور فروش، برگشت، تسویه، شماره یکتا و محاسبه دوباره جمع‌ها در سرور.",
    tone: "brand",
  },
  {
    icon: Boxes,
    title: "خرید و تأمین",
    text: "فاکتور خرید، تأمین‌کننده، پرداخت مستقل و پیگیری مانده حساب.",
    tone: "mist",
  },
  {
    icon: Warehouse,
    title: "انبار و موجودی",
    text: "کاردکس، انتقال بین انبارها، شمارش، اصلاح موجودی و لایه‌های بهای تمام‌شده.",
    tone: "gold",
  },
  {
    icon: Users,
    title: "مشتریان و اعضا",
    text: "پرونده مشتری، مانده بدهی، نقش‌های دسترسی و جداسازی فضای هر کسب‌وکار.",
    tone: "mist",
  },
  {
    icon: Landmark,
    title: "حقوق، مالیات و دارایی",
    text: "پرسنل، قرارداد، حضور، حقوق و دستمزد، مالیات و استهلاک دارایی ثابت.",
    tone: "brand",
  },
  {
    icon: Layers3,
    title: "چند شعبه و انبار",
    text: "شعبه اصلی، ساختار سازمانی و اسناد محدودشده به شعبه و سال مالی.",
    tone: "gold",
  },
];

const benefits = [
  {
    icon: ShieldCheck,
    title: "جداسازی سرور به سرور",
    text: "هر درخواست، عضویت و نقش شما را در همان کسب‌وکار دوباره بررسی می‌کند؛ نه با پنهان‌کردن دکمه.",
  },
  {
    icon: BadgeCheck,
    title: "اسناد بدون حذف پنهان",
    text: "سند قطعی و فاکتور صادرشده با ابطال اصلاح می‌شوند و ردپای مالی حفظ می‌شود.",
  },
  {
    icon: BarChart3,
    title: "گزارش از داده واقعی",
    text: "داشبورد، تراز، سود و زیان و گردش حساب فقط از اسناد ثبت‌شده شما ساخته می‌شوند.",
  },
  {
    icon: CalendarDays,
    title: "فارسی، راست‌چین، شمسی",
    text: "رابط کامل فارسی، تاریخ شمسی، مبالغ تومانی و تجربه خوانا روی موبایل و دسکتاپ.",
  },
];

const faqs = [
  {
    q: "اشتراک حساب ویرا چگونه کار می‌کند؟",
    a: "پس از ثبت اطلاعات کسب‌وکار و تأیید ایمیل، یکی از دو پلن سه‌ماهه یا یک‌ساله را انتخاب می‌کنید. فضای کاری شما ساخته می‌شود و پس از تأیید پرداخت، امکان ثبت اطلاعات جدید فعال می‌شود. همه قیمت‌ها و مدت‌ها از تنظیمات رسمی دیتابیس خوانده می‌شوند.",
  },
  {
    q: "اگر اعتبار اشتراک تمام شود، داده‌های من چه می‌شود؟",
    a: "داده مالی شما حذف نمی‌شود. مشاهده اطلاعات قبلی، گزارش‌ها و دریافت خروجی و پشتیبان تا حد امکان حفظ می‌شود؛ اما ثبت سند و اطلاعات جدید تا تمدید محدود می‌شود. این محدودیت در تمام درخواست‌های نوشتن سمت سرور اعمال می‌شود.",
  },
  {
    q: "پرداخت آنلاین واقعی فعال است؟",
    a: "در این نسخه ساختار اتصال، فاکتور، تأیید سمت سرور، جلوگیری از تکرار و Webhook آماده شده است؛ اما تا ارائه اطلاعات درگاه معتبر و آزمایش واقعی، پرداخت واقعی فعال اعلام نمی‌شود. محیط فعلی برای تست، پرداخت آزمایشی را با برچسب واضح ثبت می‌کند.",
  },
  {
    q: "آیا اطلاعات من با مشتریان دیگر مشترک است؟",
    a: "نه. هر کسب‌وکار فضای داده مستقل دارد و در هر Query و Mutation، عضویت در همان کسب‌وکار روی سرور بررسی می‌شود. تلاش برای دسترسی به فایل، سند یا گزارش کسب‌وکار دیگر رد می‌شود.",
  },
  {
    q: "امکان دریافت خروجی و پشتیبان وجود دارد؟",
    a: "بله. گزارش‌ها خروجی Excel دارند، اسناد و فاکتورها قابل چاپ هستند و مدیر کسب‌وکار می‌تواند از بخش وضعیت سیستم، پشتیبان JSON تهیه کند. محدودیت حجم و رکورد پشتیبان در صفحه پشتیبان شفاف اعلام می‌شود.",
  },
  {
    q: "ویرا AI چه کاری انجام می‌دهد؟",
    a: "ویرا AI به داده واقعی همان کسب‌وکار و با همان مجوز دسترسی پاسخ می‌دهد؛ سؤال‌های مدیریتی را به گزارش‌های موجود وصل می‌کند و منابع پاسخ را نشان می‌دهد. کلیدهای سرویس خارجی فقط در سمت سرور نگه‌داری می‌شوند.",
  },
  {
    q: "چگونه با پشتیبانی تماس بگیرم؟",
    a: "از ایمیل hello@hesabvira.ir یا صفحه «راه‌های ارتباط با پشتیبانی» استفاده کنید. برای پیگیری سریع‌تر نام کسب‌وکار، شماره فاکتور و توضیح کوتاه مشکل را بفرستید. هرگز رمز یک‌بارمصرف یا اطلاعات کارت بانکی را ارسال نکنید.",
  },
];

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold-soft/60 px-3 py-1 text-[11px] font-semibold text-[#7c6126]">
      <Sparkles className="size-3.5 text-gold" aria-hidden />
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  align?: "center" | "start";
}) {
  return (
    <Reveal
      className={
        align === "center"
          ? "mx-auto max-w-2xl text-center"
          : "max-w-2xl text-start"
      }
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-[26px] font-extrabold leading-[1.4] text-ink sm:text-[34px]">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-sm leading-7 text-ink-soft sm:text-[15px]">
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 bg-gradient-to-b from-[#f7f6f0] via-[#f7f6f0]/90 to-transparent px-3 pb-1 pt-3 sm:px-5">
      <div className="mx-auto max-w-6xl rounded-2xl border border-white/75 bg-white/75 px-3 py-2.5 shadow-[0_18px_40px_-32px_rgba(22,58,46,0.55)] backdrop-blur-xl sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <Brand subtitle="HESAB VIRA" />
          <nav
            aria-label="ناوبری صفحه اصلی"
            className="hidden items-center gap-0.5 lg:flex"
          >
            {navLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-cream/60 hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <Link
              to="/auth?returnTo=/dashboard"
              className="hidden rounded-xl px-3 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream/60 sm:inline-flex"
            >
              ورود
            </Link>
            <Button
              asChild
              className="h-9 rounded-xl px-4 shadow-[0_10px_22px_-12px_rgba(36,92,73,0.8)]"
            >
              <Link to="/signup">
                شروع اشتراک
                <ArrowLeft className="size-3.5" />
              </Link>
            </Button>
            <button
              type="button"
              aria-label={open ? "بستن منو" : "باز کردن منو"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="flex size-9 items-center justify-center rounded-xl border border-hairline/70 bg-white/80 text-ink lg:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: EASE }}
              className="overflow-hidden lg:hidden"
            >
              <nav
                aria-label="ناوبری موبایل"
                className="mt-2 grid gap-1 border-t border-hairline/60 pt-2"
              >
                {navLinks.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-cream/60 hover:text-ink"
                  >
                    {item.label}
                  </a>
                ))}
                <Link
                  to="/auth?returnTo=/dashboard"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-brand hover:bg-brand-soft/60"
                >
                  ورود به فضای کاری
                </Link>
              </nav>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" />
      <div className="noise pointer-events-none absolute inset-0 -z-10 opacity-[0.035]" />
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-12 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:gap-6 lg:px-8 lg:pb-16 lg:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative z-10"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/15 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-brand shadow-sm backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/40" />
              <span className="relative inline-flex size-2 rounded-full bg-brand" />
            </span>
            نسخه اشتراکی حساب ویرا
          </div>
          <h1 className="mt-5 text-[36px] font-black leading-[1.3] text-ink sm:text-[48px] lg:text-[54px]">
            دفتر مالی کسب‌وکارت را
            <br />
            <span className="text-gradient-brand">یک‌بار برای همیشه</span> منظم کن.
          </h1>
          <p className="mt-5 max-w-[560px] text-sm leading-8 text-ink-soft sm:text-base sm:leading-9">
            از فاکتور و مشتری تا حسابداری دوبل، خزانه، انبار، حقوق و گزارش‌های
            مدیریتی؛ همه در یک فضای کاری اختصاصی، فارسی و امن. اشتراک را انتخاب
            کن و با داده واقعی خودت شروع کن.
          </p>
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 gap-2 rounded-2xl px-6 text-sm shadow-[0_18px_35px_-18px_rgba(36,92,73,0.9)]"
            >
              <Link to="/signup">
                انتخاب پلن و ساخت فضای کاری
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 gap-2 rounded-2xl border-white/80 bg-white/60 px-5 text-sm shadow-sm backdrop-blur hover:bg-white"
            >
              <a href="#pricing">
                <CreditCard className="size-4 text-gold" />
                دیدن تعرفه‌ها
              </a>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-ink-soft">
            {[
              "بدون رمز عبور، با تأیید ایمیل",
              "داده اختصاصی هر کسب‌وکار",
              "فارسی و راست‌چین",
            ].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-brand-soft">
                  <Check className="size-2.5 text-brand" aria-hidden />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.1, ease: EASE }}
          className="relative"
        >
          <HeroScene />
        </motion.div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="glass grid grid-cols-2 overflow-hidden rounded-[26px] shadow-[0_20px_50px_-35px_rgba(22,58,46,0.6)] lg:grid-cols-4">
            {[
              ["۸ ماژول", "یک هسته مالی یکپارچه"],
              ["۲ پلن رسمی", "سه‌ماهه و یک‌ساله"],
              ["RTL", "فارسی و تاریخ شمسی"],
              ["سرور", "کنترل مجوز در هر درخواست"],
            ].map(([value, hint]) => (
              <div
                key={value}
                className="relative border-white/50 px-5 py-5 text-center [&:nth-child(odd)]:border-e [&:nth-child(-n+2)]:border-b sm:px-6 lg:[&:nth-child(-n+2)]:border-b-0 lg:[&:not(:last-child)]:border-e"
              >
                <p className="text-[22px] font-black leading-none text-ink sm:text-[26px]">
                  {value}
                </p>
                <p className="mt-2 text-[10px] text-ink-soft">{hint}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      id="features"
      className="mx-auto max-w-6xl scroll-mt-28 px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      <SectionHeading
        eyebrow="یک فضای کاری، تصویر کامل"
        title="از اولین فاکتور تا ترازنامه، کنار هم"
        description="حساب ویرا فقط یک دفتر فروش نیست؛ هسته حسابداری، خزانه، انبار و گزارش‌ها روی یک مدل داده منسجم ساخته شده‌اند."
      />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map((item, index) => (
          <Reveal key={item.title} delay={Math.min(index * 0.05, 0.2)}>
            <div className="group h-full rounded-[26px] border border-white/80 bg-white/75 p-5 shadow-[0_18px_45px_-38px_rgba(22,58,46,0.55)] backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:bg-white">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <item.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-sm font-extrabold text-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-xs leading-6 text-ink-soft">{item.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Modules() {
  const tones: Record<string, string> = {
    brand: "bg-brand-soft text-brand",
    gold: "bg-gold-soft text-[#836728]",
    mist: "bg-mist text-[#2d6470]",
  };
  return (
    <section
      id="modules"
      className="relative overflow-hidden border-y border-white/60 bg-white/45"
    >
      <div className="mx-auto max-w-6xl scroll-mt-28 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="ماژول‌های حساب ویرا"
          title="حسابداری، مالی، فروش، خرید و انبار"
          description="هر ماژول با همان کنترل دسترسی و منطق مالی مشترک کار می‌کند. هر چیزی که ثبت می‌کنید، در گزارش‌های بعدی قابل پیگیری است."
        />
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((module, index) => (
            <Reveal key={module.title} delay={Math.min(index * 0.04, 0.24)}>
              <div className="group h-full rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_14px_40px_-32px_rgba(22,58,46,0.55)] backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-brand/15 hover:bg-white">
                <span
                  className={`flex size-10 items-center justify-center rounded-2xl ${tones[module.tone]}`}
                >
                  <module.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-extrabold text-ink">
                  {module.title}
                </h3>
                <p className="mt-1.5 text-xs leading-6 text-ink-soft">
                  {module.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReportsSection() {
  return (
    <section
      id="reports"
      className="mx-auto max-w-6xl scroll-mt-28 px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      <div className="grid items-center gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12">
        <div>
          <SectionHeading
            eyebrow="گزارش مدیریتی و ویرا AI"
            title={
              <>
                اعداد را بپرس،
                <br />
                <span className="text-gradient-brand">منبعش را ببین.</span>
              </>
            }
            description="گزارش‌های فروش، سود و زیان، تراز، گردش حساب و مرکز گزارش‌ها از اسناد واقعی ساخته می‌شوند. ویرا AI هم فقط به همان داده مجاز پاسخ می‌دهد."
            align="start"
          />
          <div className="mt-6 space-y-2.5">
            {[
              "داشبورد مالی و روند فروش از فاکتورهای ثبت‌شده",
              "تراز آزمایشی، سود و زیان و گردش حساب",
              "گزارش‌ساز سفارشی با محدوده شعبه و سال مالی",
              "ویرا AI با ارجاع به گزارش و شاهد داده",
              "خروجی Excel و چاپ رسمی اسناد",
            ].map((item) => (
              <div
                key={item}
                className="flex items-start gap-2.5 rounded-2xl border border-white/80 bg-white/65 px-3.5 py-2.5 text-[12px] leading-6 text-ink-soft shadow-sm backdrop-blur"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-cream">
                  <Check className="size-2.5" />
                </span>
                {item}
              </div>
            ))}
          </div>
          <Button asChild className="mt-6 gap-2 rounded-xl">
            <Link to="/signup?plan=annual">
              شروع اشتراک یک‌ساله
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        </div>

        <Reveal>
          <div className="relative overflow-hidden rounded-[34px] bg-gradient-to-br from-[#1d4d3c] via-brand to-[#10291f] p-6 text-cream shadow-[0_40px_90px_-50px_rgba(16,41,31,0.9)] sm:p-8">
            <div className="terminal-grid pointer-events-none absolute inset-0 opacity-20" />
            <div className="pointer-events-none absolute -left-16 -top-20 size-64 rounded-full bg-gold/15 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/10 px-2.5 py-1 text-[9px] text-cream/70">
                  <Sparkles className="size-3 text-gold" />
                  نمای نمونه از فضای کاری
                </span>
                <span className="font-mono text-[8px] tracking-[0.16em] text-cream/35">
                  VIRA / EVIDENCE
                </span>
              </div>
              <div className="mt-5 rounded-3xl border border-cream/10 bg-cream/[0.06] p-4 backdrop-blur">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                    <Sparkles className="size-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold text-cream">
                      ویرا AI
                    </p>
                    <p className="mt-0.5 text-[9px] text-cream/45">
                      پاسخ با داده همین کسب‌وکار
                    </p>
                  </div>
                </div>
                <p className="mt-4 rounded-2xl bg-cream/[0.06] px-3 py-2.5 text-[11px] leading-6 text-cream/80">
                  «وضعیت سود و زیان و بیشترین مطالبات این دوره چطور است؟»
                </p>
                <div className="mt-3 space-y-2 text-[10px] leading-6 text-cream/60">
                  <p className="flex items-start gap-2">
                    <Check className="mt-1 size-3 shrink-0 text-gold" />
                    پاسخ بر اساس اسناد قطعی و فاکتورهای همین دوره ساخته می‌شود.
                  </p>
                  <p className="flex items-start gap-2">
                    <FileText className="mt-1 size-3 shrink-0 text-gold" />
                    منبع: گزارش سود و زیان، مرکز مطالبات و گردش حساب.
                  </p>
                  <p className="flex items-start gap-2">
                    <ShieldCheck className="mt-1 size-3 shrink-0 text-gold" />
                    فقط اعضای همین فضای کاری به این گفتگو دسترسی دارند.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.05] p-3">
                  <p className="text-[9px] text-cream/45">منبع گزارش</p>
                  <p className="mt-1 text-[11px] font-semibold">
                    اسناد واقعی شما
                  </p>
                </div>
                <div className="rounded-2xl border border-cream/10 bg-cream/[0.05] p-3">
                  <p className="text-[9px] text-cream/45">خروجی</p>
                  <p className="mt-1 text-[11px] font-semibold">
                    Excel و چاپ
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = useQuery(api.subscription.plans);
  return (
    <section
      id="pricing"
      className="relative scroll-mt-28 overflow-hidden border-y border-white/60 bg-white/45"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="تعرفه‌های رسمی"
          title="دو پلن، قیمت شفاف، بدون پلن پنهان"
          description="قیمت و مدت هر پلن از دیتابیس تعرفه‌ها خوانده می‌شود و فقط مدیر سامانه می‌تواند آن را تغییر دهد. مبلغ نهایی همیشه به تومان نمایش داده می‌شود."
        />
        <div className="mt-12 grid items-stretch gap-4 md:grid-cols-2">
          {plans === undefined ? (
            <div className="col-span-full flex min-h-56 items-center justify-center gap-2 rounded-[30px] border border-white/80 bg-white/60 text-xs text-ink-soft">
              <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              در حال خواندن تعرفه‌ها…
            </div>
          ) : plans.length === 0 ? (
            <div className="col-span-full rounded-[30px] border border-gold/30 bg-gold-soft/35 p-8 text-center text-[12px] leading-7 text-[#6f551d]">
              تعرفه‌های رسمی هنوز در دیتابیس تنظیم نشده‌اند. لطفاً با پشتیبانی
              تماس بگیرید؛ هیچ قیمتی خارج از دیتابیس نمایش داده نمی‌شود.
            </div>
          ) : (
            plans.map((plan, index) => {
              const featured = index === 1;
              return (
                <Reveal key={plan._id} delay={index * 0.08}>
                  <div
                    className={`relative flex h-full flex-col rounded-[32px] p-6 sm:p-8 ${
                      featured
                        ? "bg-gradient-to-br from-[#2b6b54] via-brand to-[#12352a] text-cream shadow-[0_35px_80px_-45px_rgba(22,58,46,0.8)]"
                        : "border border-white/85 bg-white/85 text-ink shadow-[0_25px_65px_-50px_rgba(22,58,46,0.6)] backdrop-blur"
                    }`}
                  >
                    {featured ? (
                      <span className="absolute -top-3 right-6 rounded-full bg-gold px-3 py-1 text-[10px] font-bold text-[#32260c] shadow-md">
                        پیشنهاد برای تیم‌های در حال رشد
                      </span>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3
                          className={`text-xl font-extrabold ${
                            featured ? "text-cream" : "text-ink"
                          }`}
                        >
                          {plan.name}
                        </h3>
                        <p
                          className={`mt-1 text-[11px] ${
                            featured ? "text-cream/55" : "text-ink-soft"
                          }`}
                        >
                          {formatNumber(plan.durationMonths)} ماه دسترسی
                        </p>
                      </div>
                      <span
                        className={`flex size-10 items-center justify-center rounded-2xl ${
                          featured
                            ? "bg-cream/10 text-gold ring-1 ring-cream/10"
                            : "bg-brand-soft text-brand"
                        }`}
                      >
                        <CreditCard className="size-4" />
                      </span>
                    </div>
                    <div className="mt-6 flex items-end gap-2">
                      <span
                        className={`num text-[38px] font-black leading-none sm:text-[44px] ${
                          featured ? "text-cream" : "text-ink"
                        }`}
                      >
                        {formatNumber(plan.priceToman)}
                      </span>
                      <span
                        className={`mb-1.5 text-xs ${
                          featured ? "text-cream/55" : "text-ink-soft"
                        }`}
                      >
                        تومان
                      </span>
                    </div>
                    <p
                      className={`mt-2 text-[11px] leading-6 ${
                        featured ? "text-cream/55" : "text-ink-soft"
                      }`}
                    >
                      {plan.description}
                    </p>
                    <div
                      className={`my-5 h-px ${
                        featured ? "bg-cream/10" : "bg-hairline/70"
                      }`}
                    />
                    <ul className="flex-1 space-y-2.5">
                      {plan.features.map((feature) => (
                        <li
                          key={feature}
                          className={`flex items-start gap-2 text-xs leading-6 ${
                            featured ? "text-cream/75" : "text-ink-soft"
                          }`}
                        >
                          <span
                            className={`mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full ${
                              featured
                                ? "bg-gold/20 text-gold"
                                : "bg-brand-soft text-brand"
                            }`}
                          >
                            <Check className="size-2.5" />
                          </span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <div
                      className={`mt-5 rounded-2xl border px-3 py-2.5 text-[10px] leading-5 ${
                        featured
                          ? "border-cream/10 bg-cream/[0.06] text-cream/60"
                          : "border-hairline/70 bg-background/50 text-ink-soft"
                      }`}
                    >
                      <p className="flex items-center justify-between gap-2">
                        <span>کاربر مجاز</span>
                        <span className="num font-semibold">
                          {formatNumber(plan.limits.maxUsers)}
                        </span>
                      </p>
                      <p className="mt-1 flex items-center justify-between gap-2">
                        <span>شعبه / انبار</span>
                        <span className="num font-semibold">
                          {formatNumber(plan.limits.maxBranches)} /{" "}
                          {formatNumber(plan.limits.maxWarehouses)}
                        </span>
                      </p>
                      <p className="mt-1 flex items-center justify-between gap-2">
                        <span>فضای فایل</span>
                        <span className="num font-semibold">
                          {formatNumber(plan.limits.maxStorageMb)} مگابایت
                        </span>
                      </p>
                    </div>
                    <Button
                      asChild
                      className={`mt-6 h-11 w-full rounded-xl text-[12px] font-bold ${
                        featured
                          ? "border border-cream/20 bg-cream text-brand-deep hover:bg-cream/90"
                          : "shadow-[0_16px_30px_-18px_rgba(36,92,73,0.8)]"
                      }`}
                      variant={featured ? "secondary" : "default"}
                    >
                      <Link to={`/signup?plan=${plan.code}`}>
                        انتخاب {plan.name}
                        <ArrowLeft className="size-4" />
                      </Link>
                    </Button>
                    <p
                      className={`mt-3 text-center text-[9px] leading-5 ${
                        featured ? "text-cream/35" : "text-ink-soft/80"
                      }`}
                    >
                      تمدید پس از پایان اعتبار؛ اطلاعات مالی حذف نمی‌شود.
                    </p>
                  </div>
                </Reveal>
              );
            })
          )}
        </div>
        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-3xl text-center text-[10px] leading-6 text-ink-soft">
            فعلاً ساختار پرداخت و تأیید سمت سرور آماده است؛ پرداخت آزمایشی با
            برچسب واضح ثبت می‌شود و تا اتصال درگاه واقعی، هیچ پرداخت واقعی فعال
            نیست. قیمت یا تخفیف دیگری خارج از این دو پلن ایجاد نمی‌شود.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="relative overflow-hidden rounded-[40px] bg-gradient-to-br from-[#1d4d3c] via-brand-deep to-[#10291f] px-5 py-12 text-cream shadow-[0_50px_100px_-50px_rgba(16,41,31,0.9)] sm:px-10 lg:px-14 lg:py-16">
        <div className="terminal-grid pointer-events-none absolute inset-0 opacity-[0.2]" />
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-0 size-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Eyebrow>امنیت سمت سرور</Eyebrow>
            <h2 className="mt-4 text-[28px] font-extrabold leading-[1.4] sm:text-[36px]">
              داده مالی مشتری،
              <br />
              <span className="text-gradient-gold">امانت است.</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-8 text-cream/75">
              هر پرس‌وجو و هر تغییر، عضویت و نقش کاربر را در همان کسب‌وکار
              بررسی می‌کند. وابستگی پرداخت، فایل و گزارش هم از همین قاعده پیروی
              می‌کند.
            </p>
            <ul className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {[
                "جداسازی کامل فضای داده",
                "کنترل مجوز در Backend",
                "تاریخچه تغییرات مهم",
                "پرداخت تأییدشده سمت سرور",
                "جلوگیری از پرداخت تکراری",
                "بدون Secret در Frontend",
              ].map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2.5 text-[12px] leading-6 text-cream/80"
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold">
                    <Check className="size-2.5" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-[28px] border border-cream/15 bg-cream/[0.07] p-6 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-gold/15 text-gold ring-1 ring-gold/20">
                    <ShieldCheck className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">دسترسی تأیید شد</p>
                    <p className="mt-0.5 text-[10px] text-cream/50">
                      بررسی در لایه سرور
                    </p>
                  </div>
                </div>
                <span className="flex size-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Check className="size-4" />
                </span>
              </div>
              <div className="mt-5 space-y-2">
                {[
                  ["فضای کاری", "اختصاصی"],
                  ["نقش کاربر", "مالک"],
                  ["دسترسی نوشتن", "اشتراک فعال"],
                  ["داده سایر مشتریان", "مسدود"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5 text-[11px] ring-1 ring-white/[0.04]"
                  >
                    <span className="text-cream/50">{label}</span>
                    <span className="font-semibold text-cream">{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-gold/15 bg-gold/[0.07] px-3 py-2.5 text-[10px] text-gold/90">
                <FileText className="size-3.5" />
                تمدید، لغو و پرداخت در Audit Log ثبت می‌شود.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-28 border-y border-white/60 bg-white/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="سؤالات متداول"
              title="پیش از انتخاب اشتراک بدانید"
              description="پاسخ شفاف درباره پرداخت، تمدید، امنیت و داده‌ها. اگر پاسخ سؤالتان اینجا نبود، به پشتیبانی بنویسید."
              align="start"
            />
            <Reveal delay={0.1}>
              <a
                href="mailto:hello@hesabvira.ir?subject=سؤال%20درباره%20اشتراک%20حساب%20ویرا"
                className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/80 bg-white/70 px-4 py-3 text-[12px] font-semibold text-brand shadow-sm transition-colors hover:bg-white"
              >
                <Mail className="size-4" />
                hello@hesabvira.ir
                <ArrowUpRight className="size-3.5" />
              </a>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-ink-soft">
                <Link
                  to="/legal/terms"
                  className="rounded-full border border-hairline/70 bg-white/60 px-3 py-1.5 hover:text-ink"
                >
                  شرایط استفاده
                </Link>
                <Link
                  to="/legal/renewal"
                  className="rounded-full border border-hairline/70 bg-white/60 px-3 py-1.5 hover:text-ink"
                >
                  تمدید و لغو
                </Link>
                <Link
                  to="/legal/refund"
                  className="rounded-full border border-hairline/70 bg-white/60 px-3 py-1.5 hover:text-ink"
                >
                  بازپرداخت
                </Link>
              </div>
            </Reveal>
          </div>
          <div className="space-y-2.5">
            {faqs.map((faq, index) => (
              <Reveal key={faq.q} delay={Math.min(index * 0.03, 0.18)}>
                <details className="group rounded-2xl border border-white/80 bg-white/80 px-5 py-4 shadow-[0_10px_30px_-28px_rgba(22,58,46,0.6)] backdrop-blur transition-colors open:bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                    <span className="text-[13px] font-bold text-ink">
                      {faq.q}
                    </span>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cream/70 text-ink-soft transition-transform duration-300 group-open:rotate-180 group-open:bg-brand group-open:text-cream">
                      <ChevronDown className="size-3.5" />
                    </span>
                  </summary>
                  <p className="mt-3 border-t border-hairline/60 pt-3 text-[12px] leading-7 text-ink-soft">
                    {faq.a}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="contact" className="scroll-mt-28 px-3 py-10 sm:px-5 lg:py-16">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[40px] bg-gradient-to-br from-[#2b6b54] via-brand to-brand-deep px-6 py-12 text-cream shadow-[0_50px_100px_-50px_rgba(22,58,46,0.9)] sm:px-10 lg:px-14 lg:py-16">
        <div className="depth-grid pointer-events-none absolute inset-x-0 bottom-0 h-56 opacity-30" />
        <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cream/15 bg-cream/10 px-3 py-1 text-[10px] font-semibold text-cream/70">
              <Sparkles className="size-3 text-gold" />
              فضای اختصاصی کسب‌وکار شما
            </span>
            <h2 className="mt-4 text-[28px] font-extrabold leading-[1.4] sm:text-[38px]">
              امروز فضای مالی
              <br />
              کسب‌وکارت را بساز.
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-8 text-cream/75">
              اطلاعات مدیر و کسب‌وکار را وارد کن، پلن سه‌ماهه یا یک‌ساله را
              انتخاب کن و بعد از تأیید پرداخت، ثبت اسناد را شروع کن.
            </p>
            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 gap-2 rounded-2xl bg-cream px-6 text-sm font-bold text-brand-deep hover:bg-cream/90"
              >
                <Link to="/signup">
                  شروع ثبت‌نام
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 gap-2 rounded-2xl border-cream/25 bg-transparent px-5 text-sm text-cream hover:bg-cream/10 hover:text-cream"
              >
                <Link to="/auth?returnTo=/dashboard">ورود به فضای کاری</Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-2xl border border-cream/15 bg-cream/[0.07] p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <Mail className="size-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold">
                    پشتیبانی و فروش
                  </p>
                  <a
                    href="mailto:hello@hesabvira.ir"
                    className="mt-0.5 block text-[11px] text-cream/55 underline-offset-4 hover:text-cream hover:underline"
                  >
                    hello@hesabvira.ir
                  </a>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-cream/15 bg-cream/[0.07] p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-mist/10 text-mist">
                  <Building2 className="size-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold">
                    صفحه راه‌های ارتباط
                  </p>
                  <Link
                    to="/legal/support"
                    className="mt-0.5 block text-[11px] text-cream/55 underline-offset-4 hover:text-cream hover:underline"
                  >
                    مشاهده کانال‌های پشتیبانی
                  </Link>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-cream/10 px-4 py-3 text-[10px] text-cream/40">
              <ShieldCheck className="size-3.5 text-gold/70" />
              اطلاعات تماس فقط برای پاسخ‌گویی استفاده می‌شود.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_0.7fr_0.7fr_0.9fr]">
          <div>
            <Brand subtitle="HESAB VIRA" />
            <p className="mt-4 max-w-xs text-[11px] leading-6 text-ink-soft">
              مدیریت هوشمند مالی و حسابداری دقیق برای کسب‌وکارهای ایرانی.
              فضای کاری اختصاصی، فارسی و راست‌چین با اشتراک سه‌ماهه یا یک‌ساله.
            </p>
            <div className="mt-5 flex items-center gap-2 text-[10px] text-ink-soft">
              <span className="rounded-full border border-hairline/70 bg-white/60 px-2.5 py-1">
                نسخه اشتراکی
              </span>
              <span className="rounded-full border border-hairline/70 bg-white/60 px-2.5 py-1">
                ساخته‌شده در ایران
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-ink">محصول</p>
            <ul className="mt-3 space-y-2 text-[11px] text-ink-soft">
              <li>
                <a href="#features" className="hover:text-ink">
                  امکانات
                </a>
              </li>
              <li>
                <a href="#modules" className="hover:text-ink">
                  ماژول‌ها
                </a>
              </li>
              <li>
                <a href="#reports" className="hover:text-ink">
                  گزارش و ویرا AI
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-ink">
                  تعرفه‌ها
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold text-ink">حقوقی</p>
            <ul className="mt-3 space-y-2 text-[11px] text-ink-soft">
              <li>
                <Link to="/legal/terms" className="hover:text-ink">
                  قوانین استفاده
                </Link>
              </li>
              <li>
                <Link to="/legal/privacy" className="hover:text-ink">
                  حریم خصوصی
                </Link>
              </li>
              <li>
                <Link to="/legal/renewal" className="hover:text-ink">
                  تمدید و لغو
                </Link>
              </li>
              <li>
                <Link to="/legal/refund" className="hover:text-ink">
                  بازپرداخت
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold text-ink">شروع و پشتیبانی</p>
            <ul className="mt-3 space-y-2 text-[11px] text-ink-soft">
              <li>
                <Link to="/signup" className="hover:text-ink">
                  ساخت فضای کاری
                </Link>
              </li>
              <li>
                <Link
                  to="/auth?returnTo=/dashboard"
                  className="hover:text-ink"
                >
                  ورود به فضای کاری
                </Link>
              </li>
              <li>
                <Link to="/legal/support" className="hover:text-ink">
                  راه‌های ارتباط با پشتیبانی
                </Link>
              </li>
              <li>
                <a
                  href="mailto:hello@hesabvira.ir"
                  className="inline-flex items-center gap-1.5 hover:text-ink"
                >
                  <Mail className="size-3" />
                  hello@hesabvira.ir
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-hairline/60 pt-5 text-[10px] text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <p>© حساب ویرا — تمام حقوق محفوظ است.</p>
          <p className="flex items-center gap-1.5">
            <Zap className="size-3 text-gold" />
            پرداخت واقعی فقط پس از اتصال و آزمایش درگاه فعال می‌شود.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="light min-h-screen overflow-hidden bg-background">
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <Modules />
        <ReportsSection />
        <Pricing />
        <Trust />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
