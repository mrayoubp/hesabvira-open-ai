import { Brand } from "@/components/app/Brand";
import {
  NAV_GROUPS,
  type NavGroup,
  type NavItem,
} from "@/components/app/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";

function itemMatches(item: NavItem, pathname: string) {
  return item.end ? pathname === item.to : pathname.startsWith(item.to);
}

function NavRow({
  item,
  collapsed,
  unreadCount,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  unreadCount: number;
  onNavigate?: () => void;
}) {
  const count = item.count === "notifications" ? unreadCount : 0;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center rounded-[11px] text-[11.5px] transition-all duration-200",
          collapsed
            ? "mx-auto size-10 justify-center"
            : "min-h-[38px] gap-2.5 px-2.5 py-1.5",
          isActive
            ? "bg-cream text-brand-deep shadow-[0_8px_18px_-12px_rgba(0,0,0,0.65)]"
            : "text-[#c3d4cc] hover:bg-white/[0.055] hover:text-cream",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-[9px] transition-colors",
              isActive
                ? "bg-brand/[0.09] text-brand"
                : "bg-white/[0.045] text-[#9fbbb0] group-hover:bg-white/[0.07] group-hover:text-gold",
            )}
          >
            <item.icon className="size-[15px]" />
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.label}
              </span>
              {item.soon ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[7.5px] font-semibold",
                    isActive
                      ? "bg-brand/[0.07] text-brand"
                      : "bg-white/[0.06] text-cream/45",
                  )}
                >
                  به‌زودی
                </span>
              ) : null}
              {count > 0 ? (
                <span
                  className={cn(
                    "num min-w-4 rounded-full px-1 py-0.5 text-center text-[8px] font-bold",
                    isActive
                      ? "bg-brand text-cream"
                      : "bg-gold text-brand-deep",
                  )}
                  aria-label={`${count} اعلان خوانده‌نشده`}
                >
                  {count.toLocaleString("fa-IR")}
                </span>
              ) : null}
            </>
          ) : count > 0 ? (
            <span className="absolute end-1 top-1 size-1.5 rounded-full bg-gold ring-2 ring-[#0d3b2e]" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function NavGroups({
  groups,
  collapsed,
  unreadCount,
  pathname,
  openGroups,
  toggleGroup,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  unreadCount: number;
  pathname: string;
  openGroups: Record<string, boolean>;
  toggleGroup: (id: string) => void;
  onNavigate?: () => void;
}) {
  if (collapsed) {
    return (
      <div className="space-y-1">
        {groups.map((group, groupIndex) => (
          <div key={group.id}>
            {groupIndex > 0 ? (
              <div className="mx-2 my-2 h-px bg-white/[0.07]" />
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavRow
                  key={item.to}
                  item={item}
                  collapsed
                  unreadCount={unreadCount}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const groupActive = group.items.some((item) =>
          itemMatches(item, pathname),
        );
        const isOpen = openGroups[group.id] !== false || groupActive;
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isOpen}
              className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 pb-1 pt-0.5 text-[8.5px] font-medium tracking-[0.02em] text-[#7fa196] transition-colors hover:text-cream/85"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-[3px] rotate-45 rounded-[1px]",
                    groupActive ? "bg-gold" : "bg-white/15",
                  )}
                  aria-hidden
                />
                {group.label}
              </span>
              <ChevronDown
                className={cn(
                  "size-3 opacity-40 transition-transform duration-200 group-hover:opacity-80",
                  isOpen ? "" : "-rotate-90",
                )}
                aria-hidden
              />
            </button>
            {isOpen ? (
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavRow
                    key={item.to}
                    item={item}
                    collapsed={false}
                    unreadCount={unreadCount}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SidebarContent({
  collapsed = false,
  unreadCount = 0,
  onToggle,
  onNavigate,
  showBrand = false,
}: {
  collapsed?: boolean;
  unreadCount?: number;
  onToggle?: () => void;
  onNavigate?: () => void;
  showBrand?: boolean;
}) {
  const { canManage } = useWorkspace();
  const { pathname } = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    overview: true,
    sales: true,
    purchasing: true,
    accounting: true,
    treasury: false,
    hr: false,
    management: false,
  });

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.manageOnly || canManage),
      })).filter((group) => group.items.length > 0),
    [canManage],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col text-cream">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#2a705c]/35 to-transparent"
        aria-hidden
      />
      {showBrand ? (
        <div className="relative flex h-[72px] shrink-0 items-center border-b border-white/[0.08] px-4 pe-12 ps-12">
          <Brand inverse subtitle="ACCOUNTING SUITE" />
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex items-center gap-2 border-b border-white/[0.07] px-3 py-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed ? (
          <div className="min-w-0 ps-1">
            <p className="text-[7.5px] font-medium tracking-[0.16em] text-cream/40">
              WORKSPACE
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-cream/85">
              <Sparkles className="size-3 text-gold" aria-hidden />
              فضای کاری حساب ویرا
            </p>
          </div>
        ) : null}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.035] text-cream/55 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-cream"
            aria-label={collapsed ? "باز کردن منوی کناری" : "جمع کردن منوی کناری"}
            title={collapsed ? "باز کردن منو" : "جمع کردن منو"}
          >
            {collapsed ? (
              <ChevronsLeft className="size-4" />
            ) : (
              <ChevronsRight className="size-4" />
            )}
          </button>
        ) : null}
      </div>

      <nav
        aria-label="منوی اصلی"
        className={cn(
          "sidebar-scroll min-h-0 flex-1 overflow-y-auto py-3.5",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        <NavGroups
          groups={groups}
          collapsed={collapsed}
          unreadCount={unreadCount}
          pathname={pathname}
          openGroups={openGroups}
          toggleGroup={(id) =>
            setOpenGroups((current) => ({
              ...current,
              [id]: current[id] === false,
            }))
          }
          onNavigate={onNavigate}
        />
      </nav>

      {!collapsed ? (
        <div className="relative border-t border-white/[0.07] p-3">
          <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[8.5px] font-medium text-cream/55">
                <span className="size-1 rounded-full bg-gold" />
                مجموعه مالی یکپارچه
              </span>
              <span className="rounded-full border border-gold/20 bg-gold/[0.08] px-1.5 py-0.5 text-[7.5px] font-semibold text-gold">
                حرفه‌ای
              </span>
            </div>
            <p className="mt-2 text-[8.5px] leading-[1.9] text-cream/35">
              حسابداری، فروش، خرید و خزانه در یک فضای کاری امن و یکپارچه.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  unreadCount,
}: {
  collapsed: boolean;
  onToggle: () => void;
  unreadCount: number;
}) {
  return (
    <aside
      className={cn(
        "sticky top-[126px] hidden shrink-0 self-start lg:block xl:top-[86px]",
        collapsed ? "w-[74px]" : "w-[264px]",
        "transition-[width] duration-300 ease-out",
      )}
      aria-label="نوار کناری"
    >
      <div className="sidebar-sheen relative max-h-[calc(100vh-8.5rem)] overflow-hidden rounded-[22px] border border-[#1b5142] bg-[#0c392d] shadow-[0_28px_65px_-38px_rgba(8,40,31,0.75)] xl:max-h-[calc(100vh-6.5rem)]">
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/20 to-transparent"
          aria-hidden
        />
        <SidebarContent
          collapsed={collapsed}
          onToggle={onToggle}
          unreadCount={unreadCount}
        />
      </div>
    </aside>
  );
}
