import { AccessDenied, HrPill, HrStat, PERMISSION_LABELS } from "@/components/hr/shared";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  Check,
  GitBranch,
  Landmark,
  Loader2,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Tab = "branches" | "units" | "team";

export default function OrganizationPage() {
  const { businessId, branches } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["hr.view"]);
  const canManageBranches = Boolean(access?.can["branches.manage"]);
  const branchRows = useQuery(api.hr.branches, businessId ? { businessId } : "skip") ?? [];
  const units = useQuery(api.hr.orgUnits, businessId && canView ? { businessId } : "skip") ?? [];
  const positions = useQuery(api.hr.positions, businessId && canView ? { businessId } : "skip") ?? [];
  const employees = useQuery(api.hr.employees, businessId && canView ? { businessId } : "skip") ?? [];
  const members = useQuery(
    api.hr.members,
    businessId && access?.can["branches.manage"] ? { businessId } : "skip",
  ) ?? [];
  const [tab, setTab] = useState<Tab>("branches");
  const [branchOpen, setBranchOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<(typeof branchRows)[number] | null>(null);
  const [savingPermissions, setSavingPermissions] = useState<string | null>(null);

  if (access && !canView && !canManageBranches) {
    return <AccessDenied />;
  }
  const canEdit = Boolean(access?.can["hr.edit"]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · سازمان"
        title="شعب، واحدها و ساختار سازمانی"
        description="هسته چندشعبه‌ای حساب ویرا: پروفایل شعبه، مدیر، پرسنل، انبار و مجوزهای سازمانی؛ با امکان تجمیع یا تفکیک گزارش‌ها."
        actions={
          canManageBranches ? (
            <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => { setEditBranch(null); setBranchOpen(true); }}>
              <Plus className="size-4" /> شعبه جدید
            </Button>
          ) : null
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="شعب فعال" value={branchRows.filter((row) => row.active !== false).length.toLocaleString("fa-IR")} hint="شعبه اصلی و عملیاتی" tone="brand" />
        <HrStat label="پرسنل" value={employees.length.toLocaleString("fa-IR")} hint="پرونده‌های سازمان" />
        <HrStat label="واحد سازمانی" value={units.length.toLocaleString("fa-IR")} hint="ساختار درختی" tone="mist" />
        <HrStat label="سمت‌های تعریف‌شده" value={positions.length.toLocaleString("fa-IR")} hint="عنوان‌های شغلی رسمی" tone="gold" />
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-hairline bg-white/70 p-1.5 dark:bg-card/60">
        {[
          { key: "branches" as const, label: "شعب", icon: Landmark },
          { key: "units" as const, label: "ساختار سازمانی", icon: GitBranch },
          { key: "team" as const, label: "دسترسی‌ها", icon: ShieldCheck },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[10px] font-semibold transition-colors", tab === item.key ? "bg-brand text-cream shadow-sm" : "text-ink-soft hover:bg-muted")}>
            <item.icon className="size-3.5" /> {item.label}
          </button>
        ))}
      </div>

      {tab === "branches" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <Panel>
            <PanelHeader eyebrow="شعب کسب‌وکار" title="پروفایل و عملکرد پایه" description="هر شعبه پرسنل، انبار، حساب بانکی و صندوق مستقل دارد." />
            {branchRows.length === 0 ? <Skeleton className="m-4 h-48 rounded-2xl" /> : (
              <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
                {branchRows.map((branch) => (
                  <div key={branch._id} className="rounded-2xl border border-hairline bg-background/60 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-brand" />
                          <h3 className="text-[12px] font-black text-ink">{branch.name}</h3>
                        </div>
                        <p className="num mt-1 text-[8px] text-ink-soft">{branch.code} {branch.isPrimary ? "· شعبه اصلی" : ""}</p>
                      </div>
                      <HrPill label={branch.active === false ? "غیرفعال" : "فعال"} tone={branch.active === false ? "danger" : "brand"} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] text-ink-soft">
                      <span>پرسنل: <b className="num text-ink">{branch.employeeCount}</b></span>
                      <span>انبار: <b className="num text-ink">{branch.warehouseCount}</b></span>
                      <span>بانک: <b className="num text-ink">{branch.bankAccountCount}</b></span>
                      <span>صندوق: <b className="num text-ink">{branch.cashFundCount}</b></span>
                    </div>
                    <p className="mt-2 text-[8px] text-ink-soft">{branch.address ?? "نشانی ثبت نشده"}</p>
                    <p className="num mt-1 text-[8px] text-ink-soft">{branch.phone ?? "—"} · مدیر: {employees.find((row) => row._id === branch.managerEmployeeId)?.fullName ?? branch.managerName ?? "—"}</p>
                    {canManageBranches ? (
                      <Button variant="outline" size="sm" className="mt-3 h-7 rounded-lg text-[8px]" onClick={() => { setEditBranch(branch); setBranchOpen(true); }}>ویرایش شعبه</Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel className="h-fit">
            <PanelHeader eyebrow="گزارش تفکیکی" title="ترکیب شعب" description="جمع پرسنل و منابع هر شعبه." />
            <div className="space-y-2 px-4 pb-4">
              {branchRows.map((branch) => {
                const ratio = branchRows.reduce((sum, row) => sum + row.employeeCount, 0) > 0
                  ? Math.round((branch.employeeCount / branchRows.reduce((sum, row) => sum + row.employeeCount, 0)) * 100)
                  : 0;
                return (
                  <div key={branch._id}>
                    <div className="flex items-center justify-between text-[9px]"><span>{branch.name}</span><span className="num">{ratio}٪</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${ratio}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "units" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
          <Panel>
            <PanelHeader
              eyebrow="ساختار درختی"
              title="واحدهای سازمانی"
              description="هر واحد می‌تواند زیرمجموعه واحد دیگر باشد و مدیر داشته باشد."
              action={canEdit ? <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setUnitOpen(true)}><Plus className="size-3.5" /> واحد جدید</Button> : null}
            />
            {units.length === 0 ? <EmptyState icon={<GitBranch className="size-5" />} title="واحد سازمانی ندارید" description="برای گزارش تعداد پرسنل هر بخش، ساختار سازمانی را تعریف کنید." /> : (
              <div className="space-y-2 px-4 pb-4">
                {units.map((unit) => (
                  <div key={unit._id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-hairline bg-background/60 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand"><GitBranch className="size-4" /></span>
                      <div>
                        <p className="text-[10px] font-bold">{unit.name}</p>
                        <p className="num text-[8px] text-ink-soft">{unit.code} {unit.parentId ? `· زیرمجموعه ${units.find((row) => row._id === unit.parentId)?.name ?? "—"}` : "· سطح اول"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-ink-soft">{unit.employeeCount} پرسنل</span>
                      <HrPill label={unit.active ? "فعال" : "غیرفعال"} tone={unit.active ? "brand" : "danger"} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel className="h-fit">
            <PanelHeader
              eyebrow="سمت‌ها"
              title="عنوان‌های شغلی"
              description="سمت‌ها به پرسنل و واحد سازمانی متصل می‌شوند."
              action={canEdit ? <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => setPositionOpen(true)}><Plus className="size-3.5" /> سمت</Button> : null}
            />
            <div className="space-y-2 px-4 pb-4">
              {positions.length === 0 ? <p className="text-[9px] text-ink-soft">سمتی تعریف نشده است.</p> : positions.map((position) => (
                <div key={position._id} className="flex items-center justify-between rounded-xl border border-hairline p-2 text-[9px]">
                  <span>{position.name}<span className="block text-[8px] text-ink-soft">{position.code}</span></span>
                  <HrPill label="فعال" tone="muted" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "team" ? (
        <Panel>
          <PanelHeader eyebrow="امنیت سازمانی" title="مجوزهای اعضای تیم" description="مالک و مدیر همه مجوزها را دارند. مجوزهای سایر اعضا از همین‌جا کنترل می‌شود و در سرور اعمال می‌گردد." />
          {!canManageBranches ? <div className="p-6"><AccessDenied title="مدیریت مجوزها فقط برای مدیر کسب‌وکار" /></div> : members.length === 0 ? <Skeleton className="m-4 h-40 rounded-2xl" /> : (
            <div className="space-y-3 px-4 pb-4">
              {members.map((member) => (
                <MemberPermissionRow key={member._id} member={member} businessId={businessId} onSaved={() => setSavingPermissions(null)} saving={savingPermissions === member._id} setSaving={setSavingPermissions} />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {branchOpen ? <BranchDialog key={editBranch?._id ?? "new"} open onOpenChange={setBranchOpen} businessId={businessId} branch={editBranch} employees={employees} /> : null}
      {unitOpen ? <UnitDialog open onOpenChange={setUnitOpen} businessId={businessId} units={units} branches={branchRows} employees={employees} /> : null}
      {positionOpen ? <PositionDialog open onOpenChange={setPositionOpen} businessId={businessId} units={units} /> : null}
    </div>
  );
}

function BranchDialog({
  open,
  onOpenChange,
  businessId,
  branch,
  employees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  branch: { _id: string; name: string; code: string; address?: string | null; phone?: string | null; managerEmployeeId?: string; active?: boolean } | null;
  employees: { _id: string; fullName: string }[];
}) {
  const create = useMutation(api.hr.createBranch);
  const update = useMutation(api.hr.updateBranch);
  const [form, setForm] = useState(() => ({
    name: branch?.name ?? "",
    code: branch?.code ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    managerEmployeeId: branch?.managerEmployeeId ?? "none",
    active: branch?.active !== false,
  }));
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      const payload = {
        businessId,
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        managerEmployeeId: form.managerEmployeeId === "none" ? undefined : (form.managerEmployeeId as Id<"employees">),
      };
      if (branch) {
        await update({ ...payload, branchId: branch._id as Id<"branches">, active: form.active });
      } else {
        if (!form.code.trim()) throw new Error("کد شعبه الزامی است.");
        await create({ ...payload, code: form.code.trim() });
      }
      toast.success(branch ? "شعبه به‌روزرسانی شد." : "شعبه ایجاد شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[560px]">
        <DialogHeader><DialogTitle>{branch ? "ویرایش شعبه" : "شعبه جدید"}</DialogTitle><DialogDescription className="text-[11px]">اطلاعات پروفایل شعبه و مدیر آن را ثبت کنید.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-[9px]">نام شعبه *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} className="mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[9px]">کد شعبه *</Label><Input value={form.code} onChange={(e) => set("code", e.target.value)} disabled={Boolean(branch)} dir="ltr" className="num mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div className="sm:col-span-2"><Label className="text-[9px]">نشانی</Label><Input value={form.address} onChange={(e) => set("address", e.target.value)} className="mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[9px]">تلفن</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" className="num mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[9px]">مدیر شعبه</Label><Select value={form.managerEmployeeId} onValueChange={(value) => set("managerEmployeeId", value)}><SelectTrigger className="mt-1 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون مدیر</SelectItem>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {branch ? <label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> شعبه فعال است</label> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />} ذخیره</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnitDialog({ open, onOpenChange, businessId, units, branches, employees }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  units: { _id: string; name: string }[];
  branches: { _id: string; name: string }[];
  employees: { _id: string; fullName: string }[];
}) {
  const create = useMutation(api.hr.createOrgUnit);
  const [form, setForm] = useState({ name: "", code: "", parentId: "none", branchId: "none", managerEmployeeId: "none", description: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await create({ businessId, name: form.name.trim(), code: form.code.trim(), parentId: form.parentId === "none" ? undefined : (form.parentId as Id<"organizationalUnits">), branchId: form.branchId === "none" ? undefined : (form.branchId as Id<"branches">), managerEmployeeId: form.managerEmployeeId === "none" ? undefined : (form.managerEmployeeId as Id<"employees">), description: form.description.trim() || undefined });
      toast.success("واحد سازمانی ایجاد شد.");
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[24px] sm:max-w-[560px]">
        <DialogHeader><DialogTitle>واحد سازمانی جدید</DialogTitle><DialogDescription className="text-[11px]">کد یکتا، والد و مدیر واحد را تعیین کنید.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-[9px]">نام واحد *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[9px]">کد واحد *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" className="num mt-1 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[9px]">واحد والد</Label><Select value={form.parentId} onValueChange={(value) => setForm({ ...form, parentId: value })}><SelectTrigger className="mt-1 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">سطح اول</SelectItem>{units.map((unit) => <SelectItem key={unit._id} value={unit._id}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[9px]">شعبه</Label><Select value={form.branchId} onValueChange={(value) => setForm({ ...form, branchId: value })}><SelectTrigger className="mt-1 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">همه شعب</SelectItem>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><Label className="text-[9px]">مدیر واحد</Label><Select value={form.managerEmployeeId} onValueChange={(value) => setForm({ ...form, managerEmployeeId: value })}><SelectTrigger className="mt-1 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون مدیر</SelectItem>{employees.map((employee) => <SelectItem key={employee._id} value={employee._id}>{employee.fullName}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><Label className="text-[9px]">توضیح</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 h-9 rounded-xl text-[11px]" /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />} ایجاد واحد</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PositionDialog({ open, onOpenChange, businessId, units }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; units: { _id: string; name: string }[] }) {
  const create = useMutation(api.hr.createPosition);
  const [form, setForm] = useState({ name: "", code: "", orgUnitId: "none" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try {
      await create({ businessId, name: form.name.trim(), code: form.code.trim(), orgUnitId: form.orgUnitId === "none" ? undefined : (form.orgUnitId as Id<"organizationalUnits">) });
      toast.success("سمت ایجاد شد."); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[480px]">
        <DialogHeader><DialogTitle>سمت جدید</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label className="text-[9px]">نام سمت *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[9px]">کد سمت *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" className="num mt-1 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[9px]">واحد سازمانی</Label><Select value={form.orgUnitId} onValueChange={(value) => setForm({ ...form, orgUnitId: value })}><SelectTrigger className="mt-1 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون واحد</SelectItem>{units.map((unit) => <SelectItem key={unit._id} value={unit._id}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>ایجاد سمت</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberPermissionRow({ member, businessId, saving, setSaving, onSaved }: {
  member: { _id: string; displayName: string; email: string | null; role: string; permissions: string[] };
  businessId?: Id<"businesses">;
  saving: boolean;
  setSaving: (id: string | null) => void;
  onSaved: () => void;
}) {
  const setPermissions = useMutation(api.hr.setMemberPermissions);
  const [selected, setSelected] = useState<string[]>(member.permissions);
  const toggle = (permission: string) => setSelected((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  const save = async () => {
    if (!businessId) return;
    setSaving(member._id);
    try {
      await setPermissions({ businessId, memberId: member._id as Id<"businessMembers">, permissions: selected });
      toast.success("مجوزها ذخیره شدند."); onSaved();
    } catch (error) { toast.error(getErrorMessage(error)); setSaving(null); }
  };
  return (
    <div className="rounded-2xl border border-hairline bg-background/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand"><Users className="size-4" /></span>
          <div><p className="text-[10px] font-bold">{member.displayName}</p><p className="text-[8px] text-ink-soft">{member.email ?? "—"} · {member.role}</p></div>
        </div>
        {member.role === "owner" ? <HrPill label="دسترسی کامل مالک" tone="gold" /> : <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[8px]" onClick={save} disabled={saving}>{saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} ذخیره مجوزها</Button>}
      </div>
      {member.role !== "owner" ? (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
            <button key={key} type="button" onClick={() => toggle(key)} className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-right text-[8px] transition-colors", selected.includes(key) ? "border-brand/25 bg-brand-soft text-brand" : "border-hairline text-ink-soft hover:bg-muted")}>
              <span className={cn("flex size-3 items-center justify-center rounded border", selected.includes(key) ? "border-brand bg-brand text-cream" : "border-hairline")}>{selected.includes(key) ? <Check className="size-2" /> : null}</span>
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
