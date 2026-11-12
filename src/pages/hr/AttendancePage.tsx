import {
  ATTENDANCE_STATUS_LABELS,
  AccessDenied,
  HrPill,
  HrStat,
  LEAVE_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  currentMonthRange,
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
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarCheck2,
  Check,
  Clock3,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Plane,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Tab = "attendance" | "leave" | "missions";

function toMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return hour * 60 + minute;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-[9px] text-ink-soft">{label}</Label><div className="mt-1">{children}</div></div>;
}

export default function AttendancePage() {
  const { businessId, branches } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["hr.view"]);
  const range = useMemo(currentMonthRange, []);
  const [from, setFrom] = useState(toDateInput(range.from.getTime()));
  const [to, setTo] = useState(toDateInput(range.to.getTime()));
  const [tab, setTab] = useState<Tab>("attendance");
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [missionOpen, setMissionOpen] = useState(false);
  const employees = useQuery(api.hr.employees, businessId && canView ? { businessId } : "skip") ?? [];
  const attendance = useQuery(
    api.hr.attendance,
    businessId && canView ? { businessId, from: fromDateInput(from), to: fromDateInput(to, true) } : "skip",
  ) ?? [];
  const leaves = useQuery(api.hr.leaveRequests, businessId && canView ? { businessId } : "skip") ?? [];
  const missions = useQuery(api.hr.missions, businessId && canView ? { businessId } : "skip") ?? [];
  const settings = useQuery(
    api.hr.attendanceSettings,
    businessId && canView && access?.can["attendance.manage"] ? { businessId } : "skip",
  );
  const importRows = useMutation(api.hr.importAttendance);
  const decideLeave = useMutation(api.hr.decideLeaveRequest);
  const decideMission = useMutation(api.hr.decideMission);
  const [importing, setImporting] = useState(false);
  const [decisionPending, setDecisionPending] = useState<string | null>(null);

  if (access && !canView) return <AccessDenied />;
  const canAttendance = Boolean(access?.can["attendance.manage"]);
  const canRequest = Boolean(access?.can["leave.request"]);
  const canApprove = Boolean(access?.can["leave.approve"]);
  const totals = attendance.reduce(
    (acc, row) => ({
      work: acc.work + row.workMinutes,
      overtime: acc.overtime + row.overtimeMinutes,
      late: acc.late + row.lateMinutes,
      absence: acc.absence + row.absenceMinutes,
    }),
    { work: 0, overtime: 0, late: 0, absence: 0 },
  );
  const pendingLeaves = leaves.filter((row) => row.status === "pending");
  const pendingMissions = missions.filter((row) => row.status === "pending");

  const importCsv = async (file: File) => {
    if (!businessId) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const byCode = new Map(employees.map((row) => [row.code, row._id]));
      const rows = lines
        .map((line) => line.split(/[,;\t]/).map((cell) => cell.trim()))
        .filter((cells) => cells.length >= 4 && byCode.has(cells[0]) && /^\d{4}-\d{2}-\d{2}$/.test(cells[1]))
        .map((cells) => ({
          employeeId: byCode.get(cells[0]) as Id<"employees">,
          date: fromDateInput(cells[1]),
          checkInMinute: toMinute(cells[2]),
          checkOutMinute: toMinute(cells[3]),
        }));
      if (rows.length === 0) throw new Error("ردیف معتبری پیدا نشد. قالب: کد پرسنلی، تاریخ، ورود، خروج");
      const result = await importRows({ businessId, rows });
      toast.success(`${result.accepted.toLocaleString("fa-IR")} ردیف حضور ثبت یا به‌روزرسانی شد.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const decide = async (
    kind: "leave" | "mission",
    id: string,
    decision: "approved" | "rejected",
  ) => {
    if (!businessId) return;
    setDecisionPending(id);
    try {
      if (kind === "leave") {
        await decideLeave({ businessId, requestId: id as Id<"leaveRequests">, decision });
      } else {
        await decideMission({ businessId, missionId: id as Id<"missions">, decision });
      }
      toast.success(decision === "approved" ? "درخواست تأیید شد." : "درخواست رد شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDecisionPending(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · حضور و مرخصی"
        title="حضور، مرخصی و مأموریت"
        description="ثبت دستی و ورود گروهی حضور، محاسبه تأخیر و اضافه‌کاری، گردش تأیید مرخصی و مأموریت با تاریخچه واقعی."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canAttendance ? (
              <>
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[9px] font-semibold text-ink-soft hover:bg-muted dark:bg-card">
                  {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />}
                  ورود از فایل
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.target.value = ""; }} />
                </label>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setSettingsOpen(true)}><Settings2 className="size-4" /> تنظیم ساعت کاری</Button>
              </>
            ) : null}
            {tab === "attendance" && canAttendance ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setAttendanceOpen(true)}><Plus className="size-4" /> ثبت حضور</Button> : null}
            {tab === "leave" && canRequest ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setLeaveOpen(true)}><Plus className="size-4" /> درخواست مرخصی</Button> : null}
            {tab === "missions" && canRequest ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setMissionOpen(true)}><Plane className="size-4" /> مأموریت</Button> : null}
          </div>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="ساعت کارکرد ماه" value={Math.round(totals.work / 60).toLocaleString("fa-IR")} hint="ساعت" tone="brand" />
        <HrStat label="اضافه‌کاری" value={Math.round(totals.overtime / 60).toLocaleString("fa-IR")} hint="ساعت" tone="gold" />
        <HrStat label="تأخیر" value={totals.late.toLocaleString("fa-IR")} hint="دقیقه" tone="danger" />
        <HrStat label="در انتظار تأیید" value={(pendingLeaves.length + pendingMissions.length).toLocaleString("fa-IR")} hint="مرخصی و مأموریت" tone="mist" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-hairline bg-white/70 p-1.5 dark:bg-card/60">
          {[
            { key: "attendance" as const, label: "حضور و غیاب", icon: CalendarCheck2 },
            { key: "leave" as const, label: "مرخصی‌ها", icon: Clock3 },
            { key: "missions" as const, label: "مأموریت‌ها", icon: Plane },
          ].map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-semibold", tab === item.key ? "bg-brand text-cream" : "text-ink-soft hover:bg-muted")}><item.icon className="size-3.5" />{item.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} dir="ltr" className="num h-8 w-32 rounded-lg text-[9px]" />
          <span className="text-[9px] text-ink-soft">تا</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} dir="ltr" className="num h-8 w-32 rounded-lg text-[9px]" />
        </div>
      </div>

      {tab === "attendance" ? (
        <Panel>
          <PanelHeader eyebrow="دفتر حضور" title="ثبت‌های ماه" description="ورود و خروج، تأخیر، غیبت و اضافه‌کاری مستقیماً از سرور محاسبه می‌شوند." />
          {!access ? <Skeleton className="m-4 h-64 rounded-2xl" /> : attendance.length === 0 ? <EmptyState icon={<CalendarCheck2 className="size-5" />} title="حضوری در این بازه ثبت نشده" description="یک رکورد دستی ثبت کنید یا فایل CSV با ستون‌های کد پرسنلی، تاریخ، ورود و خروج بارگذاری کنید." /> : (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-right">
                <thead><tr className="border-b border-hairline text-[9px] text-ink-soft"><th className="p-2">پرسنل</th><th className="p-2">تاریخ</th><th className="p-2">ورود/خروج</th><th className="p-2">کارکرد</th><th className="p-2">تأخیر</th><th className="p-2">اضافه‌کاری</th><th className="p-2">وضعیت</th></tr></thead>
                <tbody>{attendance.slice(0, 200).map((row) => (
                  <tr key={row._id} className="border-b border-hairline/60 text-[10px]">
                    <td className="p-2"><b>{row.employeeName}</b><span className="num block text-[8px] text-ink-soft">{row.employeeCode}</span></td>
                    <td className="num p-2">{toDateInput(row.date)}</td>
                    <td className="num p-2">{row.checkInMinute !== undefined ? `${String(Math.floor(row.checkInMinute / 60)).padStart(2, "0")}:${String(row.checkInMinute % 60).padStart(2, "0")}` : "—"} / {row.checkOutMinute !== undefined ? `${String(Math.floor(row.checkOutMinute / 60)).padStart(2, "0")}:${String(row.checkOutMinute % 60).padStart(2, "0")}` : "—"}</td>
                    <td className="num p-2">{Math.floor(row.workMinutes / 60)}:{String(row.workMinutes % 60).padStart(2, "0")}</td>
                    <td className="num p-2">{row.lateMinutes}</td>
                    <td className="num p-2">{row.overtimeMinutes}</td>
                    <td className="p-2"><HrPill label={ATTENDANCE_STATUS_LABELS[row.status]} tone={statusTone(row.status)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "leave" ? (
        <Panel>
          <PanelHeader eyebrow="گردش درخواست" title="مرخصی و مانده استحقاقی" description="تأیید فقط با مجوز leave.approve و با ثبت تاریخچه انجام می‌شود." />
          {leaves.length === 0 ? <EmptyState icon={<Clock3 className="size-5" />} title="درخواست مرخصی ندارید" description="درخواست جدید را ثبت کنید؛ مانده مرخصی در سرور کنترل می‌شود." /> : (
            <div className="space-y-2 px-4 pb-4">
              {leaves.slice(0, 100).map((leave) => (
                <div key={leave._id} className="flex flex-col gap-2 rounded-2xl border border-hairline bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold">{leave.employeeName}</p>
                    <p className="mt-1 text-[9px] text-ink-soft">{LEAVE_TYPE_LABELS[leave.type]} · <span className="num">{toDateInput(leave.startDate)} تا {toDateInput(leave.endDate)}</span> · <b className="num">{leave.days} روز</b></p>
                    <p className="mt-1 text-[8px] text-ink-soft">{leave.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <HrPill label={REQUEST_STATUS_LABELS[leave.status]} tone={statusTone(leave.status)} />
                    {canApprove && leave.status === "pending" ? (
                      <>
                        <Button size="sm" className="h-7 gap-1 rounded-lg text-[8px]" disabled={decisionPending === leave._id} onClick={() => void decide("leave", leave._id, "approved")}>{decisionPending === leave._id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} تأیید</Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[8px]" disabled={decisionPending === leave._id} onClick={() => void decide("leave", leave._id, "rejected")}><X className="size-3" /> رد</Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "missions" ? (
        <Panel>
          <PanelHeader eyebrow="سفرهای کاری" title="مأموریت‌ها" description="ثبت مقصد، بازه و هدف مأموریت با گردش تأیید." />
          {missions.length === 0 ? <EmptyState icon={<Plane className="size-5" />} title="مأموریتی ثبت نشده" description="مأموریت جدید را با بازه و مقصد ثبت کنید." /> : (
            <div className="space-y-2 px-4 pb-4">
              {missions.map((mission) => (
                <div key={mission._id} className="flex flex-col gap-2 rounded-2xl border border-hairline bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-[10px] font-bold">{mission.employeeName}</p><p className="mt-1 flex items-center gap-1 text-[9px] text-ink-soft"><MapPin className="size-3" /> {mission.destination} · <span className="num">{toDateInput(mission.startDate)} تا {toDateInput(mission.endDate)}</span></p><p className="mt-1 text-[8px] text-ink-soft">{mission.purpose}</p></div>
                  <div className="flex items-center gap-2">
                    <HrPill label={REQUEST_STATUS_LABELS[mission.status]} tone={statusTone(mission.status)} />
                    {canApprove && mission.status === "pending" ? <><Button size="sm" className="h-7 rounded-lg text-[8px]" onClick={() => void decide("mission", mission._id, "approved")}>تأیید</Button><Button size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => void decide("mission", mission._id, "rejected")}>رد</Button></> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {attendanceOpen ? <AttendanceDialog open onOpenChange={setAttendanceOpen} businessId={businessId} employees={employees} /> : null}
      {leaveOpen ? <LeaveDialog open onOpenChange={setLeaveOpen} businessId={businessId} employees={employees} /> : null}
      {missionOpen ? <MissionDialog open onOpenChange={setMissionOpen} businessId={businessId} employees={employees} /> : null}
      {settingsOpen && settings ? <SettingsDialog key={`${settings.workStartMinute}-${settings.workEndMinute}-${settings.graceMinutes}`} open onOpenChange={setSettingsOpen} businessId={businessId} settings={settings} /> : null}
    </div>
  );
}

function AttendanceDialog({ open, onOpenChange, businessId, employees }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; employees: { _id: string; fullName: string; code: string }[] }) {
  const record = useMutation(api.hr.recordAttendance);
  const [form, setForm] = useState({ employeeId: "", date: toDateInput(Date.now()), checkIn: "08:00", checkOut: "17:00", status: "present", note: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.employeeId) { toast.error("پرسنل را انتخاب کنید."); return; }
    setSaving(true);
    try {
      await record({ businessId, employeeId: form.employeeId as Id<"employees">, date: fromDateInput(form.date), checkInMinute: toMinute(form.checkIn), checkOutMinute: toMinute(form.checkOut), status: form.status as "present", note: form.note.trim() || undefined });
      toast.success("حضور ثبت شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[520px]">
        <DialogHeader><DialogTitle>ثبت دستی حضور</DialogTitle><DialogDescription className="text-[11px]">تأخیر، کارکرد و اضافه‌کاری در سرور محاسبه می‌شوند.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="پرسنل *"><Select value={form.employeeId} onValueChange={(value) => setForm({ ...form, employeeId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب پرسنل" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName} · {employee.code}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="تاریخ *"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field>
            <Field label="ورود"><Input type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field>
            <Field label="خروج"><Input type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field>
          </div>
          <Field label="وضعیت"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="توضیح"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck2 className="size-4" />} ثبت</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({ open, onOpenChange, businessId, employees }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; employees: { _id: string; fullName: string; code: string }[] }) {
  const create = useMutation(api.hr.createLeaveRequest);
  const [form, setForm] = useState({ employeeId: "", type: "annual", startDate: toDateInput(Date.now() + 86_400_000), endDate: toDateInput(Date.now() + 86_400_000), reason: "" });
  const balance = useQuery(api.hr.leaveBalance, businessId && form.employeeId ? { businessId, employeeId: form.employeeId as Id<"employees"> } : "skip");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.employeeId) { toast.error("پرسنل را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const result = await create({ businessId, employeeId: form.employeeId as Id<"employees">, type: form.type as "annual", startDate: fromDateInput(form.startDate), endDate: fromDateInput(form.endDate), reason: form.reason.trim() });
      toast.success(`درخواست ${result.days} روزه ثبت شد و در انتظار تأیید است.`); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[540px]">
        <DialogHeader><DialogTitle>درخواست مرخصی</DialogTitle><DialogDescription className="text-[11px]">مانده مرخصی و هم‌پوشانی در سرور کنترل می‌شود.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="پرسنل *"><Select value={form.employeeId} onValueChange={(value) => setForm({ ...form, employeeId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب پرسنل" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName} · {employee.code}</SelectItem>)}</SelectContent></Select></Field>
          {balance ? <div className="rounded-xl border border-brand/15 bg-brand-soft/30 px-3 py-2 text-[9px]">مانده استحقاقی: <b className="num">{balance.remaining}</b> روز از {balance.entitlement} روز</div> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="نوع"><Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="شروع"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field>
            <Field label="پایان"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field>
          </div>
          <Field label="علت *"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="rounded-xl text-[11px]" /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Clock3 className="size-4" />} ثبت درخواست</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MissionDialog({ open, onOpenChange, businessId, employees }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; employees: { _id: string; fullName: string; code: string }[] }) {
  const create = useMutation(api.hr.createMission);
  const [form, setForm] = useState({ employeeId: "", startDate: toDateInput(Date.now() + 86_400_000), endDate: toDateInput(Date.now() + 86_400_000), destination: "", purpose: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.employeeId) { toast.error("پرسنل را انتخاب کنید."); return; }
    setSaving(true);
    try {
      await create({ businessId, employeeId: form.employeeId as Id<"employees">, startDate: fromDateInput(form.startDate), endDate: fromDateInput(form.endDate), destination: form.destination.trim(), purpose: form.purpose.trim() });
      toast.success("مأموریت ثبت شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[540px]">
        <DialogHeader><DialogTitle>ثبت مأموریت</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="پرسنل *"><Select value={form.employeeId} onValueChange={(value) => setForm({ ...form, employeeId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب پرسنل" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="شروع"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="پایان"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field></div>
          <Field label="مقصد *"><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field>
          <Field label="هدف مأموریت *"><Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} rows={3} className="rounded-xl text-[11px]" /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plane className="size-4" />} ثبت مأموریت</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ open, onOpenChange, businessId, settings }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; settings?: { workStartMinute: number; workEndMinute: number; graceMinutes: number; expectedDailyMinutes: number; workDays: number[] } | null }) {
  const update = useMutation(api.hr.updateAttendanceSettings);
  const [form, setForm] = useState(() => ({
    start: settings ? `${String(Math.floor(settings.workStartMinute / 60)).padStart(2, "0")}:${String(settings.workStartMinute % 60).padStart(2, "0")}` : "08:00",
    end: settings ? `${String(Math.floor(settings.workEndMinute / 60)).padStart(2, "0")}:${String(settings.workEndMinute % 60).padStart(2, "0")}` : "17:00",
    grace: String(settings?.graceMinutes ?? 10),
    expected: String(settings?.expectedDailyMinutes ?? 480),
    workDays: settings?.workDays ?? [0, 1, 2, 3, 4, 5],
  }));
  const [saving, setSaving] = useState(false);
  const days = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await update({ businessId, workStartMinute: toMinute(form.start) ?? 480, workEndMinute: toMinute(form.end) ?? 1020, graceMinutes: Number(form.grace) || 0, expectedDailyMinutes: Number(form.expected) || 480, workDays: form.workDays });
      toast.success("تنظیمات حضور ذخیره شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[500px]">
        <DialogHeader><DialogTitle>تنظیم ساعت کاری</DialogTitle><DialogDescription className="text-[11px]">این مقادیر مبنای تأخیر و اضافه‌کاری هستند و قابل تغییرند.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="شروع"><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="پایان"><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="مهلت تأخیر (دقیقه)"><Input value={form.grace} onChange={(e) => setForm({ ...form, grace: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="دقیقه کاری روز"><Input value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field></div>
          <div><Label className="text-[9px]">روزهای کاری</Label><div className="mt-2 flex flex-wrap gap-1.5">{days.map((label, index) => <button key={label} type="button" onClick={() => setForm({ ...form, workDays: form.workDays.includes(index) ? form.workDays.filter((day) => day !== index) : [...form.workDays, index] })} className={cn("rounded-lg border px-2 py-1 text-[8px]", form.workDays.includes(index) ? "border-brand bg-brand-soft text-brand" : "border-hairline text-ink-soft")}>{label}</button>)}</div></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>ذخیره تنظیمات</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
