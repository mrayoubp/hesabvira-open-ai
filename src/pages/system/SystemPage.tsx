import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatJalaliLong, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  ArchiveRestore,
  BadgeCheck,
  Bot,
  CalendarClock,
  Check,
  CloudUpload,
  Database,
  Download,
  HardDrive,
  ImagePlus,
  KeyRound,
  Loader2,
  RefreshCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

type Tab = "health" | "backup" | "settings" | "events";
type HealthState = "healthy" | "warning" | "critical" | "unknown";

const TAB_LABELS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "health", label: "سلامت سامانه", icon: Activity },
  { key: "backup", label: "پشتیبان و بازیابی", icon: HardDrive },
  { key: "settings", label: "تنظیمات", icon: ShieldCheck },
  { key: "events", label: "رویدادها و خطاها", icon: CalendarClock },
];

const STATUS_META: Record<
  HealthState | "healthy" | "degraded" | "unhealthy",
  { label: string; className: string; dot: string }
> = {
  healthy: {
    label: "سالم",
    className: "border-brand/25 bg-brand-soft/60 text-brand dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  warning: {
    label: "هشدار",
    className: "border-gold/35 bg-gold-soft/55 text-[#7a6122] dark:text-gold",
    dot: "bg-amber-500",
  },
  critical: {
    label: "بحرانی",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
  unknown: {
    label: "نامشخص",
    className: "border-hairline bg-cream/40 text-ink-soft",
    dot: "bg-ink-soft/40",
  },
  degraded: {
    label: "نیازمند بررسی",
    className: "border-gold/35 bg-gold-soft/55 text-[#7a6122] dark:text-gold",
    dot: "bg-amber-500",
  },
  unhealthy: {
    label: "ناسالم",
    className: "border-destructive/25 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
};

const BACKUP_STATUS: Record<string, string> = {
  running: "در حال اجرا",
  success: "موفق",
  failed: "ناموفق",
};

const EVENT_LABELS: Record<string, string> = {
  "session_start": "شروع نشست",
  logout: "خروج از حساب",
  "file.upload": "آپلود فایل",
  "backup.create": "ایجاد پشتیبان",
  "backup.download": "دانلود پشتیبان",
  "backup.restore": "بازیابی پشتیبان",
};

function StatusBadge({ status }: { status: HealthState | "degraded" | "unhealthy" }) {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold",
        meta.className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function bytes(value?: number | null) {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} کیلوبایت`;
  return `${formatNumber(Math.round(value / 1024 / 1024))} مگابایت`;
}

function AccessDenied() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center p-4">
      <Panel className="w-full p-8 text-center">
        <ShieldCheck className="mx-auto size-10 text-ink-soft/40" />
        <h1 className="mt-4 text-lg font-black text-ink">دسترسی مدیریتی لازم است</h1>
        <p className="mt-2 text-xs leading-6 text-ink-soft">
          وضعیت سلامت، پشتیبان‌گیری و تنظیمات فقط برای مالک یا مدیر کسب‌وکار
          در دسترس است.
        </p>
      </Panel>
    </div>
  );
}

function HealthCard({
  icon,
  label,
  status,
  detail,
  footer,
}: {
  icon: ReactNode;
  label: string;
  status: HealthState;
  detail: string;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/80 bg-white/75 p-4 dark:border-white/10 dark:bg-card/65">
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-cream/70 text-brand dark:bg-white/[0.06]">
          {icon}
        </span>
        <StatusBadge status={status} />
      </div>
      <h3 className="mt-3 text-xs font-extrabold text-ink">{label}</h3>
      <p className="mt-1.5 min-h-10 text-[10px] leading-5 text-ink-soft">{detail}</p>
      {footer}
    </div>
  );
}

function HealthTab({
  businessId,
  canManage,
}: {
  businessId?: Id<"businesses">;
  canManage: boolean;
}) {
  const health = useQuery(
    api.system.health,
    businessId && canManage ? { businessId } : "skip",
  );
  const runAction = useAction(api.system.runHealthCheck);
  const [checking, setChecking] = useState(false);

  const run = async () => {
    if (!businessId) return;
    setChecking(true);
    try {
      const result = await runAction({ businessId });
      toast.success(
        result.status === "healthy"
          ? "همه سرویس‌های بررسی‌شده سالم هستند."
          : "بررسی انجام شد؛ یک یا چند مورد نیازمند توجه است.",
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  if (!health) {
    return (
      <div className="flex min-h-56 items-center justify-center text-xs text-ink-soft">
        <Loader2 className="me-2 size-4 animate-spin" /> در حال خواندن وضعیت واقعی سرویس‌ها…
      </div>
    );
  }

  const checks = health.checks;
  const cardIcons: Record<string, ReactNode> = {
    database: <Database className="size-4" />,
    backend: <Activity className="size-4" />,
    storage: <HardDrive className="size-4" />,
    ai: <Bot className="size-4" />,
    backup: <CloudUpload className="size-4" />,
  };

  return (
    <div className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <div className="pointer-events-none absolute -end-8 -top-16 size-48 rounded-full bg-brand/10 blur-3xl" />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={health.status as "healthy" | "degraded" | "unhealthy"}
                />
                <Badge variant="outline" className="num rounded-full text-[9px]">
                  نسخه {health.version}
                </Badge>
                <Badge variant="outline" className="rounded-full text-[9px]">
                  {health.phase}
                </Badge>
              </div>
              <h2 className="mt-3 text-xl font-black text-ink">وضعیت سلامت حساب ویرا</h2>
              <p className="mt-1.5 max-w-2xl text-[11px] leading-6 text-ink-soft">
                این صفحه فقط نتیجه بررسی‌های واقعی Backend، دیتابیس، فضای فایل،
                پشتیبان و سرویس AI را نشان می‌دهد. وضعیت «نامشخص» به معنی
                آزمون‌نشده است، نه سالم.
              </p>
            </div>
            <Button
              onClick={() => void run()}
              disabled={checking}
              className="h-10 shrink-0 gap-2 rounded-xl px-4 text-[11px]"
            >
              {checking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              بررسی کامل الآن
            </Button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline/60 pt-4 sm:grid-cols-4">
            <div>
              <p className="text-[9px] text-ink-soft">آخرین بررسی دستی</p>
              <p className="num mt-1 text-[11px] font-bold text-ink">
                {health.lastCheckAt ? formatJalaliLong(health.lastCheckAt) : "انجام نشده"}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-ink-soft">تأخیر دیتابیس</p>
              <p className="num mt-1 text-[11px] font-bold text-ink">
                {formatNumber(health.latencyMs)} ms
              </p>
            </div>
            <div>
              <p className="text-[9px] text-ink-soft">آخرین پشتیبان</p>
              <p className="num mt-1 text-[11px] font-bold text-ink">
                {health.backup.latest
                  ? formatJalali(health.backup.latest.startedAt)
                  : "ندارد"}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-ink-soft">رویدادهای امنیتی</p>
              <p className="num mt-1 text-[11px] font-bold text-ink">
                {formatNumber(health.stats.securityEvents)}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map((check) => (
          <HealthCard
            key={check.key}
            icon={cardIcons[check.key] ?? <BadgeCheck className="size-4" />}
            label={check.label}
            status={check.status as HealthState}
            detail={check.detail}
            footer={
              check.latencyMs !== undefined ? (
                <p className="num mt-2 text-[9px] text-ink-soft">
                  پاسخ: {formatNumber(check.latencyMs)} ms
                </p>
              ) : null
            }
          />
        ))}
      </div>

      <Panel>
        <PanelHeader
          eyebrow="سیاست پشتیبان"
          title="برنامه و نگهداری نسخه‌ها"
          description="زمان‌بندی از تنظیمات همین کسب‌وکار خوانده می‌شود و Cron سرور آن را اجرا می‌کند."
        />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
          <div className="rounded-xl bg-cream/45 p-3 dark:bg-white/[0.04]">
            <p className="text-[9px] text-ink-soft">وضعیت برنامه</p>
            <p className="mt-1 text-[11px] font-bold text-ink">
              {health.backup.enabled ? "فعال" : "غیرفعال"}
            </p>
          </div>
          <div className="rounded-xl bg-cream/45 p-3 dark:bg-white/[0.04]">
            <p className="text-[9px] text-ink-soft">تکرار</p>
            <p className="mt-1 text-[11px] font-bold text-ink">
              {health.backup.frequency === "daily"
                ? "روزانه"
                : health.backup.frequency === "weekly"
                  ? "هفتگی"
                  : "ماهانه"}
            </p>
          </div>
          <div className="rounded-xl bg-cream/45 p-3 dark:bg-white/[0.04]">
            <p className="text-[9px] text-ink-soft">اجرای بعدی</p>
            <p className="num mt-1 text-[11px] font-bold text-ink">
              {health.backup.nextRunAt
                ? formatJalaliLong(health.backup.nextRunAt)
                : "زمان‌بندی نشده"}
            </p>
          </div>
        </div>
        {health.stats.openErrors > 0 ? (
          <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/35 p-3 text-[10px] leading-5 text-[#7a6122] dark:text-gold">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {formatNumber(health.stats.openErrors)} خطای ثبت‌شده هنوز بسته نشده
            است؛ در تب رویدادها بررسی کنید.
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function BackupTab({
  businessId,
  canManage,
}: {
  businessId?: Id<"businesses">;
  canManage: boolean;
}) {
  const jobs = useQuery(
    api.backup.list,
    businessId && canManage ? { businessId } : "skip",
  );
  const create = useAction(api.backup.create);
  const verify = useAction(api.backup.verify);
  const restore = useAction(api.backup.restore);
  const downloadUrl = useMutation(api.backup.getDownloadUrl);
  const { setBusinessId } = useWorkspace();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  if (!canManage) return <AccessDenied />;
  if (!jobs) {
    return (
      <div className="flex min-h-56 items-center justify-center text-xs text-ink-soft">
        <Loader2 className="me-2 size-4 animate-spin" /> در حال خواندن نسخه‌ها…
      </div>
    );
  }

  const runCreate = async () => {
    if (!businessId) return;
    setBusy("create");
    try {
      const result = await create({ businessId });
      toast.success(
        `پشتیبان واقعی ساخته شد (${formatNumber(result.rowCount)} رکورد).`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async (jobId: string) => {
    if (!businessId) return;
    setBusy(`verify-${jobId}`);
    try {
      const result = await verify({
        businessId,
        jobId: jobId as Id<"backupJobs">,
      });
      if (result.ok) {
        toast.success(
          `پشتیبان سالم است: ${formatNumber(result.rowCount)} رکورد و checksum معتبر.`,
        );
      } else {
        toast.error("بررسی صحت پشتیبان ناموفق بود؛ جزئیات در کنسول مرورگر.");
        console.warn("backup verification", result);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const runDownload = async (jobId: string) => {
    if (!businessId) return;
    setBusy(`download-${jobId}`);
    try {
      const result = await downloadUrl({
        businessId,
        jobId: jobId as Id<"backupJobs">,
      });
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.filename;
      anchor.rel = "noopener";
      anchor.click();
      toast.success("دانلود پشتیبان آغاز شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const runRestore = async () => {
    if (!businessId || !restoreId) return;
    setBusy("restore");
    try {
      const result = await restore({
        businessId,
        jobId: restoreId as Id<"backupJobs">,
      });
      toast.success(
        `بازیابی در فضای کاری جدید انجام شد (${formatNumber(result.rows)} رکورد). فضای اصلی دست‌نخورده ماند.`,
      );
      setRestoreId(null);
      setBusinessId(result.businessId);
      navigate("/dashboard");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          eyebrow="File Storage خارج از جداول عملیاتی"
          title="پشتیبان واقعی و قابل راستی‌آزمایی"
          description="هر نسخه شامل داده همین کسب‌وکار است، با checksum ذخیره می‌شود و از جداول دیتابیس جدا نگهداری می‌شود. محدودیت فعلی: حداکثر ۴ مگابایت و ۵۰۰۰ رکورد در هر جدول."
          action={
            <Button
              onClick={() => void runCreate()}
              disabled={busy !== null}
              className="h-9 gap-2 rounded-xl text-[10px]"
            >
              {busy === "create" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              ساخت پشتیبان الآن
            </Button>
          }
        />
        <div className="mx-5 mb-5 rounded-xl border border-gold/25 bg-gold-soft/30 p-3 text-[10px] leading-6 text-[#7a6150] dark:text-gold">
          بازیابی، نسخه را در یک کسب‌وکار جدید باز می‌کند و قبل از آن یک
          پشتیبان ایمنی از وضعیت فعلی می‌سازد. داده اصلی حذف یا بازنویسی
          نمی‌شود؛ این رفتار برای جلوگیری از تخریب ناشی از Restore ناقص است.
        </div>
        {jobs.length === 0 ? (
          <EmptyState
            icon={<CloudUpload className="size-5" />}
            title="هنوز پشتیبانی ساخته نشده"
            description="دکمه «ساخت پشتیبان الآن» یک snapshot واقعی از داده این کسب‌وکار می‌سازد."
          />
        ) : (
          <div className="divide-y divide-hairline/50 border-t border-hairline/50">
            {jobs.map((job) => (
              <div
                key={job._id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        job.status === "success"
                          ? "bg-emerald-500"
                          : job.status === "failed"
                            ? "bg-destructive"
                            : "animate-pulse bg-amber-500",
                      )}
                    />
                    <p className="truncate text-[11px] font-bold text-ink">
                      {job.filename}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[8px]">
                      {BACKUP_STATUS[job.status] ?? job.status}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-[8px]">
                      {job.trigger === "scheduled"
                        ? "زمان‌بندی"
                        : job.trigger === "pre_restore"
                          ? "ایمنی قبل از بازیابی"
                          : "دستی"}
                    </Badge>
                  </div>
                  <p className="num mt-1 text-[9px] text-ink-soft">
                    {formatJalaliLong(job.startedAt)} · {formatNumber(job.rowCount)} رکورد ·{" "}
                    {bytes(job.sizeBytes)}
                    {job.checksum ? ` · ${job.checksum.slice(0, 12)}…` : ""}
                  </p>
                  {job.error ? (
                    <p className="mt-1 text-[9px] text-destructive">{job.error}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg text-[9px]"
                    disabled={!job.downloadReady || busy !== null}
                    onClick={() => void runDownload(job._id)}
                  >
                    {busy === `download-${job._id}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    دانلود
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg text-[9px]"
                    disabled={!job.downloadReady || busy !== null}
                    onClick={() => void runVerify(job._id)}
                  >
                    {busy === `verify-${job._id}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3" />
                    )}
                    بررسی صحت
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 rounded-lg border-gold/40 text-[9px] text-[#7a6122] dark:text-gold"
                        disabled={!job.downloadReady || busy !== null}
                        onClick={() => setRestoreId(job._id)}
                      >
                        <ArchiveRestore className="size-3" />
                        بازیابی
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-[24px]">
                      <AlertDialogHeader>
                        <AlertDialogTitle>بازیابی در فضای کاری جدید</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] leading-6">
                          ابتدا یک پشتیبان ایمنی از وضعیت فعلی ساخته می‌شود،
                          سپس داده این نسخه در یک کسب‌وکار جدید باز می‌شود.
                          فضای کاری فعلی و داده‌های آن تغییر نمی‌کند.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy === "restore"}>
                          انصراف
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={busy === "restore"}
                          onClick={(event) => {
                            event.preventDefault();
                            void runRestore();
                          }}
                          className="gap-1.5"
                        >
                          {busy === "restore" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <ArchiveRestore className="size-3.5" />
                          )}
                          تأیید و بازیابی
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SettingsTab({
  businessId,
  canManage,
}: {
  businessId?: Id<"businesses">;
  canManage: boolean;
}) {
  const saved = useQuery(
    api.system.settings,
    businessId && canManage ? { businessId } : "skip",
  );
  const update = useMutation(api.system.updateSettings);
  const generateUpload = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoId, setLogoId] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    displayName: "",
    legalName: "",
    calendar: "jalali" as "jalali" | "gregorian",
    timezone: "Asia/Tehran",
    invoiceFooter: "",
    printOrientation: "landscape" as "landscape" | "portrait",
    notificationsEnabled: true,
    lowStockAlerts: true,
    backupEnabled: true,
    backupFrequency: "daily" as "daily" | "weekly" | "monthly",
    backupHourUtc: "1",
    backupRetentionDays: "30",
  });

  useEffect(() => {
    if (!saved) return;
    setForm({
      displayName: saved.businessName,
      legalName: saved.legalName,
      calendar: saved.calendar,
      timezone: saved.timezone,
      invoiceFooter: saved.invoiceFooter,
      printOrientation: saved.printOrientation,
      notificationsEnabled: saved.notificationsEnabled,
      lowStockAlerts: saved.lowStockAlerts,
      backupEnabled: saved.backupEnabled,
      backupFrequency: saved.backupFrequency,
      backupHourUtc: String(saved.backupHourUtc),
      backupRetentionDays: String(saved.backupRetentionDays),
    });
    setLogoId(saved.logoStorageId ?? null);
    setLogoPreview(saved.logoUrl ?? null);
  }, [saved]);

  if (!canManage) return <AccessDenied />;
  if (!saved) {
    return (
      <div className="flex min-h-56 items-center justify-center text-xs text-ink-soft">
        <Loader2 className="me-2 size-4 animate-spin" /> در حال خواندن تنظیمات…
      </div>
    );
  }

  const uploadLogo = async (file: File) => {
    if (!businessId) return;
    if (file.size > 600 * 1024) {
      toast.error("حجم لوگو باید کمتر از ۶۰۰ کیلوبایت باشد.");
      return;
    }
    setLogoUploading(true);
    try {
      const url = await generateUpload({ businessId });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error("upload failed");
      const payload = (await response.json()) as { storageId?: string };
      if (!payload.storageId) throw new Error("storageId missing");
      await registerUpload({
        businessId,
        storageId: payload.storageId as Id<"_storage">,
        name: file.name,
      });
      setLogoId(payload.storageId);
      setLogoPreview(URL.createObjectURL(file));
      toast.success("لوگو بارگذاری شد؛ برای ذخیره تنظیمات دکمه ذخیره را بزنید.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLogoUploading(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await update({
        businessId,
        displayName: form.displayName.trim(),
        legalName: form.legalName.trim() || undefined,
        calendar: form.calendar,
        timezone: form.timezone.trim(),
        invoiceFooter: form.invoiceFooter.trim() || undefined,
        printOrientation: form.printOrientation,
        notificationsEnabled: form.notificationsEnabled,
        lowStockAlerts: form.lowStockAlerts,
        backupEnabled: form.backupEnabled,
        backupFrequency: form.backupFrequency,
        backupHourUtc: Number(form.backupHourUtc),
        backupRetentionDays: Number(form.backupRetentionDays),
        logoStorageId: (logoId as Id<"_storage"> | null) ?? undefined,
      });
      toast.success("تنظیمات ذخیره شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form onSubmit={save} className="space-y-5">
      <Panel>
        <PanelHeader
          eyebrow="هویت کسب‌وکار"
          title="اطلاعات پایه و برند"
          description="واحد پول، دقت اعشار و نرخ مالیات پس از ثبت اسناد با تنظیمات این فرم تغییر داده نمی‌شوند؛ تغییر آن‌ها یک عملیات مهاجرت کنترل‌شده است."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-2xl border border-hairline/70 bg-cream/30 p-4 dark:bg-white/[0.03]">
            <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-white/80 bg-white dark:border-white/10 dark:bg-card">
              {logoPreview ? (
                <img src={logoPreview} alt="لوگوی کسب‌وکار" className="size-full object-cover" />
              ) : (
                <ImagePlus className="size-6 text-ink-soft/50" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-ink">لوگوی کسب‌وکار</p>
              <p className="mt-1 text-[9px] leading-5 text-ink-soft">
                PNG، JPG یا WebP تا ۶۰۰ کیلوبایت. فایل فقط در همین کسب‌وکار
                قابل دسترسی است.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1.5 rounded-xl text-[10px]"
              disabled={logoUploading}
              onClick={() => fileRef.current?.click()}
            >
              {logoUploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              بارگذاری لوگو
            </Button>
            {logoId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl text-ink-soft"
                aria-label="حذف لوگو"
                onClick={() => {
                  setLogoId(null);
                  setLogoPreview(null);
                }}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">نام نمایشی *</Label>
            <Input
              value={form.displayName}
              onChange={(event) => set("displayName", event.target.value)}
              className="h-10 rounded-xl text-[11px]"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">نام حقوقی</Label>
            <Input
              value={form.legalName}
              onChange={(event) => set("legalName", event.target.value)}
              className="h-10 rounded-xl text-[11px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">تقویم نمایش</Label>
            <Select
              value={form.calendar}
              onValueChange={(value) => set("calendar", value as typeof form.calendar)}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jalali">شمسی</SelectItem>
                <SelectItem value="gregorian">میلادی</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">منطقه زمانی</Label>
            <Input
              value={form.timezone}
              onChange={(event) => set("timezone", event.target.value)}
              dir="ltr"
              className="num h-10 rounded-xl text-[11px]"
              placeholder="Asia/Tehran"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-[10px]">پاورقی چاپ فاکتور</Label>
            <Textarea
              value={form.invoiceFooter}
              onChange={(event) => set("invoiceFooter", event.target.value)}
              rows={2}
              className="rounded-xl text-[11px]"
              placeholder="مثلاً: با تشکر از خرید شما — حساب ویرا"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">جهت پیش‌فرض چاپ گزارش</Label>
            <Select
              value={form.printOrientation}
              onValueChange={(value) =>
                set("printOrientation", value as typeof form.printOrientation)
              }
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">افقی (A4)</SelectItem>
                <SelectItem value="portrait">عمودی (A4)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">واحد پول (فقط نمایش)</Label>
            <Input
              value={saved.currency}
              readOnly
              dir="ltr"
              className="num h-10 rounded-xl bg-muted/40 text-[11px]"
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="اعلان و پشتیبان‌گیری"
          title="سیاست اجرا و نگهداری"
          description="Cron سرور هر ساعت موعد را بررسی می‌کند؛ این مقادیر فقط برای کسب‌وکار فعال ذخیره می‌شوند."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-hairline/60 p-3 text-[10px]">
            <span>اعلان‌های سامانه</span>
            <Switch
              checked={form.notificationsEnabled}
              onCheckedChange={(value) => set("notificationsEnabled", value)}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-hairline/60 p-3 text-[10px]">
            <span>هشدار موجودی کم</span>
            <Switch
              checked={form.lowStockAlerts}
              onCheckedChange={(value) => set("lowStockAlerts", value)}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-hairline/60 p-3 text-[10px]">
            <span>پشتیبان‌گیری زمان‌بندی‌شده</span>
            <Switch
              checked={form.backupEnabled}
              onCheckedChange={(value) => set("backupEnabled", value)}
            />
          </label>
          <div className="space-y-1.5">
            <Label className="text-[10px]">تکرار پشتیبان</Label>
            <Select
              value={form.backupFrequency}
              onValueChange={(value) =>
                set("backupFrequency", value as typeof form.backupFrequency)
              }
              disabled={!form.backupEnabled}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">روزانه</SelectItem>
                <SelectItem value="weekly">هفتگی</SelectItem>
                <SelectItem value="monthly">ماهانه</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">ساعت اجرا (UTC)</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={form.backupHourUtc}
              onChange={(event) => set("backupHourUtc", event.target.value)}
              disabled={!form.backupEnabled}
              dir="ltr"
              className="num h-10 rounded-xl text-[11px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">نگهداری نسخه‌ها (روز)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={form.backupRetentionDays}
              onChange={(event) => set("backupRetentionDays", event.target.value)}
              dir="ltr"
              className="num h-10 rounded-xl text-[11px]"
            />
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={saving}
          className="h-10 gap-2 rounded-xl px-5 text-[11px]"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          ذخیره تنظیمات
        </Button>
      </div>
    </form>
  );
}

function EventsTab({
  businessId,
  canManage,
}: {
  businessId?: Id<"businesses">;
  canManage: boolean;
}) {
  const audit = useQuery(
    api.system.audit,
    businessId && canManage ? { businessId, limit: 30 } : "skip",
  );
  const security = useQuery(
    api.system.securityLog,
    businessId && canManage ? { businessId, limit: 30 } : "skip",
  );
  const errors = useQuery(
    api.system.errors,
    businessId && canManage ? { businessId, limit: 30 } : "skip",
  );
  const resolve = useMutation(api.system.resolveError);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!canManage) return <AccessDenied />;

  const resolveOne = async (id: string) => {
    if (!businessId) return;
    setBusyId(id);
    try {
      await resolve({
        businessId,
        errorId: id as Id<"systemErrors">,
      });
      toast.success("خطا بسته شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <PanelHeader
          eyebrow="Audit Trail"
          title="تاریخچه عملیات"
          description="آخرین ۳۰ رویداد ثبت‌شده در auditLogs همین کسب‌وکار."
        />
        <div className="max-h-[520px] divide-y divide-hairline/50 overflow-auto border-t border-hairline/50">
          {!audit ? (
            <Loader2 className="mx-auto my-8 size-5 animate-spin text-ink-soft" />
          ) : audit.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="رویدادی ثبت نشده"
              description="عملیات ثبت، ویرایش و تأیید پس از انجام در این بخش دیده می‌شود."
            />
          ) : (
            audit.map((row) => (
              <div key={row._id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold text-ink">
                    {row.summary || row.action}
                  </p>
                  <p className="num mt-1 text-[9px] text-ink-soft">
                    {row.actorName} · {row.action} · {formatJalaliLong(row.createdAt)}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full text-[8px]">
                  {row.entity}
                </Badge>
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel>
          <PanelHeader
            eyebrow="Security Events"
            title="رویدادهای امنیتی مشاهده‌شده"
            description="شروع نشست، خروج، آپلود و عملیات پشتیبان. این رویدادها مشاهده‌های سمت برنامه هستند و جایگزین لاگ کامل Identity Provider نیستند."
          />
          <div className="max-h-[240px] divide-y divide-hairline/50 overflow-auto border-t border-hairline/50">
            {!security ? (
              <Loader2 className="mx-auto my-8 size-5 animate-spin text-ink-soft" />
            ) : security.length === 0 ? (
              <EmptyState
                icon={<KeyRound className="size-5" />}
                title="رویداد امنیتی ثبت نشده"
                description="ورود، خروج، آپلود و عملیات پشتیبان در این بخش ثبت می‌شود."
              />
            ) : (
              security.map((row) => (
                <div key={row._id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-ink">
                      {EVENT_LABELS[row.action] ?? row.action}
                    </p>
                    <p className="num mt-1 truncate text-[9px] text-ink-soft">
                      {row.detail ?? "بدون جزئیات"} · {formatJalaliLong(row.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 rounded-full text-[8px]",
                      row.result === "success"
                        ? "border-brand/25 text-brand"
                        : "border-destructive/25 text-destructive",
                    )}
                  >
                    {row.result === "success" ? "موفق" : "ناموفق"}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Error Registry"
            title="خطاهای ثبت‌شده"
            description="پیام‌ها پیش از ذخیره پاک‌سازی می‌شوند؛ کلید، رمز یا آدرس ایمیل در لاگ نگهداری نمی‌شود."
          />
          <div className="max-h-[330px] divide-y divide-hairline/50 overflow-auto border-t border-hairline/50">
            {!errors ? (
              <Loader2 className="mx-auto my-8 size-5 animate-spin text-ink-soft" />
            ) : errors.length === 0 ? (
              <EmptyState
                icon={<BadgeCheck className="size-5" />}
                title="خطایی ثبت نشده"
                description="خطاهای سمت مرورگر و سرور پس از ثبت در این فهرست نمایش داده می‌شوند."
              />
            ) : (
              errors.map((row) => (
                <div key={row._id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[10px] font-semibold text-ink">
                      {row.message}
                    </p>
                    <p className="num mt-1 text-[8px] text-ink-soft">
                      {row.source === "server" ? "سرور" : "مرورگر"} · {row.errorId} ·{" "}
                      {formatJalaliLong(row.createdAt)}
                    </p>
                  </div>
                  {row.resolvedAt ? (
                    <Badge variant="outline" className="shrink-0 rounded-full text-[8px] text-brand">
                      <Check className="size-2.5" /> بسته
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 rounded-lg text-[8px]"
                      disabled={busyId === row._id}
                      onClick={() => void resolveOne(row._id)}
                    >
                      {busyId === row._id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : null}
                      بستن
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function SystemPage() {
  const { businessId, canManage } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: Tab =
    requestedTab === "backup" ||
    requestedTab === "settings" ||
    requestedTab === "events"
      ? requestedTab
      : "health";

  const changeTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  if (!canManage) return <AccessDenied />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · PHASE 10"
        title="وضعیت سلامت حساب ویرا"
        description="پایش واقعی دیتابیس، API، فایل، پشتیبان و ویرا AI؛ همراه با بکاپ خارج از جداول و تنظیمات عملیاتی."
      />

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/80 bg-white/70 p-1.5 dark:border-white/10 dark:bg-card/60">
        {TAB_LABELS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => changeTab(item.key)}
              className={cn(
                "inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-[10px] font-bold transition-colors sm:flex-none",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-soft hover:bg-cream/60 hover:text-ink dark:hover:bg-white/[0.06]",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "health" ? (
        <HealthTab businessId={businessId} canManage={canManage} />
      ) : tab === "backup" ? (
        <BackupTab businessId={businessId} canManage={canManage} />
      ) : tab === "settings" ? (
        <SettingsTab businessId={businessId} canManage={canManage} />
      ) : (
        <EventsTab businessId={businessId} canManage={canManage} />
      )}
    </div>
  );
}
