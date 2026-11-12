import { Brand } from "@/components/app/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CreditCard,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

const highlights = [
  "اشتراک سه‌ماهه یا یک‌ساله",
  "دسترسی کامل به ماژول‌های حساب ویرا",
  "فضای داده اختصاصی هر کسب‌وکار",
];

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
    } catch (signInError) {
      console.error("Email sign-in error:", signInError);
      setError(
        "ارسال کد ورود انجام نشد. ایمیل را بررسی کنید و دوباره تلاش کنید.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect, { replace: true });
    } catch (verifyError) {
      console.error("OTP verification error:", verifyError);
      setError("کد وارد‌شده درست نیست یا منقضی شده است.");
      setOtp("");
      setIsLoading(false);
    }
  };

  return (
    <div className="light relative min-h-screen overflow-hidden bg-background">
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" />
      <div className="noise pointer-events-none absolute inset-0 -z-10 opacity-[0.03]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Brand subtitle="HESAB VIRA" />
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-ink"
        >
          بازگشت به سایت
          <ArrowLeft className="size-3.5 rotate-180" />
        </Link>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-14 pt-2 sm:px-6 lg:grid-cols-[1fr_1.02fr] lg:gap-12 lg:px-8 lg:pb-20 lg:pt-8">
        <div className="mx-auto w-full max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-white/65 px-3 py-1.5 text-[10px] font-semibold text-brand shadow-sm backdrop-blur">
            <Sparkles className="size-3 text-gold" />
            ورود امن، بدون رمز عبور
          </span>

          <h1 className="mt-4 text-[30px] font-black leading-[1.3] text-ink sm:text-[36px]">
            {step === "signIn" ? (
              <>
                خوش آمدی به
                <br />
                <span className="text-gradient-brand">فضای کاری حسابت.</span>
              </>
            ) : (
              <>
                کد ورودت را
                <br />
                <span className="text-gradient-brand">اینجا وارد کن.</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-[13px] leading-7 text-ink-soft">
            {step === "signIn"
              ? "با ایمیل حساب خود وارد شو. اگر هنوز فضای کاری نداری، از دکمه «ثبت‌نام و انتخاب اشتراک» شروع کن."
              : `کد شش‌رقمی به ${step.email} ارسال شد. این کد تا ۱۵ دقیقه معتبر است.`}
          </p>

          <div className="mt-6 rounded-[30px] border border-white/85 bg-white/80 p-5 shadow-[0_35px_80px_-50px_rgba(22,58,46,0.65)] backdrop-blur-xl sm:p-6">
            {step === "signIn" ? (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="text-[11px] font-semibold text-ink"
                  >
                    ایمیل کاری یا شخصی
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft/70"
                      aria-hidden
                    />
                    <Input
                      id="auth-email"
                      name="email"
                      placeholder="name@shop.ir"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      className="num h-11 rounded-xl border-white/90 bg-background/70 ps-9 text-start shadow-inner"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <p className="text-[10px] leading-5 text-ink-soft">
                    کد یک‌بارمصرف برای همین ایمیل ارسال می‌شود؛ رمز عبوری ذخیره
                    نمی‌کنیم.
                  </p>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive"
                  >
                    {error}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full gap-2 rounded-xl text-[13px] font-bold shadow-[0_16px_30px_-18px_rgba(36,92,73,0.9)]"
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  دریافت کد ورود
                  <ArrowLeft className="size-4" />
                </Button>

                <div className="flex items-center gap-3 py-1">
                  <span className="h-px flex-1 bg-hairline/70" />
                  <span className="text-[9px] font-medium text-ink-soft/70">
                    هنوز حساب نداری؟
                  </span>
                  <span className="h-px flex-1 bg-hairline/70" />
                </div>

                <Button
                  asChild
                  type="button"
                  variant="outline"
                  className="h-11 w-full gap-2 rounded-xl border-white/90 bg-white/70 text-[12px] font-semibold shadow-sm hover:bg-white"
                >
                  <Link to="/signup">
                    <CreditCard className="size-4 text-brand" />
                    ثبت‌نام و انتخاب اشتراک
                  </Link>
                </Button>
              </form>
            ) : (
              <form onSubmit={handleOtpSubmit} className="space-y-4">
                <input type="hidden" name="email" value={step.email} />
                <input type="hidden" name="code" value={otp} />

                <div className="flex justify-center py-1" dir="ltr">
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    disabled={isLoading}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        otp.length === 6 &&
                        !isLoading
                      ) {
                        const form = (event.target as HTMLElement).closest(
                          "form",
                        );
                        form?.requestSubmit();
                      }
                    }}
                  >
                    <InputOTPGroup className="gap-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="size-11 rounded-xl border border-white/90 bg-background/70 text-sm shadow-inner first:rounded-xl last:rounded-xl"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-center text-[11px] leading-5 text-destructive"
                  >
                    {error}
                  </p>
                ) : (
                  <p className="text-center text-[10px] text-ink-soft">
                    کد را از ایمیل خود کپی کنید؛ حساس به فاصله نیست.
                  </p>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full gap-2 rounded-xl text-[13px] font-bold shadow-[0_16px_30px_-18px_rgba(36,92,73,0.9)]"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  تأیید و ورود
                  <ArrowLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full rounded-xl text-[11px] font-medium text-ink-soft"
                  onClick={() => {
                    setStep("signIn");
                    setOtp("");
                    setError(null);
                  }}
                  disabled={isLoading}
                >
                  تغییر ایمیل
                </Button>
              </form>
            )}

            <div className="mt-5 flex items-center justify-between border-t border-hairline/60 pt-4">
              <span className="flex items-center gap-1.5 text-[9px] text-ink-soft">
                <ShieldCheck className="size-3.5 text-brand" />
                نشست امن · داده جداگانه
              </span>
              <span className="font-mono text-[8px] tracking-[0.18em] text-ink-soft/60">
                HESAB VIRA · SUBSCRIPTION
              </span>
            </div>
          </div>

          <p className="mt-4 px-2 text-center text-[10px] leading-5 text-ink-soft">
            با ورود،{" "}
            <Link to="/legal/terms" className="text-brand hover:underline">
              شرایط استفاده
            </Link>{" "}
            و{" "}
            <Link to="/legal/privacy" className="text-brand hover:underline">
              سیاست حریم خصوصی
            </Link>{" "}
            حساب ویرا را می‌پذیری.
          </p>
        </div>

        <div className="relative hidden lg:block" aria-hidden>
          <div className="relative h-[560px] overflow-hidden rounded-[40px] bg-gradient-to-br from-[#2c6b55] via-brand to-[#12352a] p-8 shadow-[0_50px_100px_-45px_rgba(22,58,46,0.8)]">
            <div className="depth-grid pointer-events-none absolute inset-x-0 bottom-0 h-64 opacity-30" />
            <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-gold/15 blur-3xl" />
            <div className="pointer-events-none absolute -right-16 top-20 size-56 rounded-full border border-cream/10" />
            <div className="pointer-events-none absolute -right-6 top-32 size-40 rounded-full border border-cream/10" />

            <div className="relative flex h-full flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-cream/10 text-gold ring-1 ring-cream/10">
                    <CreditCard className="size-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold text-cream">
                      فضای کاری فروشگاه آفتاب
                    </p>
                    <p className="mt-0.5 font-mono text-[8px] tracking-[0.18em] text-cream/40">
                      HESAB VIRA · LIVE
                    </p>
                  </div>
                </div>

                <h2 className="mt-7 max-w-xs text-[26px] font-extrabold leading-[1.5] text-cream">
                  همه‌چیز در یک نگاه،
                  <br />
                  <span className="text-gradient-gold">همه‌چیز قابل پیگیری.</span>
                </h2>
                <p className="mt-3 max-w-xs text-[11px] leading-6 text-cream/70">
                  از اولین مشتری تا آخرین فاکتور؛ حساب ویرا تصویر مالی فروشگاهت
                  را زنده نگه می‌دارد.
                </p>
              </div>

              <div className="relative mt-6 [perspective:1000px]">
                <div className="rounded-[26px] border border-white/15 bg-white/[0.08] p-4 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-cream/55">موجودی نقد و بانک</p>
                    <span className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[8px] font-bold text-gold">
                      <TrendingUp className="size-2.5" />
                      +۱۸٪
                    </span>
                  </div>
                  <p className="num mt-2 text-[26px] font-bold leading-none text-cream">
                    ۱۲۸,۴۵۰,۰۰۰
                    <span className="ms-1.5 font-sans text-[9px] font-normal text-cream/45">
                      تومان
                    </span>
                  </p>
                  <div className="mt-4 flex h-20 items-end gap-1.5">
                    {[32, 46, 38, 58, 50, 72, 64, 86].map((height, index) => (
                      <span
                        key={index}
                        className={
                          index === 7
                            ? "flex-1 rounded-t-md bg-gradient-to-t from-gold/40 to-gold"
                            : "flex-1 rounded-t-md bg-cream/15"
                        }
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="animate-float-slow absolute bottom-3 -start-2 w-[196px] rounded-2xl border border-white/70 bg-white/95 p-2.5 shadow-[0_25px_50px_-25px_rgba(0,0,0,0.45)]">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-xl bg-brand text-cream">
                      <BadgeCheck className="size-4" />
                    </span>
                    <div>
                      <p className="text-[10px] font-bold text-ink">
                        فاکتور صادر شد
                      </p>
                      <p className="num text-[8px] text-ink-soft">
                        INV-0042 · ۵,۴۸۰,۰۰۰
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-soft/60 px-2 py-1 text-[8px] text-brand">
                    <span>محاسبه سروری</span>
                    <Check className="size-3" />
                  </div>
                </div>

                <div className="animate-float-slower absolute -top-6 -end-4 rounded-2xl bg-gold px-3 py-2 text-[#30240a] shadow-[0_20px_40px_-18px_rgba(197,164,91,0.9)]">
                  <p className="text-[8px] font-semibold opacity-70">
                    مطالبات باز
                  </p>
                  <p className="num mt-0.5 text-sm font-bold">۱۲,۶۰۰,۰۰۰</p>
                </div>
              </div>

              <div className="mt-16 flex flex-wrap gap-x-4 gap-y-2">
                {highlights.map((item) => (
                  <span
                    key={item}
                    className="flex items-center gap-1.5 text-[9px] text-cream/75"
                  >
                    <span className="flex size-3.5 items-center justify-center rounded-full bg-gold/15 text-gold">
                      <Check className="size-2" />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="size-5 animate-spin text-ink-soft" />
        </div>
      }
    >
      <Auth {...props} />
    </Suspense>
  );
}
