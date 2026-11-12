import {
  AccessDenied,
  HrPill,
  HrStat,
  fromDateInput,
  statusTone,
  toDateInput,
} from "@/components/hr/shared";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  Download,
  FileCheck2,
  FilePlus2,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  ReceiptText,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Tab = "overview" | "periods" | "records" | "reports" | "settings";
type ReportKind = "sales-tax" | "purchase-tax" | "payroll-tax" | "liabilities";
type ReportRow = {
  number?: string;
  date?: number;
  base?: number;
  tax?: number;
  total?: number;
  kind?: string;
  title?: string;
  startAt?: number;
  endAt?: number;
  gross?: number;
  insurance?: number;
  net?: number;
  dueDate?: number;
  status?: string;
  taxableBase?: number;
  overdue?: boolean;
};

const TAX_TYPE_LABELS = {
  sales: "مالیات فروش",
  purchase: "مالیات خرید",
  payroll: "مالیات حقوق",
  income: "مالیات درآمد",
  other: "سایر",
} as const;

const TAX_STATUS_LABELS = {
  open: "باز",
  filed: "اظهارشده",
  paid: "پرداخت‌شده",
  closed: "بسته",
} as const;

const REPORT_LABELS: Record<ReportKind, string> = {
  "sales-tax": "مالیات فروش",
  "purchase-tax": "مالیات خرید",
  "payroll-tax": "مالیات حقوق",
  liabilities: "بدهی مالیاتی",
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-[9px] text-ink-soft">{label}</Label><div className="mt-1">{children}</div></div>;
}

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toDateInput(from.getTime()), to: toDateInput(to.getTime()) };
}

