import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-hairline placeholder:text-ink-soft/55 focus-visible:border-brand/55 focus-visible:ring-brand/15 aria-invalid:ring-destructive/15 dark:aria-invalid:ring-destructive/25 aria-invalid:border-destructive flex field-sizing-content min-h-20 w-full rounded-[12px] border bg-surface px-3 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgba(24,34,44,0.03)_inset] transition-[color,box-shadow,border-color] outline-none hover:border-input focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.035] md:text-[12px]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
