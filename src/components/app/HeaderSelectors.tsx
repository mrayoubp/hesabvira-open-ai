import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { MEMBER_ROLE_LABELS, formatJalali } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Bell,
  Building2,
  CalendarRange,
  Check,
  ChevronDown,
  CreditCard,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useTheme } from "next-themes";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useNavigate } from "react-router";

const triggerClass =
  "flex h-9 items-center gap-1.5 rounded-[10px] border border-hairline/80 bg-surface/75 px-2.5 text-ink transition-[background-color,border-color] hover:border-brand/20 hover:bg-brand-soft/30 dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.07]";

interface SelectorTriggerProps extends ComponentPropsWithoutRef<"button"> {
  icon: typeof Building2;
  caption: string;
  value: string;
  compact?: boolean;
  ariaLabel: string;
}

const SelectorTrigger = forwardRef<HTMLButtonElement, SelectorTriggerProps>(
  function SelectorTrigger(
    { icon: Icon, caption, value, compact = false, ariaLabel, className, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(triggerClass, compact && "px-2", className)}
        aria-label={ariaLabel}
        {...rest}
      >
        <Icon className="size-3.5 shrink-0 text-brand/80" />
        <span className="min-w-0 text-start">
          {!compact ? (
            <span className="block text-[7.5px] leading-3 text-ink-soft/70">
              {caption}
            </span>
          ) : null}
          <span className="block max-w-[8rem] truncate text-[10px] font-semibold leading-4">
            {value}
          </span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-ink-soft" />
      </button>
    );
  },
);

