import type {
  AssetStatus,
  AttendanceStatus,
  ContractStatus,
  DepreciationMethod,
  EmployeeStatus,
  EmploymentType,
  LeaveType,
  PayrollPeriodStatus,
  RequestStatus,
  TaxPeriodStatus,
  TaxType,
  AssetMovementType,
} from "@/convex/schema";
import { Panel } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "شاغل",
  on_leave: "در مرخصی",
  suspended: "تعلیق",
  terminated: "پایان همکاری",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "تمام‌وقت",
  part_time: "پاره‌وقت",
  contract: "پیمانی",
  temporary: "موقت",
  intern: "کارآموز",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: "فعال",
  ended: "پایان‌یافته",
  renewed: "تمدیدشده",
  cancelled: "لغوشده",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "حاضر",
  late: "تأخیر",
  absent: "غایب",
  leave: "مرخصی",
  mission: "مأموریت",
  holiday: "تعطیل",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "در انتظار تأیید",
  approved: "تأییدشده",
  rejected: "ردشده",
  cancelled: "لغوشده",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "استحقاقی",
  sick: "استعلاجی",
  unpaid: "بدون حقوق",
  maternity: "زایمان",
  hajj: "حج",
  marriage: "ازدواج",
  bereavement: "فوت بستگان",
  other: "سایر",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  draft: "پیش‌نویس",
  calculated: "محاسبه‌شده",
  approved: "تأیید نهایی",
  paid: "پرداخت‌شده",
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "در خدمت",
  fully_depreciated: "کاملاً مستهلک",
  sold: "فروخته‌شده",
  disposed: "خارج از دفاتر",
};

export const ASSET_METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: "خط مستقیم",
  declining_balance: "مانده نزولی",
  custom: "ماهانه سفارشی",
};

export const ASSET_MOVEMENT_LABELS: Record<AssetMovementType, string> = {
  purchase: "خرید",
  transfer: "انتقال",
  repair: "تعمیر",
  sale: "فروش",
  disposal: "خروج",
  depreciation: "استهلاک",
};

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  sales: "مالیات فروش",
  purchase: "مالیات خرید",
  payroll: "مالیات حقوق",
  income: "مالیات درآمد",
  other: "سایر",
};

export const TAX_STATUS_LABELS: Record<TaxPeriodStatus, string> = {
  open: "باز",
  filed: "اظهارنامه ثبت‌شده",
  paid: "پرداخت‌شده",
  closed: "بسته",
};

export const PERMISSION_LABELS: Record<string, string> = {
  "hr.view": "مشاهده پرونده پرسنل",
  "hr.sensitive": "مشاهده اطلاعات حساس پرسنل",
  "hr.edit": "ویرایش پرونده پرسنل",
  "attendance.manage": "مدیریت حضور و غیاب",
  "leave.request": "ثبت درخواست مرخصی",
  "leave.approve": "تأیید مرخصی و مأموریت",
  "payroll.view": "مشاهده حقوق",
  "payroll.calculate": "محاسبه حقوق",
  "payroll.approve": "تأیید و پرداخت حقوق",
  "tax.view": "مشاهده اطلاعات مالیاتی",
  "tax.manage": "مدیریت مالیات",
  "assets.view": "مشاهده دارایی‌ها",
  "assets.manage": "مدیریت دارایی‌ها",
  "branches.manage": "مدیریت شعب",
  "org.reports.view": "مشاهده گزارش‌های سازمانی",
  "loans.manage": "مدیریت وام و مساعده",
};

const TONES = {
  brand: "border-brand/25 bg-brand-soft text-brand",
  gold: "border-gold/35 bg-gold-soft text-[#7a6122] dark:text-gold",
  muted: "border-hairline bg-muted text-ink-soft",
  danger: "border-destructive/25 bg-destructive/5 text-destructive",
  mist: "border-mist bg-mist/50 text-[#2d6470] dark:text-[#a9d5e2]",
} as const;

export function HrPill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-semibold",
        TONES[tone],
      )}
    >
      {label}
    </span>
  );
}

export function statusTone(value: string): keyof typeof TONES {
  if (["active", "approved", "paid", "present", "calculated"].includes(value))
    return "brand";
  if (["pending", "late", "warning", "draft", "on_leave"].includes(value))
    return "gold";
  if (["rejected", "terminated", "absent", "cancelled", "sold", "disposed"].includes(value))
    return "danger";
  return "muted";
}

export function toDateInput(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function fromDateInput(value: string, endOfDay = false) {
  if (!value) return Date.now();
  return Date.parse(`${value}T${endOfDay ? "23:59:59" : "12:00:00"}Z`);
}

export function currentMonthRange() {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  };
}

export function AccessDenied({
  title = "دسترسی به این بخش مجاز نیست",
  description = "مدیر کسب‌وکار باید مجوز سازمانی لازم را برای نقش شما فعال کند. کنترل مجوز در سرور انجام می‌شود.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Panel className="mx-auto max-w-xl p-8 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/5 text-destructive">
        <ShieldAlert className="size-6" />
      </span>
      <h2 className="mt-4 text-base font-black text-ink">{title}</h2>
      <p className="mt-2 text-[11px] leading-6 text-ink-soft">{description}</p>
    </Panel>
  );
}

export function HrStat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "brand" | "gold" | "danger" | "mist";
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_14px_35px_-34px_rgba(22,58,46,0.55)] dark:border-white/10 dark:bg-card/70">
      <p className="text-[9px] font-semibold text-ink-soft">{label}</p>
      <p
        className={cn(
          "num mt-1.5 text-[20px] font-black",
          tone === "brand" && "text-brand",
          tone === "gold" && "text-gold",
          tone === "danger" && "text-destructive",
          tone === "mist" && "text-[#2d6470] dark:text-[#a9d5e2]",
          tone === "ink" && "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[8px] leading-4 text-ink-soft">{hint}</p> : null}
    </div>
  );
}
