import { Brand } from "@/components/app/Brand";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatJalaliLong } from "@/lib/format";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams } from "react-router";

const LEGAL_LINKS = [
  { slug: "terms", label: "قوانین و شرایط استفاده" },
  { slug: "privacy", label: "حریم خصوصی" },
  { slug: "renewal", label: "تمدید و لغو" },
  { slug: "refund", label: "بازپرداخت" },
  { slug: "support", label: "پشتیبانی" },
];

export default function LegalPage() {
  const { slug = "" } = useParams();
  const page = useQuery(api.legal.get, { slug });
  const pages = useQuery(api.legal.list);
  const navItems =
    pages && pages.length > 0
      ? pages.map((item) => ({ slug: item.slug, label: item.title }))
      : LEGAL_LINKS;

  return (
    <div className="light min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Brand subtitle="HESAB VIRA" />
        <div className="flex items-center gap-2">
          <Link
            to="/auth?returnTo=/dashboard"
            className="rounded-xl px-3 py-2 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-white/60 hover:text-ink"
          >
            ورود
          </Link>
          <Button asChild size="sm" className="h-8 rounded-xl px-3 text-[10px]">
            <Link to="/signup">شروع اشتراک</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-5 px-4 pb-16 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:px-8">
        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[26px] border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur-xl">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
              <FileText className="size-3.5 text-gold" />
              صفحات حقوقی حساب ویرا
            </p>
            <nav className="mt-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.slug}
                  to={`/legal/${item.slug}`}
                  className={`block rounded-xl px-3 py-2 text-[11px] transition-colors ${
                    item.slug === slug
                      ? "bg-brand-soft font-bold text-brand"
                      : "text-ink-soft hover:bg-cream/50 hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="rounded-[26px] border border-hairline/70 bg-white/60 p-4 text-[10px] leading-6 text-ink-soft">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              <ShieldCheck className="size-3.5 text-brand" />
              سؤال حقوقی یا پرداخت دارید؟
            </p>
            <p className="mt-2">
              متن این صفحات توسط مدیر سامانه قابل ویرایش است. برای پیگیری
              صورت‌حساب، تمدید یا بازپرداخت با پشتیبانی تماس بگیرید.
            </p>
            <a
              href="mailto:hello@hesabvira.ir"
              className="mt-2 inline-flex items-center gap-1.5 text-brand hover:underline"
            >
              <Mail className="size-3" />
              hello@hesabvira.ir
            </a>
          </div>
        </aside>

        <article className="rounded-[30px] border border-white/85 bg-white/90 p-5 shadow-[0_25px_65px_-50px_rgba(22,58,46,0.6)] backdrop-blur-xl sm:p-8">
          {page === undefined ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-xs text-ink-soft">
              <Loader2 className="size-4 animate-spin" /> در حال خواندن متن…
            </div>
          ) : page === null ? (
            <div className="flex min-h-56 flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-cream/70 text-ink-soft">
                <FileText className="size-5" />
              </span>
              <h1 className="mt-4 text-base font-bold text-ink">
                این صفحه در دسترس نیست
              </h1>
              <p className="mt-2 max-w-sm text-[11px] leading-6 text-ink-soft">
                ممکن است نشانی تغییر کرده باشد یا صفحه توسط مدیر سامانه غیرفعال
                شده باشد.
              </p>
              <Button asChild variant="outline" className="mt-4 rounded-xl">
                <Link to="/">بازگشت به صفحه اصلی</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline/60 pb-5">
                <div>
                  <p className="text-[10px] font-semibold text-gold">
                    HESAB VIRA · LEGAL
                  </p>
                  <h1 className="mt-1 text-[26px] font-black leading-tight text-ink">
                    {page.title}
                  </h1>
                </div>
                <div className="rounded-xl border border-hairline/70 bg-background/60 px-3 py-2 text-[9px] text-ink-soft">
                  <p>نسخه {page.version.toLocaleString("fa-IR")}</p>
                  <p className="num mt-1">
                    آخرین به‌روزرسانی: {formatJalaliLong(page.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                {page.content.split(/\n{2,}/).map((paragraph, index) => (
                  <p
                    key={index}
                    className="whitespace-pre-line text-[12px] leading-8 text-ink-soft"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
              <div className="mt-8 flex flex-col gap-2 border-t border-hairline/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[9px] text-ink-soft">
                  این متن جایگزین مشاوره حقوقی تخصصی نیست و نسخه منتشرشده در این
                  صفحه معتبر است.
                </p>
                <div className="flex gap-2">
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link to="/">
                      <ArrowRight className="size-3.5" />
                      صفحه اصلی
                    </Link>
                  </Button>
                  <Button asChild className="rounded-xl">
                    <Link to="/signup">
                      شروع اشتراک
                      <ArrowLeft className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          )}
        </article>
      </main>
    </div>
  );
}