export function WorkspaceSelector({ compact = false }: { compact?: boolean }) {
  const { workspaces, workspace, setBusinessId } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectorTrigger
          icon={Building2}
          caption="کسب‌وکار"
          value={workspace?.business.name ?? "در حال آماده‌سازی"}
          compact={compact}
          ariaLabel="انتخاب کسب‌وکار"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="px-2 py-1.5 text-[9px] text-ink-soft">
          کسب‌وکار فعال
        </DropdownMenuLabel>
        {workspaces.map((item) => (
          <DropdownMenuItem
            key={item.business._id}
            onSelect={() => setBusinessId(item.business._id)}
            className="gap-2 rounded-lg px-2 py-2 text-xs"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Building2 className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{item.business.name}</span>
              <span className="mt-0.5 block text-[9px] text-ink-soft">
                {MEMBER_ROLE_LABELS[item.role]}
              </span>
            </span>
            {workspace?.business._id === item.business._id ? (
              <Check className="size-3.5 text-brand" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[9px] text-ink-soft">
          هر کسب‌وکار داده‌های مالی جداگانه دارد.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BranchSelector({ compact = false }: { compact?: boolean }) {
  const { branches, activeBranch, setBranchId } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectorTrigger
          icon={MapPin}
          caption="شعبه"
          value={activeBranch?.name ?? "شعبه اصلی"}
          compact={compact}
          ariaLabel="انتخاب شعبه"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="px-2 py-1.5 text-[9px] text-ink-soft">
          محدوده شعبه
        </DropdownMenuLabel>
        {branches.length === 0 ? (
          <p className="px-2 py-2 text-[10px] leading-5 text-ink-soft">
            شعبه‌ای ثبت نشده است.
          </p>
        ) : (
          branches.map((branch) => (
            <DropdownMenuItem
              key={branch._id}
              onSelect={() => setBranchId(branch._id)}
              className="gap-2 rounded-lg px-2 py-2 text-xs"
            >
              <MapPin className="size-3.5 text-brand" />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
              {branch.isPrimary ? (
                <span className="text-[8px] text-ink-soft">اصلی</span>
              ) : null}
              {activeBranch?._id === branch._id ? (
                <Check className="size-3.5 text-brand" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FiscalYearSelector({ compact = false }: { compact?: boolean }) {
  const { fiscalYears, activeFiscalYear, setFiscalYearId } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectorTrigger
          icon={CalendarRange}
          caption="دوره مالی"
          value={activeFiscalYear?.name ?? "دوره جاری"}
          compact={compact}
          ariaLabel="انتخاب دوره مالی"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="px-2 py-1.5 text-[9px] text-ink-soft">
          دوره مالی
        </DropdownMenuLabel>
        {fiscalYears.length === 0 ? (
          <p className="px-2 py-2 text-[10px] leading-5 text-ink-soft">
            دوره مالی هنوز ساخته نشده است.
          </p>
        ) : (
          fiscalYears.map((year) => (
            <DropdownMenuItem
              key={year._id}
              onSelect={() => setFiscalYearId(year._id)}
              className="gap-2 rounded-lg px-2 py-2 text-xs"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  year.status === "open" ? "bg-brand" : "bg-ink-soft/50",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{year.name}</span>
                <span className="mt-0.5 block text-[8px] text-ink-soft">
                  {formatJalali(year.startAt)} تا {formatJalali(year.endAt)}
                </span>
              </span>
              <span className="text-[8px] text-ink-soft">
                {year.status === "open" ? "باز" : "بسته"}
              </span>
              {activeFiscalYear?._id === year._id ? (
                <Check className="size-3.5 text-brand" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProfileMenu() {
  const { user, role, canManage, businessId } = useWorkspace();
  const { signOut } = useAuth();
  const noteSession = useMutation(api.system.noteSession);
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isPlatformAdmin = useQuery(api.platform.amIPlatformAdmin);

  const displayName = user?.name?.trim() || user?.email || "حساب مهمان";
  const initial = displayName.trim().charAt(0) || "و";
  const isDark = resolvedTheme === "dark";

  const handleSignOut = async () => {
    if (businessId) {
      await noteSession({
        businessId,
        event: "logout",
        userAgent: navigator.userAgent.slice(0, 240),
      }).catch(() => undefined);
    }
    await signOut();
    navigate("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full p-0.5 transition-opacity hover:opacity-85"
          aria-label="منوی پروفایل"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-[11px] font-bold text-cream shadow-[0_8px_18px_-12px_rgba(15,81,63,0.9)] ring-2 ring-gold/25">
            {initial}
          </span>
          <ChevronDown className="hidden size-3 text-ink-soft sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-xs font-bold text-cream ring-2 ring-gold/20">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-ink">{displayName}</p>
            <p className="mt-0.5 text-[9px] text-ink-soft">
              {user?.isAnonymous
                ? "نشست مهمان"
                : (role && MEMBER_ROLE_LABELS[role]) || "کاربر"}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard/subscription")}
          className="gap-2 rounded-lg py-2 text-xs"
        >
          <CreditCard className="size-3.5 text-ink-soft" />
          اشتراک و صورت‌حساب
        </DropdownMenuItem>
        {canManage ? (
          <DropdownMenuItem
            onSelect={() => navigate("/dashboard/system?tab=settings")}
            className="gap-2 rounded-lg py-2 text-xs"
          >
            <UserRound className="size-3.5 text-ink-soft" />
            تنظیمات کسب‌وکار
          </DropdownMenuItem>
        ) : null}
        {isPlatformAdmin ? (
          <DropdownMenuItem
            onSelect={() => navigate("/admin/subscriptions")}
            className="gap-2 rounded-lg py-2 text-xs"
          >
            <ShieldCheck className="size-3.5 text-gold" />
            پنل مدیر سامانه
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
          className="gap-2 rounded-lg py-2 text-xs"
        >
          {isDark ? (
            <Sun className="size-3.5 text-gold" />
          ) : (
            <Moon className="size-3.5 text-ink-soft" />
          )}
          {isDark ? "حالت روشن" : "حالت تاریک"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard/notifications")}
          className="gap-2 rounded-lg py-2 text-xs"
        >
          <Bell className="size-3.5 text-ink-soft" />
          اعلان‌ها
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={handleSignOut}
          className="gap-2 rounded-lg py-2 text-xs"
        >
          <LogOut className="size-3.5" />
          خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
