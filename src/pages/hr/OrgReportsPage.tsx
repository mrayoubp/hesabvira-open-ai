import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  LEAVE_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  TAX_STATUS_LABELS,
  AccessDenied,
  HrPill,
  fromDateInput,
  toDateInput,
} from "@/components/hr/shared";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  Calculator,
  Download,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Printer,
  ReceiptText,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Kind =
  | "personnel"
  | "payroll"
  | "payroll-by-branch"
  | "overtime"
  | "leave"
  | "attendance"
  | "expiring-contracts"
  | "tax"
  | "fixed-assets"
  | "depreciation"
  | "employee-loans"
  | "branch-performance";

type Column = { key: string; label: string; kind: "text" | "money" | "number" | "date" };

const REPORTS: { kind: Kind; label: string; description: string; icon: typeof Users }[] = [
  { kind: "personnel", label: "لیست پرسنل", description: "پرونده پرسنلی با فیلتر شعبه، واحد و جستجو", icon: Users },
  { kind: "payroll", label: "حقوق ماهانه", description: "ریز حقوق تأییدشده هر پرسنل در بازه", icon: ReceiptText },
  { kind: "payroll-by-branch", label: "هزینه حقوق شعب", description: "تجمیع هزینه، بیمه، مالیات و خالص به تفکیک شعبه", icon: Building2 },
  { kind: "overtime", label: "اضافه‌کاری", description: "ساعت کارکرد، اضافه‌کاری و تأخیر پرسنل", icon: CalendarClock },
  { kind: "leave", label: "مرخصی", description: "درخواست‌ها، نوع، روزها و وضعیت تأیید", icon: CalendarDays },
  { kind: "attendance", label: "حضور و غیاب", description: "خلاصه ماهانه حضور هر پرسنل", icon: Calculator },
  { kind: "expiring-contracts", label: "قراردادهای در حال انقضا", description: "قراردادهای فعال و روزهای باقی‌مانده", icon: CalendarClock },
  { kind: "tax", label: "گزارش مالیات", description: "دوره‌ها، مأخذ و مالیات ثبت‌شده", icon: Landmark },
  { kind: "fixed-assets", label: "دارایی ثابت", description: "بها، استهلاک انباشته و ارزش دفتری", icon: Building2 },
  { kind: "depreciation", label: "استهلاک", description: "ثبت‌های استهلاک دوره‌ای با سند", icon: Calculator },
  { kind: "employee-loans", label: "وام پرسنل", description: "مبلغ، تسویه و مانده بدهی پرسنل", icon: Wallet },
  { kind: "branch-performance", label: "عملکرد شعب", description: "فروش، خرید، پرسنل و هزینه حقوق هر شعبه", icon: BarChart3 },
];

function permissionsFor(kind: Kind): string[][] {
  if (kind === "personnel" || kind === "overtime" || kind === "leave" || kind === "attendance" || kind === "expiring-contracts") {
    return [["hr.view", "org.reports.view"]];
  }
  if (kind === "payroll" || kind === "payroll-by-branch") return [["payroll.view", "org.reports.view"]];
  if (kind === "tax") return [["tax.view", "org.reports.view"]];
  if (kind === "fixed-assets" || kind === "depreciation") return [["assets.view", "org.reports.view"]];
  if (kind === "employee-loans") return [["loans.manage", "payroll.view", "hr.sensitive"]];
  return [["org.reports.view"]];
}

const STATUS_LABELS: Record<string, string> = {
  ...EMPLOYEE_STATUS_LABELS,
  ...EMPLOYMENT_TYPE_LABELS,
  ...LEAVE_TYPE_LABELS,
  ...REQUEST_STATUS_LABELS,
  ...TAX_STATUS_LABELS,
  active: "جاری",
  settled: "تسویه‌شده",
  sold: "فروخته‌شده",
  disposed: "خارج از دفاتر",
  fully_depreciated: "کاملاً مستهلک",
  loan: "وام",
  advance: "مساعده",
};

