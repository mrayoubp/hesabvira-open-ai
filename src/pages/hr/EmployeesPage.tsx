import { AccessDenied, EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, HrPill, HrStat, fromDateInput, statusTone, toDateInput } from "@/components/hr/shared";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  BookUser,
  BriefcaseBusiness,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";
import { toast } from "sonner";

type ContractSummary = {
  _id: string;
  number: string;
  startDate: number;
  endDate?: number | null;
  baseSalary?: number | null;
  benefits?: number | null;
  paymentTerms?: string;
};

type EmployeeRow = {
  _id: string;
  code: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  email?: string | null;
  hireDate: number;
  jobTitle: string;
  branchId: string;
  orgUnitId?: string;
  positionId?: string;
  employmentType: keyof typeof EMPLOYMENT_TYPE_LABELS;
  status: keyof typeof EMPLOYEE_STATUS_LABELS;
  bankName?: string | null;
  bankAccount?: string | null;
  insuranceNumber?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  leaveEntitlementDays: number;
  notes?: string | null;
  sensitiveVisible?: boolean;
};

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[9px] text-ink-soft">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function EmployeeDialog({
  open,
  onOpenChange,
  businessId,
  branches,
  units,
  positions,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  branches: { _id: string; name: string }[];
  units: { _id: string; name: string }[];
  positions: { _id: string; name: string }[];
  row: EmployeeRow | null;
}) {
  const create = useMutation(api.hr.createEmployee);
  const update = useMutation(api.hr.updateEmployee);
  const [form, setForm] = useState(() => ({
    code: row?.code ?? "",
    firstName: row?.firstName ?? "",
    lastName: row?.lastName ?? "",
    nationalId: row?.nationalId ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
    hireDate: toDateInput(row?.hireDate ?? Date.now()),
    jobTitle: row?.jobTitle ?? "",
    branchId: row?.branchId ?? branches[0]?._id ?? "",
    orgUnitId: row?.orgUnitId ?? "none",
    positionId: row?.positionId ?? "none",
    employmentType: row?.employmentType ?? "full_time",
    bankName: row?.bankName ?? "",
    bankAccount: row?.bankAccount ?? "",
    insuranceNumber: row?.insuranceNumber ?? "",
    address: row?.address ?? "",
    emergencyContact: row?.emergencyContact ?? "",
    leaveEntitlementDays: String(row?.leaveEntitlementDays ?? 26),
    notes: row?.notes ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!form.firstName.trim() || !form.lastName.trim() || !form.branchId) {
      toast.error("نام، نام خانوادگی و شعبه الزامی است.");
      return;
    }
    if (!/^\d{10}$/.test(form.nationalId.trim())) {
      toast.error("کد ملی باید ۱۰ رقم باشد.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        businessId,
        code: form.code.trim() || undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nationalId: form.nationalId.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        hireDate: fromDateInput(form.hireDate),
        jobTitle: form.jobTitle.trim() || "کارشناس",
        branchId: form.branchId as Id<"branches">,
        orgUnitId: form.orgUnitId === "none" ? undefined : (form.orgUnitId as Id<"organizationalUnits">),
        positionId: form.positionId === "none" ? undefined : (form.positionId as Id<"jobPositions">),
        employmentType: form.employmentType as "full_time",
        bankName: form.bankName.trim() || undefined,
        bankAccount: form.bankAccount.trim() || undefined,
        insuranceNumber: form.insuranceNumber.trim() || undefined,
        address: form.address.trim() || undefined,
        emergencyContact: form.emergencyContact.trim() || undefined,
        leaveEntitlementDays: Number(form.leaveEntitlementDays) || 0,
        notes: form.notes.trim() || undefined,
      };
      if (row) {
        await update({ ...payload, employeeId: row._id as Id<"employees"> });
      } else {
        await create(payload);
      }
      toast.success(row ? "پرونده پرسنلی به‌روزرسانی شد." : "پرونده پرسنلی ایجاد شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[26px] sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>{row ? "ویرایش پرونده پرسنلی" : "ثبت پرسنل جدید"}</DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            کد پرسنلی و کد ملی یکتا هستند. اطلاعات بانکی و هویتی فقط برای دارندگان مجوز حساس نمایش داده می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="کد پرسنلی">
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="خودکار" className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="نام *">
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="نام خانوادگی *">
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="کد ملی *">
              <Input value={form.nationalId} onChange={(e) => set("nationalId", e.target.value)} dir="ltr" maxLength={10} className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="تلفن *">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="ایمیل">
              <Input value={form.email} onChange={(e) => set("email", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="تاریخ استخدام *">
              <Input type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="عنوان شغلی">
              <Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="نوع قرارداد">
              <Select value={form.employmentType} onValueChange={(value) => set("employmentType", value)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="شعبه *">
              <Select value={form.branchId} onValueChange={(value) => set("branchId", value)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="واحد سازمانی">
              <Select value={form.orgUnitId} onValueChange={(value) => set("orgUnitId", value)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون واحد</SelectItem>
                  {units.map((unit) => <SelectItem key={unit._id} value={unit._id}>{unit.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="سمت">
              <Select value={form.positionId} onValueChange={(value) => set("positionId", value)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون سمت</SelectItem>
                  {positions.map((position) => <SelectItem key={position._id} value={position._id}>{position.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="بانک">
              <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="شماره حساب">
              <Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="شماره بیمه">
              <Input value={form.insuranceNumber} onChange={(e) => set("insuranceNumber", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="استحقاق مرخصی سالانه">
              <Input value={form.leaveEntitlementDays} onChange={(e) => set("leaveEntitlementDays", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="تماس اضطراری">
              <Input value={form.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="نشانی" className="sm:col-span-2">
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="یادداشت" className="sm:col-span-3">
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="rounded-xl text-[11px]" />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {row ? "ذخیره تغییرات" : "ایجاد پرونده"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeesPage() {
  const { businessId, currency, branches } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["hr.view"]);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [status, setStatus] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [contractDialog, setContractDialog] = useState<{ mode: "create" | "renew"; contract?: ContractSummary } | null>(null);
  const [endingContractId, setEndingContractId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rows = useQuery(
    api.hr.employees,
    businessId && canView
      ? {
          businessId,
          search: deferred || undefined,
          status: status === "all" ? undefined : (status as "active"),
          branchId: branchId === "all" ? undefined : (branchId as Id<"branches">),
        }
      : "skip",
  ) ?? [];
  const units = useQuery(api.hr.orgUnits, businessId && canView ? { businessId } : "skip") ?? [];
  const positions = useQuery(api.hr.positions, businessId && canView ? { businessId } : "skip") ?? [];
  const detail = useQuery(
    api.hr.employee,
    businessId && canView && profileId ? { businessId, employeeId: profileId as Id<"employees"> } : "skip",
  );
  const balance = useQuery(
    api.hr.leaveBalance,
    businessId && canView && profileId ? { businessId, employeeId: profileId as Id<"employees"> } : "skip",
  );
  const addDocument = useMutation(api.hr.addEmployeeDocument);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (access && !canView) return <AccessDenied />;

  const canEdit = Boolean(access?.can["hr.edit"]);
  const canSensitive = Boolean(access?.can["hr.sensitive"]);
  const canPayroll = Boolean(access?.can["payroll.view"]);
  const activeCount = rows.filter((row) => row.status === "active").length;
  const provisioned = rows.length;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const upload = async (file: File) => {
    if (!businessId || !profileId) return;
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ businessId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error("بارگذاری فایل ناموفق بود.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await registerUpload({ businessId, storageId, name: file.name });
      await addDocument({
        businessId,
        employeeId: profileId as Id<"employees">,
        title: file.name.replace(/\.[^.]+$/, ""),
        category: "مدرک پرسنلی",
        storageId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
      toast.success("مدرک به پرونده اضافه شد.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · سرمایه انسانی"
        title="پرونده پرسنل و قراردادها"
        description="مدیریت هویتی، شغلی، بانکی و مدارک پرسنل با کنترل دسترسی سرور. اطلاعات حساس برای نقش‌های فاقد مجوز پوشانده می‌شود."
        actions={
          canEdit ? (
            <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={openCreate}>
              <Plus className="size-4" /> پرسنل جدید
            </Button>
          ) : null
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="کل پرونده‌ها" value={provisioned.toLocaleString("fa-IR")} hint="پرونده‌های ثبت‌شده در کسب‌وکار" tone="brand" />
        <HrStat label="پرسنل شاغل" value={activeCount.toLocaleString("fa-IR")} hint="بدون احتساب پایان همکاری" />
        <HrStat label="واحدهای سازمانی" value={units.length.toLocaleString("fa-IR")} hint="ساختار سازمانی فعال" tone="mist" />
        <HrStat label="دسترسی اطلاعات حساس" value={canSensitive ? "فعال" : "پوشانده‌شده"} hint="کد ملی، تماس و بانک" tone={canSensitive ? "gold" : "danger"} />
      </div>

      <Panel>
        <PanelHeader
          eyebrow="فهرست پرسنل"
          title="جستجو و فیلتر پرونده‌ها"
          description="جستجو بر اساس کد، نام، عنوان شغلی یا شماره تماس."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-2.5 size-3.5 text-ink-soft" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی پرسنل…" className="h-9 w-48 rounded-xl pr-8 text-[10px]" />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-28 rounded-xl text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                  {Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9 w-32 rounded-xl text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه شعب</SelectItem>
                  {branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          }
        />
        {!access ? <Skeleton className="m-4 h-64 rounded-2xl" /> : rows.length === 0 ? (
          <EmptyState icon={<UserRound className="size-5" />} title="هنوز پرسنلی ثبت نشده" description="اولین پرونده پرسنلی را ایجاد کنید؛ قرارداد و حضور و غیاب به همین پرونده متصل می‌شوند." action={canEdit ? <Button size="sm" onClick={openCreate}><Plus className="size-4" /> پرسنل جدید</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto px-2 pb-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[9px]">کد</TableHead>
                <TableHead className="text-[9px]">نام</TableHead>
                <TableHead className="text-[9px]">عنوان شغلی</TableHead>
                <TableHead className="text-[9px]">شعبه / واحد</TableHead>
                <TableHead className="text-[9px]">نوع همکاری</TableHead>
                <TableHead className="text-[9px]">وضعیت</TableHead>
                <TableHead className="text-[9px]">استخدام</TableHead>
                <TableHead className="text-[9px]">عملیات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row._id} className="cursor-pointer hover:bg-brand-soft/30" onClick={() => setProfileId(row._id)}>
                    <TableCell className="num text-[10px] font-semibold">{row.code}</TableCell>
                    <TableCell className="text-[10px] font-bold text-ink">{row.fullName}</TableCell>
                    <TableCell className="text-[10px]">{row.jobTitle}</TableCell>
                    <TableCell className="text-[10px] text-ink-soft">
                      {branches.find((branch) => branch._id === row.branchId)?.name ?? "—"}
                      {row.orgUnitId ? <span className="block text-[8px]">{units.find((unit) => unit._id === row.orgUnitId)?.name}</span> : null}
                    </TableCell>
                    <TableCell className="text-[9px]">{EMPLOYMENT_TYPE_LABELS[row.employmentType]}</TableCell>
                    <TableCell><HrPill label={EMPLOYEE_STATUS_LABELS[row.status]} tone={statusTone(row.status)} /></TableCell>
                    <TableCell className="num text-[9px]">{formatJalali(row.hireDate)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-[9px]" onClick={(event) => { event.stopPropagation(); setProfileId(row._id); }}>
                          <BookUser className="size-3.5" /> پرونده
                        </Button>
                        {canEdit && canSensitive ? (
                          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[9px]" onClick={(event) => { event.stopPropagation(); setEditing(row); setDialogOpen(true); }}>
                            <Pencil className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {dialogOpen ? <EmployeeDialog key={editing?._id ?? "new"} open onOpenChange={setDialogOpen} businessId={businessId} branches={branches} units={units} positions={positions} row={editing} /> : null}

      <Dialog open={Boolean(profileId)} onOpenChange={(open) => !open && setProfileId(null)}>
        <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[26px] sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>پرونده پرسنلی</DialogTitle>
            <DialogDescription className="text-[11px]">اطلاعات پرونده، قراردادها، مرخصی‌ها و مدارک.</DialogDescription>
          </DialogHeader>
          {!detail || !balance ? <Skeleton className="h-64 rounded-2xl" /> : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-brand/15 bg-brand-soft/35 p-4 dark:bg-brand/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] text-ink-soft">{detail.code} · {detail.branchName}</p>
                    <h3 className="mt-1 text-lg font-black text-ink">{detail.fullName}</h3>
                    <p className="mt-1 text-[10px] text-ink-soft">{detail.jobTitle} · {EMPLOYMENT_TYPE_LABELS[detail.employmentType]}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5"><HrPill label={EMPLOYEE_STATUS_LABELS[detail.status]} tone={statusTone(detail.status)} />{canEdit ? <Button size="sm" variant="outline" className="h-7 rounded-lg text-[8px]" onClick={() => setStatusOpen(true)}>تغییر وضعیت همکاری</Button> : null}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-4">
                  <span>کد ملی: <b className="num">{detail.nationalId ?? "پوشانده‌شده"}</b></span>
                  <span>تلفن: <b className="num">{detail.phone ?? "—"}</b></span>
                  <span>استخدام: <b className="num">{formatJalali(detail.hireDate)}</b></span>
                  <span>مرخصی مانده: <b className="num">{balance.remaining} روز</b></span>
                  <span>بانک: <b>{detail.bankName ?? "—"}</b></span>
                  <span>حساب: <b className="num">{detail.bankAccount ?? "—"}</b></span>
                  <span>بیمه: <b className="num">{detail.insuranceNumber ?? "—"}</b></span>
                  <span>واحد: <b>{detail.orgUnitName ?? "—"}</b></span>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-hairline bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><BriefcaseBusiness className="size-4 text-brand" /><p className="text-[10px] font-bold">قراردادها</p></div>{canEdit ? <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[8px]" onClick={() => setContractDialog({ mode: "create" })}><Plus className="size-3" /> قرارداد جدید</Button> : null}</div>
                  <div className="mt-2 space-y-2">
                    {detail.contracts.length === 0 ? <p className="text-[9px] text-ink-soft">قراردادی ثبت نشده است.</p> : detail.contracts.map((contract) => (
                      <div key={contract._id} className="rounded-xl border border-hairline p-2 text-[9px]">
                        <div className="flex items-center justify-between gap-2"><b className="num">{contract.number}</b><HrPill label={contract.status === "active" ? "فعال" : contract.status === "renewed" ? "تمدیدشده" : "پایان‌یافته"} tone={statusTone(contract.status)} /></div>
                        <p className="mt-1 text-ink-soft">{formatJalali(contract.startDate)} تا {contract.endDate ? formatJalali(contract.endDate) : "نامشخص"}</p>
                        <p className="num mt-1">{contract.baseSalary !== null ? formatMoney(contract.baseSalary, currency) : "مبلغ پوشانده‌شده"}</p>
                        {canEdit && contract.status === "active" ? <div className="mt-1.5 flex gap-1.5"><Button type="button" size="sm" variant="ghost" className="h-6 rounded-md px-2 text-[8px] text-brand" onClick={() => setContractDialog({ mode: "renew", contract })}>تمدید</Button><Button type="button" size="sm" variant="ghost" className="h-6 rounded-md px-2 text-[8px] text-destructive" onClick={() => setEndingContractId(contract._id)}>پایان قرارداد</Button></div> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-hairline bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-gold" /><p className="text-[10px] font-bold">سابقه شغلی</p></div>{canEdit ? <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[8px]" onClick={() => setHistoryOpen(true)}><Plus className="size-3" /> ثبت سابقه</Button> : null}</div>
                  <div className="mt-2 space-y-2">
                    {detail.jobHistory.map((item) => (
                      <div key={item._id} className="rounded-xl border border-hairline p-2 text-[9px]">
                        <b>{item.jobTitle}</b><p className="num text-ink-soft">{formatJalali(item.effectiveFrom)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-hairline bg-background/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><FileUp className="size-4 text-brand" /><p className="text-[10px] font-bold">مدارک و پیوست‌ها</p></div>
                  {canEdit ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-brand/20 bg-brand-soft px-3 py-1.5 text-[9px] font-semibold text-brand">
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
                      بارگذاری مدرک
                      <input ref={fileRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
                    </label>
                  ) : null}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {detail.documents.length === 0 ? <p className="text-[9px] text-ink-soft">مدرکی بارگذاری نشده است.</p> : detail.documents.map((document) => (
                    <div key={document._id} className="flex items-center justify-between rounded-xl border border-hairline p-2 text-[9px]">
                      <span>{document.title}<span className="block text-[8px] text-ink-soft">{document.category}</span></span>
                      {document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand"><Download className="size-3" /> دانلود</a> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-hairline p-3">
                  <p className="text-[10px] font-bold">مرخصی‌ها</p>
                  <p className="mt-1 text-[9px] text-ink-soft">مانده سالانه: <b className="num">{balance.remaining}</b> از {balance.entitlement} روز</p>
                  <div className="mt-2 space-y-1">
                    {detail.leaves.slice(0, 5).map((leave) => (
                      <div key={leave._id} className="mt-1 flex items-center justify-between text-[9px]">
                        <span className="num">{formatJalali(leave.startDate)} · {leave.days} روز</span>
                        <HrPill label={leave.status === "approved" ? "تأیید" : leave.status === "pending" ? "در انتظار" : "بسته"} tone={statusTone(leave.status)} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-hairline p-3">
                  <p className="text-[10px] font-bold">وام و مساعده</p>
                  {detail.loans.length === 0 ? <p className="mt-1 text-[9px] text-ink-soft">سابقه‌ای ندارد.</p> : detail.loans.slice(0, 5).map((loan) => (
                    <div key={loan._id} className="mt-1 flex items-center justify-between text-[9px]"><span>{loan.type === "loan" ? "وام" : "مساعده"}</span><b className="num">{canPayroll ? formatMoney(loan.amount, currency) : "پوشانده‌شده"}</b></div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setProfileId(null)}>بستن</Button>
                {canEdit && canSensitive ? <Button onClick={() => { setEditing(detail as unknown as EmployeeRow); setProfileId(null); setDialogOpen(true); }} className="gap-1.5"><Pencil className="size-4" /> ویرایش پرونده</Button> : null}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {profileId && contractDialog ? <ContractDialog open onOpenChange={(open) => !open && setContractDialog(null)} businessId={businessId} employeeId={profileId} mode={contractDialog.mode} contract={contractDialog.contract ?? null} /> : null}
      {profileId && endingContractId ? <EndContractDialog open businessId={businessId} contractId={endingContractId} onOpenChange={(open) => !open && setEndingContractId(null)} /> : null}
      {statusOpen && detail ? <EmployeeStatusDialog employee={detail} businessId={businessId} onClose={() => setStatusOpen(false)} /> : null}
      {historyOpen && detail ? <JobHistoryDialog employeeId={detail._id} businessId={businessId} branches={branches} units={units} defaultJobTitle={detail.jobTitle} defaultBranchId={detail.branchId} defaultUnitId={detail.orgUnitId} onClose={() => setHistoryOpen(false)} /> : null}
    </div>
  );
}

function JobHistoryDialog({ employeeId, businessId, branches, units, defaultJobTitle, defaultBranchId, defaultUnitId, onClose }: { employeeId: string; businessId?: Id<"businesses">; branches: { _id: string; name: string }[]; units: { _id: string; name: string }[]; defaultJobTitle: string; defaultBranchId: string; defaultUnitId?: string; onClose: () => void }) {
  const add = useMutation(api.hr.addJobHistory);
  const [form, setForm] = useState({ jobTitle: defaultJobTitle, branchId: defaultBranchId, orgUnitId: defaultUnitId ?? "none", effectiveFrom: toDateInput(Date.now()), note: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.jobTitle.trim() || !form.branchId) { toast.error("عنوان شغلی و شعبه الزامی است."); return; }
    setSaving(true);
    try { await add({ businessId, employeeId: employeeId as Id<"employees">, jobTitle: form.jobTitle.trim(), branchId: form.branchId as Id<"branches">, orgUnitId: form.orgUnitId === "none" ? undefined : (form.orgUnitId as Id<"organizationalUnits">), effectiveFrom: fromDateInput(form.effectiveFrom), note: form.note.trim() || undefined }); toast.success("سابقه شغلی ثبت و پرونده به‌روزرسانی شد."); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[520px]"><DialogHeader><DialogTitle>ثبت سابقه شغلی</DialogTitle><DialogDescription className="text-[11px]">عنوان، واحد و شعبه جاری پرونده با این سابقه به‌روزرسانی می‌شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="عنوان شغلی *"><Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><div className="grid grid-cols-2 gap-3"><Field label="شعبه *"><Select value={form.branchId} onValueChange={(value) => setForm({ ...form, branchId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="واحد سازمانی"><Select value={form.orgUnitId} onValueChange={(value) => setForm({ ...form, orgUnitId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون واحد</SelectItem>{units.map((unit) => <SelectItem key={unit._id} value={unit._id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="تاریخ اجرا"><Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="توضیح"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} ثبت سابقه</Button></DialogFooter></form></DialogContent></Dialog>;
}

function EmployeeStatusDialog({ employee, businessId, onClose }: { employee: { _id: string; fullName: string; status: keyof typeof EMPLOYEE_STATUS_LABELS }; businessId?: Id<"businesses">; onClose: () => void }) {
  const changeStatus = useMutation(api.hr.setEmployeeStatus);
  const [status, setStatus] = useState<keyof typeof EMPLOYEE_STATUS_LABELS>(employee.status);
  const [terminationDate, setTerminationDate] = useState(toDateInput(Date.now()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await changeStatus({ businessId, employeeId: employee._id as Id<"employees">, status, terminationDate: status === "terminated" ? fromDateInput(terminationDate) : undefined, note: note.trim() || undefined });
      toast.success("وضعیت همکاری به‌روزرسانی شد.");
      onClose();
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[460px]"><DialogHeader><DialogTitle>تغییر وضعیت همکاری</DialogTitle><DialogDescription className="text-[11px]">{employee.fullName} · پایان همکاری قراردادهای فعال را نیز می‌بندد.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="وضعیت جدید"><Select value={status} onValueChange={(value) => setStatus(value as keyof typeof EMPLOYEE_STATUS_LABELS)}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>{status === "terminated" ? <Field label="تاریخ پایان همکاری"><Input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field> : null}<Field label="توضیح"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} ثبت وضعیت</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ContractDialog({ open, onOpenChange, businessId, employeeId, mode, contract }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; employeeId: string; mode: "create" | "renew"; contract: ContractSummary | null }) {
  const create = useMutation(api.hr.createContract);
  const renew = useMutation(api.hr.renewContract);
  const [form, setForm] = useState({
    type: "full_time",
    startDate: toDateInput(contract?.endDate ? contract.endDate + 86_400_000 : Date.now() + 86_400_000),
    endDate: toDateInput(contract?.endDate ? contract.endDate + 366 * 86_400_000 : Date.now() + 365 * 86_400_000),
    baseSalary: contract?.baseSalary ? String(contract.baseSalary) : "",
    benefits: contract?.benefits ? String(contract.benefits) : "",
    paymentTerms: contract?.paymentTerms ?? "پرداخت ماهانه در پایان ماه",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!form.baseSalary.trim() || !form.paymentTerms.trim()) { toast.error("حقوق پایه و شرایط پرداخت الزامی است."); return; }
    setSaving(true);
    try {
      const result = mode === "create"
        ? await create({ businessId, employeeId: employeeId as Id<"employees">, type: form.type as "full_time", startDate: fromDateInput(form.startDate), endDate: form.endDate ? fromDateInput(form.endDate) : undefined, baseSalary: Number(form.baseSalary) || 0, benefits: Number(form.benefits) || 0, paymentTerms: form.paymentTerms.trim(), notes: form.notes.trim() || undefined })
        : await renew({ businessId, contractId: contract?._id as Id<"employmentContracts">, startDate: fromDateInput(form.startDate), endDate: form.endDate ? fromDateInput(form.endDate) : undefined, baseSalary: Number(form.baseSalary) || 0, benefits: Number(form.benefits) || 0, paymentTerms: form.paymentTerms.trim(), notes: form.notes.trim() || undefined });
      toast.success(`${mode === "create" ? "قرارداد" : "تمدید قرارداد"} ${result.number} ثبت شد.`);
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[620px]"><DialogHeader><DialogTitle>{mode === "create" ? "قرارداد استخدام جدید" : "تمدید قرارداد"}</DialogTitle><DialogDescription className="text-[11px]">{mode === "create" ? "شماره قرارداد در صورت خالی بودن خودکار تولید می‌شود." : `قرارداد ${contract?.number ?? ""} بسته و قرارداد جدید فعال می‌شود.`}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">{mode === "create" ? <Field label="نوع قرارداد"><Select value={form.type} onValueChange={(value) => set("type", value)}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field> : null}<Field label="تاریخ شروع *"><Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="تاریخ پایان"><Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="حقوق پایه *"><Input value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="مزایا"><Input value={form.benefits} onChange={(e) => set("benefits", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field></div><Field label="شرایط پرداخت *"><Textarea value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field><Field label="یادداشت"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <BriefcaseBusiness className="size-4" />} {mode === "create" ? "ثبت قرارداد" : "ثبت تمدید"}</Button></DialogFooter></form></DialogContent></Dialog>
  );
}

function EndContractDialog({ open, onOpenChange, businessId, contractId }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; contractId: string }) {
  const end = useMutation(api.hr.endContract);
  const [endedAt, setEndedAt] = useState(toDateInput(Date.now()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try { await end({ businessId, contractId: contractId as Id<"employmentContracts">, endedAt: fromDateInput(endedAt), note: note.trim() || undefined }); toast.success("قرارداد پایان یافت و تاریخچه حفظ شد."); onOpenChange(false); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[24px] sm:max-w-[460px]"><DialogHeader><DialogTitle>پایان قرارداد</DialogTitle><DialogDescription className="text-[11px]" >قرارداد بسته می‌شود اما سابقه آن حذف نمی‌شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="تاریخ پایان"><Input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="توضیح"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" variant="destructive" disabled={saving}>تأیید پایان قرارداد</Button></DialogFooter></form></DialogContent></Dialog>;
}
