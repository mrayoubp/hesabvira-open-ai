import { Brand } from "@/components/app/Brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

/**
 * Wraps a route that requires a signed-in user.
 *
 * Signed-out visitors are bounced to `/auth` with `returnTo`, so the protected
 * page they asked for is where they land after signing in.
 */
export function RequireAuth({
  children,
  title = "برای ادامه وارد شوید",
  description = "این بخش فقط برای کاربران وارد‌شده در دسترس است.",
  redirectImmediately = false,
}: {
  children: ReactNode;
  /** Headline on the blocked screen. */
  title?: string;
  /** Says what the visitor gets by signing in. */
  description?: string;
  /** Skip the explanation and go straight to `/auth`. */
  redirectImmediately?: boolean;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-[11px] text-ink-soft">
          <Loader2 className="size-4 animate-spin text-brand" />
          در حال بررسی نشست امن…
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const signInHref = `/auth?returnTo=${encodeURIComponent(returnTo)}`;

    if (redirectImmediately) {
      return <Navigate to={signInHref} replace />;
    }

    return (
      <main className="surface-grain flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-hairline/80 bg-surface shadow-[0_30px_70px_-45px_rgba(15,81,63,0.4)]">
          <div className="page-masthead flex items-center justify-between border-b border-hairline/60 px-5 py-4">
            <Brand subtitle="HESAB VIRA" />
            <span className="rounded-full border border-gold/25 bg-gold-soft/50 px-2.5 py-1 text-[8px] font-semibold text-[#7a6122] dark:text-gold">
              دسترسی محافظت‌شده
            </span>
          </div>
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-[15px] bg-brand-soft text-brand ring-1 ring-inset ring-brand/10">
              <Lock className="size-5" />
            </div>
            <h1 className="text-lg font-black text-ink">{title}</h1>
            <p className="max-w-xs text-[11px] leading-6 text-ink-soft">
              {description}
            </p>
            <p className="max-w-full truncate rounded-full bg-cream/45 px-3 py-1 font-mono text-[8px] text-ink-soft/70 dark:bg-white/[0.04]">
              returnTo: {returnTo}
            </p>
          </div>
          <div className="flex flex-col gap-2 border-t border-hairline/60 bg-cream/15 p-4 dark:bg-white/[0.015]">
            <Button
              className="w-full"
              onClick={() => navigate(signInHref)}
            >
              ورود به حساب
            </Button>
            <Button
              variant="ghost"
              className="w-full text-ink-soft"
              onClick={() => navigate("/")}
            >
              بازگشت به صفحه اصلی
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return children;
}
