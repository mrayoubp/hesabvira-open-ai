import type {
  NotificationFeed,
  NotificationItem,
} from "@/components/app/NotificationBell";
import {
  EmptyState,
  PageHeader,
  Panel,
} from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  BadgeDollarSign,
  Bell,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  Clock3,
  FileText,
  FileWarning,
  Landmark,
  Loader2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const typeMeta = {
  "invoice-overdue": {
    icon: TriangleAlert,
    label: "سررسید گذشته",
    tone: "bg-destructive/10 text-destructive",
  },
  "invoice-due-soon": {
    icon: Clock3,
    label: "نزدیک سررسید",
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "invoice-draft": {
    icon: FileText,
    label: "پیش‌نویس",
    tone: "bg-brand-soft text-brand",
  },
  "fiscal-year": {
    icon: CalendarClock,
    label: "دوره مالی",
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "contract-expiring": {
    icon: CalendarClock,
    label: "قرارداد",
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "leave-pending": {
    icon: Clock3,
    label: "مرخصی",
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "payroll-unpaid": {
    icon: Wallet,
    label: "حقوق",
    tone: "bg-brand-soft text-brand",
  },
  "loan-installment": {
    icon: BadgeDollarSign,
    label: "قسط وام",
    tone: "bg-gold-soft text-[#7a6122] dark:text-gold",
  },
  "tax-due": {
    icon: Landmark,
    label: "مالیات",
    tone: "bg-destructive/10 text-destructive",
  },
  "depreciation-due": {
    icon: CalendarClock,
    label: "استهلاک",
    tone: "bg-mist/70 text-[#245c5c] dark:bg-mist/30 dark:text-[#a9d5e2]",
  },
  "employee-docs": {
    icon: FileWarning,
    label: "مدارک پرسنلی",
    tone: "bg-destructive/10 text-destructive",
  },
} as const;

function NotificationRow({
  item,
  onRead,
}: {
  item: NotificationItem;
  onRead: (key: string) => void;
}) {
  const meta = typeMeta[item.type];
  const navigate = useNavigate();

  return (
    <li
      className={cn(
        "relative flex flex-col gap-3 px-4 py-4 transition-colors sm:flex-row sm:items-center sm:px-5",
        !item.read && "bg-brand-soft/20 dark:bg-brand-soft/10",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl",
          meta.tone,
        )}
      >
        <meta.icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12px] font-bold text-ink">{item.title}</p>
          {!item.read ? (
            <span className="rounded-full bg-gold-soft px-1.5 py-0.5 text-[8px] font-semibold text-[#7a6122] dark:text-gold">
              خوانده‌نشده
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[10px] leading-5 text-ink-soft">
          {item.description}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[8px] text-ink-soft">
          <span className="rounded-full bg-background px-2 py-0.5">
            {meta.label}
          </span>
          <span className="num">{formatJalali(item.date)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!item.read ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 rounded-lg px-2 text-[9px] text-brand hover:bg-brand-soft"
            onClick={() => onRead(item.key)}
          >
            <CheckCircle2 className="size-3.5" />
            خوانده شد
          </Button>
        ) : (
          <span className="flex items-center gap-1 px-2 text-[8px] text-ink-soft">
            <CheckCheck className="size-3" />
            خوانده‌شده
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-hairline bg-card px-2 text-[9px]"
          onClick={() => {
            if (!item.read) onRead(item.key);
            navigate(item.href);
          }}
        >
          مشاهده
        </Button>
      </div>
    </li>
  );
}

export default function Notifications() {
  const { businessId, branchId, fiscalYearId } = useWorkspace();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [pendingAll, setPendingAll] = useState(false);

  const feed = useQuery(
    api.notifications.list,
    businessId ? { businessId, branchId, fiscalYearId } : "skip",
  ) as NotificationFeed | undefined;

  const markRead = useMutation(api.notifications.markRead);

  const mark = async (keys: string[]) => {
    if (!businessId || keys.length === 0) return;
    try {
      await markRead({ businessId, keys });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const markAll = async () => {
    if (!feed) return;
    const keys = feed.items.filter((item) => !item.read).map((item) => item.key);
    if (keys.length === 0) return;
    setPendingAll(true);
    try {
      await mark(keys);
    } finally {
      setPendingAll(false);
    }
  };

  const visible =
    feed?.items.filter((item) => filter === "all" || !item.read) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="مرکز هشدار"
        title="اعلان‌ها"
        description="رویدادهایی که به اقدام نیاز دارند، از سررسید فاکتورها و اسناد باز همین کسب‌وکار ساخته می‌شوند."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3.5"
            >
              <Link to="/dashboard">
                <ArrowRight className="size-4" />
                داشبورد
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={markAll}
              disabled={pendingAll || !feed?.unreadCount}
              className="h-9 gap-1.5 rounded-xl px-3.5"
            >
              {pendingAll ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck className="size-4" />
              )}
              خواندن این فهرست
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "سررسید گذشته",
            value: feed?.counts.overdue ?? 0,
            tone: "text-destructive bg-destructive/10",
            icon: TriangleAlert,
          },
          {
            label: "نزدیک سررسید",
            value: feed?.counts.dueSoon ?? 0,
            tone: "text-[#7a6122] bg-gold-soft dark:text-gold",
            icon: Clock3,
          },
          {
            label: "پیش‌نویس باز",
            value: feed?.counts.drafts ?? 0,
            tone: "text-brand bg-brand-soft",
            icon: FileText,
          },
        ].map((card) => (
          <Panel key={card.label} className="flex items-center gap-3 p-4">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                card.tone,
              )}
            >
              <card.icon className="size-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold text-ink-soft">{card.label}</p>
              <p className="num mt-0.5 text-2xl font-black text-ink">
                {feed ? card.value.toLocaleString("fa-IR") : "—"}
              </p>
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline/60 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-brand" />
            <h2 className="text-xs font-extrabold text-ink">جریان اعلان‌ها</h2>
            {feed && feed.unreadCount > 0 ? (
              <span className="num rounded-full bg-destructive px-1.5 py-0.5 text-[8px] font-bold text-white">
                {feed.unreadCount.toLocaleString("fa-IR")} خوانده‌نشده
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-background/70 p-0.5 dark:bg-white/[0.04]">
            {(
              [
                ["all", "همه"],
                ["unread", "خوانده‌نشده"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[9px] font-semibold transition-colors",
                  filter === value
                    ? "bg-card text-ink shadow-sm"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!feed ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-5" />}
            title={
              filter === "unread"
                ? "اعلان خوانده‌نشده‌ای نیست"
                : "هیچ اعلانی وجود ندارد"
            }
            description="هشدارها فقط از رویدادهای واقعی مثل سررسید فاکتور، پیش‌نویس یا پایان دوره مالی ساخته می‌شوند."
          />
        ) : (
          <ul className="divide-y divide-hairline/50">
            {visible.map((item) => (
              <NotificationRow
                key={item.key}
                item={item}
                onRead={(key) => void mark([key])}
              />
            ))}
          </ul>
        )}

        <div className="border-t border-hairline/60 px-4 py-3 text-[8px] leading-5 text-ink-soft sm:px-5">
          ماژول‌های موجودی، چک و بدهی تأمین‌کننده هنوز فعال نیستند؛ بنابراین
          اعلان ساختگی برای آن‌ها تولید نمی‌شود.
        </div>
      </Panel>
    </div>
  );
}
