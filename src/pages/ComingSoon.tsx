import { PageHeader, Panel } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import {
  COMING_SOON_INFO,
  COMING_SOON_PAYMENTS,
} from "@/components/app/navigation";
import { ArrowRight, Check, Sparkles, Wrench } from "lucide-react";
import { Link, useParams } from "react-router";

export default function ComingSoon() {
  const { slug } = useParams<{ slug: string }>();
  const info =
    (slug ? COMING_SOON_INFO[slug] : undefined) ??
    (slug === "payments" ? COMING_SOON_PAYMENTS : undefined) ?? {
      title: "بخش در دست توسعه",
      description:
        "این بخش هنوز روی هسته حساب ویرا فعال نشده است. به‌جای نمایش داده ساختگی، مسیر واقعی آن را در نقشه راه نگه داشته‌ایم.",
      bullets: ["طراحی مبتنی بر داده واقعی", "کنترل دسترسی سمت سرور", "آماده اتصال به دفتر مالی"],
    };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="نقشه راه حساب ویرا"
        title={info.title}
        description="این صفحه یک مسیر واقعی و قابل بازگشت است؛ لینک شکسته یا فرم نمایشی ساخته نشده است."
        actions={
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3.5"
          >
            <Link to="/dashboard">
              <ArrowRight className="size-4" />
              بازگشت به داشبورد
            </Link>
          </Button>
        }
      />

      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute -start-20 -top-24 size-64 rounded-full bg-mist/50 blur-3xl" />
        <div className="pointer-events-none absolute end-0 top-10 size-40 rounded-full bg-gold/10 blur-2xl" />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:p-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold-soft/60 px-2.5 py-1 text-[9px] font-semibold text-[#7a6122] dark:text-gold">
              <Wrench className="size-3" />
              در دست توسعه
            </span>
            <h2 className="mt-4 text-xl font-black text-ink sm:text-2xl">
              {info.title}
            </h2>
            <p className="mt-3 max-w-xl text-[12px] leading-7 text-ink-soft">
              {info.description}
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {info.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-center gap-2 rounded-xl border border-hairline/50 bg-background/60 px-3 py-2 text-[10px] font-medium text-ink"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Check className="size-3" />
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild size="sm" className="rounded-xl gap-1.5">
                <Link to="/dashboard">
                  <Sparkles className="size-3.5" />
                  ادامه کار روی داشبورد
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-[18px]"
              >
                <Link to="/dashboard/invoices">مشاهده فروش فعلی</Link>
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-[26px] border border-white/80 bg-white/75 p-4 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-center justify-between border-b border-hairline/60 pb-3">
                <span className="text-[9px] font-semibold text-ink-soft">
                  وضعیت شفافیت محصول
                </span>
                <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[8px] font-semibold text-[#7a6122] dark:text-gold">
                  فاز بعدی
                </span>
              </div>
              <p className="mt-3 text-[10px] leading-6 text-ink-soft">
                حساب ویرا هیچ داده مالی ساختگی برای این ماژول تولید نمی‌کند.
                تا زمان پیاده‌سازی، داشبورد و گزارش‌ها فقط روی اسناد واقعی
                فعال کار می‌کنند.
              </p>
              <div className="mt-4 space-y-2">
                {[
                  ["فروش و فاکتور", "فعال", true],
                  ["دریافت وجه", "فعال", true],
                  ["درآمد و هزینه", "فعال", true],
                  ["خرید و تأمین‌کننده", "در دست توسعه", false],
                  ["حسابداری دوبل", "در دست توسعه", false],
                  ["انبار و کالا", "در دست توسعه", false],
                ].map(([label, status, active]) => (
                  <div
                    key={String(label)}
                    className="flex items-center justify-between rounded-lg bg-background/60 px-2.5 py-1.5"
                  >
                    <span className="text-[9px] text-ink">{label}</span>
                    <span
                      className={
                        active
                          ? "flex items-center gap-1 text-[8px] font-semibold text-brand"
                          : "text-[8px] font-semibold text-gold"
                      }
                    >
                      {active ? <Check className="size-2.5" /> : null}
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
