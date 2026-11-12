import {
  AccessDenied,
  HrPill,
  HrStat,
  PAYROLL_STATUS_LABELS,
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
import {
  formatJalali,
  formatMoney,
  formatNumber,
  numberToPersianWords,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeDollarSign,
  Calculator,
  CheckCircle2,
  FileText,
  Landmark,
  Loader2,
  Plus,
  Printer,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Tab = "periods" | "settings" | "loans";

function currentJalali() {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 1405);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  return { year, month };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-[9px] text-ink-soft">{label}</Label><div className="mt-1">{children}</div></div>;
}

export default function PayrollPage() {
  const { businessId, currency } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["payroll.view"]);
  const periods = useQuery(api.payroll.periods, businessId && canView ? { businessId } : "skip") ?? [];
  const settings = useQuery(api.payroll.settings, businessId && canView ? { businessId } : "skip") ?? [];
  const summary = useQuery(api.payroll.summary, businessId && canView ? { businessId } : "skip");
  const loans = useQuery(api.loans.list, businessId && canView ? { businessId } : "skip") ?? [];
  const employees = useQuery(api.hr.employees, businessId && canView ? { businessId } : "skip") ?? [];
  const funds = useQuery(api.treasury.funds, businessId && canView ? { businessId } : "skip") ?? [];
  const [tab, setTab] = useState<Tab>("periods");
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  const [calculateOpen, setCalculateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payslipEmployee, setPayslipEmployee] = useState<string | null>(null);
  const [loanDetailId, setLoanDetailId] = useState<string | null>(null);
  const periodQueryId = periodId ?? periods[0]?._id ?? null;
  const detail = useQuery(
    api.payroll.get,
    businessId && canView && periodQueryId ? { businessId, periodId: periodQueryId as Id<"payrollPeriods"> } : "skip",
  );
  const payslip = useQuery(
    api.payroll.payslip,
    businessId && canView && periodQueryId && payslipEmployee
      ? {
          businessId,
          periodId: periodQueryId as Id<"payrollPeriods">,
          employeeId: payslipEmployee as Id<"employees">,
        }
      : "skip",
  );
  const approve = useMutation(api.payroll.approve);
  const [actionPending, setActionPending] = useState(false);

  if (access && !canView) return <AccessDenied />;
  const canCalculate = Boolean(access?.can["payroll.calculate"]);
  const canApprove = Boolean(access?.can["payroll.approve"]);
  const canManageLoans = Boolean(access?.can["loans.manage"]);
  const selected = periods.find((row) => row._id === periodQueryId) ?? null;
  const activeDetail = detail;

  const doApprove = async () => {
    if (!businessId || !selected) return;
    setActionPending(true);
    try {
      const result = await approve({ businessId, periodId: selected._id as Id<"payrollPeriods"> });
      toast.success(`حقوق تأیید نهایی شد؛ سند ${result.documentNumber} ثبت شد.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · حقوق و دستمزد"
        title="دوره حقوق، فیش و پرداخت"
        description="نرخ‌ها فقط از تنظیمات دارای منبع خوانده می‌شوند. محاسبه، تأیید، سند دوبل و پرداخت خالص در سرور و به‌صورت اتمیک انجام می‌شود."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canCalculate ? <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl" onClick={() => setSettingsOpen(true)}><Settings2 className="size-4" /> تنظیمات قانونی</Button> : null}
            {canCalculate ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setPeriodOpen(true)}><Plus className="size-4" /> دوره حقوق جدید</Button> : null}
          </div>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="دوره‌های ثبت‌شده" value={Number(summary?.periodCount ?? periods.length).toLocaleString("fa-IR")} hint="دوره‌های واقعی" tone="brand" />
        <HrStat label="در انتظار تأیید" value={Number(summary?.pending ?? 0).toLocaleString("fa-IR")} hint="پیش‌نویس یا محاسبه‌شده" tone="gold" />
        <HrStat label="تأییدشده و پرداخت‌نشده" value={Number(summary?.approvedUnpaid ?? 0).toLocaleString("fa-IR")} hint="نیازمند پرداخت" tone="danger" />
        <HrStat label="هزینه حقوق ثبت‌شده" value={formatMoney(Number(summary?.totalCost ?? 0), currency)} hint="حقوق + بیمه کارفرما" tone="mist" />
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-hairline bg-white/70 p-1.5 dark:bg-card/60">
        {[
          { key: "periods" as const, label: "دوره‌های حقوق", icon: ReceiptText },
          { key: "settings", label: "نرخ‌ها و اجزا", icon: Settings2 },
          { key: "loans", label: "وام و مساعده", icon: BadgeDollarSign },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key as Tab)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-semibold", tab === item.key ? "bg-brand text-cream" : "text-ink-soft hover:bg-muted")}><item.icon className="size-3.5" />{item.label}</button>
        ))}
      </div>

      {tab === "periods" ? (
        <div className="grid gap-3 lg:grid-cols-[310px_1fr]">
          <Panel className="h-fit">
            <PanelHeader eyebrow="دوره‌ها" title="تاریخچه حقوق" description="سوابق تأییدشده قابل بازنویسی نیستند." />
            {periods.length === 0 ? <div className="px-4 pb-4 text-[9px] text-ink-soft">هنوز دوره‌ای ساخته نشده است.</div> : (
              <div className="space-y-1.5 px-3 pb-3">
                {periods.map((period) => (
                  <button key={period._id} type="button" onClick={() => setPeriodId(period._id)} className={cn("w-full rounded-xl border p-3 text-right transition-colors", (periodId ?? periods[0]?._id) === period._id ? "border-brand/25 bg-brand-soft/50" : "border-hairline bg-background/50 hover:bg-muted/50")}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold">{period.title}</span><HrPill label={PAYROLL_STATUS_LABELS[period.status]} tone={statusTone(period.status)} /></div>
                    <p className="num mt-1.5 text-[8px] text-ink-soft">{period.employeeCount} پرسنل · خالص {formatMoney(period.netTotal, currency)}</p>
                  </button>
                ))}
              </div>
            )}
          </Panel>
          <Panel className="min-w-0">
            {!selected ? <EmptyState icon={<Calculator className="size-5" />} title="دوره حقوق را ایجاد کنید" description="پس از انتخاب تنظیمات دارای منبع، دوره ماهانه ساخته و محاسبه می‌شود." /> : (
              <>
                <PanelHeader
                  eyebrow={PAYROLL_STATUS_LABELS[selected.status]}
                  title={selected.title}
                  description={`${formatJalali(selected.startAt)} تا ${formatJalali(selected.endAt)} · ${selected.employeeCount} پرسنل`}
                  action={
                    <div className="flex flex-wrap gap-1.5">
                      {canCalculate && (selected.status === "draft" || selected.status === "calculated") ? <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setCalculateOpen(true)}><Calculator className="size-3.5" /> {selected.status === "calculated" ? "محاسبه مجدد" : "محاسبه"}</Button> : null}
                      {canApprove && selected.status === "calculated" ? <Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" disabled={actionPending} onClick={() => void doApprove()}>{actionPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} تأیید نهایی</Button> : null}
                      {canApprove && selected.status === "approved" ? <Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setPayOpen(true)}><Wallet className="size-3.5" /> پرداخت حقوق</Button> : null}
                    </div>
                  }
                />
                <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
                  <MiniStat label="جمع حقوق" value={formatMoney(selected.grossTotal, currency)} />
                  <MiniStat label="بیمه" value={formatMoney(selected.employeeInsuranceTotal + selected.employerInsuranceTotal, currency)} />
                  <MiniStat label="مالیات" value={formatMoney(selected.taxTotal, currency)} />
                  <MiniStat label="خالص" value={formatMoney(selected.netTotal, currency)} tone />
                </div>
                {!activeDetail ? <Skeleton className="m-4 h-48 rounded-2xl" /> : activeDetail.records.length === 0 ? <EmptyState icon={<Calculator className="size-5" />} title="محاسبه‌ای انجام نشده" description="با دکمه محاسبه، حقوق پرسنل دارای قرارداد معتبر را محاسبه کنید." /> : (
                  <div className="overflow-x-auto px-4 pb-4">
                    <table className="w-full text-right">
                      <thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="p-2">پرسنل</th><th className="p-2">پایه</th><th className="p-2">اضافه‌کاری</th><th className="p-2">جمع</th><th className="p-2">بیمه</th><th className="p-2">مالیات</th><th className="p-2">کسورات</th><th className="p-2">خالص</th><th className="p-2">فیش</th></tr></thead>
                      <tbody>{activeDetail.records.map((record) => (
                        <tr key={record._id} className="border-b border-hairline/60 text-[9px]">
                          <td className="p-2"><b>{record.employeeName}</b><span className="num block text-[8px] text-ink-soft">{record.employeeCode}</span></td>
                          <td className="num p-2">{formatNumber(record.baseSalary)}</td>
                          <td className="num p-2">{formatNumber(record.overtimePay)}</td>
                          <td className="num p-2 font-bold">{formatNumber(record.gross)}</td>
                          <td className="num p-2">{formatNumber(record.insuranceEmployee)}</td>
                          <td className="num p-2">{formatNumber(record.tax)}</td>
                          <td className="num p-2">{formatNumber(record.loanDeduction + record.advanceDeduction + record.otherDeductions)}</td>
                          <td className="num p-2 font-black text-brand">{formatNumber(record.net)}</td>
                          <td className="p-2"><Button size="sm" variant="ghost" className="h-7 gap-1 rounded-lg text-[8px]" onClick={() => setPayslipEmployee(record.employeeId)}><FileText className="size-3" /> مشاهده</Button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "settings" ? (
        <Panel>
          <PanelHeader eyebrow="قواعد قابل تنظیم" title="نرخ‌های حقوق و بیمه" description="هیچ نرخ قانونی به‌صورت ثابت در کد نیست؛ هر تنظیم باید سال، حوزه و منبع داشته باشد." action={canCalculate ? <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setSettingsOpen(true)}><Plus className="size-3.5" /> تنظیم جدید</Button> : null} />
          {settings.length === 0 ? <EmptyState icon={<Settings2 className="size-5" />} title="تنظیمات حقوق تعریف نشده" description="برای محاسبه، نرخ بیمه، معافیت، پله‌های مالیات و مزایا را با منبع معتبر ثبت کنید." /> : (
            <div className="grid gap-2 px-4 pb-4 md:grid-cols-2">
              {settings.map((setting) => (
                <div key={setting._id} className="rounded-2xl border border-hairline bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold">{setting.year} · {setting.jurisdiction}</p><p className="mt-1 text-[8px] text-ink-soft">{setting.sourceTitle}</p></div><HrPill label={setting.active ? "فعال" : "غیرفعال"} tone={setting.active ? "brand" : "muted"} /></div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[8px] text-ink-soft"><span>بیمه کارمند: <b className="num">{setting.employeeInsuranceBps / 100}٪</b></span><span>بیمه کارفرما: <b className="num">{setting.employerInsuranceBps / 100}٪</b></span><span>حق مسکن: <b className="num">{formatNumber(setting.housingAllowance)}</b></span><span>غذا: <b className="num">{formatNumber(setting.foodAllowance)}</b></span><span className="col-span-2">پله‌های مالیات: <b className="num">{setting.taxBrackets.length}</b></span></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "loans" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <Panel>
            <PanelHeader eyebrow="مطالبات پرسنل" title="وام و مساعده" description="پرداخت وام سند دریافتنی و گردش نقدی می‌سازد؛ کسر قسط در تأیید حقوق ثبت می‌شود." action={canManageLoans ? <Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setLoanOpen(true)}><Plus className="size-3.5" /> وام / مساعده</Button> : null} />
            {loans.length === 0 ? <EmptyState icon={<BadgeDollarSign className="size-5" />} title="وام یا مساعده‌ای ثبت نشده" description="پرداخت‌ها از صندوق/بانک ثبت و به حساب مطالبات پرسنل منتقل می‌شوند." /> : (
              <div className="overflow-x-auto px-4 pb-4"><table className="w-full text-right"><thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="p-2">پرسنل</th><th className="p-2">نوع</th><th className="p-2">مبلغ</th><th className="p-2">تسویه</th><th className="p-2">مانده</th><th className="p-2">اقساط</th><th className="p-2">وضعیت</th></tr></thead>                            <tbody>{loans.map((loan) => <tr key={loan._id} className="cursor-pointer border-b border-hairline/60 text-[9px] hover:bg-muted/40" onClick={() => setLoanDetailId(loan._id)}><td className="p-2 font-semibold">{loan.employeeName}</td><td className="p-2">{loan.type === "loan" ? "وام" : "مساعده"}</td><td className="num p-2">{formatNumber(loan.amount)}</td><td className="num p-2">{formatNumber(loan.paidAmount)}</td><td className="num p-2 font-bold text-gold">{formatNumber(loan.outstanding)}</td><td className="num p-2">{loan.pendingCount} از {loan.installments}</td><td className="p-2"><HrPill label={loan.status === "active" ? "جاری" : loan.status === "settled" ? "تسویه" : "لغو"} tone={loan.status === "active" ? "gold" : "brand"} /></td></tr>)}</tbody></table></div>
            )}
          </Panel>
          <Panel className="h-fit"><PanelHeader eyebrow="خلاصه" title="مانده مطالبات" /><div className="grid grid-cols-2 gap-2 px-4 pb-4"><MiniStat label="تعداد پرونده" value={loans.length.toLocaleString("fa-IR")} /><MiniStat label="مانده کل" value={formatMoney(loans.reduce((sum, row) => sum + row.outstanding, 0), currency)} tone /></div></Panel>
        </div>
      ) : null}

      {periodOpen ? <PeriodDialog open onOpenChange={setPeriodOpen} businessId={businessId} settings={settings} onCreated={(id) => { setPeriodId(id); setCalculateOpen(true); }} /> : null}
      {settingsOpen ? <SettingsDialog open onOpenChange={setSettingsOpen} businessId={businessId} /> : null}
      {loanOpen && selected ? <LoanDialog open onOpenChange={setLoanOpen} businessId={businessId} employees={employees} funds={funds} /> : null}
      {calculateOpen && selected ? <CalculateDialog open onOpenChange={setCalculateOpen} businessId={businessId} periodId={selected._id} employees={employees} /> : null}
      {payOpen && selected ? <PayDialog open onOpenChange={setPayOpen} businessId={businessId} periodId={selected._id} net={selected.netTotal} funds={funds} /> : null}
      {loanDetailId ? <LoanDetailDialog loanId={loanDetailId} businessId={businessId} funds={funds} canManage={canManageLoans} currency={currency} onClose={() => setLoanDetailId(null)} /> : null}
      <Dialog open={Boolean(payslipEmployee)} onOpenChange={(open) => !open && setPayslipEmployee(null)}>
        <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[620px]">
          <DialogHeader><DialogTitle>فیش حقوقی</DialogTitle><DialogDescription className="text-[10px]">فیش از رکورد تأییدشده دوره تولید می‌شود.</DialogDescription></DialogHeader>
          {!payslip ? <Skeleton className="h-64 rounded-2xl" /> : (
            <div className="print-sheet rounded-2xl border border-hairline bg-white p-5 text-ink">
              <div className="flex items-start justify-between border-b border-hairline pb-3">
                <div><p className="text-[9px] font-semibold text-gold">HESAB VIRA</p><h3 className="mt-1 text-sm font-black">{payslip.businessName}</h3><p className="mt-1 text-[8px] text-ink-soft">فیش حقوقی {payslip.period.title}</p></div>
                <div className="text-left text-[8px] text-ink-soft"><p>{payslip.employee.name}</p><p className="num">{payslip.employee.code}</p><p>{payslip.employee.branchName}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 text-[8px] text-ink-soft"><span>عنوان شغلی: {payslip.employee.jobTitle}</span><span>بانک: {payslip.employee.bankName ?? "—"}</span><span className="num">حساب: {payslip.employee.bankAccount ?? "—"}</span><span className="num">بازه: {formatJalali(payslip.period.startAt)} تا {formatJalali(payslip.period.endAt)}</span></div>
              <table className="mt-4 w-full text-right"><thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="py-1">جزء حقوق</th><th className="py-1">نوع</th><th className="py-1">مبلغ</th></tr></thead><tbody>{payslip.components.map((component) => <tr key={component._id} className="border-b border-hairline/50 text-[9px]"><td className="py-1.5">{component.label}</td><td className="py-1.5 text-[8px] text-ink-soft">{component.kind === "earning" ? "مزایا" : component.kind === "deduction" ? "کسورات" : "کارفرما"}</td><td className="num py-1.5">{formatMoney(component.kind === "deduction" ? -component.amount : component.amount, payslip.currency)}</td></tr>)}</tbody></table>
              <div className="mt-3 rounded-xl bg-brand-soft/50 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-bold">خالص پرداختی</span><span className="num text-sm font-black text-brand">{formatMoney(payslip.record.net, payslip.currency)}</span></div><p className="mt-1 text-[8px] leading-4 text-ink-soft">{numberToPersianWords(Math.max(0, payslip.record.net))} {payslip.currency === "IRR" ? "ریال" : "تومان"}</p></div>
              <div className="mt-5 flex items-end justify-between text-[8px] text-ink-soft"><span>مهر و امضای کارفرما</span><span>تاریخ چاپ: {formatJalali(Date.now())}</span></div>
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPayslipEmployee(null)}>بستن</Button><Button onClick={() => window.print()} className="gap-1.5"><Printer className="size-4" /> چاپ / PDF</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value, tone = false }: { label: string; value: string; tone?: boolean }) {
  return <div className="rounded-xl border border-hairline bg-background/60 p-2.5"><p className="text-[8px] text-ink-soft">{label}</p><p className={cn("num mt-1 text-[12px] font-black", tone ? "text-brand" : "text-ink")}>{value}</p></div>;
}

function PeriodDialog({ open, onOpenChange, businessId, settings, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; settings: { _id: string; year: number; jurisdiction: string; active: boolean; sourceTitle: string }[]; onCreated: (id: string) => void }) {
  const now = currentJalali();
  const create = useMutation(api.payroll.createPeriod);
  const active = settings.filter((row) => row.active);
  const [form, setForm] = useState({ year: String(now.year), month: String(now.month), settingsId: active[0]?._id ?? "", title: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.settingsId) { toast.error("تنظیمات حقوق را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const result = await create({ businessId, year: Number(form.year), month: Number(form.month), settingsId: form.settingsId as Id<"payrollSettings">, title: form.title.trim() || undefined });
      toast.success("دوره حقوق ایجاد شد."); onCreated(result.periodId); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[500px]"><DialogHeader><DialogTitle>دوره حقوق جدید</DialogTitle><DialogDescription className="text-[11px]">سال و ماه شمسی است؛ بازه واقعی از تقویم محاسبه می‌شود.</DialogDescription></DialogHeader>{active.length === 0 ? <div className="rounded-xl bg-destructive/5 p-3 text-[10px] text-destructive">ابتدا یک تنظیم حقوق فعال با منبع معتبر بسازید.</div> : <form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="سال *"><Input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="ماه *"><Input value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field></div><Field label="تنظیمات حقوق *"><Select value={form.settingsId} onValueChange={(value) => setForm({ ...form, settingsId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{active.map((row) => <SelectItem key={row._id} value={row._id}>{row.year} · {row.jurisdiction} · {row.sourceTitle}</SelectItem>)}</SelectContent></Select></Field><Field label="عنوان"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />} ایجاد دوره</Button></DialogFooter></form>}</DialogContent></Dialog>
  );
}

function SettingsDialog({ open, onOpenChange, businessId }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses"> }) {
  const now = currentJalali();
  const create = useMutation(api.payroll.createSettings);
  const [form, setForm] = useState({
    year: String(now.year), jurisdiction: "ایران", effectiveFrom: new Date().toISOString().slice(0, 10),
    employeeInsurance: "", employerInsurance: "", exemption: "", housing: "", food: "", overtime: "",
    workDays: "", sourceTitle: "", sourceUrl: "", bracket1: "", rate1: "", bracket2: "", rate2: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    const brackets = [
      { upTo: Number(form.bracket1) || 0, rateBps: Math.round((Number(form.rate1) || 0) * 100) },
      { upTo: Number(form.bracket2) || 0, rateBps: Math.round((Number(form.rate2) || 0) * 100) },
    ].filter((row) => row.upTo > 0);
    if (!form.sourceTitle.trim() || brackets.length === 0) { toast.error("منبع قانونی و حداقل یک پله مالیات لازم است."); return; }
    if (!form.employeeInsurance.trim() || !form.employerInsurance.trim() || !form.overtime.trim() || !form.workDays.trim()) { toast.error("درصدهای بیمه، ضریب اضافه‌کاری و روز کاری ماه را از منبع وارد کنید."); return; }
    setSaving(true);
    try {
      await create({ businessId, year: Number(form.year), jurisdiction: form.jurisdiction, effectiveFrom: fromDateInput(form.effectiveFrom), employeeInsuranceBps: Math.round(Number(form.employeeInsurance) * 100), employerInsuranceBps: Math.round(Number(form.employerInsurance) * 100), taxExemption: Number(form.exemption) || 0, taxBrackets: brackets, housingAllowance: Number(form.housing) || 0, foodAllowance: Number(form.food) || 0, overtimeMultiplierBps: Math.round(Number(form.overtime) * 100), monthlyWorkDays: Number(form.workDays) || 30, sourceTitle: form.sourceTitle.trim(), sourceUrl: form.sourceUrl.trim() || undefined, notes: form.notes.trim() || undefined });
      toast.success("تنظیمات حقوق ثبت شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[680px]"><DialogHeader><DialogTitle>تنظیمات حقوق و نرخ‌های قانونی</DialogTitle><DialogDescription className="text-[11px]">این مقادیر پیش‌فرض نیستند؛ باید برای سال و حوزه قضایی با منبع معتبر وارد شوند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><Field label="سال *"><Input value={form.year} onChange={(e) => set("year", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="حوزه قضایی *"><Input value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field><Field label="شروع اعتبار"><Input type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="بیمه کارمند (٪)"><Input value={form.employeeInsurance} onChange={(e) => set("employeeInsurance", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="بیمه کارفرما (٪)"><Input value={form.employerInsurance} onChange={(e) => set("employerInsurance", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="معافیت مالیات"><Input value={form.exemption} onChange={(e) => set("exemption", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="حق مسکن"><Input value={form.housing} onChange={(e) => set("housing", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="کمک‌هزینه غذا"><Input value={form.food} onChange={(e) => set("food", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="ضریب اضافه‌کاری (٪)"><Input value={form.overtime} onChange={(e) => set("overtime", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="روز کاری ماه"><Input value={form.workDays} onChange={(e) => set("workDays", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="سقف پله ۱"><Input value={form.bracket1} onChange={(e) => set("bracket1", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="نرخ پله ۱ (٪)"><Input value={form.rate1} onChange={(e) => set("rate1", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="سقف پله ۲"><Input value={form.bracket2} onChange={(e) => set("bracket2", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="نرخ پله ۲ (٪)"><Input value={form.rate2} onChange={(e) => set("rate2", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="منبع قانونی *" className="sm:col-span-2"><Input value={form.sourceTitle} onChange={(e) => set("sourceTitle", e.target.value)} className="h-9 rounded-xl text-[11px]" placeholder="نام قانون/بخشنامه و سال" /></Field><Field label="نشانی منبع"><Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} dir="ltr" className="h-9 rounded-xl text-[11px]" /></Field><Field label="یادداشت" className="sm:col-span-3"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} ثبت تنظیمات</Button></DialogFooter></form></DialogContent></Dialog>
  );
}

function CalculateDialog({ open, onOpenChange, businessId, periodId, employees }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; periodId: string; employees: { _id: string; fullName: string; code: string; status: string }[] }) {
  const calculate = useMutation(api.payroll.calculate);
  const [adjustments, setAdjustments] = useState<Record<string, { bonus: string; commission: string; otherEarnings: string; otherDeductions: string }>>({});
  const [saving, setSaving] = useState(false);
  const update = (employeeId: string, key: string, value: string) => setAdjustments((current) => ({ ...current, [employeeId]: { ...(current[employeeId] ?? { bonus: "", commission: "", otherEarnings: "", otherDeductions: "" }), [key]: value } }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      const rows = employees
        .filter((employee) => employee.status === "active" || employee.status === "on_leave")
        .map((employee) => {
          const values = adjustments[employee._id] ?? { bonus: "", commission: "", otherEarnings: "", otherDeductions: "" };
          return { employeeId: employee._id as Id<"employees">, bonus: Number(values.bonus) || 0, commission: Number(values.commission) || 0, otherEarnings: Number(values.otherEarnings) || 0, otherDeductions: Number(values.otherDeductions) || 0 };
        });
      const result = await calculate({ businessId, periodId: periodId as Id<"payrollPeriods">, adjustments: rows });
      toast.success(`حقوق ${result.employeeCount} پرسنل محاسبه شد.`); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[780px]"><DialogHeader><DialogTitle>محاسبه حقوق و تعدیلات</DialogTitle><DialogDescription className="text-[11px]">پاداش، پورسانت و کسورات هر پرسنل را وارد کنید. قرارداد، حضور و اقساط از داده واقعی خوانده می‌شوند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3">{employees.length === 0 ? <p className="text-[10px] text-ink-soft">پرسنلی ثبت نشده است.</p> : <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-hairline"><table className="w-full text-right"><thead className="sticky top-0 bg-muted"><tr className="text-[8px] text-ink-soft"><th className="p-2">پرسنل</th><th className="p-1">پاداش</th><th className="p-1">پورسانت</th><th className="p-1">سایر مزایا</th><th className="p-1">سایر کسورات</th></tr></thead><tbody>{employees.map((employee) => { const values = adjustments[employee._id] ?? { bonus: "", commission: "", otherEarnings: "", otherDeductions: "" }; return <tr key={employee._id} className="border-t border-hairline/50 text-[9px]"><td className="p-2"><b>{employee.fullName}</b><span className="num block text-[8px] text-ink-soft">{employee.code}</span></td>{(Object.keys(values) as (keyof typeof values)[]).map((key) => <td key={key} className="p-1"><Input value={values[key]} onChange={(e) => update(employee._id, key, e.target.value)} dir="ltr" placeholder="0" className="num h-7 w-24 rounded-lg text-[9px]" /></td>)}</tr>; })}</tbody></table></div>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />} محاسبه حقوق</Button></DialogFooter></form></DialogContent></Dialog>
  );
}

function PayDialog({ open, onOpenChange, businessId, periodId, net, funds }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; periodId: string; net: number; funds: { _id: string; name: string }[] }) {
  const pay = useMutation(api.payroll.pay);
  const [fundId, setFundId] = useState(funds[0]?._id ?? "");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !fundId) { toast.error("صندوق پرداخت را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const result = await pay({ businessId, periodId: periodId as Id<"payrollPeriods">, paidAt: Date.now(), sourceType: "cash", cashFundId: fundId as Id<"cashFunds"> });
      toast.success(result.accountingDocumentId ? "پرداخت ثبت و سند متوازن ایجاد شد." : "دوره بدون خالص پرداختی بسته شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[460px]"><DialogHeader><DialogTitle>پرداخت خالص حقوق</DialogTitle><DialogDescription className="text-[11px]">مبلغ {formatMoney(net)} از صندوق انتخاب‌شده پرداخت و سند جداگانه ثبت می‌شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3">{funds.length === 0 ? <p className="rounded-xl bg-destructive/5 p-3 text-[10px] text-destructive">صندوق فعالی ندارید؛ ابتدا در بخش مالی صندوق ایجاد کنید.</p> : <Field label="صندوق پرداخت *"><Select value={fundId} onValueChange={setFundId}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{funds.map((fund) => <SelectItem key={fund._id} value={fund._id}>{fund.name}</SelectItem>)}</SelectContent></Select></Field>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving || funds.length === 0}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />} پرداخت و ثبت سند</Button></DialogFooter></form></DialogContent></Dialog>
  );
}

function LoanDetailDialog({ loanId, businessId, funds, canManage, currency, onClose }: { loanId: string; businessId?: Id<"businesses">; funds: { _id: string; name: string }[]; canManage: boolean; currency: string; onClose: () => void }) {
  const detail = useQuery(api.loans.get, businessId ? { businessId, loanId: loanId as Id<"employeeLoans"> } : "skip");
  const pay = useMutation(api.loans.payInstallment);
  const [installmentId, setInstallmentId] = useState<string | null>(null);
  const [fundId, setFundId] = useState(funds[0]?._id ?? "");
  const [paidAt, setPaidAt] = useState(toDateInput(Date.now()));
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !installmentId || !fundId) { toast.error("قسط و صندوق را انتخاب کنید."); return; }
    setSaving(true);
    try {
      await pay({ businessId, installmentId: installmentId as Id<"loanInstallments">, paidAt: fromDateInput(paidAt), sourceType: "cash", cashFundId: fundId as Id<"cashFunds"> });
      toast.success("قسط دریافت و سند آن ثبت شد.");
      setInstallmentId(null);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[620px]"><DialogHeader><DialogTitle>جزئیات وام / مساعده</DialogTitle><DialogDescription className="text-[10px]" >{detail ? `${detail.employeeName} · ${detail.employeeCode} · مانده ${formatMoney(detail.outstanding, currency)}` : "در حال دریافت..."}</DialogDescription></DialogHeader>{!detail ? <Skeleton className="h-48 rounded-2xl" /> : <div className="space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><MiniStat label="مبلغ" value={formatMoney(detail.amount, currency)} /><MiniStat label="پرداخت‌شده" value={formatMoney(detail.paidAmount, currency)} /><MiniStat label="مانده" value={formatMoney(detail.outstanding, currency)} tone /><MiniStat label="اقساط" value={`${detail.pendingCount} باقی`} /></div><div className="overflow-x-auto rounded-xl border border-hairline"><table className="w-full text-right"><thead><tr className="bg-muted/50 text-[8px] text-ink-soft"><th className="p-2">قسط</th><th className="p-2">مبلغ</th><th className="p-2">سررسید</th><th className="p-2">وضعیت</th><th className="p-2">پرداخت</th></tr></thead><tbody>{detail.installments.map((installment) => <tr key={installment._id} className="border-t border-hairline/50 text-[9px]"><td className="num p-2">{installment.number}</td><td className="num p-2">{formatMoney(installment.amount, currency)}</td><td className="num p-2">{formatJalali(installment.dueDate)}</td><td className="p-2"><HrPill label={installment.status === "pending" ? "در انتظار" : installment.status === "deducted" ? "کسر از حقوق" : "پرداخت‌شده"} tone={installment.status === "pending" ? "gold" : "brand"} /></td><td className="p-2">{canManage && installment.status === "pending" ? <Button size="sm" variant="outline" className="h-6 rounded-md px-2 text-[8px]" onClick={() => setInstallmentId(installment._id)}>ثبت پرداخت</Button> : <span className="text-[8px] text-ink-soft">—</span>}</td></tr>)}</tbody></table></div>{installmentId ? <form onSubmit={submit} className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-3"><p className="text-[9px] font-bold text-gold">ثبت دریافت قسط</p><div className="grid grid-cols-2 gap-2"><Field label="صندوق دریافت"><Select value={fundId} onValueChange={setFundId}><SelectTrigger className="h-8 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent>{funds.map((fund) => <SelectItem key={fund._id} value={fund._id}>{fund.name}</SelectItem>)}</SelectContent></Select></Field><Field label="تاریخ دریافت"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} dir="ltr" className="num h-8 rounded-lg text-[9px]" /></Field></div><div className="flex justify-end gap-1.5"><Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => setInstallmentId(null)}>انصراف</Button><Button type="submit" size="sm" className="h-7 rounded-lg text-[8px]" disabled={saving}>{saving ? <Loader2 className="size-3 animate-spin" /> : <Wallet className="size-3" />} ثبت و صدور سند</Button></div></form> : null}</div>}<DialogFooter><Button variant="outline" onClick={onClose}>بستن</Button></DialogFooter></DialogContent></Dialog>
  );
}

function LoanDialog({ open, onOpenChange, businessId, employees, funds }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; employees: { _id: string; fullName: string; code: string }[]; funds: { _id: string; name: string }[] }) {
  const create = useMutation(api.loans.create);
  const [form, setForm] = useState({ employeeId: "", type: "loan", amount: "", installments: "12", description: "", fundId: funds[0]?._id ?? "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.employeeId || !form.fundId) { toast.error("پرسنل و صندوق را انتخاب کنید."); return; }
    setSaving(true);
    try {
      await create({ businessId, employeeId: form.employeeId as Id<"employees">, type: form.type as "loan", amount: Number(form.amount) || 0, paidAt: Date.now(), installments: Number(form.installments) || 1, sourceType: "cash", cashFundId: form.fundId as Id<"cashFunds">, description: form.description.trim() || undefined });
      toast.success("وام ثبت و سند دریافتنی ایجاد شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[520px]"><DialogHeader><DialogTitle>ثبت وام / مساعده</DialogTitle><DialogDescription className="text-[11px]">پرداخت از صندوق انجام و اقساط خودکار ساخته می‌شوند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="پرسنل *"><Select value={form.employeeId} onValueChange={(value) => setForm({ ...form, employeeId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب پرسنل" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName} · {employee.code}</SelectItem>)}</SelectContent></Select></Field><div className="grid grid-cols-2 gap-3"><Field label="نوع"><Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="loan">وام</SelectItem><SelectItem value="advance">مساعده</SelectItem></SelectContent></Select></Field><Field label="تعداد اقساط"><Input value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="مبلغ *"><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="صندوق پرداخت *"><Select value={form.fundId} onValueChange={(value) => setForm({ ...form, fundId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{funds.map((fund) => <SelectItem key={fund._id} value={fund._id}>{fund.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="توضیح"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <BadgeDollarSign className="size-4" />} ثبت و پرداخت</Button></DialogFooter></form></DialogContent></Dialog>
  );
}
