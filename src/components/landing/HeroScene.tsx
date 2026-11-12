import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import type { PointerEvent } from "react";
import { useRef } from "react";

const months = ["مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const recentInvoices = [
  { number: "INV-0042", name: "فروشگاه آفتاب", total: "۵,۴۸۰,۰۰۰", paid: true },
  { number: "INV-0041", name: "کافه رُز", total: "۲,۹۵۰,۰۰۰", paid: false },
];

const kpis = [
  { label: "مطالبات", value: "۱۲.۶M", icon: CircleDollarSign },
  { label: "مشتریان", value: "۲۴", icon: Users },
  { label: "نرخ تسویه", value: "۸۲٪", icon: TrendingUp },
];

export function HeroScene() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const spring = { stiffness: 90, damping: 20, mass: 0.6 };
  const rotateY = useSpring(
    useTransform(pointerX, [-0.5, 0.5], [-7, 7]),
    spring,
  );
  const rotateX = useSpring(
    useTransform(pointerY, [-0.5, 0.5], [5, -5]),
    spring,
  );

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  const resetTilt = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <div
      ref={ref}
      className="relative mx-auto w-full max-w-[520px] select-none px-3 py-8 sm:px-0"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      aria-hidden
    >
      {/* warm light behind the scene */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-8 top-10 h-72 rounded-full bg-mist/70 blur-3xl" />
        <div className="absolute bottom-10 start-0 size-56 rounded-full bg-gold/20 blur-3xl" />
      </div>

      <div className="[perspective:1500px]">
        <motion.div
          initial={{ opacity: 0, y: 36, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
          style={{
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
          }}
          className="relative"
        >
          {/* perspective floor */}
          <div
            className="depth-grid pointer-events-none absolute -inset-x-24 -bottom-24 h-64 opacity-70"
            style={{ transform: "rotateX(76deg) translateZ(-90px)" }}
          />

          {/* coin */}
          <div
            className="absolute -bottom-7 start-2 z-30 hidden sm:block"
            style={{ transform: "translateZ(90px)" }}
          >
            <div className="animate-float-slower relative flex size-[74px] items-center justify-center rounded-full bg-gradient-to-br from-[#e8d29c] via-gold to-[#8f6f2c] shadow-[0_22px_35px_-16px_rgba(150,118,47,0.9)] ring-1 ring-white/40">
              <div className="flex size-[54px] items-center justify-center rounded-full border border-[#7c5f22]/30 bg-gradient-to-br from-[#d9bd82] to-[#b19045] font-sans text-xl font-black text-[#4d3a12]">
                و
              </div>
              <span className="absolute inset-0 rounded-full border border-white/30" />
            </div>
          </div>

          {/* main dashboard card */}
          <div
            className="relative z-10 overflow-hidden rounded-[30px] border border-white/80 bg-white/90 shadow-[0_45px_100px_-45px_rgba(22,58,46,0.6)] backdrop-blur-xl"
            style={{ transform: "translateZ(18px)" }}
          >
            <div className="flex items-center justify-between border-b border-ink/5 bg-white/60 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-deep font-sans text-sm font-black text-cream">
                  و
                </span>
                <div className="min-w-0">
                  <p className="max-w-[150px] truncate text-[11px] font-bold leading-4 text-ink">
                    فضای کاری فروشگاه آفتاب
                  </p>
                  <p className="font-mono text-[8px] tracking-[0.16em] text-ink-soft">
                    HESAB VIRA / DEMO
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="hidden rounded-full bg-brand-soft px-2 py-1 text-[9px] font-semibold text-brand sm:inline-flex">
                  مدیر مالی
                </span>
                <span className="flex size-7 items-center justify-center rounded-full bg-cream text-[10px] font-bold text-ink">
                  آ
                </span>
              </div>
            </div>

            <div className="space-y-4 p-4 pb-5 sm:p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium text-ink-soft">
                    موجودی نقد و بانک
                  </p>
                  <p className="num mt-1 text-[26px] font-bold leading-none text-ink">
                    ۱۲۸,۴۵۰,۰۰۰
                    <span className="ms-1.5 font-sans text-[10px] font-normal text-ink-soft">
                      تومان
                    </span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-1 text-[9px] font-bold text-brand">
                  <ArrowUpRight className="size-3" />
                  ۱۸٪
                </span>
              </div>

              <div className="relative rounded-2xl border border-ink/5 bg-gradient-to-b from-[#f4f8f4] to-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-ink">
                    روند فروش شش دوره
                  </p>
                  <span className="flex items-center gap-1 text-[9px] text-ink-soft">
                    <span className="size-1.5 rounded-full bg-gold" />
                    دوره جاری
                  </span>
                </div>
                <svg
                  viewBox="0 0 340 108"
                  className="mt-2 h-[104px] w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="presentation"
                >
                  <defs>
                    <linearGradient id="heroArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#245C49" stopOpacity="0.26" />
                      <stop offset="100%" stopColor="#245C49" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[24, 54, 84].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="340"
                      y1={y}
                      y2={y}
                      stroke="#26352E"
                      strokeOpacity="0.06"
                      strokeDasharray="3 5"
                    />
                  ))}
                  <path
                    d="M340,90 C316,86 300,70 276,74 C250,79 236,50 208,56 C180,62 166,34 134,42 C104,49 86,20 54,29 C34,34 16,16 0,12 L0,108 L340,108 Z"
                    fill="url(#heroArea)"
                  />
                  <path
                    d="M340,90 C316,86 300,70 276,74 C250,79 236,50 208,56 C180,62 166,34 134,42 C104,49 86,20 54,29 C34,34 16,16 0,12"
                    fill="none"
                    stroke="#245C49"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <circle cx="0" cy="12" r="7" fill="#C5A45B" opacity="0.16" />
                  <circle cx="0" cy="12" r="3.4" fill="#C5A45B" />
                </svg>
                <div className="mt-1 flex justify-between text-[8px] text-ink-soft">
                  {months.map((month) => (
                    <span key={month}>{month}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {kpis.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-ink/5 bg-white p-2.5 shadow-[0_1px_0_rgba(38,53,46,0.03)]"
                  >
                    <div className="flex items-center gap-1 text-[9px] text-ink-soft">
                      <item.icon className="size-3 text-brand" />
                      {item.label}
                    </div>
                    <p className="num mt-1 text-xs font-bold text-ink">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {recentInvoices.map((invoice) => (
                  <div
                    key={invoice.number}
                    className="flex items-center justify-between gap-2 rounded-xl bg-cream/35 px-2.5 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white text-brand shadow-sm">
                        <CircleDollarSign className="size-3" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold text-ink">
                          {invoice.name}
                        </p>
                        <p className="num text-[8px] text-ink-soft">
                          {invoice.number}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num text-[10px] font-semibold text-ink">
                        {invoice.total}
                      </span>
                      <span
                        className={
                          invoice.paid
                            ? "rounded-full bg-brand/10 px-1.5 py-0.5 text-[8px] font-bold text-brand"
                            : "rounded-full bg-gold/15 px-1.5 py-0.5 text-[8px] font-bold text-[#806421]"
                        }
                      >
                        {invoice.paid ? "پرداخت شد" : "در انتظار"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* floating success card */}
          <div
            className="pointer-events-none absolute -start-2 top-[26%] z-20 hidden sm:block"
            style={{ transform: "translateZ(70px)" }}
          >
            <div className="animate-float-slow rounded-2xl border border-white/80 bg-white/90 p-3 shadow-[0_24px_45px_-20px_rgba(22,58,46,0.35)] backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-xl bg-brand text-cream">
                  <BadgeCheck className="size-4" />
                </span>
                <div>
                  <p className="text-[10px] font-bold text-ink">فاکتور صادر شد</p>
                  <p className="num text-[8px] text-ink-soft">
                    INV-0042 · متوازن
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* floating monthly card */}
          <div
            className="pointer-events-none absolute -end-1 bottom-[24%] z-20 hidden sm:block"
            style={{ transform: "translateZ(110px)" }}
          >
            <div className="animate-float-slower w-[136px] rounded-2xl bg-gradient-to-br from-[#2f725b] to-brand-deep p-3 text-cream shadow-[0_30px_55px_-25px_rgba(22,58,46,0.8)]">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-cream/65">فروش این ماه</span>
                <Sparkles className="size-3 text-gold" />
              </div>
              <p className="num mt-2 text-lg font-bold leading-none">۴۸.۲M</p>
              <div className="mt-2 flex items-center gap-1 text-[8px] text-gold">
                <TrendingUp className="size-2.5" />
                رشد ۲۴٪ نسبت به ماه قبل
              </div>
            </div>
          </div>

          {/* security chip */}
          <div
            className="pointer-events-none absolute end-0 bottom-[4%] z-20 hidden lg:block"
            style={{ transform: "translateZ(50px)" }}
          >                <div className="animate-float-slow flex items-center gap-1.5 rounded-full border border-white/80 bg-white/85 px-2.5 py-1.5 text-[9px] font-semibold text-ink shadow-lg backdrop-blur">
              <ShieldCheck className="size-3 text-brand" />
              داده‌ها فقط در فضای کاری شما
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
