import {
  ASSET_METHOD_LABELS,
  ASSET_MOVEMENT_LABELS,
  ASSET_STATUS_LABELS,
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
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Calculator,
  Download,
  History,
  Landmark,
  Loader2,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Tab = "assets" | "depreciation" | "reports";

type AssetListRow = {
  _id: string;
  code: string;
  name: string;
  group: string;
  status: keyof typeof ASSET_STATUS_LABELS;
  cost: number;
  accumulated: number;
  bookValue: number;
  purchaseDate: number;
  branchId: string;
  method: keyof typeof ASSET_METHOD_LABELS;
  usefulLifeMonths: number;
  location: string;
  custodian?: string | null;
  salvageValue: number;
  decliningRateBps?: number | null;
  customMonthlyAmount?: number | null;
  notes?: string | null;
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-[9px] text-ink-soft">{label}</Label><div className="mt-1">{children}</div></div>;
}

function monthStart() {
  const now = new Date();
  return toDateInput(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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

export default function AssetsPage() {
  const { businessId, currency, branches, branchId: workspaceBranchId } = useWorkspace();
  const access = useQuery(api.hr.access, businessId ? { businessId } : "skip");
  const canView = Boolean(access?.can["assets.view"]);
  const [tab, setTab] = useState<Tab>("assets");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [action, setAction] = useState<"transfer" | "repair" | "sell" | "dispose" | "edit" | null>(null);
  const [asOf, setAsOf] = useState(monthStart());
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(toDateInput(Date.now()));
  const assets = useQuery(
    api.assets.list,
    businessId && canView
      ? { businessId, search: search.trim() || undefined, status: status === "all" ? undefined : (status as "active"), branchId: branchId === "all" ? undefined : (branchId as Id<"branches">) }
      : "skip",
  ) ?? [];
  const branchesList = useQuery(api.hr.branches, businessId && canView ? { businessId } : "skip") ?? [];
  const funds = useQuery(api.treasury.funds, businessId && canView ? { businessId } : "skip") ?? [];
  const banks = useQuery(api.treasury.banks, businessId && canView ? { businessId } : "skip") ?? [];
  const preview = useQuery(api.assets.depreciationPreview, businessId && canView ? { businessId, asOf: fromDateInput(asOf), branchId: branchId === "all" ? undefined : (branchId as Id<"branches">) } : "skip");
  const book = useQuery(api.assets.bookValueReport, businessId && canView ? { businessId, branchId: branchId === "all" ? undefined : (branchId as Id<"branches">) } : "skip");
  const depreciationReport = useQuery(api.assets.depreciationReport, businessId && canView ? { businessId, from: fromDateInput(from), to: fromDateInput(to, true), branchId: branchId === "all" ? undefined : (branchId as Id<"branches">) } : "skip") ?? [];
  const movements = useQuery(api.assets.movements, businessId && canView ? { businessId } : "skip") ?? [];
  const runDepreciation = useMutation(api.assets.runDepreciation);
  const [running, setRunning] = useState(false);

  if (access && !canView) return <AccessDenied />;
  const canManage = Boolean(access?.can["assets.manage"]);
  const totalCost = assets.reduce((sum, row) => sum + row.cost, 0);
  const totalAccumulated = assets.reduce((sum, row) => sum + row.accumulated, 0);
  const totalBook = assets.reduce((sum, row) => sum + row.bookValue, 0);
  const detailAsset = assets.find((row) => row._id === detailId) ?? null;
  const branchName = (id: string) => branchesList.find((row) => row._id === id)?.name ?? branches.find((row) => row._id === id)?.name ?? "—";

  const postDepreciation = async () => {
    if (!businessId) return;
    setRunning(true);
    try {
      const result = await runDepreciation({ businessId, asOf: fromDateInput(asOf), branchId: branchId === "all" ? undefined : (branchId as Id<"branches">) });
      toast.success(result.count ? `استهلاک ${result.count} دارایی ثبت و سند صادر شد.` : "دارایی واجد استهلاکی برای این دوره باقی نمانده است.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRunning(false);
    }
  };

  const exportBook = () => {
    if (!book) return;
    downloadCsv("ارزش-دفتری-دارایی‌ها", ["کد", "نام", "گروه", "تاریخ خرید", "بهای تمام‌شده", "استهلاک انباشته", "ارزش دفتری", "وضعیت"], book.rows.map((row) => [row.code, row.name, row.group, toDateInput(row.purchaseDate), row.cost, row.accumulated, row.bookValue, ASSET_STATUS_LABELS[row.status as keyof typeof ASSET_STATUS_LABELS]]));
    toast.success("فایل Excel آماده شد.");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · دارایی ثابت"
        title="دارایی‌ها، استهلاک و ارزش دفتری"
        description="خرید، انتقال، تعمیر، استهلاک، فروش و خروج هر دارایی با سند متوازن و تاریخچه غیرقابل حذف ثبت می‌شود."
        actions={canManage ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> ثبت دارایی</Button> : null}
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HrStat label="بهای تمام‌شده" value={formatMoney(totalCost, currency)} hint={`${assets.length.toLocaleString("fa-IR")} دارایی`} tone="brand" />
        <HrStat label="استهلاک انباشته" value={formatMoney(totalAccumulated, currency)} hint="ثبت‌شده در دفاتر" tone="gold" />
        <HrStat label="ارزش دفتری" value={formatMoney(totalBook, currency)} hint="بهای تمام‌شده منهای استهلاک" tone="mist" />
        <HrStat label="استهلاک این دوره" value={formatMoney(preview?.total ?? 0, currency)} hint={preview?.periodKey ? `دوره ${preview.periodKey}` : "محاسبه‌نشده"} tone="danger" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-hairline bg-white/70 p-1.5 dark:bg-card/60">
          {[
            { key: "assets" as const, label: "دفتر دارایی", icon: Building2 },
            { key: "depreciation" as const, label: "استهلاک دوره‌ای", icon: Calculator },
            { key: "reports" as const, label: "گزارش‌ها", icon: Download },
          ].map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-semibold", tab === item.key ? "bg-brand text-cream" : "text-ink-soft hover:bg-muted")}><item.icon className="size-3.5" />{item.label}</button>)}
        </div>
        <Select value={branchId} onValueChange={setBranchId}><SelectTrigger className="h-8 w-36 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه شعب</SelectItem>{branchesList.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select>
      </div>

      {tab === "assets" ? (
        <Panel>
          <PanelHeader eyebrow="دفتر دارایی" title="فهرست دارایی‌های ثابت" description="استهلاک و ارزش دفتری هر ردیف از رکوردهای واقعی محاسبه شده است." action={<div className="flex flex-wrap gap-1.5"><div className="relative"><Search className="absolute right-2 top-2 size-3.5 text-ink-soft" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کد، نام، گروه..." className="h-8 w-40 rounded-lg pr-7 text-[9px]" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-8 w-32 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه وضعیت‌ها</SelectItem>{Object.entries(ASSET_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>} />
          {assets.length === 0 ? <EmptyState icon={<PackageOpen className="size-5" />} title="دارایی ثبت نشده" description={search ? "نتیجه‌ای برای جستجو نیست." : "اولین دارایی را با بهای خرید، عمر مفید و منبع پرداخت ثبت کنید."} /> : (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-right"><thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="p-2">کد / دارایی</th><th className="p-2">شعبه</th><th className="p-2">خرید</th><th className="p-2">بهای تمام‌شده</th><th className="p-2">استهلاک</th><th className="p-2">ارزش دفتری</th><th className="p-2">روش</th><th className="p-2">وضعیت</th></tr></thead><tbody>{assets.map((asset) => <tr key={asset._id} className="cursor-pointer border-b border-hairline/60 text-[9px] hover:bg-muted/40" onClick={() => setDetailId(asset._id)}><td className="p-2"><b>{asset.name}</b><span className="num block text-[8px] text-ink-soft">{asset.code} · {asset.group}</span></td><td className="p-2 text-[8px]">{branchName(asset.branchId)}</td><td className="num p-2 text-[8px]">{formatJalali(asset.purchaseDate)}</td><td className="num p-2">{formatNumber(asset.cost)}</td><td className="num p-2 text-gold">{formatNumber(asset.accumulated)}</td><td className="num p-2 font-bold text-brand">{formatNumber(asset.bookValue)}</td><td className="p-2 text-[8px]">{ASSET_METHOD_LABELS[asset.method]}</td><td className="p-2"><HrPill label={ASSET_STATUS_LABELS[asset.status]} tone={statusTone(asset.status)} /></td></tr>)}</tbody></table>
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "depreciation" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_310px]">
          <Panel>
            <PanelHeader eyebrow="محاسبه خودکار" title="پیش‌نمایش استهلاک ماه" description="برای هر دارایی فقط یک بار در هر ماه سند ثبت می‌شود؛ محاسبه مجدد سند تکراری نمی‌سازد." />
            <div className="flex flex-wrap items-end gap-2 px-4 pb-3"><Field label="تاریخ محاسبه (ماه)"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} dir="ltr" className="num h-8 w-36 rounded-lg text-[9px]" /></Field><Button size="sm" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => void postDepreciation()} disabled={running || !canManage || (preview?.rows.length ?? 0) === 0}>{running ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} ثبت سند استهلاک</Button></div>
            {!preview ? <Skeleton className="m-4 h-48 rounded-2xl" /> : preview.rows.length === 0 ? <EmptyState icon={<BadgeCheck className="size-5" />} title="استهلاک این دوره ثبت شده است" description="برای این ماه ردیف واجد شرایطی باقی نمانده یا همه دارایی‌ها قبلاً استهلاک شده‌اند." /> : <div className="overflow-x-auto px-4 pb-4"><table className="w-full text-right"><thead><tr className="border-b border-hairline text-[8px] text-ink-soft"><th className="p-2">دارایی</th><th className="p-2">بهای تمام‌شده</th><th className="p-2">استهلاک انباشته</th><th className="p-2">ارزش دفتری</th><th className="p-2">استهلاک این ماه</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.assetId} className="border-b border-hairline/60 text-[9px]"><td className="p-2"><b>{row.name}</b><span className="num block text-[8px] text-ink-soft">{row.code}</span></td><td className="num p-2">{formatNumber(row.cost)}</td><td className="num p-2">{formatNumber(row.accumulated)}</td><td className="num p-2">{formatNumber(row.bookValue)}</td><td className="num p-2 font-bold text-brand">{formatNumber(row.amount)}</td></tr>)}</tbody></table></div>}
          </Panel>
          <Panel className="h-fit"><PanelHeader eyebrow="خلاصه دوره" title={preview?.periodKey ?? "—"} /><div className="space-y-2 px-4 pb-4"><div className="rounded-2xl bg-brand p-4 text-cream"><p className="text-[9px] opacity-80">جمع استهلاک آماده ثبت</p><p className="num mt-2 text-xl font-black">{formatMoney(preview?.total ?? 0, currency)}</p></div><div className="rounded-xl bg-mist/40 p-3 text-[8px] leading-4 text-ink-soft">سند: بدهکار هزینه استهلاک / بستانکار استهلاک انباشته. پس از ثبت، سند قطعی و غیرقابل ویرایش مستقیم است.</div></div></Panel>
        </div>
      ) : null}

      {tab === "reports" ? (
        <div className="space-y-3">
          <Panel><PanelHeader eyebrow="ارزش دفتری" title="گزارش دارایی‌ها" description="فیلتر شعبه از بالای صفحه اعمال می‌شود." action={<div className="flex gap-1.5"><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={exportBook} disabled={!book}><Download className="size-3.5" /> Excel</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => window.print()}><Printer className="size-3.5" /> چاپ</Button></div>} />
            {!book ? <Skeleton className="m-4 h-32 rounded-2xl" /> : <div className="print-sheet m-4 overflow-x-auto rounded-2xl border border-hairline"><table className="w-full text-right"><thead className="bg-muted/60"><tr className="text-[8px] text-ink-soft"><th className="p-2">کد</th><th className="p-2">دارایی</th><th className="p-2">گروه</th><th className="p-2">خرید</th><th className="p-2">بها</th><th className="p-2">استهلاک</th><th className="p-2">ارزش دفتری</th></tr></thead><tbody>{book.rows.map((row) => <tr key={row.code} className="border-t border-hairline/60 text-[9px]"><td className="num p-2">{row.code}</td><td className="p-2 font-semibold">{row.name}</td><td className="p-2 text-[8px]">{row.group}</td><td className="num p-2 text-[8px]">{formatJalali(row.purchaseDate)}</td><td className="num p-2">{formatNumber(row.cost)}</td><td className="num p-2">{formatNumber(row.accumulated)}</td><td className="num p-2 font-bold">{formatNumber(row.bookValue)}</td></tr>)}</tbody><tfoot><tr className="border-t border-hairline bg-muted/40 text-[9px] font-bold"><td colSpan={4} className="p-2">جمع</td><td className="num p-2">{formatNumber(book.totals.cost)}</td><td className="num p-2">{formatNumber(book.totals.accumulated)}</td><td className="num p-2">{formatNumber(book.totals.bookValue)}</td></tr></tfoot></table></div>}
          </Panel>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel><PanelHeader eyebrow="دفتر استهلاک" title="ثبت‌های دوره‌ای" action={<div className="flex items-center gap-1"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="num h-7 w-30 rounded-md text-[8px]" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="num h-7 w-30 rounded-md text-[8px]" /></div>} />{depreciationReport.length === 0 ? <p className="px-4 pb-4 text-[9px] text-ink-soft">ثبتی در این بازه نیست.</p> : <div className="max-h-72 overflow-y-auto px-4 pb-4"><table className="w-full text-right"><thead><tr className="text-[8px] text-ink-soft"><th className="p-1">دارایی</th><th className="p-1">دوره</th><th className="p-1">مبلغ</th></tr></thead><tbody>{depreciationReport.map((row) => <tr key={row._id} className="border-t border-hairline/50 text-[9px]"><td className="p-1.5">{row.assetName}<span className="num block text-[8px] text-ink-soft">{row.assetCode}</span></td><td className="num p-1.5 text-[8px]">{row.periodKey}</td><td className="num p-1.5 font-bold">{formatNumber(row.amount)}</td></tr>)}</tbody></table></div>}</Panel>
            <Panel><PanelHeader eyebrow="تاریخچه" title="حرکات دارایی" /><div className="max-h-72 overflow-y-auto px-4 pb-4">{movements.length === 0 ? <p className="text-[9px] text-ink-soft">حرکتی ثبت نشده است.</p> : <div className="space-y-1.5">{movements.slice(0, 30).map((movement) => <div key={movement._id} className="flex items-center justify-between rounded-xl border border-hairline px-2.5 py-2 text-[9px]"><div><p className="font-semibold">{ASSET_MOVEMENT_LABELS[movement.type]}{movement.amount ? ` · ${formatNumber(movement.amount)}` : ""}</p><p className="num mt-0.5 text-[8px] text-ink-soft">{formatJalali(movement.occurredAt)} · {movement.description}</p></div><History className="size-3.5 text-ink-soft" /></div>)}</div>}</div></Panel>
          </div>
        </div>
      ) : null}

      {createOpen ? <AssetCreateDialog open onOpenChange={setCreateOpen} businessId={businessId} branches={branchesList} funds={funds} banks={banks} defaultBranchId={workspaceBranchId ?? branchesList[0]?._id} /> : null}
      {detailAsset ? <AssetDetailDialog asset={detailAsset} branchName={branchName(detailAsset.branchId)} businessId={businessId} canManage={canManage} currency={currency} onClose={() => setDetailId(null)} onAction={(kind) => setAction(kind)} /> : null}
      {detailAsset && action === "edit" ? <AssetEditDialog asset={detailAsset} businessId={businessId} onClose={() => { setAction(null); setDetailId(null); }} /> : null}
      {detailAsset && action === "transfer" ? <AssetTransferDialog asset={detailAsset} businessId={businessId} branches={branchesList} onClose={() => { setAction(null); setDetailId(null); }} /> : null}
      {detailAsset && action === "repair" ? <AssetRepairDialog asset={detailAsset} businessId={businessId} funds={funds} banks={banks} currency={currency} onClose={() => { setAction(null); setDetailId(null); }} /> : null}
      {detailAsset && action === "sell" ? <AssetSellDialog asset={detailAsset} businessId={businessId} funds={funds} banks={banks} currency={currency} onClose={() => { setAction(null); setDetailId(null); }} /> : null}
      {detailAsset && action === "dispose" ? <AssetDisposeDialog asset={detailAsset} businessId={businessId} onClose={() => { setAction(null); setDetailId(null); }} /> : null}
    </div>
  );
}

function AssetCreateDialog({ open, onOpenChange, businessId, branches, funds, banks, defaultBranchId }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; branches: { _id: string; name: string }[]; funds: { _id: string; name: string }[]; banks: { _id: string; name: string }[]; defaultBranchId?: string }) {
  const create = useMutation(api.assets.create);
  const [form, setForm] = useState({ code: "", name: "", group: "", branchId: defaultBranchId ?? "", location: "", custodian: "", purchase: toDateInput(Date.now()), cost: "", life: "60", salvage: "0", method: "straight_line", rate: "10", custom: "", funding: "cash", sourceId: funds[0]?._id ?? "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.branchId) { toast.error("شعبه دارایی را انتخاب کنید."); return; }
    if (form.funding !== "payable" && !form.sourceId) { toast.error("منبع پرداخت را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const result = await create({ businessId, code: form.code.trim() || undefined, name: form.name.trim(), group: form.group.trim(), branchId: form.branchId as Id<"branches">, location: form.location.trim(), custodian: form.custodian.trim() || undefined, purchaseDate: fromDateInput(form.purchase), cost: Number(form.cost) || 0, usefulLifeMonths: Number(form.life) || 1, salvageValue: Number(form.salvage) || 0, method: form.method as "straight_line", decliningRateBps: form.method === "declining_balance" ? Math.round((Number(form.rate) || 0) * 100) : undefined, customMonthlyAmount: form.method === "custom" ? Number(form.custom) || 0 : undefined, funding: form.funding as "cash", bankAccountId: form.funding === "bank" ? (form.sourceId as Id<"bankAccounts">) : undefined, cashFundId: form.funding === "cash" ? (form.sourceId as Id<"cashFunds">) : undefined, notes: form.notes.trim() || undefined });
      toast.success(`دارایی ${result.code} با سند ${result.documentNumber} ثبت شد.`); onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[700px]"><DialogHeader><DialogTitle>ثبت دارایی ثابت</DialogTitle><DialogDescription className="text-[11px]">خرید هنگام ثبت، سند دارایی و پرداخت/بدهی ایجاد می‌کند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><Field label="کد دارایی"><Input value={form.code} onChange={(e) => set("code", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" placeholder="خودکار" /></Field><Field label="نام دارایی *" className="sm:col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field><Field label="گروه *"><Input value={form.group} onChange={(e) => set("group", e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field><Field label="شعبه *"><Select value={form.branchId} onValueChange={(value) => set("branchId", value)}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="محل استقرار *"><Input value={form.location} onChange={(e) => set("location", e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field><Field label="مسئول دارایی"><Input value={form.custodian} onChange={(e) => set("custodian", e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field><Field label="تاریخ خرید"><Input type="date" value={form.purchase} onChange={(e) => set("purchase", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="بهای تمام‌شده *"><Input value={form.cost} onChange={(e) => set("cost", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="عمر مفید (ماه)"><Input value={form.life} onChange={(e) => set("life", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="ارزش اسقاط"><Input value={form.salvage} onChange={(e) => set("salvage", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="روش استهلاک"><Select value={form.method} onValueChange={(value) => set("method", value)}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ASSET_METHOD_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>{form.method === "declining_balance" ? <Field label="نرخ نزولی (٪)"><Input value={form.rate} onChange={(e) => set("rate", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field> : form.method === "custom" ? <Field label="استهلاک ماهانه"><Input value={form.custom} onChange={(e) => set("custom", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field> : null}<Field label="منبع تأمین"><Select value={form.funding} onValueChange={(value) => setForm({ ...form, funding: value, sourceId: value === "bank" ? banks[0]?._id ?? "" : value === "cash" ? funds[0]?._id ?? "" : "" })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">صندوق</SelectItem><SelectItem value="bank">حساب بانکی</SelectItem><SelectItem value="payable">بدهی / پرداختنی</SelectItem></SelectContent></Select></Field>{form.funding !== "payable" ? <Field label={form.funding === "cash" ? "صندوق *" : "حساب بانکی *"}><Select value={form.sourceId} onValueChange={(value) => set("sourceId", value)}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب" /></SelectTrigger><SelectContent>{(form.funding === "cash" ? funds : banks).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></Field> : null}<Field label="یادداشت" className="sm:col-span-3"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />} ثبت و صدور سند</Button></DialogFooter></form></DialogContent></Dialog>
  );
}

function AssetDetailDialog({ asset, branchName, businessId, canManage, currency, onClose, onAction }: { asset: AssetListRow; branchName: string; businessId?: Id<"businesses">; canManage: boolean; currency: string; onClose: () => void; onAction: (kind: "transfer" | "repair" | "sell" | "dispose" | "edit") => void }) {
  const detail = useQuery(api.assets.get, businessId ? { businessId, assetId: asset._id as Id<"fixedAssets"> } : "skip");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[680px]"><DialogHeader><DialogTitle>{asset.name}</DialogTitle><DialogDescription className="num text-[10px]">{asset.code} · {branchName} · {asset.location}</DialogDescription></DialogHeader>
      {!detail ? <Skeleton className="h-64 rounded-2xl" /> : <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="بهای تمام‌شده" value={formatMoney(detail.cost, currency)} /><Mini label="استهلاک" value={formatMoney(detail.accumulated, currency)} /><Mini label="ارزش دفتری" value={formatMoney(detail.bookValue, currency)} tone /><Mini label="وضعیت" value={ASSET_STATUS_LABELS[detail.status as keyof typeof ASSET_STATUS_LABELS]} /></div>
        <div className="grid gap-2 rounded-2xl border border-hairline bg-background/60 p-3 text-[9px] sm:grid-cols-2"><span>گروه: {detail.group}</span><span>مسئول: {detail.custodian ?? "—"}</span><span>روش: {ASSET_METHOD_LABELS[detail.method as keyof typeof ASSET_METHOD_LABELS]}</span><span className="num">عمر: {detail.usefulLifeMonths} ماه · اسقاط: {formatNumber(detail.salvageValue)}</span><span className="num">خرید: {formatJalali(detail.purchaseDate)}</span><span>شعبه: {detail.branchName}</span></div>
        {canManage && detail.status !== "sold" && detail.status !== "disposed" ? <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => onAction("edit")}><Pencil className="size-3.5" /> ویرایش</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => onAction("transfer")}><ArrowRightLeft className="size-3.5" /> انتقال</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => onAction("repair")}><Wrench className="size-3.5" /> تعمیر</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px]" onClick={() => onAction("sell")}><Landmark className="size-3.5" /> فروش</Button><Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-[9px] text-destructive" onClick={() => onAction("dispose")}><Trash2 className="size-3.5" /> خروج</Button></div> : null}
        <div><p className="mb-1.5 text-[9px] font-bold">استهلاک‌های ثبت‌شده</p>{detail.depreciations.length === 0 ? <p className="text-[8px] text-ink-soft">هنوز استهلاکی ثبت نشده است.</p> : <div className="max-h-32 overflow-y-auto rounded-xl border border-hairline"><table className="w-full text-right"><tbody>{detail.depreciations.map((row) => <tr key={row._id} className="border-b border-hairline/50 text-[8px]"><td className="num p-1.5">{row.periodKey}</td><td className="num p-1.5">{formatNumber(row.amount)}</td><td className="num p-1.5 text-ink-soft">{formatJalali(row.periodEnd)}</td></tr>)}</tbody></table></div>}</div>
        <div><p className="mb-1.5 text-[9px] font-bold">تاریخچه حرکات</p>{detail.movements.length === 0 ? <p className="text-[8px] text-ink-soft">حرکتی ثبت نشده است.</p> : <div className="max-h-36 space-y-1 overflow-y-auto">{detail.movements.map((movement) => <div key={movement._id} className="flex items-center justify-between rounded-lg border border-hairline px-2 py-1.5 text-[8px]"><span>{ASSET_MOVEMENT_LABELS[movement.type]} · {movement.description}</span><span className="num text-ink-soft">{formatJalali(movement.occurredAt)}</span></div>)}</div>}</div>
      </div>}
      <DialogFooter><Button variant="outline" onClick={onClose}>بستن</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function Mini({ label, value, tone = false }: { label: string; value: string; tone?: boolean }) {
  return <div className="rounded-xl border border-hairline bg-background/60 p-2.5"><p className="text-[8px] text-ink-soft">{label}</p><p className={cn("num mt-1 text-[11px] font-black", tone ? "text-brand" : "text-ink")}>{value}</p></div>;
}

function AssetEditDialog({ asset, businessId, onClose }: { asset: AssetListRow; businessId?: Id<"businesses">; onClose: () => void }) {
  const update = useMutation(api.assets.update);
  const [form, setForm] = useState({ name: asset.name, group: asset.group, location: asset.location, custodian: asset.custodian ?? "", notes: asset.notes ?? "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try { await update({ businessId, assetId: asset._id as Id<"fixedAssets">, name: form.name.trim(), group: form.group.trim(), location: form.location.trim(), custodian: form.custodian.trim() || undefined, notes: form.notes.trim() || undefined }); toast.success("اطلاعات مجاز دارایی ویرایش شد."); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[500px]"><DialogHeader><DialogTitle>ویرایش اطلاعات دارایی</DialogTitle><DialogDescription className="text-[10px]">بهای خرید و تاریخ خرید پس از ثبت تغییر نمی‌کنند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="نام"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><div className="grid grid-cols-2 gap-3"><Field label="گروه"><Input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><Field label="محل"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field></div><Field label="مسئول"><Input value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} className="h-9 rounded-xl text-[11px]" /></Field><Field label="یادداشت"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>ذخیره</Button></DialogFooter></form></DialogContent></Dialog>;
}

function AssetTransferDialog({ asset, businessId, branches, onClose }: { asset: AssetListRow; businessId?: Id<"businesses">; branches: { _id: string; name: string }[]; onClose: () => void }) {
  const transfer = useMutation(api.assets.transfer);
  const [toBranchId, setToBranchId] = useState(branches.find((row) => row._id !== asset.branchId)?._id ?? "");
  const [occurredAt, setOccurredAt] = useState(toDateInput(Date.now()));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !toBranchId) { toast.error("شعبه مقصد را انتخاب کنید."); return; }
    setSaving(true);
    try { await transfer({ businessId, assetId: asset._id as Id<"fixedAssets">, toBranchId: toBranchId as Id<"branches">, occurredAt: fromDateInput(occurredAt), description: description.trim() || undefined }); toast.success("دارایی منتقل و حرکت آن ثبت شد."); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[460px]"><DialogHeader><DialogTitle>انتقال دارایی</DialogTitle><DialogDescription className="text-[10px]">{asset.name} · شعبه فعلی مشخص است</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><Field label="شعبه مقصد *"><Select value={toBranchId} onValueChange={setToBranchId}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب شعبه" /></SelectTrigger><SelectContent>{branches.filter((row) => row._id !== asset.branchId).map((branch) => <SelectItem key={branch._id} value={branch._id}>{branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="تاریخ انتقال"><Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="توضیح"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />} ثبت انتقال</Button></DialogFooter></form></DialogContent></Dialog>;
}

function AssetRepairDialog({ asset, businessId, funds, banks, currency, onClose }: { asset: AssetListRow; businessId?: Id<"businesses">; funds: { _id: string; name: string }[]; banks: { _id: string; name: string }[]; currency: string; onClose: () => void }) {
  const repair = useMutation(api.assets.repair);
  const [form, setForm] = useState({ amount: "", occurredAt: toDateInput(Date.now()), description: "", sourceType: "cash", sourceId: funds[0]?._id ?? "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.sourceId) { toast.error("منبع پرداخت را انتخاب کنید."); return; }
    setSaving(true);
    try { await repair({ businessId, assetId: asset._id as Id<"fixedAssets">, amount: Number(form.amount) || 0, occurredAt: fromDateInput(form.occurredAt), description: form.description.trim(), sourceType: form.sourceType as "cash", cashFundId: form.sourceType === "cash" ? (form.sourceId as Id<"cashFunds">) : undefined, bankAccountId: form.sourceType === "bank" ? (form.sourceId as Id<"bankAccounts">) : undefined }); toast.success("تعمیر با سند هزینه ثبت شد."); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[500px]"><DialogHeader><DialogTitle>ثبت تعمیر دارایی</DialogTitle><DialogDescription className="text-[10px]">{asset.name} · ارزش دفتری {formatMoney(asset.bookValue, currency)}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="هزینه تعمیر *"><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="تاریخ"><Input type="date" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="منبع"><Select value={form.sourceType} onValueChange={(value) => setForm({ ...form, sourceType: value, sourceId: value === "cash" ? funds[0]?._id ?? "" : banks[0]?._id ?? "" })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">صندوق</SelectItem><SelectItem value="bank">بانک</SelectItem></SelectContent></Select></Field><Field label="حساب *"><Select value={form.sourceId} onValueChange={(value) => setForm({ ...form, sourceId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{(form.sourceType === "cash" ? funds : banks).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="شرح تعمیر *"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>ثبت و صدور سند</Button></DialogFooter></form></DialogContent></Dialog>;
}

function AssetSellDialog({ asset, businessId, funds, banks, currency, onClose }: { asset: AssetListRow; businessId?: Id<"businesses">; funds: { _id: string; name: string }[]; banks: { _id: string; name: string }[]; currency: string; onClose: () => void }) {
  const sell = useMutation(api.assets.sell);
  const [form, setForm] = useState({ proceeds: "", saleDate: toDateInput(Date.now()), sourceType: "cash", sourceId: funds[0]?._id ?? "", description: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !form.sourceId) { toast.error("منبع دریافت را انتخاب کنید."); return; }
    setSaving(true);
    try { const result = await sell({ businessId, assetId: asset._id as Id<"fixedAssets">, proceeds: Number(form.proceeds) || 0, saleDate: fromDateInput(form.saleDate), sourceType: form.sourceType as "cash", cashFundId: form.sourceType === "cash" ? (form.sourceId as Id<"cashFunds">) : undefined, bankAccountId: form.sourceType === "bank" ? (form.sourceId as Id<"bankAccounts">) : undefined, description: form.description.trim() || undefined }); toast.success(`فروش ثبت و سند ${result.documentNumber} صادر شد.`); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[500px]"><DialogHeader><DialogTitle>فروش دارایی</DialogTitle><DialogDescription className="text-[10px]">ارزش دفتری {formatMoney(asset.bookValue, currency)} · سود یا زیان فروش در سند محاسبه می‌شود.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="مبلغ فروش *"><Input value={form.proceeds} onChange={(e) => setForm({ ...form, proceeds: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="تاریخ فروش"><Input type="date" value={form.saleDate} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="دریافت"><Select value={form.sourceType} onValueChange={(value) => setForm({ ...form, sourceType: value, sourceId: value === "cash" ? funds[0]?._id ?? "" : banks[0]?._id ?? "" })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">صندوق</SelectItem><SelectItem value="bank">بانک</SelectItem></SelectContent></Select></Field><Field label="حساب *"><Select value={form.sourceId} onValueChange={(value) => setForm({ ...form, sourceId: value })}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{(form.sourceType === "cash" ? funds : banks).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="توضیح"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" disabled={saving}>ثبت فروش و سند</Button></DialogFooter></form></DialogContent></Dialog>;
}

function AssetDisposeDialog({ asset, businessId, onClose }: { asset: AssetListRow; businessId?: Id<"businesses">; onClose: () => void }) {
  const dispose = useMutation(api.assets.dispose);
  const [form, setForm] = useState({ disposedAt: toDateInput(Date.now()), reason: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    try { const result = await dispose({ businessId, assetId: asset._id as Id<"fixedAssets">, disposedAt: fromDateInput(form.disposedAt), reason: form.reason.trim() }); toast.success(`خروج دارایی با سند ${result.documentNumber} ثبت شد.`); onClose(); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="rounded-[24px] sm:max-w-[460px]"><DialogHeader><DialogTitle>خروج دارایی از دفاتر</DialogTitle><DialogDescription className="text-[10px]">این عملیات برگشت‌پذیر نیست و سند ارزش دفتری را خارج می‌کند.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-3"><div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-[9px] text-destructive">دارایی {asset.name} با ارزش دفتری فعلی از دفاتر خارج می‌شود. دلیل را دقیق ثبت کنید.</div><Field label="تاریخ خروج"><Input type="date" value={form.disposedAt} onChange={(e) => setForm({ ...form, disposedAt: e.target.value })} dir="ltr" className="num h-9 rounded-xl text-[11px]" /></Field><Field label="علت خروج *"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="rounded-xl text-[11px]" /></Field><DialogFooter><Button type="button" variant="outline" onClick={onClose}>انصراف</Button><Button type="submit" variant="destructive" disabled={saving}>تأیید خروج و صدور سند</Button></DialogFooter></form></DialogContent></Dialog>;
}