function downloadCsv(name: string, columns: Column[], rows: Record<string, unknown>[]) {
  const csv = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key] ?? ""))]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function displayValue(value: unknown, kind: Column["kind"], currency: string) {
  if (value === null || value === undefined) return "—";
  if (kind === "money") return formatMoney(Number(value), currency);
  if (kind === "number") return formatNumber(Number(value));
  if (kind === "date") return Number(value) ? formatJalali(Number(value)) : "—";
  const text = String(value);
  return STATUS_LABELS[text] ?? text;
}

export default function OrgReportsPage() {
  const { businessId, currency, branches } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const [kind, setKind] = useState<Kind>("personnel");
  const canPermission = (permission: string) =>
    Boolean(access?.can[permission as keyof NonNullable<typeof access>["can"]]);
  const availableKinds = REPORTS.filter((item) =>
    permissionsFor(item.kind).some((group) =>
      group.some((permission) => canPermission(permission)),
    ),
  );
  const activeKind = availableKinds.some((item) => item.kind === kind)
    ? kind
    : (availableKinds[0]?.kind ?? null);
  const yearAgo = useMemo(() => toDateInput(Date.now() - 365 * 86_400_000), []);
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(toDateInput(Date.now()));
  const [branchId, setBranchId] = useState("all");
  const [orgUnitId, setOrgUnitId] = useState("all");
  const [search, setSearch] = useState("");
  const units = useQuery(api.hr.orgUnits, businessId && access?.can["hr.view"] ? { businessId } : "skip") ?? [];
  const report = useQuery(
    api.orgReports.report,
    businessId && activeKind
      ? {
          businessId,
          kind: activeKind,
          from: fromDateInput(from),
          to: fromDateInput(to, true),
          branchId: branchId === "all" ? undefined : (branchId as Id<"branches">),
          orgUnitId: orgUnitId === "all" ? undefined : (orgUnitId as Id<"organizationalUnits">),
          search: search.trim() || undefined,
        }
      : "skip",
  );
  const [showAll, setShowAll] = useState(false);

  if (access && availableKinds.length === 0) {
    return <AccessDenied />;
  }
  const meta = REPORTS.find((item) => item.kind === activeKind) ?? REPORTS[0];
  const rows = (report?.rows ?? []) as Record<string, unknown>[];
  const columns = (report?.columns ?? []) as Column[];
  const totals = (report?.totals ?? {}) as Record<string, unknown>;
  const visibleRows = showAll ? rows : rows.slice(0, 250);

  const exportExcel = () => {
    if (!report) return;
    downloadCsv(meta.label, columns, rows);
    toast.success("خروجی CSV برای Excel آماده شد.");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · گزارش‌های سازمانی"
        title="مرکز گزارش‌های سازمان"
        description="۱۲ گزارش از داده واقعی پرسنل، حضور، حقوق، مالیات، دارایی، وام و شعب؛ با فیلتر تاریخ، شعبه، واحد، جستجو و خروجی چاپ/Excel."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl" onClick={() => window.print()} disabled={!report}><Printer className="size-4" /> چاپ / PDF</Button>
            <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={exportExcel} disabled={!report}><Download className="size-4" /> خروجی Excel</Button>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[270px_1fr]">
        <Panel className="h-fit">
          <PanelHeader eyebrow="انتخاب گزارش" title="گزارش‌های موجود" />
          <div className="grid gap-1 px-2 pb-3">
            {availableKinds.map((item) => (
              <button key={item.kind} type="button" onClick={() => { setKind(item.kind); setShowAll(false); }} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2 text-right transition-colors", activeKind === item.kind ? "border-brand/25 bg-brand-soft/60 text-brand" : "border-transparent text-ink-soft hover:bg-muted/50")}>
                <item.icon className="size-3.5 shrink-0" />
                <span className="text-[9px] font-semibold">{item.label}</span>
              </button>
            ))}
          </div>
        </Panel>

        <div className="min-w-0 space-y-3">
          <Panel>
            <PanelHeader
              eyebrow="فیلتر و بازه"
              title={meta.label}
              description={meta.description}
              action={
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="relative"><Search className="absolute right-2 top-2 size-3.5 text-ink-soft" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو..." className="h-8 w-32 rounded-lg pr-7 text-[9px]" /></div>
                  <Select value={branchId} onValueChange={setBranchId}><SelectTrigger className="h-8 w-28 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه شعب</SelectItem>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select>
                  {access?.can["hr.view"] ? <Select value={orgUnitId} onValueChange={setOrgUnitId}><SelectTrigger className="h-8 w-28 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه واحدها</SelectItem>{units.map((unit) => <SelectItem key={unit._id} value={unit._id}>{unit.name}</SelectItem>)}</SelectContent></Select> : null}
                </div>
              }
            />
            <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
              <div><Label className="text-[8px] text-ink-soft">از تاریخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="num mt-1 h-8 w-34 rounded-lg text-[9px]" /></div>
              <div><Label className="text-[8px] text-ink-soft">تا تاریخ</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="num mt-1 h-8 w-34 rounded-lg text-[9px]" /></div>
              <div className="flex flex-wrap gap-1.5 pb-0.5">
                {[
                  { label: "این ماه", days: 30 },
                  { label: "۳ ماه", days: 90 },
                  { label: "یک سال", days: 365 },
                ].map((preset) => <button key={preset.label} type="button" onClick={() => { setFrom(toDateInput(Date.now() - preset.days * 86_400_000)); setTo(toDateInput(Date.now())); }} className="rounded-lg border border-hairline px-2 py-1.5 text-[8px] text-ink-soft hover:bg-muted">{preset.label}</button>)}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow={`${rows.length.toLocaleString("fa-IR")} ردیف`}
              title={meta.label}
              description={`${formatJalali(fromDateInput(from))} تا ${formatJalali(fromDateInput(to, true))}`}
              action={rows.length > 250 ? <Button size="sm" variant="ghost" className="h-7 rounded-lg text-[8px]" onClick={() => setShowAll((value) => !value)}>{showAll ? "نمایش ۲۵۰ ردیف" : `نمایش همه ${rows.length} ردیف`}</Button> : null}
            />
            {!report ? <Skeleton className="m-4 h-56 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon={<FileSpreadsheet className="size-5" />} title="داده‌ای مطابق فیلترها نیست" description="بازه تاریخ، شعبه یا عبارت جستجو را تغییر دهید. گزارش فقط از رکوردهای واقعی ساخته می‌شود." /> : (
              <div className="print-sheet m-4 overflow-x-auto rounded-2xl border border-hairline bg-white">
                <div className="border-b border-hairline bg-brand/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2"><div><p className="text-[9px] font-black text-brand">حساب ویرا · {meta.label}</p><p className="mt-1 text-[8px] text-ink-soft">بازه {formatJalali(fromDateInput(from))} تا {formatJalali(fromDateInput(to, true))}</p></div><HrPill label={`${rows.length.toLocaleString("fa-IR")} ردیف`} tone="brand" /></div>
                </div>
                <table className="w-full text-right">
                  <thead><tr className="border-b border-hairline bg-muted/50">{columns.map((column) => <th key={column.key} className="whitespace-nowrap p-2 text-[8px] font-semibold text-ink-soft">{column.label}</th>)}</tr></thead>
                  <tbody>{visibleRows.map((row, index) => <tr key={String(row.id ?? row.code ?? index)} className="border-b border-hairline/50 text-[9px]">{columns.map((column) => <td key={column.key} className={cn("whitespace-nowrap p-2", (column.kind === "money" || column.kind === "number" || column.kind === "date") && "num", column.kind === "money" && "font-semibold")}>{displayValue(row[column.key], column.kind, currency)}</td>)}</tr>)}</tbody>
                  {Object.keys(totals).length > 0 ? <tfoot><tr className="border-t border-hairline bg-brand-soft/40 text-[9px] font-bold">{columns.map((column) => <td key={column.key} className="whitespace-nowrap p-2">{totals[column.key] !== undefined ? displayValue(totals[column.key], column.kind, currency) : column.key === columns[0]?.key ? "جمع" : "—"}</td>)}</tr></tfoot> : null}
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
