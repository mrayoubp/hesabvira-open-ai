import type { InvoiceStatus } from "@/convex/schema";
import { INVOICE_STATUS_META } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Panel({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative rounded-[22px] border border-hairline/80 bg-surface shadow-[0_1px_2px_rgba(24,34,44,0.03),0_22px_50px_-42px_rgba(15,81,63,0.3)] dark:border-white/[0.08] dark:bg-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <span className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.12em] text-gold">
            <span className="h-px w-4 bg-gold/60" aria-hidden />
            {eyebrow}
          </span>
        ) : null}
        <h2 className="truncate text-[15px] font-extrabold leading-6 text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-ink-soft">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow = "فضای کاری مالی",
}: {
  /** Kept for backwards compatibility with existing pages. */
  command?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <section className="page-masthead relative overflow-hidden rounded-[24px] border border-hairline/75 px-5 py-5 shadow-[0_1px_2px_rgba(24,34,44,0.03),0_20px_48px_-42px_rgba(15,81,63,0.25)] sm:px-6 sm:py-6">
      <span
        className="pointer-events-none absolute -end-8 -top-14 size-44 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-5 end-0 w-px bg-gradient-to-b from-transparent via-gold/25 to-transparent"
        aria-hidden
      />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-[9px] font-semibold tracking-[0.14em] text-gold">
            <span className="flex size-1.5 items-center justify-center">
              <span className="size-1 rounded-full bg-gold" />
            </span>
            {eyebrow}
          </span>
          <h1 className="mt-2 text-[24px] font-black leading-[1.35] text-ink sm:text-[30px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-[12px] leading-6 text-ink-soft">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-l from-transparent via-brand/15 to-transparent"
        aria-hidden
      />
    </section>
  );
}

const accentClasses = {
  brand: {
    chip: "bg-brand-soft text-brand dark:bg-brand-soft/30",
    glow: "bg-brand/10",
    rule: "from-brand to-[#3f8b74]",
  },
  gold: {
    chip: "bg-gold-soft text-[#8a6c2c] dark:text-gold",
    glow: "bg-gold/15",
    rule: "from-gold to-[#d7bd84]",
  },
  mist: {
    chip: "bg-mist text-[#365d6e] dark:bg-mist/25 dark:text-[#a9d5e2]",
    glow: "bg-mist/50",
    rule: "from-[#6f91a3] to-[#b6cbd2]",
  },
  ink: {
    chip: "bg-cream/70 text-ink dark:bg-white/[0.06]",
    glow: "bg-cream/70",
    rule: "from-[#536170] to-[#9ba6ae]",
  },
} as const;

export function KpiCard({
  label,
  value,
  unit,
  footnote,
  accent = "brand",
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  footnote?: string;
  accent?: keyof typeof accentClasses;
  icon?: ReactNode;
}) {
  const tone = accentClasses[accent];
  return (
    <div className="group relative overflow-hidden rounded-[22px] border border-hairline/80 bg-surface p-5 shadow-[0_1px_2px_rgba(24,34,44,0.03),0_20px_46px_-42px_rgba(15,81,63,0.32)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(24,34,44,0.03),0_26px_54px_-38px_rgba(15,81,63,0.32)] dark:border-white/[0.08] dark:bg-card">
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-l opacity-80",
          tone.rule,
        )}
        aria-hidden
      />
      <span
        className={cn(
          "pointer-events-none absolute -left-8 -top-10 size-28 rounded-full blur-3xl",
          tone.glow,
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className="text-[10px] font-semibold leading-4 text-ink-soft">
          {label}
        </span>
        {icon ? (
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-[12px]",
              tone.chip,
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="num relative mt-4 text-[27px] font-bold leading-none text-ink">
        {value}
        {unit ? (
          <span className="ms-1.5 font-sans text-[10px] font-normal text-ink-soft">
            {unit}
          </span>
        ) : null}
      </p>
      {footnote ? (
        <p className="relative mt-2 text-[9px] leading-4 text-ink-soft">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus;
  className?: string;
}) {
  const meta = INVOICE_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
        meta.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="relative flex size-12 items-center justify-center rounded-[16px] border border-hairline/70 bg-gradient-to-br from-cream/55 to-brand-soft/35 text-brand">
        <span className="absolute inset-0 rounded-[16px] border border-dashed border-brand/10" />
        {icon}
      </div>
      <div>
        <p className="text-[13px] font-bold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-ink-soft">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function WorkspaceLoader({
  label = "در حال آماده‌سازی فضای کاری",
}: {
  label?: string;
}) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5">
      <div className="relative flex size-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-[18px] bg-brand/10" />
        <span className="relative flex size-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-brand to-brand-deep font-sans text-xl font-black text-cream shadow-[0_18px_35px_-20px_rgba(15,81,63,0.8)]">
          و
        </span>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold text-ink">{label}</p>
        <p className="mt-1 text-[10px] text-ink-soft">
          اتصال امن به فضای کاری برقرار می‌شود…
        </p>
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-cream">
        <div className="animate-shimmer h-full w-2/3 rounded-full bg-gradient-to-l from-brand via-gold to-brand" />
      </div>
    </div>
  );
}