function downloadCsv(name: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function TaxPage() {
  const { businessId, currency, fiscalYears } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["tax.view"]);
  const initialRange = useMemo(monthRange, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [tab, setTab] = useState<Tab>("overview");
  const [reportKind, setReportKind] = useState<ReportKind>("sales-tax");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const preview = useQuery(
    api.tax.preview,
    businessId && canView ? { businessId, from: fromDateInput(from), to: fromDateInput(to, true) } : "skip",
  );
  const periods = useQuery(api.tax.periods, businessId && canView ? { businessId } : "skip") ?? [];
  const recordPeriodId = selectedPeriodId ?? periods[0]?._id ?? null;
  const records = useQuery(
    api.tax.records,
    businessId && canView && recordPeriodId ? { businessId, periodId: recordPeriodId as Id<"taxPeriods"> } : "skip",
  ) ?? [];
  const settings = useQuery(api.tax.settings, businessId && canView ? { businessId } : "skip") ?? [];
  const report = useQuery(
    api.tax.report,
    businessId && canView ? { businessId, from: fromDateInput(from), to: fromDateInput(to), kind: reportKind } : "skip",
  );
  const updateStatus = useMutation(api.tax.updatePeriodStatus);
  const updateSettings = useMutation(api.tax.updateSettings);
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [statusDialog, setStatusDialog] = useState<{ periodId: string; status: "filed" | "paid" | "closed"; title: string } | null>(null);

  if (access && !canView) return <AccessDenied />;
  const canManage = Boolean(access?.can["tax.manage"]);
  const selectedPeriod = periods.find((row) => row._id === recordPeriodId) ?? null;
  const activeRecordPeriodId = recordPeriodId;
  const recordRows = records;
  const overdue = periods.filter((row) => row.status !== "paid" && row.status !== "closed" && row.dueDate < Date.now());
  const reportRows = (report?.rows ?? []) as ReportRow[];

  const changeStatus = async (confirmReviewed: boolean) => {
    if (!businessId || !statusDialog) return;
    setStatusPending(statusDialog.periodId);
    try {
      await updateStatus({ businessId, periodId: statusDialog.periodId as Id<"taxPeriods">, status: statusDialog.status, confirmReviewed });
      toast.success("وضعیت دوره مالیاتی ثبت شد.");
      setStatusDialog(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setStatusPending(null);
    }
  };

  const exportReport = () => {
    if (!report) return;
    const rows = reportRows;
    if (reportKind === "sales-tax" || reportKind === "purchase-tax") {
      downloadCsv(REPORT_LABELS[reportKind], ["شماره", "تاریخ", "ماخذ", "مالیات", "جمع", "نوع"], rows.map((row) => [row.number ?? "", toDateInput(row.date ?? 0), row.base ?? 0, row.tax ?? 0, row.total ?? 0, row.kind ?? ""]));
    } else if (reportKind === "payroll-tax") {
      downloadCsv("مالیات حقوق", ["دوره", "از", "تا", "جمع حقوق", "مالیات", "بیمه", "خالص"], rows.map((row) => [row.title ?? "", toDateInput(row.startAt ?? 0), toDateInput(row.endAt ?? 0), row.gross ?? 0, row.tax ?? 0, row.insurance ?? 0, row.net ?? 0]));
    } else {
      downloadCsv("بدهی مالیاتی", ["دوره", "شروع", "مهلت", "وضعیت", "ماخذ", "مالیات", "معوق"], rows.map((row) => [row.title ?? "", toDateInput(row.startAt ?? 0), toDateInput(row.dueDate ?? 0), row.status ?? "", row.taxableBase ?? 0, row.tax ?? 0, row.overdue ? "بله" : "خیر"]));
    }
    toast.success("فایل CSV برای Excel آماده شد.");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · مالیات"
        title="مدیریت مالیات و اظهارنامه"
        description="نرخ‌ها با منبع و بازه اعتبار نگه‌داری می‌شوند. پیش‌نمایش فروش، خرید و حقوق از اسناد واقعی ساخته می‌شود؛ ثبت اظهارنامه فقط پس از بازبینی کامل مجاز است."
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage ? <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl" onClick={() => setSettingsOpen(true)}><Settings2 className="size-4" /> نرخ قانونی جدید</Button> : null}
            {canManage ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setPeriodOpen(true)}><Plus className="size-4" /> دوره مالیاتی</Button> : null}
          </div>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="مالیات فروش دوره" value={formatMoney(preview?.salesTax ?? 0, currency)} hint="پس از برگشت فروش" tone="brand" />
        <HrStat label="مالیات خرید دوره" value={formatMoney(preview?.purchaseTax ?? 0, currency)} hint="اعتبار قابل بررسی" tone="mist" />
        <HrStat label="مالیات حقوق" value={formatMoney(preview?.payrollTax ?? 0, currency)} hint="دوره‌های تأییدشده" tone="gold" />
        <HrStat label="دوره‌های معوق" value={overdue.length.toLocaleString("fa-IR")} hint="نیازمند اقدام" tone="danger" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-hairline bg-white/70 p-1.5 dark:bg-card/60">
          {[
            { key: "overview" as const, label: "نمای کلی", icon: BarChart3 },
            { key: "periods" as const, label: "دوره‌ها", icon: ReceiptText },
            { key: "records" as const, label: "ردیف‌های مالیاتی", icon: FileCheck2 },
            { key: "reports" as const, label: "گزارش‌ها", icon: Download },
            { key: "settings" as const, label: "نرخ‌ها", icon: Settings2 },
          ].map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[9px] font-semibold", tab === item.key ? "bg-brand text-cream" : "text-ink-soft hover:bg-muted")}><item.icon className="size-3.5" />{item.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} dir="ltr" className="num h-8 w-32 rounded-lg text-[9px]" />
          <span className="text-[9px] text-ink-soft">تا</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} dir="ltr" className="num h-8 w-32 rounded-lg text-[9px]" />
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <Panel>
            <PanelHeader eyebrow="پیش‌نمایش مدیریتی" title="خلاصه مالیات دوره" description={preview?.note ?? "در حال محاسبه از اسناد واقعی..."} />
            {!preview ? <Skeleton className="m-4 h-44 rounded-2xl" /> : (
              <div className="space-y-4 px-4 pb-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-brand/15 bg-brand-soft/30 p-3"><p className="text-[9px] text-ink-soft">مالیات فروش</p><p className="num mt-2 text-lg font-black text-brand">{formatMoney(preview.salesTax, currency)}</p><p className="num mt-1 text-[8px] text-ink-soft">{preview.invoiceCount} فاکتور · ماخذ {formatMoney(preview.salesBase, currency)}</p></div>
                  <div className="rounded-2xl border border-hairline bg-background/60 p-3"><p className="text-[9px] text-ink-soft">مالیات خرید</p><p className="num mt-2 text-lg font-black text-ink">{formatMoney(preview.purchaseTax, currency)}</p><p className="num mt-1 text-[8px] text-ink-soft">{preview.purchaseCount} فاکتور · ماخذ {formatMoney(preview.purchaseBase, currency)}</p></div>
                </div>
                <div className="rounded-2xl border border-gold/25 bg-gold/5 p-3">
                  <div className="flex items-center justify-between"><p className="text-[10px] font-bold">خالص مالیات بر ارزش افزوده</p><p className="num text-base font-black text-gold">{formatMoney(preview.netVat, currency)}</p></div>
                  <p className="mt-1 text-[8px] text-ink-soft">فروش منهای خرید. منفی بودن یعنی اعتبار مالیاتی قابل انتقال؛ این عدد اظهارنامه رسمی نیست.</p>
                </div>
                <div className="rounded-xl border border-hairline p-3"><div className="flex items-center justify-between text-[9px]"><span>مالیات حقوق از {preview.payrollCount} دوره تأییدشده</span><b className="num">{formatMoney(preview.payrollTax, currency)}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, preview.salesTax > 0 ? (preview.netVat / preview.salesTax) * 100 : 0)}%` }} /></div></div>
              </div>
            )}
          </Panel>
          <Panel className="h-fit">
            <PanelHeader eyebrow="اقدام" title="برنامه مالیاتی" />
            <div className="space-y-2 px-4 pb-4">
              {periods.length === 0 ? <p className="text-[9px] leading-5 text-ink-soft">هنوز دوره مالیاتی تعریف نشده است. ابتدا دوره را داخل سال مالی ایجاد کنید.</p> : periods.slice(0, 4).map((period) => (
                <button key={period._id} type="button" onClick={() => { setSelectedPeriodId(period._id); setTab("records"); }} className="w-full rounded-xl border border-hairline p-2.5 text-right hover:bg-muted/40">
                  <div className="flex items-center justify-between"><span className="text-[9px] font-bold">{period.title}</span><HrPill label={TAX_STATUS_LABELS[period.status]} tone={statusTone(period.status)} /></div>
                  <p className="num mt-1 text-[8px] text-ink-soft">مهلت {formatJalali(period.dueDate)}</p>
                </button>
              ))}
              <div className="rounded-xl bg-mist/40 p-2.5 text-[8px] leading-4 text-ink-soft"><ShieldCheck className="mb-1 size-3.5 text-brand" /> ثبت «اظهارشده» فقط با تأیید بازبینی و وقتی همه ردیف‌ها reviewed باشند ممکن است.</div>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "periods" ? (
        <Panel>
          <PanelHeader eyebrow="دوره‌های مالیاتی" title="وضعیت اظهار و پرداخت" description="وضعیت فقط به جلو حرکت می‌کند و هر تغییر در تاریخچه ثبت می‌شود." />
          {periods.length === 0 ? <EmptyState icon={<ReceiptText className="size-5" />} title="دوره مالیاتی ندارید" description="یک دوره داخل سال مالی بسازید تا ردیف‌ها و گزارش‌ها به آن متصل شوند." /> : (
            <div className="grid gap-2 px-4 pb-4 md:grid-cols-2">
              {periods.map((period) => (
                <div key={period._id} className="rounded-2xl border border-hairline bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold">{period.title}</p><p className="num mt-1 text-[8px] text-ink-soft">{formatJalali(period.startAt)} تا {formatJalali(period.endAt)} · مهلت {formatJalali(period.dueDate)}</p></div><HrPill label={TAX_STATUS_LABELS[period.status]} tone={statusTone(period.status)} /></div>
                  {period.dueDate < Date.now() && period.status !== "paid" && period.status !== "closed" ? <p className="mt-2 flex items-center gap-1 text-[8px] text-destructive"><AlertTriangle className="size-3" /> مهلت دوره گذشته است.</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => { setSelectedPeriodId(period._id); setTab("records"); }}>ردیف‌ها</Button>
                    {canManage && period.status === "open" ? <Button size="sm" className="h-7 rounded-lg text-[8px]" onClick={() => setStatusDialog({ periodId: period._id, status: "filed", title: period.title })}><FileCheck2 className="size-3" /> ثبت اظهارنامه</Button> : null}
                    {canManage && period.status === "filed" ? <Button size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => setStatusDialog({ periodId: period._id, status: "paid", title: period.title })}>ثبت پرداخت</Button> : null}
                    {canManage && period.status === "paid" ? <Button size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => setStatusDialog({ periodId: period._id, status: "closed", title: period.title })}>بستن دوره</Button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "records" ? (
        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          <Panel className="h-fit"><PanelHeader eyebrow="انتخاب دوره" title="دوره مالیاتی" />{periods.length === 0 ? <p className="px-4 pb-4 text-[9px] text-ink-soft">دوره‌ای وجود ندارد.</p> : <div className="space-y-1.5 px-3 pb-3">{periods.map((period) => <button key={period._id} type="button" onClick={() => setSelectedPeriodId(period._id)} className={cn("w-full rounded-xl border p-2.5 text-right text-[9px]", (activeRecordPeriodId === period._id) ? "border-brand/25 bg-brand-soft/50" : "border-hairline hover:bg-muted/40")}><b>{period.title}</b><span className="mt-1 block text-[8px] text-ink-soft">{TAX_STATUS_LABELS[period.status]} · مهلت {formatJalali(period.dueDate)}</span></button>)}</div>}</Panel>
          <Panel><PanelHeader eyebrow="اسناد و مدارک" title="ردیف‌های مالیاتی" description="هر ردیف باید بازبینی شود تا اظهارنامه قابل ثبت باشد." action={canManage ? <Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" disabled={!selectedPeriod || selectedPeriod.status === "paid" || selectedPeriod.status === "closed"} onClick={() => setRecordOpen(true)}><FilePlus2 className="size-3.5" /> ردیف جدید</Button> : null} />
            {!activeRecordPeriodId ? <EmptyState icon={<FileCheck2 className="size-5" />} title="دوره‌ای را انتخاب کنید" description="برای مشاهده ردیف‌ها یک دوره مالیاتی انتخاب کنید." /> : recordRows.length === 0 ? <EmptyState icon={<FileCheck2 className="size-5" />} title="ردیف مالیاتی ثبت نشده" description="مأخذ، مبلغ، شرح و وضعیت بازبینی را ثبت کنید." /> : <div className="overflow-x-auto px-4 pb-4"><table className="w-full text-right"><thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="p-2">نوع</th><th className="p-2">ماخذ</th><th className="p-2">مالیات</th><th className="p-2">شرح</th><th className="p-2">بازبینی</th><th className="p-2">پیوست</th></tr></thead><tbody>{records.map((record) => <tr key={record._id} className="border-b border-hairline/50 text-[9px]"><td className="p-2">{TAX_TYPE_LABELS[record.taxType]}</td><td className="num p-2">{formatNumber(record.taxableBase)}</td><td className="num p-2 font-bold">{formatNumber(record.taxAmount)}</td><td className="max-w-[260px] p-2 text-[8px]">{record.description}<span className="num block text-[7px] text-ink-soft">{record.sourceReference ?? ""}</span></td><td className="p-2"><HrPill label={record.reviewed ? "بازبینی‌شده" : "نیازمند بازبینی"} tone={record.reviewed ? "brand" : "gold"} /></td><td className="p-2 text-[8px] text-ink-soft">{record.attachmentName ? record.attachmentUrl ? <a href={record.attachmentUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">{record.attachmentName}</a> : record.attachmentName : "—"}</td></tr>)}</tbody></table></div>}
          </Panel>
        </div>
      ) : null}

      {tab === "reports" ? (
        <Panel>
          <PanelHeader eyebrow="گزارش قابل چاپ و خروجی" title={REPORT_LABELS[reportKind]} description={`${formatJalali(fromDateInput(from))} تا ${formatJalali(fromDateInput(to, true))} · این خروجی برای بازبینی داخلی است.`} action={<div className="flex flex-wrap gap-1.5"><Select value={reportKind} onValueChange={(value) => setReportKind(value as ReportKind)}><SelectTrigger className="h-8 w-36 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => <SelectItem key={key} value={key}>{REPORT_LABELS[key]}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={exportReport} disabled={!report}><Download className="size-3.5" /> Excel</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => window.print()}><Printer className="size-3.5" /> PDF</Button></div>} />
          {!report ? <Skeleton className="m-4 h-44 rounded-2xl" /> : reportRows.length === 0 ? <EmptyState icon={<BarChart3 className="size-5" />} title="داده‌ای در این بازه نیست" description="پس از ثبت اسناد، گزارش از همان داده‌ها ساخته می‌شود." /> : (
            <div className="print-sheet m-4 overflow-x-auto rounded-2xl border border-hairline bg-white">
              <table className="w-full text-right text-ink"><thead className="bg-muted/60"><tr className="text-[8px] text-ink-soft">
                {reportKind === "sales-tax" || reportKind === "purchase-tax" ? <><th className="p-2">شماره</th><th className="p-2">تاریخ</th><th className="p-2">ماخذ</th><th className="p-2">مالیات</th><th className="p-2">جمع</th><th className="p-2">نوع</th></> : reportKind === "payroll-tax" ? <><th className="p-2">دوره</th><th className="p-2">بازه</th><th className="p-2">حقوق</th><th className="p-2">مالیات</th><th className="p-2">بیمه</th><th className="p-2">خالص</th></> : <><th className="p-2">دوره</th><th className="p-2">مهلت</th><th className="p-2">وضعیت</th><th className="p-2">ماخذ</th><th className="p-2">مالیات</th><th className="p-2">معوق</th></>}
              </tr></thead><tbody>
                {reportKind === "sales-tax" || reportKind === "purchase-tax" ? reportRows.map((row, index) => <tr key={`${row.number}-${index}`} className="border-t border-hairline/60 text-[9px]"><td className="num p-2">{row.number}</td><td className="num p-2">{formatJalali(row.date ?? 0)}</td><td className="num p-2">{formatNumber(row.base ?? 0)}</td><td className="num p-2">{formatNumber(row.tax ?? 0)}</td><td className="num p-2">{formatNumber(row.total ?? 0)}</td><td className="p-2">{row.kind}</td></tr>) : reportKind === "payroll-tax" ? reportRows.map((row, index) => <tr key={`${row.title}-${index}`} className="border-t border-hairline/60 text-[9px]"><td className="p-2 font-semibold">{row.title}</td><td className="num p-2 text-[8px]">{formatJalali(row.startAt ?? 0)} تا {formatJalali(row.endAt ?? 0)}</td><td className="num p-2">{formatNumber(row.gross ?? 0)}</td><td className="num p-2">{formatNumber(row.tax ?? 0)}</td><td className="num p-2">{formatNumber(row.insurance ?? 0)}</td><td className="num p-2">{formatNumber(row.net ?? 0)}</td></tr>) : reportRows.map((row, index) => <tr key={`${row.title}-${index}`} className="border-t border-hairline/60 text-[9px]"><td className="p-2 font-semibold">{row.title}</td><td className="num p-2">{formatJalali(row.dueDate ?? 0)}</td><td className="p-2">{TAX_STATUS_LABELS[(row.status ?? "open") as keyof typeof TAX_STATUS_LABELS]}</td><td className="num p-2">{formatNumber(row.taxableBase ?? 0)}</td><td className="num p-2">{formatNumber(row.tax ?? 0)}</td><td className="p-2">{row.overdue ? <span className="text-destructive">بله</span> : "خیر"}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "settings" ? (
        <Panel><PanelHeader eyebrow="قواعد دارای منبع" title="نرخ‌های مالیاتی" description="هر نرخ باید نوع، حوزه، بازه اعتبار و منبع قانونی داشته باشد." action={canManage ? <Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setSettingsOpen(true)}><Plus className="size-3.5" /> نرخ جدید</Button> : null} />
          {settings.length === 0 ? <EmptyState icon={<Settings2 className="size-5" />} title="نرخ مالیاتی تعریف نشده" description="برای گزارش‌های قانونی، نرخ را با منبع معتبر سال و حوزه ثبت کنید." /> : <div className="grid gap-2 px-4 pb-4 md:grid-cols-2">{settings.map((setting) => <div key={setting._id} className="rounded-2xl border border-hairline bg-background/60 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold">{setting.name}</p><p className="mt-1 text-[8px] text-ink-soft">{TAX_TYPE_LABELS[setting.taxType]} · {setting.jurisdiction} · {setting.rateBps / 100}٪</p></div><HrPill label={setting.active ? "فعال" : "غیرفعال"} tone={setting.active ? "brand" : "muted"} /></div><p className="num mt-2 text-[8px] text-ink-soft">اعتبار: {formatJalali(setting.effectiveFrom)} {setting.effectiveTo ? `تا ${formatJalali(setting.effectiveTo)}` : "بدون پایان"}</p><p className="mt-1 text-[8px] text-ink-soft">منبع: {setting.sourceTitle}</p>{canManage ? <Button size="sm" variant="ghost" className="mt-1 h-6 rounded-md px-2 text-[8px]" onClick={async () => { if (!businessId) return; try { await updateSettings({ businessId, settingsId: setting._id, active: !setting.active }); toast.success(setting.active ? "نرخ غیرفعال شد." : "نرخ فعال شد."); } catch (error) { toast.error(getErrorMessage(error)); } }}>{setting.active ? "غیرفعال‌سازی" : "فعال‌سازی"}</Button> : null}</div>)}</div>}
        </Panel>
      ) : null}

      {periodOpen ? <TaxPeriodDialog open onOpenChange={setPeriodOpen} businessId={businessId} fiscalYears={fiscalYears} /> : null}
      {recordOpen && selectedPeriod ? <TaxRecordDialog open onOpenChange={setRecordOpen} businessId={businessId} periodId={selectedPeriod._id} /> : null}
      {settingsOpen ? <TaxSettingsDialog open onOpenChange={setSettingsOpen} businessId={businessId} /> : null}
      <Dialog open={Boolean(statusDialog)} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent className="rounded-[24px] sm:max-w-[480px]"><DialogHeader><DialogTitle>{statusDialog?.status === "filed" ? "ثبت اظهارنامه" : statusDialog?.status === "paid" ? "ثبت پرداخت مالیات" : "بستن دوره مالیاتی"}</DialogTitle><DialogDescription className="text-[11px]">{statusDialog?.title}</DialogDescription></DialogHeader><div className="space-y-3">{statusDialog?.status === "filed" ? <div className="rounded-xl border border-gold/25 bg-gold/5 p-3 text-[9px] leading-5"><div className="flex items-center gap-1.5 font-bold text-gold"><AlertTriangle className="size-4" /> تأیید بازبینی انسانی</div>این سامانه اظهارنامه رسمی تولید نمی‌کند. با ادامه تأیید می‌کنید همه ردیف‌ها و مقررات جاری بررسی شده‌اند.</div> : <p className="text-[9px] text-ink-soft">این اقدام وضعیت دوره را به مرحله بعد منتقل می‌کند و در تاریخچه ثبت می‌شود.</p>}<DialogFooter><Button variant="outline" onClick={() => setStatusDialog(null)}>انصراف</Button><Button disabled={Boolean(statusPending)} onClick={() => void changeStatus(statusDialog?.status === "filed")} className="gap-1">{statusPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} تأیید و ثبت</Button></DialogFooter></div></DialogContent>
      </Dialog>
    </div>
  );
}

function TaxPeriodDialog({ open, onOpenChange, businessId, fiscalYears }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; fiscalYears: { _id: string; name: string; startAt: number; endAt: number }[] }) {
  const create = useMutation(api.tax.createPeriod);
  const [form, setForm] = useState({ fiscalYearId: fiscalYears[0]?._id ?? "", title: "", start: toDateInput(Date.now()), end: toDateInput(Date.now()), due: toDateInput(Date.now() + 30 * 86_400_000), notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.fiscalYearId) { toast.error("سال مالی را انتخاب کنید."); return; }
    setSaving(true);
    try {
      await create({ businessId, fiscalYearId: form.fiscalYearId as Id<"fiscalYears">, title: form.title.trim(), startAt: fromDateInput(form.start), endAt: fromDateInput(form.end), dueDate: fromDateInput(form.due), notes: form.notes.trim() || undefined });
      toast.success("دوره مالیاتی ایجاد شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[540px]"><DialogHeader><DialogTitle>دوره مالیاتی جدید</DialogTitle><DialogDescription className="text-[11px]">دوره باید داخل سال مالی باشد و مهلت بعد از پایان دوره ثبت شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="سال مالی *"><Select value={form.fiscalYearId} onValueChange={(value) => setForm({ ...form, fiscalYearId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب سال مالی" /></SelectTrigger><SelectContent>{fiscalYears.map((year) => <SelectItem key={year._id} value={year._id}>{year.name}</SelectItem>)}</SelectContent></Select></Field><Field label="عنوان *"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-9 rounded-xl text-[11px]" placeholder="مثلاً مالیات ارزش افزوده فصل" /></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="شروع"><Input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="پایان"><Input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="مهلت"><Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field></div><Field label="یادداشت"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />} ایجاد دوره</Button></DialogFooter></form></DialogContent></Dialog>;
}

function TaxRecordDialog({ open, onOpenChange, businessId, periodId }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; periodId: string }) {
  const create = useMutation(api.tax.createRecord);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const [form, setForm] = useState({ taxType: "sales", taxableBase: "", taxAmount: "", description: "", sourceReference: "", reviewed: false });
  const [attachment, setAttachment] = useState<{ storageId: Id<"_storage">; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const uploadAttachment = async (file: File) => {
    if (!businessId) return;
    try {
      const uploadUrl = await generateUploadUrl({ businessId });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error("بارگذاری پیوست ناموفق بود.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await registerUpload({ businessId, storageId, name: file.name });
      setAttachment({ storageId, name: file.name });
      toast.success("پیوست بارگذاری شد.");
    } catch (error) { toast.error(getErrorMessage(error)); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await create({ businessId, periodId: periodId as Id<"taxPeriods">, taxType: form.taxType as "sales", taxableBase: Number(form.taxableBase) || 0, taxAmount: Number(form.taxAmount) || 0, description: form.description.trim(), sourceReference: form.sourceReference.trim() || undefined, attachmentStorageId: attachment?.storageId, attachmentName: attachment?.name, reviewed: form.reviewed });
      toast.success("ردیف مالیاتی ثبت شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[520px]"><DialogHeader><DialogTitle>ردیف مالیاتی</DialogTitle><DialogDescription className="text-[11px]">مبلغ و مأخذ را از سند یا محاسبه تأییدشده وارد کنید.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="نوع"><Select value={form.taxType} onValueChange={(value) => setForm({ ...form, taxType: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TAX_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field><Field label="مأخذ"><Input value={form.taxableBase} onChange={(e) => setForm({ ...form, taxableBase: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="مبلغ مالیات"><Input value={form.taxAmount} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="شماره مرجع"><Input value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field></div>          <Field label="شرح *"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><div><Label className="text-[9px] text-ink-soft">پیوست سند</Label><div className="mt-1 flex items-center gap-2"><label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-white px-2.5 text-[8px] font-semibold text-ink-soft hover:bg-muted dark:bg-card"><Paperclip className="size-3" />{attachment ? "تغییر پیوست" : "افزودن پیوست"}<input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); event.target.value = ""; }} /></label>{attachment ? <span className="truncate text-[8px] text-ink-soft">{attachment.name}</span> : <span className="text-[8px] text-ink-soft">اختیاری</span>}</div></div><label className="flex items-center gap-2 text-[9px]"><input type="checkbox" checked={form.reviewed} onChange={(e) => setForm({ ...form, reviewed: e.target.checked })} className="size-3.5 accent-[#245C49]" /> این ردیف را با اسناد پشتیبان بازبینی کردم.</label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>ثبت ردیف</Button></DialogFooter></form></DialogContent></Dialog>;
}

function TaxSettingsDialog({ open, onOpenChange, businessId }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses"> }) {
  const create = useMutation(api.tax.createSettings);
  const [form, setForm] = useState({ name: "", taxType: "sales", jurisdiction: "ایران", rate: "", from: toDateInput(Date.now()), to: "", sourceTitle: "", sourceUrl: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await create({ businessId, name: form.name.trim(), taxType: form.taxType as "sales", jurisdiction: form.jurisdiction.trim(), rateBps: Math.round((Number(form.rate) || 0) * 100), effectiveFrom: fromDateInput(form.from), effectiveTo: form.to ? fromDateInput(form.to) : undefined, sourceTitle: form.sourceTitle.trim(), sourceUrl: form.sourceUrl.trim() || undefined, notes: form.notes.trim() || undefined });
      toast.success("نرخ مالیاتی ثبت شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[600px]"><DialogHeader><DialogTitle>نرخ مالیاتی جدید</DialogTitle><DialogDescription className="text-[11px]">نرخ بدون منبع ذخیره نمی‌شود؛ اعتبار از تاریخ مشخص شروع می‌شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="نام قانون *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><Field label="نوع مالیات"><Select value={form.taxType} onValueChange={(value) => setForm({ ...form, taxType: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TAX_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field><Field label="حوزه قضایی *"><Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><Field label="نرخ (٪) *"><Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="شروع اعتبار"><Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="پایان اعتبار"><Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="منبع قانونی *" className="sm:col-span-2"><Input value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><Field label="نشانی منبع" className="sm:col-span-2"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} dir="ltr" className="h-9 rounded-xl text-[11px]" /></Field><Field label="یادداشت" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} ثبت نرخ</Button></DialogFooter></form></DialogContent></Dialog>;
}
