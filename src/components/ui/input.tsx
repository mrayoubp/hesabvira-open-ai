import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-ink-soft/55 selection:bg-primary selection:text-primary-foreground dark:bg-white/[0.035] border-hairline h-10 w-full min-w-0 rounded-[11px] border bg-surface px-3 py-2 text-sm text-ink shadow-[0_1px_2px_rgba(24,34,44,0.03)_inset] transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-[12px]",
        "hover:border-input focus-visible:border-brand/55 focus-visible:ring-brand/15 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/15 dark:aria-invalid:ring-destructive/25 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
