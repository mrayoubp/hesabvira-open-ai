import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import {
  CommercePill,
  INVENTORY_STATUS_LABELS,
  INVENTORY_TYPE_LABELS,
  Metric,
  Qty,
  DateText,
  downloadCsv,
} from "@/components/commerce/shared";
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
import type { InventoryDocumentType } from "@/convex/schema";
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatMoney, formatQuantity } from "@/lib/format";
import { parseAmount, parseQuantityMilli } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  Plus,
  Settings2,
  Warehouse,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type WarehouseRow = {
  _id: string;
  code: string;
  name: string;
  branchId: string;
  responsibleName: string | null;
  address: string | null;
  isDefault: boolean;
  active: boolean;
};

type ProductOption = {
  _id: string;
  name: string;
  code: string;
  unit: string;
  purchasePrice: number;
};

function WarehouseDialog({
  open,
  onOpenChange,
  businessId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
}) {
  const create = useMutation(api.inventory.createWarehouse);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [responsible, setResponsible] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !name.trim()) return;
    setSaving(true);
    try {
      await create({
        businessId,
        name: name.trim(),
        code: code.trim() || undefined,
        responsibleName: responsible.trim() || undefined,
        address: address.trim() || undefined,
      });
      toast.success("انبار ثبت شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[500px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Warehouse className="size-4 text-brand" />انبار جدید</DialogTitle><DialogDescription className="text-[11px]">انبار به شعبه فعال متصل می‌شود.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div><Label className="text-[10px]">نام انبار *</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[10px]">کد انبار</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="خودکار" className="mt-1.5 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[10px]">مسئول انبار</Label><Input value={responsible} onChange={(e) => setResponsible(e.target.value)} className="mt-1.5 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[10px]">نشانی</Label><Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="mt-1.5 rounded-xl text-[11px]" /></div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : null} ثبت انبار</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InventoryDocDialog({
  open,
  onOpenChange,
  businessId,
  warehouses,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  warehouses: WarehouseRow[];
  products: ProductOption[];
}) {
  const create = useMutation(api.inventory.createDocument);
  const [type, setType] = useState<InventoryDocumentType>("receipt");
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouses[0]?._id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(
    warehouses.find((row) => row.isDefault)?._id ?? warehouses[0]?._id ?? "",
  );
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [occurredDate, setOccurredDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([
    { productId: products[0]?._id ?? "", quantity: "1", unitCost: String(products[0]?.purchasePrice ?? 0) },
  ]);
  const [saving, setSaving] = useState(false);
  const updateLine = (index: number, key: "productId" | "quantity" | "unitCost", value: string) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [key]: value };
      if (key === "productId") {
        const product = products.find((row) => row._id === value);
        next.unitCost = String(product?.purchasePrice ?? 0);
      }
      return next;
    }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!description.trim()) {
      toast.error("شرح سند الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const selectedLines = lines
        .filter((line) => line.productId && parseQuantityMilli(line.quantity) > 0)
        .map((line) => ({
          productId: line.productId as Id<"products">,
          quantityMilli: parseQuantityMilli(line.quantity),
          unitCost: parseAmount(line.unitCost) || undefined,
        }));
      if (selectedLines.length === 0) throw new Error("حداقل یک ردیف معتبر لازم است.");
      const result = await create({
        businessId,
        type,
        fromWarehouseId: type === "receipt" || type === "return_from_customer" ? undefined : (fromWarehouseId as Id<"warehouses">),
        toWarehouseId: type === "transfer" || type === "receipt" || type === "return_from_customer" || type === "adjustment" || type === "count" ? (toWarehouseId as Id<"warehouses">) : undefined,
        occurredAt: Date.parse(`${occurredDate}T12:00:00Z`),
        description: description.trim(),
        adjustmentDirection: type === "adjustment" || type === "count" ? direction : undefined,
        lines: selectedLines,
      });
      toast.success(`سند ${result.number} به‌صورت پیش‌نویس ثبت شد؛ برای اعمال موجودی آن را قطعی کنید.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const needsFrom = type !== "receipt" && type !== "return_from_customer";
  const needsTo = type !== "issue" && type !== "return_to_supplier";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[760px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PackagePlus className="size-4 text-brand" />سند انبار جدید</DialogTitle><DialogDescription className="text-[11px]">موجودی فقط با ثبت سند گردش تغییر می‌کند؛ سند پیش‌نویس تا زمان قطعی‌شدن اثری ندارد.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-[10px]">نوع سند</Label><Select value={type} onValueChange={(value) => setType(value as InventoryDocumentType)}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(INVENTORY_TYPE_LABELS) as InventoryDocumentType[]).map((key) => <SelectItem key={key} value={key}>{INVENTORY_TYPE_LABELS[key]}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">تاریخ</Label><Input type="date" value={occurredDate} onChange={(e) => setOccurredDate(e.target.value)} dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            {needsFrom ? <div><Label className="text-[10px]">انبار مبدأ</Label><Select value={fromWarehouseId} onValueChange={setFromWarehouseId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب انبار" /></SelectTrigger><SelectContent>{warehouses.map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div> : null}
            {needsTo ? <div><Label className="text-[10px]">انبار مقصد</Label><Select value={toWarehouseId} onValueChange={setToWarehouseId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب انبار" /></SelectTrigger><SelectContent>{warehouses.map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div> : null}
            {type === "adjustment" || type === "count" ? <div><Label className="text-[10px]">جهت اصلاح</Label><Select value={direction} onValueChange={(value) => setDirection(value as "in" | "out")}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">افزایش موجودی</SelectItem><SelectItem value="out">کاهش موجودی</SelectItem></SelectContent></Select></div> : null}
          </div>
          <div><Label className="text-[10px]">شرح سند *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1.5 rounded-xl text-[11px]" /></div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label className="text-[10px]">ردیف‌ها</Label><Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-[9px]" onClick={() => setLines((current) => [...current, { productId: products[0]?._id ?? "", quantity: "1", unitCost: "0" }])}><Plus className="size-3.5" /> ردیف</Button></div>
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-hairline p-2 sm:grid-cols-[1fr_90px_100px_30px]">
                <Select value={line.productId} onValueChange={(value) => updateLine(index, "productId", value)}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue placeholder="کالا" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product._id} value={product._id}>{product.name} · {product.code}</SelectItem>)}</SelectContent></Select>
                <Input value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} placeholder="تعداد" inputMode="decimal" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Input value={line.unitCost} onChange={(e) => updateLine(index, "unitCost", e.target.value)} placeholder="بهای واحد" inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)}>×</Button>
              </div>
            ))}
          </div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : null} ذخیره پیش‌نویس</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryPage() {
  const { businessId, currency, role } = useWorkspace();
  const [tab, setTab] = useState<"stock" | "documents" | "warehouses">("stock");
  const [search, setSearch] = useState("");
  const [docOpen, setDocOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const balances = useQuery(api.inventory.balances, businessId ? { businessId, search: search.trim() || undefined } : "skip");
  const warehouses = useQuery(api.inventory.warehouses, businessId ? { businessId } : "skip") ?? [];
  const documents = useQuery(api.inventory.documents, businessId ? { businessId, limit: 200 } : "skip");
  const products = useQuery(api.products.list, businessId ? { businessId } : "skip") ?? [];
  const settings = useQuery(api.inventory.settings, businessId ? { businessId } : "skip");
  const postDocument = useMutation(api.inventory.postDocument);
  const updateSettings = useMutation(api.inventory.updateValuationMethod);
  const canWrite = role !== "viewer";
  const canManage = role === "owner" || role === "admin";

  const post = async (documentId: string) => {
    if (!businessId) return;
    try {
      const result = await postDocument({ businessId, documentId: documentId as Id<"inventoryDocuments"> });
      toast.success(result.accountingDocumentId ? "سند انبار قطعی و سند حسابداری متوازن ثبت شد." : "سند انبار قطعی شد.");
    } catch (error) { toast.error(getErrorMessage(error)); }
  };
  const changeMethod = async (method: "fifo" | "weighted_average", allowNegativeStock: boolean) => {
    if (!businessId) return;
    setSavingSettings(true);
    try {
      await updateSettings({ businessId, method, allowNegativeStock });
      toast.success("روش ارزش‌گذاری برای اسناد آینده به‌روزرسانی شد؛ سوابق قبلی تغییر نمی‌کند.");
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSavingSettings(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · انبارداری چندگانه"
        title="انبارها، موجودی و گردش کالا"
        description="رسید ورود، حواله خروج، انتقال بین انبارها، اصلاح با مجوز و انبارگردانی؛ همه تغییرات در دفتر گردش موجودی ثبت می‌شوند."
        actions={<>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => downloadCsv("inventory.csv", ["کالا", "انبار", "موجودی", "بهای میانگین", "ارزش"], (balances?.rows ?? []).map((row) => [row.productName, row.warehouseName, row.quantityMilli / 1000, row.averageCost, row.value]))}><FileSpreadsheet className="size-4" /> Excel</Button>
          {canWrite ? <><Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setWarehouseOpen(true)}><Warehouse className="size-4" /> انبار جدید</Button><Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setDocOpen(true)}><PackagePlus className="size-4" /> سند انبار</Button></> : null}
        </>}
      />
      <div className="flex flex-wrap gap-1.5">
        {([{ key: "stock", label: "موجودی و کاردکس" }, { key: "documents", label: "اسناد انبار" }, { key: "warehouses", label: "انبارها و تنظیمات" }] as const).map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("rounded-full border px-3 py-1.5 text-[10px] font-semibold", tab === item.key ? "border-brand bg-brand text-cream" : "border-hairline bg-card text-ink-soft")}>{item.label}</button>)}
      </div>

      {tab === "stock" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-4"><Metric label="تعداد اقلام" value={String(balances?.rows.length ?? 0)} /><Metric label="موجودی کل" value={balances ? formatQuantity(balances.totalQuantityMilli) : "—"} /><Metric label="ارزش موجودی" value={formatMoney(balances?.totalValue ?? 0, currency)} tone="brand" /><Metric label="کالاهای کم‌موجودی" value={String(balances?.lowStockCount ?? 0)} tone="danger" /></div>
          <Panel><PanelHeader eyebrow="موجودی واقعی" title="موجودی هر انبار" description="بر پایه دفتر گردش موجودی، نه یک عدد دستی." action={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی کالا…" className="h-8 w-48 rounded-lg text-[10px]" />} />
            {!balances ? <Skeleton className="m-4 h-40 rounded-xl" /> : balances.rows.length === 0 ? <EmptyState icon={<Boxes className="size-5" />} title="موجودی ثبت نشده" description="با ثبت رسید ورود یا فاکتور خرید، موجودی واقعی شکل می‌گیرد." /> : <div className="overflow-x-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">کالا</TableHead><TableHead className="text-[9px]">انبار</TableHead><TableHead className="text-[9px]">موجودی</TableHead><TableHead className="text-[9px]">بهای میانگین</TableHead><TableHead className="text-[9px]">ارزش</TableHead><TableHead className="text-[9px]">حداقل</TableHead></TableRow></TableHeader><TableBody>{balances.rows.map((row) => <TableRow key={`${row.productId}:${row.warehouseId}`}><TableCell><p className="text-[10px] font-semibold">{row.productName}</p><p className="text-[8px] text-ink-soft">{row.productCode}</p></TableCell><TableCell className="text-[10px]">{row.warehouseName}</TableCell><TableCell className={cn("text-[10px]", row.lowStock && "text-destructive")}><Qty value={row.quantityMilli} /> {row.lowStock ? "⚠" : ""}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.averageCost, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.value, currency)}</TableCell><TableCell className="text-[10px]"><Qty value={row.minStockMilli} /></TableCell></TableRow>)}</TableBody></Table></div>}
          </Panel>
        </>
      ) : tab === "documents" ? (
        <Panel><PanelHeader eyebrow="دفتر اسناد" title="اسناد ورود، خروج، انتقال و اصلاح" description="سند پیش‌نویس تا زمان قطعی‌شدن موجودی را تغییر نمی‌دهد." />
          {!documents ? <Skeleton className="m-4 h-40 rounded-xl" /> : documents.length === 0 ? <EmptyState icon={<ArrowLeftRight className="size-5" />} title="سندی ثبت نشده" description="اولین رسید ورود یا حواله خروج را ثبت کنید." /> : <div className="overflow-x-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">شماره</TableHead><TableHead className="text-[9px]">نوع</TableHead><TableHead className="text-[9px]">مبدأ</TableHead><TableHead className="text-[9px]">مقصد</TableHead><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">وضعیت</TableHead><TableHead className="text-[9px]">ارزش</TableHead><TableHead /></TableRow></TableHeader><TableBody>{documents.map((row) => <TableRow key={row._id}><TableCell className="num text-[10px]">{row.number}</TableCell><TableCell><CommercePill label={INVENTORY_TYPE_LABELS[row.type]} tone="mist" /></TableCell><TableCell className="text-[10px]">{row.fromWarehouseName ?? "—"}</TableCell><TableCell className="text-[10px]">{row.toWarehouseName ?? "—"}</TableCell><TableCell><DateText value={row.occurredAt} /></TableCell><TableCell><CommercePill label={INVENTORY_STATUS_LABELS[row.status]} tone={row.status === "posted" ? "brand" : "muted"} /></TableCell><TableCell className="num text-[10px]">{formatMoney(row.totalValue, currency)}</TableCell><TableCell>{row.status === "draft" && canWrite ? <Button size="sm" className="h-7 rounded-lg text-[9px]" onClick={() => void post(row._id)}><CheckCircle2 className="size-3.5" /> قطعی</Button> : null}</TableCell></TableRow>)}</TableBody></Table></div>}
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel><PanelHeader eyebrow="چند انبار" title="انبارهای کسب‌وکار" />
            <div className="divide-y divide-hairline px-4 pb-4">{warehouses.map((row) => <div key={row._id} className="flex items-center justify-between py-2.5"><div><p className="text-[11px] font-semibold">{row.name} {row.isDefault ? <CommercePill label="پیش‌فرض" tone="gold" /> : null}</p><p className="num text-[9px] text-ink-soft">{row.code} · {row.responsibleName ?? "بدون مسئول"}</p></div><CommercePill label={row.active ? "فعال" : "غیرفعال"} tone={row.active ? "brand" : "muted"} /></div>)}</div>
          </Panel>
          <Panel><PanelHeader eyebrow="ارزش‌گذاری" title="روش بهای تمام‌شده" description="تغییر روش فقط بر اسناد آینده اثر دارد و سوابق قطعی را بازنویسی نمی‌کند." />
            <div className="space-y-3 px-4 pb-4">{settings ? <><div className="flex gap-2"><Button variant={settings.valuationMethod === "fifo" ? "default" : "outline"} size="sm" className="flex-1 rounded-xl" disabled={savingSettings || !canManage} onClick={() => void changeMethod("fifo", settings.allowNegativeStock)}>FIFO</Button><Button variant={settings.valuationMethod === "weighted_average" ? "default" : "outline"} size="sm" className="flex-1 rounded-xl" disabled={savingSettings || !canManage} onClick={() => void changeMethod("weighted_average", settings.allowNegativeStock)}>میانگین موزون</Button></div><Button variant={settings.allowNegativeStock ? "default" : "outline"} size="sm" className="w-full rounded-xl" disabled={savingSettings || !canManage} onClick={() => void changeMethod(settings.valuationMethod, !settings.allowNegativeStock)}><Settings2 className="size-4" /> موجودی منفی: {settings.allowNegativeStock ? "مجاز" : "ممنوع"}</Button>{!canManage ? <p className="text-[9px] text-ink-soft">تغییر تنظیمات فقط برای مدیر کسب‌وکار مجاز است.</p> : null}</> : <Skeleton className="h-24 rounded-xl" />}</div>
          </Panel>
        </div>
      )}
      {docOpen ? <InventoryDocDialog open onOpenChange={setDocOpen} businessId={businessId} warehouses={warehouses} products={products} /> : null}
      <WarehouseDialog open={warehouseOpen} onOpenChange={setWarehouseOpen} businessId={businessId} />
    </div>
  );
}
