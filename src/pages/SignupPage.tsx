import { Brand } from "@/components/app/Brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

type Step = "details" | "verify" | "plan" | "payment" | "done";

interface Details {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  businessName: string;
  businessType: string;
  city: string;
  economicCode: string;
}

const EMPTY_DETAILS: Details = {
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
  businessName: "",
  businessType: "فروشگاه و خرده‌فروشی",
  city: "",
  economicCode: "",
};

const BUSINESS_TYPES = [
  "فروشگاه و خرده‌فروشی",
  "بازرگانی و عمده‌فروشی",
  "تولیدی و صنعتی",
  "خدمات و مشاوره",
  "رستوران و کافه",
  "پیمانکاری",
  "استارتاپ و نرم‌افزار",
  "سایر",
];

const STEPS = [
  { id: "details", label: "اطلاعات مدیر و کسب‌وکار" },
  { id: "verify", label: "تأیید ایمیل" },
  { id: "plan", label: "انتخاب پلن" },
  { id: "payment", label: "پرداخت و فعال‌سازی" },
];

const STEP_INDEX: Record<Step, number> = {
  details: 0,
  verify: 1,
  plan: 2,
  payment: 3,
  done: 4,
};

function makeOnboardingKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `signup-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function StepRail({ step }: { step: Step }) {
  const activeIndex = STEP_INDEX[step];
  return (
    <ol className="space-y-3">
      {STEPS.map((item, index) => {
        const complete = activeIndex > index;
        const active = activeIndex === index;
        return (
          <li
            key={item.id}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
              active
                ? "border-gold/25 bg-gold/[0.08] text-cream"
                : complete
                  ? "border-cream/10 bg-cream/[0.05] text-cream/75"
                  : "border-transparent text-cream/40"
            }`}
          >
            <span
              className={`num flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                active
                  ? "bg-gold text-[#31260e]"
                  : complete
                    ? "bg-cream/15 text-gold"
                    : "bg-cream/[0.06] text-cream/40"
              }`}
            >
              {complete ? <Check className="size-3" /> : index + 1}
            </span>
            <span className="text-[11px] font-medium">{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  children,
  hint,
}: {
  id: string;
  label: string;
  icon: typeof UserRound;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3.5 text-brand" />
        {label}
      </Label>
      {children}
      {hint ? (
        <p className="text-[9px] leading-4 text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

export default function SignupPage() {
  const { isLoading, isAuthenticated, user, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedPlan = searchParams.get("plan");

  const plans = useQuery(api.subscription.plans);
  const billing = useQuery(api.subscription.billingConfig);
  const startOnboarding = useMutation(api.subscription.startOnboarding);
  const checkout = useMutation(api.subscription.checkout);
  const confirmTest = useMutation(api.subscription.confirmTestPayment);

  const [step, setStep] = useState<Step>("details");
  const [details, setDetails] = useState<Details>(() => {
    if (typeof window === "undefined") return EMPTY_DETAILS;
    try {
      const raw = window.sessionStorage.getItem("hv.signup.details");
      return raw
        ? { ...EMPTY_DETAILS, ...(JSON.parse(raw) as Partial<Details>) }
        : EMPTY_DETAILS;
    } catch {
      return EMPTY_DETAILS;
    }
  });
  const [accepted, setAccepted] = useState(false);
  const [otp, setOtp] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [onboardingKey] = useState(makeOnboardingKey);
  const [invoice, setInvoice] = useState<{
    invoiceId: string;
    number: string;
    amountToman: number;
  } | null>(null);
  const [testPaymentId, setTestPaymentId] = useState<string | null>(null);
  const [testSucceeded, setTestSucceeded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPlan =
    plans?.find(
      (plan) =>
        plan._id === selectedPlanId ||
        (!selectedPlanId &&
          (plan.code === requestedPlan || plan._id === requestedPlan)),
    ) ?? plans?.[0];

  function updateDetail<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails((current) => {
      const next = { ...current, [key]: value };
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("hv.signup.details", JSON.stringify(next));
      }
      return next;
    });
  }

  async function submitDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const email = (details.email || user?.email || "").trim();
    if (
      !details.firstName.trim() ||
      !details.lastName.trim() ||
      !details.mobile.trim() ||
      !details.businessName.trim() ||
      !details.city.trim()
    ) {
      setError("نام، نام خانوادگی، موبایل، نام کسب‌وکار و شهر را کامل کنید.");
      return;
    }
    if (!accepted) {
      setError("برای ادامه، قوانین و شرایط استفاده را بپذیرید.");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError("ایمیل معتبر وارد کنید.");
      return;
    }
    if (isAuthenticated) {
      setStep("plan");
      return;
    }
    setBusy("otp-send");
    try {
      const formData = new FormData();
      formData.set("email", email);
      await signIn("email-otp", formData);
      setDetails((current) => ({
        ...current,
        email,
      }));
      setStep("verify");
      toast.success("کد ورود به ایمیل شما ارسال شد.");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy("otp-verify");
    try {
      const formData = new FormData();
      formData.set("email", details.email || user?.email || "");
      formData.set("code", otp);
      await signIn("email-otp", formData);
      setStep("plan");
      toast.success("ایمیل تأیید شد. پلن خود را انتخاب کنید.");
    } catch (reason) {
      setError(
        "کد واردشده درست نیست یا منقضی شده است. دوباره تلاش کنید." +
          (import.meta.env.DEV ? ` (${getErrorMessage(reason)})` : ""),
      );
      setOtp("");
    } finally {
      setBusy(null);
    }
  }

  async function createWorkspaceAndInvoice() {
    if (!selectedPlan) {
      setError("یک پلن اشتراک انتخاب کنید.");
      return;
    }
    if (!billing) {
      setError("تنظیمات پرداخت در حال بارگذاری است. چند لحظه بعد تلاش کنید.");
      return;
    }
    if (!billing.testMode) {
      setError(
        "درگاه پرداخت واقعی هنوز متصل و آزمایش نشده است؛ ساخت فضای کاری تا آماده‌شدن پرداخت متوقف است. لطفاً با پشتیبانی تماس بگیرید.",
      );
      return;
    }
    setError(null);
    setBusy("workspace");
    try {
      const result = await startOnboarding({
        firstName: details.firstName,
        lastName: details.lastName,
        mobile: details.mobile,
        email: details.email || user?.email || "",
        businessName: details.businessName,
        businessType: details.businessType,
        city: details.city,
        economicCode: details.economicCode || undefined,
        planId: selectedPlan._id as never,
        acceptedTerms: accepted,
        onboardingKey,
      });
      if (!result.invoiceId) {
        throw new Error("فاکتور اشتراک صادر نشد.");
      }
      setInvoice({
        invoiceId: result.invoiceId,
        number: result.invoiceNumber ?? "—",
        amountToman: result.amountToman ?? selectedPlan.priceToman,
      });
      setStep("payment");
      if (billing?.testMode) {
        try {
          const invoiceRow = await checkout({
            invoiceId: result.invoiceId,
          });
          if (invoiceRow.mode === "already_paid") {
            setTestSucceeded(true);
            setStep("done");
            return;
          }
          setTestPaymentId(invoiceRow.paymentId);
        } catch (checkoutError) {
          setError(getErrorMessage(checkoutError));
        }
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function simulatePayment(outcome: "success" | "failed") {
    if (!invoice) return;
    setError(null);
    setBusy("payment");
    try {
      let paymentId = testPaymentId;
      if (!paymentId) {
        const result = await checkout({
          invoiceId: invoice.invoiceId as never,
        });
        if (result.mode === "already_paid") {
          setTestSucceeded(true);
          setStep("done");
          return;
        }
        paymentId = result.paymentId;
        setTestPaymentId(paymentId);
      }
      const result = await confirmTest({
        paymentId: paymentId as never,
        outcome,
      });
      if (outcome === "success") {
        setTestSucceeded(true);
        setStep("done");
        toast.success(
          result.alreadyProcessed
            ? "این پرداخت قبلاً فعال شده است."
            : "اشتراک شما با موفقیت فعال شد.",
        );
      } else {
        setTestPaymentId(null);
        setError(
          "پرداخت آزمایشی ناموفق ثبت شد. اشتراک فعال نشد؛ می‌توانید دوباره تلاش کنید.",
        );
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="light relative min-h-screen overflow-hidden bg-background">
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" />
      <div className="noise pointer-events-none absolute inset-0 -z-10 opacity-[0.03]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Brand subtitle="HESAB VIRA" />
        <div className="flex items-center gap-2">
          <Link
            to="/auth?returnTo=/dashboard"
            className="hidden rounded-xl px-3 py-2 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-white/60 hover:text-ink sm:inline-flex"
          >
            قبلاً ثبت‌نام کرده‌ام
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-ink"
          >
            بازگشت به سایت
            <ArrowLeft className="size-3.5 rotate-180" />
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 pt-2 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:items-start lg:gap-10 lg:px-8 lg:pt-8">
        <aside className="relative hidden overflow-hidden rounded-[32px] bg-gradient-to-br from-[#1d4d3c] via-brand to-[#10291f] p-7 text-cream shadow-[0_35px_80px_-45px_rgba(16,41,31,0.9)] lg:sticky lg:top-6 lg:block">
          <div className="terminal-grid pointer-events-none absolute inset-0 opacity-20" />
          <div className="pointer-events-none absolute -left-16 -top-20 size-64 rounded-full bg-gold/15 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/10 px-3 py-1 text-[10px] font-semibold text-cream/75">
              <Sparkles className="size-3 text-gold" />
              ثبت‌نام حساب ویرا
            </span>
            <h2 className="mt-5 text-[26px] font-black leading-[1.45]">
              فضای مالی اختصاصی
              <br />
              <span className="text-gradient-gold">کسب‌وکار شما.</span>
            </h2>
            <p className="mt-3 text-[11px] leading-6 text-cream/60">
              اطلاعات، کاربران، اسناد و گزارش‌های شما جدا از سایر مشتریان نگه‌داری
              می‌شود. بعد از تأیید پرداخت، اشتراک فعال می‌شود.
            </p>
            <div className="mt-7">
              <StepRail step={step} />
            </div>
            <div className="mt-7 space-y-2 border-t border-cream/10 pt-5 text-[10px] leading-5 text-cream/55">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold" />
                تأیید ایمیل با کد یک‌بارمصرف؛ بدون رمز عبور.
              </p>
              <p className="flex items-start gap-2">
                <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-gold" />
                قیمت و مدت پلن از دیتابیس رسمی خوانده می‌شود.
              </p>
              <p className="flex items-start gap-2">
                <CreditCard className="mt-0.5 size-3.5 shrink-0 text-gold" />
                تا اتصال درگاه واقعی، پرداخت این محیط آزمایشی است.
              </p>
            </div>
          </div>
        </aside>

        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <p className="text-[11px] font-bold text-ink">
              مرحله {Math.min(STEP_INDEX[step] + 1, 4)} از ۴
            </p>
            <div className="flex flex-1 gap-1">
              {STEPS.map((item, index) => (
                <span
                  key={item.id}
                  className={`h-1.5 flex-1 rounded-full ${
                    STEP_INDEX[step] >= index
                      ? "bg-brand"
                      : "bg-hairline/70"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-white/85 bg-white/85 p-5 shadow-[0_35px_80px_-50px_rgba(22,58,46,0.65)] backdrop-blur-xl sm:p-7">
            {step === "details" ? (
              <form onSubmit={submitDetails} className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-black leading-tight text-ink sm:text-[28px]">
                    کسب‌وکار خود را معرفی کنید
                  </h1>
                  <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                    این اطلاعات برای ساخت فضای اختصاصی و صدور فاکتور اشتراک
                    استفاده می‌شود. فیلدهای ستاره‌دار الزامی‌اند.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="first-name" label="نام مدیر *" icon={UserRound}>
                    <Input
                      id="first-name"
                      value={details.firstName}
                      onChange={(event) =>
                        updateDetail("firstName", event.target.value)
                      }
                      placeholder="مثلاً علی"
                      className="h-10 rounded-xl text-xs"
                      required
                    />
                  </Field>
                  <Field
                    id="last-name"
                    label="نام خانوادگی مدیر *"
                    icon={UserRound}
                  >
                    <Input
                      id="last-name"
                      value={details.lastName}
                      onChange={(event) =>
                        updateDetail("lastName", event.target.value)
                      }
                      placeholder="مثلاً رضایی"
                      className="h-10 rounded-xl text-xs"
                      required
                    />
                  </Field>
                  <Field
                    id="mobile"
                    label="شماره موبایل *"
                    icon={MapPin}
                    hint="فقط برای هماهنگی و پشتیبانی استفاده می‌شود."
                  >
                    <Input
                      id="mobile"
                      value={details.mobile}
                      onChange={(event) =>
                        updateDetail("mobile", event.target.value)
                      }
                      placeholder="09123456789"
                      dir="ltr"
                      inputMode="tel"
                      className="num h-10 rounded-xl text-start text-xs"
                      required
                    />
                  </Field>
                  <Field
                    id="email"
                    label="ایمیل مدیر *"
                    icon={Mail}
                    hint="کد تأیید به همین ایمیل ارسال می‌شود."
                  >
                    <Input
                      id="email"
                      type="email"
                      value={details.email || user?.email || ""}
                      onChange={(event) =>
                        updateDetail("email", event.target.value)
                      }
                      placeholder="name@business.ir"
                      dir="ltr"
                      className="num h-10 rounded-xl text-start text-xs"
                      required
                      disabled={Boolean(user?.email)}
                    />
                  </Field>
                  <Field
                    id="business-name"
                    label="نام کسب‌وکار *"
                    icon={Building2}
                  >
                    <Input
                      id="business-name"
                      value={details.businessName}
                      onChange={(event) =>
                        updateDetail("businessName", event.target.value)
                      }
                      placeholder="مثلاً فروشگاه آفتاب"
                      className="h-10 rounded-xl text-xs"
                      required
                    />
                  </Field>
                  <Field id="city" label="شهر *" icon={MapPin}>
                    <Input
                      id="city"
                      value={details.city}
                      onChange={(event) =>
                        updateDetail("city", event.target.value)
                      }
                      placeholder="مثلاً تهران"
                      className="h-10 rounded-xl text-xs"
                      required
                    />
                  </Field>
                  <Field id="business-type" label="نوع کسب‌وکار *" icon={Sparkles}>
                    <select
                      id="business-type"
                      value={details.businessType}
                      onChange={(event) =>
                        updateDetail("businessType", event.target.value)
                      }
                      className="h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-xs text-ink"
                    >
                      {BUSINESS_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    id="economic-code"
                    label="کد اقتصادی (اختیاری)"
                    icon={Building2}
                  >
                    <Input
                      id="economic-code"
                      value={details.economicCode}
                      onChange={(event) =>
                        updateDetail("economicCode", event.target.value)
                      }
                      placeholder="کد اقتصادی یا شناسه ملی"
                      dir="ltr"
                      className="num h-10 rounded-xl text-start text-xs"
                    />
                  </Field>
                </div>

                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-hairline/70 bg-background/40 px-3 py-3 text-[10px] leading-5 text-ink-soft">
                  <Checkbox
                    checked={accepted}
                    onCheckedChange={(value) => setAccepted(value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <Link
                      to="/legal/terms"
                      target="_blank"
                      className="font-semibold text-brand underline-offset-4 hover:underline"
                    >
                      قوانین و شرایط استفاده
                    </Link>{" "}
                    و{" "}
                    <Link
                      to="/legal/privacy"
                      target="_blank"
                      className="font-semibold text-brand underline-offset-4 hover:underline"
                    >
                      سیاست حریم خصوصی
                    </Link>{" "}
                    را خوانده‌ام و می‌پذیرم.
                  </span>
                </label>

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
                  className="h-11 w-full gap-2 rounded-xl text-[12px] font-bold"
                  disabled={busy !== null || isLoading}
                >
                  {busy === "otp-send" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {isAuthenticated ? "ادامه به انتخاب پلن" : "دریافت کد تأیید ایمیل"}
                  <ArrowLeft className="size-4" />
                </Button>
              </form>
            ) : null}

            {step === "verify" ? (
              <form onSubmit={verifyOtp} className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-black leading-tight text-ink sm:text-[28px]">
                    ایمیل خود را تأیید کنید
                  </h1>
                  <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                    کد شش‌رقمی به{" "}
                    <span className="num font-semibold text-ink">
                      {details.email || user?.email}
                    </span>{" "}
                    ارسال شد. این کد تا ۱۵ دقیقه معتبر است.
                  </p>
                </div>
                <div className="flex justify-center py-2" dir="ltr">
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    disabled={busy !== null}
                  >
                    <InputOTPGroup className="gap-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="size-12 rounded-xl border border-white/90 bg-background/70 text-sm shadow-inner"
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
                ) : null}
                <Button
                  type="submit"
                  className="h-11 w-full gap-2 rounded-xl text-[12px] font-bold"
                  disabled={busy !== null || otp.length !== 6}
                >
                  {busy === "otp-verify" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  تأیید ایمیل و ادامه
                  <ArrowLeft className="size-4" />
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-[10px] text-ink-soft hover:text-ink"
                  onClick={() => {
                    setStep("details");
                    setOtp("");
                    setError(null);
                  }}
                >
                  تغییر اطلاعات یا ایمیل
                </button>
              </form>
            ) : null}

            {step === "plan" ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-black leading-tight text-ink sm:text-[28px]">
                    پلن اشتراک را انتخاب کنید
                  </h1>
                  <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                    فقط دو پلن رسمی حساب ویرا در دسترس است. قیمت و مدت از
                    دیتابیس تعرفه‌ها خوانده می‌شود.
                  </p>
                </div>
                {plans === undefined ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-soft">
                    <Loader2 className="size-4 animate-spin" />
                    در حال خواندن تعرفه‌ها…
                  </div>
                ) : plans.length === 0 ? (
                  <div className="rounded-xl border border-gold/30 bg-gold-soft/40 p-4 text-[11px] leading-6 text-[#6f551d]">
                    تعرفه‌ها هنوز در دیتابیس تنظیم نشده‌اند. لطفاً با پشتیبانی
                    حساب ویرا تماس بگیرید.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {plans.map((plan) => {
                      const active = selectedPlan?._id === plan._id;
                      return (
                        <button
                          type="button"
                          key={plan._id}
                          onClick={() => setSelectedPlanId(plan._id)}
                          className={`relative rounded-2xl border p-4 text-start transition-all ${
                            active
                              ? "border-brand bg-brand-soft/45 shadow-sm"
                              : "border-hairline/70 bg-background/40 hover:border-brand/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-ink">
                              {plan.name}
                            </p>
                            <span
                              className={`flex size-5 items-center justify-center rounded-full border ${
                                active
                                  ? "border-brand bg-brand text-cream"
                                  : "border-hairline bg-white"
                              }`}
                            >
                              {active ? <Check className="size-3" /> : null}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-ink-soft">
                            {formatNumber(plan.durationMonths)} ماه اعتبار
                          </p>
                          <p className="num mt-4 text-2xl font-black text-ink">
                            {formatNumber(plan.priceToman)}
                            <span className="ms-1 font-sans text-[10px] font-normal text-ink-soft">
                              تومان
                            </span>
                          </p>
                          <ul className="mt-3 space-y-1.5">
                            {plan.features.slice(0, 4).map((feature) => (
                              <li
                                key={feature}
                                className="flex items-start gap-1.5 text-[10px] leading-5 text-ink-soft"
                              >
                                <Check className="mt-0.5 size-3 shrink-0 text-brand" />
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>
                )}

                {billing?.testMode ? (
                  <div className="flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/40 px-3 py-2.5 text-[10px] leading-5 text-[#6f551d]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    پرداخت این محیط آزمایشی است. برای فعال‌سازی واقعی، اتصال
                    درگاه معتبر لازم است.
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-hairline bg-muted/40 px-3 py-2.5 text-[10px] leading-5 text-ink-soft">
                    <CreditCard className="mt-0.5 size-3.5 shrink-0" />
                    درگاه پرداخت واقعی هنوز فعال نشده است. پس از اتصال، همین
                    مسیر برای پرداخت امن استفاده می‌شود.
                  </div>
                )}

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                  <Button
                    className="h-11 flex-1 gap-2 rounded-xl text-[12px] font-bold"
                    onClick={createWorkspaceAndInvoice}
                    disabled={busy !== null || !selectedPlan}
                  >
                    {busy === "workspace" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    ساخت فضای کاری و ادامه به پرداخت
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl text-[11px]"
                    onClick={() => setStep("details")}
                    disabled={busy !== null}
                  >
                    <ArrowRight className="size-4" />
                    بازگشت
                  </Button>
                </div>
              </div>
            ) : null}

            {step === "payment" ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-black leading-tight text-ink sm:text-[28px]">
                    پرداخت و فعال‌سازی اشتراک
                  </h1>
                  <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                    فضای کاری «{details.businessName}» ساخته شد. تا تأیید پرداخت،
                    اشتراک در وضعیت «در انتظار پرداخت» می‌ماند و امکان ثبت
                    اطلاعات جدید ندارد.
                  </p>
                </div>
                {invoice ? (
                  <div className="rounded-2xl border border-hairline/70 bg-background/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-ink-soft">
                        شماره فاکتور
                      </span>
                      <span className="num font-mono text-[10px] text-ink">
                        {invoice.number}
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-hairline/60 pt-3">
                      <span className="text-[11px] text-ink-soft">
                        مبلغ قابل پرداخت
                      </span>
                      <span className="num text-xl font-black text-ink">
                        {formatNumber(invoice.amountToman)}
                        <span className="ms-1 font-sans text-[10px] font-normal text-ink-soft">
                          تومان
                        </span>
                      </span>
                    </div>
                  </div>
                ) : null}

                {billing?.testMode ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-gold/30 bg-gold-soft/40 px-3 py-2.5 text-[10px] leading-5 text-[#6f551d]">
                      این پرداخت شبیه‌سازی‌شده است و هیچ مبلغی از حساب شما کسر
                      نمی‌شود. برای تست مسیر ناموفق هم می‌توانید یکی از دکمه‌ها را
                      انتخاب کنید.
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        className="h-11 gap-2 rounded-xl text-[12px] font-bold"
                        onClick={() => simulatePayment("success")}
                        disabled={busy !== null}
                      >
                        {busy === "payment" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CreditCard className="size-4" />
                        )}
                        تأیید پرداخت آزمایشی موفق
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 gap-2 rounded-xl text-[11px]"
                        onClick={() => simulatePayment("failed")}
                        disabled={busy !== null}
                      >
                        شبیه‌سازی پرداخت ناموفق
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-hairline bg-muted/40 p-4 text-[11px] leading-6 text-ink-soft">
                    درگاه پرداخت واقعی هنوز متصل و آزمایش نشده است؛ بنابراین
                    پرداخت واقعی در این نسخه فعال نیست. برای هماهنگی با پشتیبانی
                    تماس بگیرید.
                  </div>
                )}

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive"
                  >
                    {error}
                  </p>
                ) : null}

                <p className="text-[9px] leading-5 text-ink-soft">
                  با پرداخت،{" "}
                  <Link
                    to="/legal/renewal"
                    className="text-brand underline-offset-4 hover:underline"
                  >
                    شرایط تمدید
                  </Link>{" "}
                  و{" "}
                  <Link
                    to="/legal/refund"
                    className="text-brand underline-offset-4 hover:underline"
                  >
                    شرایط بازپرداخت
                  </Link>{" "}
                  را می‌پذیرید.
                </p>
              </div>
            ) : null}

            {step === "done" ? (
              <div className="flex flex-col items-center py-6 text-center">
                <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-brand">
                  <CheckCircle2 className="size-8" />
                </span>
                <h1 className="mt-5 text-[24px] font-black text-ink">
                  اشتراک شما فعال شد
                </h1>
                <p className="mt-2 max-w-sm text-[11px] leading-6 text-ink-soft">
                  فضای کاری «{details.businessName}» آماده است. فاکتور و تاریخچه
                  پرداخت در بخش «اشتراک من» قابل مشاهده و پیگیری است.
                </p>
                <div className="mt-5 w-full max-w-sm rounded-2xl border border-hairline/70 bg-background/50 p-3 text-start">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-ink-soft">پلن</span>
                    <span className="font-semibold text-ink">
                      {selectedPlan?.name ?? "اشتراک حساب ویرا"}
                    </span>
                  </div>
                  {invoice ? (
                    <div className="mt-2 flex items-center justify-between text-[10px]">
                      <span className="text-ink-soft">فاکتور</span>
                      <span className="num font-mono text-[9px]">
                        {invoice.number}
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between text-[10px]">
                    <span className="text-ink-soft">وضعیت</span>
                    <Badge
                      variant="outline"
                      className="border-brand/25 bg-brand-soft text-brand"
                    >
                      {testSucceeded ? "پرداخت‌شده — آزمایشی" : "پرداخت‌شده"}
                    </Badge>
                  </div>
                </div>
                <Button
                  className="mt-6 h-11 w-full max-w-sm gap-2 rounded-xl text-[12px] font-bold"
                  onClick={() => navigate("/dashboard", { replace: true })}
                >
                  ورود به داشبورد
                  <ArrowLeft className="size-4" />
                </Button>
                <Link
                  to="/legal/support"
                  className="mt-3 text-[10px] text-ink-soft hover:text-ink"
                >
                  نیاز به کمک دارم
                </Link>
              </div>
            ) : null}
          </div>

          {step !== "done" ? (
            <p className="mt-4 px-2 text-center text-[10px] leading-5 text-ink-soft">
              با ادامه،{" "}
              <Link to="/legal/terms" className="text-brand hover:underline">
                قوانین استفاده
              </Link>{" "}
              و{" "}
              <Link to="/legal/privacy" className="text-brand hover:underline">
                حریم خصوصی
              </Link>{" "}
              حساب ویرا را می‌پذیرید.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
