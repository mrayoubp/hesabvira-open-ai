import { cn } from "@/lib/utils";
import { Link } from "react-router";

export function BrandMark({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] shadow-[0_10px_22px_-13px_rgba(8,40,31,0.9)] ring-1 ring-inset",
        inverse
          ? "bg-cream text-brand-deep ring-gold/40"
          : "bg-gradient-to-br from-[#3a806a] via-brand to-[#0a3529] text-cream ring-white/10",
        className,
      )}
      aria-hidden
    >
      <span className="absolute inset-x-2 top-1.5 h-px bg-white/20" />
      <span className="font-sans text-[19px] font-black leading-none">و</span>
      <span
        className={cn(
          "absolute start-2 top-2 size-1 rounded-full",
          inverse ? "bg-gold" : "bg-gold",
        )}
      />
      <span className="absolute inset-x-2 bottom-1.5 h-px bg-cream/25" />
    </span>
  );
}

export function Brand({
  className,
  subtitle = "HESAB VIRA",
  asLink = true,
  inverse = false,
}: {
  className?: string;
  subtitle?: string;
  asLink?: boolean;
  inverse?: boolean;
}) {
  const content = (
    <>
      <BrandMark inverse={inverse} />
      <span className="leading-none">
        <span
          className={cn(
            "block font-sans text-[17px] font-black tracking-[-0.01em]",
            inverse ? "text-cream" : "text-ink",
          )}
        >
          حساب ویرا
        </span>
        <span
          className={cn(
            "mt-[5px] block font-mono text-[7px] tracking-[0.32em]",
            inverse ? "text-cream/40" : "text-ink-soft/70",
          )}
        >
          {subtitle}
        </span>
      </span>
    </>
  );

  if (!asLink) {
    return (
      <span className={cn("flex items-center gap-2.5", className)}>
        {content}
      </span>
    );
  }

  return (
    <Link
      to="/"
      className={cn(
        "flex items-center gap-2.5 rounded-2xl transition-opacity hover:opacity-85",
        className,
      )}
      aria-label="حساب ویرا — صفحه اصلی"
    >
      {content}
    </Link>
  );
}
