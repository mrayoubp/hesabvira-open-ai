import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMutation } from "convex/react";
import {
  BadgeDollarSign,
  Bell,
  CalendarClock,
  CheckCheck,
  ChevronLeft,
  Clock3,
  FileText,
  FileWarning,
  Landmark,
  Loader2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export interface NotificationItem {
  key: string;
  type:
    | "invoice-overdue"
    | "invoice-due-soon"
    | "invoice-draft"
    | "fiscal-year"
    | "contract-expiring"
    | "leave-pending"
    | "payroll-unpaid"
    | "loan-installment"
    | "tax-due"
    | "depreciation-due"
    | "employee-docs";
  title: string;
  description: string;
  href: string;
  severity: "danger" | "warning" | "info";
  date: number;
  read: boolean;
}

export interface NotificationFeed {
  items: NotificationItem[];
  unreadCount: number;
  counts: {
    overdue: number;
    dueSoon: number;
    drafts: number;
  };
  modules: {
    inventory: boolean;
    cheques: boolean;
    supplierDebts: boolean;
    journal: boolean;
  };
}

const typeMeta = {
  "invoice-overdue": {
    icon: TriangleAlert,
    tone: "bg-destructive/10 text-destructive",
  },
  "invoice-due-soon": {
    icon: Clock3,
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "invoice-draft": {
    icon: FileText,
    tone: "bg-brand-soft text-brand",
  },
  "fiscal-year": {
    icon: CalendarClock,
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "contract-expiring": {
    icon: CalendarClock,
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "leave-pending": {
    icon: Clock3,
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "payroll-unpaid": {
    icon: Wallet,
    tone: "bg-brand-soft text-brand",
  },
  "loan-installment": {
    icon: BadgeDollarSign,
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "tax-due": {
    icon: Landmark,
    tone: "bg-destructive/10 text-destructive",
  },
  "depreciation-due": {
    icon: CalendarClock,
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "employee-docs": {
    icon: FileWarning,
    tone: "bg-destructive/10 text-destructive",
  },
} as const;

export function NotificationBell({
  businessId,
  feed,
  isLoading,
}: {
  businessId?: Id<"businesses">;
  feed: NotificationFeed | undefined;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const markRead = useMutation(api.notifications.markRead);
  const navigate = useNavigate();

  const unread = feed?.unreadCount ?? 0;

  const handleItem = async (item: NotificationItem) => {
    setOpen(false);
    if (!item.read && businessId) {
      void markRead({ businessId, keys: [item.key] }).catch((error) =>
        toast.error(getErrorMessage(error)),
      );
    }
    navigate(item.href);
  };

  const handleMarkAll = async () => {
    if (!businessId || !feed) return;
    const keys = feed.items.filter((item) => !item.read).map((item) => item.key);
    if (keys.length === 0) return;
    setPending(true);
    try {
      await markRead({ businessId, keys });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-cream/55 hover:text-ink dark:hover:bg-white/[0.06]"
          aria-label={
            unread > 0 ? `اعلان‌ها، ${unread} اعلان خوانده‌نشده` : "اعلان‌ها"
          }
        >
          <Bell className="size-[17px]" />
          {unread > 0 ? (
            <span className="num absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 py-0.5 text-[8px] font-bold text-white ring-2 ring-card">
              {unread > 99 ? "۹۹+" : unread.toLocaleString("fa-IR")}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[calc(100vw-1.5rem)] max-w-[390px] rounded-[18px] border-hairline/80 bg-surface p-0 shadow-[0_24px_60px_-28px_rgba(16,44,35,0.35)] dark:border-white/10"
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline/60 px-4 py-3">
          <div>
            <p className="text-xs font-bold text-ink">اعلان‌های واقعی</p>
            <p className="mt-0.5 text-[9px] text-ink-soft">
              از سررسید و وضعیت اسناد همین کسب‌وکار
            </p>
          </div>
          {feed && feed.unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCheck className="size-3" />
              )}
              خواندن موارد فهرست
            </button>
          ) : null}
        </div>

        {isLoading || !feed ? (
          <div className="space-y-2 p-3">
            <div className="h-14 animate-pulse rounded-[11px] bg-cream/50 dark:bg-white/[0.04]" />
            <div className="h-14 animate-pulse rounded-[11px] bg-cream/50 dark:bg-white/[0.04]" />
          </div>
        ) : feed.items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Bell className="size-5" />
            </span>
            <p className="mt-3 text-xs font-semibold text-ink">هیچ هشداری فعال نیست</p>
            <p className="mt-1 text-[10px] leading-5 text-ink-soft">
              سررسیدهای گذشته، فاکتورهای نزدیک سررسید و پیش‌نویس‌ها اینجا
              نمایش داده می‌شوند. ماژول‌های غیرفعال اعلان ساختگی ندارند.
            </p>
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {feed.items.map((item) => {
              const meta = typeMeta[item.type];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleItem(item)}
                  className={cn(
                    "group flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2.5 text-start transition-colors hover:bg-cream/45 dark:hover:bg-white/[0.05]",
                    !item.read && "bg-brand-soft/25 dark:bg-brand-soft/10",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                      meta.tone,
                    )}
                  >
                    <meta.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-[11px] font-semibold leading-5 text-ink">
                        {item.title}
                      </span>
                      {!item.read ? (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-4 text-ink-soft">
                      {item.description}
                    </span>
                    <span className="num mt-1 block text-[8px] text-ink-soft/80">
                      {formatJalali(item.date)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="border-t border-hairline/60 p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/dashboard/notifications");
            }}
            className="flex w-full items-center justify-center gap-1 rounded-xl px-3 py-2 text-[10px] font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            مشاهده همه اعلان‌ها
            <ChevronLeft className="size-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
