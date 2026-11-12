import { Brand } from "@/components/app/Brand";
import { Button } from "@/components/ui/button";
import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <main className="light relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Brand subtitle="HESAB VIRA" />
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-[32px] border border-white/85 bg-white/80 p-7 text-center shadow-[0_40px_90px_-55px_rgba(22,58,46,0.7)] backdrop-blur-xl sm:p-9">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cream to-mist/70 text-ink-soft">
            <SearchX className="size-6" />
          </span>
          <p className="num mt-4 text-[11px] font-semibold tracking-[0.2em] text-gold">
            404
          </p>
          <h1 className="mt-1 text-2xl font-black text-ink">
            این صفحه پیدا نشد
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-6 text-ink-soft">
            نشانی وارد‌شده وجود ندارد یا جابه‌جا شده است. از داشبورد یا صفحه
            اصلی ادامه بده.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild className="h-10 gap-2 rounded-xl">
              <Link to="/dashboard">
                رفتن به داشبورد
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 rounded-xl border-white/90 bg-white/70"
            >
              <Link to="/">صفحه اصلی</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
