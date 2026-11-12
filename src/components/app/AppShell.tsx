import { Brand, BrandMark } from "@/components/app/Brand";
import {
  BranchSelector,
  FiscalYearSelector,
  ProfileMenu,
  WorkspaceSelector,
} from "@/components/app/HeaderSelectors";
import {
  NotificationBell,
  type NotificationFeed,
} from "@/components/app/NotificationBell";
import {
  GlobalSearchDialog,
  SearchTrigger,
} from "@/components/app/GlobalSearchDialog";
import { NAV_GROUPS } from "@/components/app/navigation";
import { Sidebar, SidebarContent } from "@/components/app/Sidebar";
import { TelemetryBridge } from "@/components/app/TelemetryBridge";
import { WorkspaceLoader } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatJalaliLong } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { CreditCard, Menu, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

const SIDEBAR_KEY = "hv.sidebar.collapsed";

export function AppShell() {
  const {
    workspace,
    businessId,
    branchId,
    fiscalYearId,
    currency,
    canWrite,
    subscription,
    isLoading,
    isProvisioning,
    error,
  } = useWorkspace();

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const noteSession = useMutation(api.system.noteSession);
  const sessionNoted = useRef(false);

  useEffect(() => {
    if (!businessId || sessionNoted.current) return;
    sessionNoted.current = true;
    void noteSession({
      businessId,
      event: "session_start",
      userAgent: navigator.userAgent.slice(0, 240),
    }).catch(() => undefined);
  }, [businessId, noteSession]);

  const notificationFeed = useQuery(
    api.notifications.list,
    businessId ? { businessId, branchId, fiscalYearId } : "skip",
  ) as NotificationFeed | undefined;

  const unread = notificationFeed?.unreadCount ?? 0;
  const [today] = useState(() => formatJalaliLong(Date.now()));
  const currentSection =
    NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) =>
        item.end ? pathname === item.to : pathname.startsWith(item.to),
      )
      .sort((a, b) => b.to.length - a.to.length)[0]?.label ?? "داشبورد";

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (isLoading || (!workspace && !error) || (!workspace && isProvisioning)) {
    return (
      <div className="min-h-screen bg-background">
        <WorkspaceLoader />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-[26px] border border-hairline/80 bg-surface p-6 text-center shadow-[0_30px_70px_-45px_rgba(15,81,63,0.4)]">
          <Brand asLink={false} className="justify-center" />
          <span className="mx-auto mt-5 block h-px w-16 bg-gradient-to-l from-transparent via-gold/60 to-transparent" />
          <h1 className="mt-4 text-sm font-bold text-ink">
            فضای کاری هنوز ساخته نشده است
          </h1>
          <p className="mt-2 text-[11px] leading-6 text-ink-soft">
            {error ??
              "برای شروع، اطلاعات کسب‌وکار را ثبت کنید و پلن اشتراک خود را انتخاب کنید."}
          </p>
          <Button asChild className="mt-5">
            <Link to="/signup">تکمیل ثبت‌نام و انتخاب پلن</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TelemetryBridge businessId={businessId} />
      <header className="sticky top-0 z-40 border-b border-hairline/75 bg-background/95 px-3 backdrop-blur-xl dark:border-white/[0.07] dark:bg-background/90 sm:px-5">
        <div className="mx-auto max-w-[1520px]">
          <div className="flex h-[68px] items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-cream/60 hover:text-ink dark:hover:bg-white/[0.06] lg:hidden"
              aria-label="باز کردن منوی موبایل"
            >
              <Menu className="size-5" />
            </button>

            <Link
              to="/dashboard"
              className="flex items-center gap-2.5 rounded-xl transition-opacity hover:opacity-85"
              aria-label="داشبورد حساب ویرا"
            >
              <BrandMark className="sm:hidden" />
              <Brand asLink={false} className="hidden sm:flex" />
            </Link>

            <span
              className="mx-1 hidden h-7 w-px bg-hairline/70 md:block"
              aria-hidden
            />

            <div className="hidden md:block">
              <WorkspaceSelector />
            </div>
            <div className="hidden xl:block">
              <BranchSelector />
            </div>
            <div className="hidden xl:block">
              <FiscalYearSelector />
            </div>

            <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
              <SearchTrigger
                onClick={() => setSearchOpen(true)}
                className="hidden h-9 w-[clamp(160px,18vw,260px)] px-2.5 lg:flex"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-cream/60 hover:text-ink dark:hover:bg-white/[0.06] lg:hidden"
                aria-label="جستجوی سراسری"
              >
                <Search className="size-[17px]" />
              </button>

              <NotificationBell
                businessId={businessId}
                feed={notificationFeed}
                isLoading={!notificationFeed}
              />

              <span
                className="hidden h-7 w-px bg-hairline/70 sm:block"
                aria-hidden
              />

              {canWrite ? (
                <Button
                  asChild
                  size="sm"
                  className="hidden h-9 gap-1.5 rounded-[10px] px-3 xl:inline-flex"
                >
                  <Link to="/dashboard/invoices/new">
                    <Plus className="size-3.5" />
                    فاکتور جدید
                  </Link>
                </Button>
              ) : null}

              <ProfileMenu />
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-t border-hairline/55 py-2 dark:border-white/[0.06] xl:hidden">
            <WorkspaceSelector compact />
            <BranchSelector compact />
            <FiscalYearSelector compact />
            <span className="num ms-auto hidden shrink-0 whitespace-nowrap text-[9px] text-ink-soft/75 sm:block">
              {today}
            </span>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-auto mt-2 max-w-[1520px] px-3 sm:px-5">
          <p className="rounded-xl border border-gold/25 bg-gold-soft/40 px-3 py-2 text-[9px] leading-5 text-[#7a6122] dark:text-gold">
            بخشی از تنظیمات فضای کاری آماده نشد: {error}
          </p>
        </div>
      ) : null}

      {subscription &&
      subscription.status !== "active" &&
      subscription.status !== "legacy" ? (
        <div className="mx-auto mt-2 max-w-[1520px] px-3 sm:px-5">
          <div className="flex flex-col gap-2 rounded-[16px] border border-gold/25 bg-gold-soft/40 px-4 py-3 shadow-[0_10px_30px_-26px_rgba(184,147,77,0.5)] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-bold text-[#6f551d] dark:text-gold">
                وضعیت اشتراک: {subscription.message}
              </p>
              <p className="mt-1 text-[9px] leading-5 text-ink-soft">
                مشاهده اطلاعات، گزارش‌ها و دریافت خروجی همچنان در دسترس است؛
                ثبت سند و اطلاعات جدید تا فعال‌سازی اشتراک محدود می‌شود.
              </p>
            </div>
            <Button
              asChild
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-3 text-[10px]"
            >
              <Link to="/dashboard/subscription">
                <CreditCard className="size-3.5" />
                مدیریت اشتراک
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1520px] gap-5 px-3 pb-10 pt-4 sm:px-5 lg:gap-6 lg:pt-5">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((current) => !current)}
          unreadCount={unread}
        />

        <main className="min-w-0 flex-1 pb-10">
          <div className="mb-4 flex items-center justify-between gap-2 lg:hidden">
            <p className="flex min-w-0 items-center gap-1.5 text-[10px] text-ink-soft">
              <span className="truncate">{workspace.business.name}</span>
              <span className="text-ink-soft/35">/</span>
              <span className="truncate font-semibold text-ink">{currentSection}</span>
            </p>
            {canWrite ? (
              <Button
                asChild
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-[9px] px-2.5 text-[10px]"
              >
                <Link to="/dashboard/invoices/new">
                  <Plus className="size-3.5" />
                  فاکتور جدید
                </Link>
              </Button>
            ) : null}
          </div>
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="w-[320px] gap-0 overflow-hidden border-[#1b5142] bg-[#0c392d] p-0 text-cream sm:max-w-[340px]"
        >
          <SheetTitle className="sr-only">منوی داشبورد</SheetTitle>
          <SheetDescription className="sr-only">
            ناوبری بخش‌های حساب ویرا
          </SheetDescription>
          <div className="min-h-0 flex-1">
            <SidebarContent
              showBrand
              unreadCount={unread}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
          {canWrite ? (
            <div className="border-t border-white/10 p-3">
              <Button asChild className="w-full gap-2 rounded-[11px]">
                <Link
                  to="/dashboard/invoices/new"
                  onClick={() => setMobileOpen(false)}
                >
                  <Plus className="size-4" />
                  ثبت فاکتور فروش
                </Link>
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <GlobalSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        businessId={businessId}
        currency={currency}
      />
    </div>
  );
}
