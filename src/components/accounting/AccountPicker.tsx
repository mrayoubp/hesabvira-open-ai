import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AccountLevel, AccountType } from "@/convex/schema";
import {
  ACCOUNT_LEVEL_LABELS,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
} from "@/lib/accounting";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useDeferredValue, useState } from "react";

export interface AccountChoice {
  _id: string;
  code: string;
  name: string;
  level: AccountLevel;
  type: AccountType;
  active: boolean;
  postable: boolean;
  linkedEntityName?: string | null;
}

export function AccountPicker({
  accounts,
  value,
  onChange,
  disabled,
  onlyPostable = false,
  allowInactive = false,
  placeholder = "انتخاب حساب…",
  className,
  id,
}: {
  accounts: AccountChoice[];
  value: string | null;
  onChange: (accountId: string) => void;
  disabled?: boolean;
  onlyPostable?: boolean;
  allowInactive?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const selected = accounts.find((account) => account._id === value) ?? null;
  const needle = deferredSearch.trim().toLowerCase();

  const filtered = accounts
    .filter((account) => (onlyPostable ? account.postable : true))
    .filter((account) => allowInactive || account.active)
    .filter((account) => {
      if (!needle) return true;
      return [account.code, account.name, account.linkedEntityName]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle));
    });

  const groups = ACCOUNT_TYPE_ORDER.map((type) => ({
    type,
    rows: filtered
      .filter((account) => account.type === type)
      .sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      ),
  })).filter((group) => group.rows.length > 0);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between rounded-xl border-hairline bg-background px-2.5 text-start text-[10px] font-normal",
            !selected && "text-ink-soft",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {selected ? (
              <>
                <span className="num font-semibold text-ink">
                  {selected.code}
                </span>
                <span className="mx-1 text-ink-soft">·</span>
                {selected.name}
              </>
            ) : (
              placeholder
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {selected && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                className="rounded p-0.5 text-ink-soft hover:text-ink"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    onChange("");
                  }
                }}
                aria-label="پاک کردن حساب"
              >
                <X className="size-3" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-3 text-ink-soft" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(360px,var(--radix-popover-trigger-width))] overflow-hidden rounded-2xl border-white/70 bg-card/98 p-0 shadow-xl backdrop-blur-xl dark:border-white/10"
      >
        <div className="relative border-b border-hairline/60 p-2">
          <Search className="pointer-events-none absolute end-4 top-1/2 size-3 -translate-y-1/2 text-ink-soft" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="کد یا نام حساب…"
            autoFocus
            className="h-8 rounded-lg border-hairline bg-background pe-7 text-[10px]"
            aria-label="جستجوی حساب"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-[10px] text-ink-soft">
              حسابی با این عبارت پیدا نشد.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="mb-1">
                <p className="px-2 py-1 text-[8px] font-semibold text-gold">
                  {ACCOUNT_TYPE_LABELS[group.type]}
                </p>
                {group.rows.map((account) => {
                  const disabledRow = onlyPostable
                    ? !account.postable || (!account.active && !allowInactive)
                    : !account.active && !allowInactive;
                  const active = account._id === value;
                  return (
                    <button
                      key={account._id}
                      type="button"
                      disabled={disabledRow}
                      onClick={() => {
                        onChange(account._id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
                        active
                          ? "bg-brand-soft text-brand"
                          : "hover:bg-cream/60 dark:hover:bg-white/[0.05]",
                        disabledRow && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="num w-14 shrink-0 font-mono text-[9px] font-semibold">
                        {account.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] text-ink">
                          {account.name}
                        </span>
                        <span className="block truncate text-[8px] text-ink-soft">
                          {ACCOUNT_LEVEL_LABELS[account.level]}
                          {account.linkedEntityName
                            ? ` · ${account.linkedEntityName}`
                            : ""}
                          {!account.active ? " · غیرفعال" : ""}
                        </span>
                      </span>
                      {active ? <Check className="size-3 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        {onlyPostable ? (
          <p className="border-t border-hairline/60 px-3 py-1.5 text-[8px] text-ink-soft">
            فقط حساب‌های تفصیلی فعال قابل انتخاب‌اند.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
