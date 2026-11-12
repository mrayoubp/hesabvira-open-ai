import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import {
  CommercePill,
  DateText,
  Qty,
  downloadCsv,
  printPage,
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
import { useWorkspace } from "@/hooks/use-workspace";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Barcode,
  Eye,
  FileSpreadsheet,
  ImagePlus,
  Layers3,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Tags,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

type ProductRow = {
  _id: string;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  taxRateBps: number;
  minStockMilli: number;
  productType: "physical" | "service" | "serial" | "expiry";
  trackSerial: boolean;
  trackExpiry: boolean;
  expiryDate: number | null;
  description: string | null;
  active: boolean;
  quantityMilli: number;
  lowStock: boolean;
};

const TYPE_LABELS: Record<ProductRow["productType"], string> = {
  physical: "کالای فیزیکی",
  service: "خدمت",
  serial: "دارای سریال",
  expiry: "دارای تاریخ انقضا",
};

function ProductDialog({
  open,
  onOpenChange,
  businessId,
  product,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  product: ProductRow | null;
  categories: { _id: string; name: string }[];
}) {
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const uploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const [form, setForm] = useState(() => ({
    code: product?.code ?? "",
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    categoryId: product?.categoryId ?? "none",
    brand: product?.brand ?? "",
    unit: product?.unit ?? "عدد",
    purchasePrice: product ? String(product.purchasePrice) : "",
    salePrice: product ? String(product.salePrice) : "",
    taxRateBps: String(product?.taxRateBps ?? 0),
    minStock: product ? String(product.minStockMilli / 1000) : "0",
    productType: product?.productType ?? "physical",
    description: product?.description ?? "",
    imageStorageId: undefined as string | undefined,
    imageName: "",
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const uploadImage = async (file: File) => {
    if (!businessId) return;
    setUploading(true);
    try {
      const url = await uploadUrl({ businessId });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("upload failed");
      const json = (await response.json()) as { storageId: string };
      await registerUpload({
        businessId,
        storageId: json.storageId as Id<"_storage">,
        name: file.name,
      });
      setForm((current) => ({
        ...current,
        imageStorageId: json.storageId,
        imageName: file.name,
      }));
      toast.success("تصویر بارگذاری شد.");
    } catch {
      toast.error("بارگذاری تصویر انجام نشد.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!form.name.trim() || !form.unit.trim()) {
      toast.error("نام و واحد کالا الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        businessId,
        code: form.code.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        name: form.name.trim(),
        imageStorageId: form.imageStorageId
          ? (form.imageStorageId as Id<"_storage">)
          : undefined,
        categoryId:
          form.categoryId === "none"
            ? undefined
            : (form.categoryId as Id<"productCategories">),
        brand: form.brand.trim() || undefined,
        unit: form.unit.trim(),
        purchasePrice: parseAmount(form.purchasePrice),
        salePrice: parseAmount(form.salePrice),
        taxRateBps: Number(form.taxRateBps) || 0,
        minStockMilli: Math.round((Number(form.minStock) || 0) * 1000),
        productType: form.productType as ProductRow["productType"],
        description: form.description.trim() || undefined,
      };
      if (product) {
        await updateProduct({
          ...payload,
          productId: product._id as Id<"products">,
        });
      } else {
        await createProduct(payload);
      }
      toast.success(product ? "کالا به‌روزرسانی شد." : "کالا ثبت شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{product ? "ویرایش کالا" : "کالای جدید"}</DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            کالا و خدمت با قیمت خرید/فروش، مالیات و حداقل موجودی. تاریخچه قیمت
            خودکار ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="کد کالا">
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="خودکار" className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="بارکد">
              <div className="flex gap-1.5">
                <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} dir="ltr" className="num h-9 rounded-xl text-[11px]" />
                <Barcode className="mt-2.5 size-4 shrink-0 text-ink-soft" />
              </div>
            </Field>
            <Field label="نام کالا / خدمت *" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="نوع">
              <Select value={form.productType} onValueChange={(v) => set("productType", v)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as ProductRow["productType"][]).map((key) => (
                    <SelectItem key={key} value={key}>{TYPE_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="دسته‌بندی">
              <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue placeholder="بدون دسته" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون دسته</SelectItem>
                  {categories.map((category) => <SelectItem key={category._id} value={category._id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="برند">
              <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="واحد اندازه‌گیری">
              <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} className="h-9 rounded-xl text-[11px]" />
            </Field>
            <Field label="قیمت خرید">
              <Input value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} inputMode="numeric" dir="ltr" className="num h-9 rounded-xl text-left text-[11px]" />
            </Field>
            <Field label="قیمت فروش">
              <Input value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} inputMode="numeric" dir="ltr" className="num h-9 rounded-xl text-left text-[11px]" />
            </Field>
            <Field label="نرخ مالیات">
              <Select value={form.taxRateBps} onValueChange={(v) => set("taxRateBps", v)}>
                <SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">بدون مالیات</SelectItem>
                  <SelectItem value="600">۶٪</SelectItem>
                  <SelectItem value="900">۹٪</SelectItem>
                  <SelectItem value="1000">۱۰٪</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="حداقل موجودی">
              <Input value={form.minStock} onChange={(e) => set("minStock", e.target.value)} inputMode="decimal" dir="ltr" className="num h-9 rounded-xl text-left text-[11px]" />
            </Field>
          </div>
          <Field label="توضیحات">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="rounded-xl text-[11px]" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={uploading} onClick={() => document.getElementById("product-image-input")?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              تصویر کالا
            </Button>
            <input id="product-image-input" type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} />
            {form.imageName ? <span className="truncate text-[10px] text-ink-soft">{form.imageName}</span> : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button>
            <Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : null} ذخیره کالا</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1.5", className)}><Label className="text-[10px]">{label}</Label>{children}</div>;
}

function ProductProfileDialog({ productId, onClose, currency }: { productId: string | null; onClose: () => void; currency: string }) {
  const { businessId } = useWorkspace();
  const detail = useQuery(api.products.get, businessId && productId ? { businessId, productId: productId as Id<"products"> } : "skip");
  return (
    <Dialog open={Boolean(productId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[720px]">
        {!detail ? <Skeleton className="h-64 rounded-xl" /> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Package className="size-4 text-brand" />{detail.name}</DialogTitle>
              <DialogDescription className="text-[11px]">{detail.code}{detail.barcode ? ` · ${detail.barcode}` : ""} · {TYPE_LABELS[detail.productType]}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-4">
              <Summary label="موجودی" value={<Qty value={detail.quantityMilli} />} />
              <Summary label="قیمت خرید" value={formatMoney(detail.purchasePrice, currency)} />
              <Summary label="قیمت فروش" value={formatMoney(detail.salePrice, currency)} />
              <Summary label="حداقل موجودی" value={<Qty value={detail.minStockMilli} />} />
            </div>
            <Panel><PanelHeader title="تاریخچه قیمت" eyebrow="قیمت خرید و فروش" /><div className="max-h-48 overflow-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">خرید</TableHead><TableHead className="text-[9px]">فروش</TableHead></TableRow></TableHeader><TableBody>{detail.priceHistory.map((row) => <TableRow key={row._id}><TableCell><DateText value={row.createdAt} /></TableCell><TableCell><span className="num">{formatMoney(row.purchasePrice, currency)}</span></TableCell><TableCell><span className="num">{formatMoney(row.salePrice, currency)}</span></TableCell></TableRow>)}</TableBody></Table></div></Panel>
            <Panel><PanelHeader title="کاردکس" eyebrow="آخرین گردش‌ها" /><div className="max-h-56 overflow-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">نوع</TableHead><TableHead className="text-[9px]">تعداد</TableHead><TableHead className="text-[9px]">شرح</TableHead></TableRow></TableHeader><TableBody>{detail.transactions.map((row) => <TableRow key={row._id}><TableCell><DateText value={row.occurredAt} /></TableCell><TableCell><CommercePill label={row.direction === "in" ? "ورود" : "خروج"} tone={row.direction === "in" ? "brand" : "gold"} /></TableCell><TableCell><Qty value={row.quantityMilli} /></TableCell><TableCell className="text-[10px]">{row.description}</TableCell></TableRow>)}</TableBody></Table></div></Panel>
            <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => printPage(`کالا ${detail.name}`)}><Printer className="size-4" /> چاپ</Button></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-hairline bg-background/70 p-3"><p className="text-[9px] text-ink-soft">{label}</p><p className="mt-1 text-[12px] font-black">{value}</p></div>;
}

function CategoryDialog({ open, onOpenChange, businessId, categories }: { open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">; categories: { _id: string; name: string; parentId: string | null; active: boolean }[] }) {
  const createCategory = useMutation(api.products.createCategory);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("none");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !name.trim()) return;
    try {
      await createCategory({ businessId, name: name.trim(), parentId: parentId === "none" ? undefined : (parentId as Id<"productCategories">) });
      toast.success("دسته‌بندی ثبت شد.");
      setName("");
    } catch (error) { toast.error(getErrorMessage(error)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[520px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Tags className="size-4 text-brand" />دسته‌بندی کالا</DialogTitle><DialogDescription className="text-[11px]">دسته‌ها می‌توانند زیرمجموعه داشته باشند.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <Field label="نام دسته *"><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-xl text-[11px]" /></Field>
          <Field label="دسته والد"><Select value={parentId} onValueChange={setParentId}><SelectTrigger className="h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون والد</SelectItem>{categories.map((category) => <SelectItem key={category._id} value={category._id}>{category.name}</SelectItem>)}</SelectContent></Select></Field>
          <Button type="submit" className="w-full rounded-xl"><Plus className="size-4" /> افزودن دسته</Button>
        </form>
        <div className="max-h-56 overflow-auto rounded-xl border border-hairline p-2">
          {categories.length === 0 ? <p className="p-3 text-center text-[10px] text-ink-soft">دسته‌ای ثبت نشده است.</p> : categories.map((category) => <div key={category._id} className="flex items-center justify-between border-b border-hairline/60 px-2 py-1.5 last:border-0"><span className="text-[10px]">{category.name}</span><span className="text-[8px] text-ink-soft">{category.parentId ? "زیرمجموعه" : "اصلی"}</span></div>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const { businessId, currency, role } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [categoryId, setCategoryId] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(
    searchParams.get("new") === "1" && role !== "viewer",
  );
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [profileId, setProfileId] = useState<string | null>(
    searchParams.get("product"),
  );
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categories = useQuery(api.products.categories, businessId ? { businessId, includeInactive: true } : "skip") ?? [];
  const products = useQuery(api.products.list, businessId ? { businessId, search: deferredSearch.trim() || undefined, categoryId: categoryId === "all" ? undefined : (categoryId as Id<"productCategories">), includeInactive } : "skip");
  const canWrite = role !== "viewer";
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · کالا و خدمات"
        title="کاتالوگ کالا و خدمات"
        description="کد و بارکد یکتا، دسته‌بندی، قیمت خرید و فروش، مالیات، حداقل موجودی و گردش واقعی انبار."
        actions={<>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setCategoriesOpen(true)}><Layers3 className="size-4" /> دسته‌بندی‌ها</Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => downloadCsv("products.csv", ["کد", "نام", "بارکد", "موجودی", "قیمت فروش", "فعال"], (products ?? []).map((row) => [row.code, row.name, row.barcode ?? "", row.quantityMilli / 1000, row.salePrice, row.active ? "بله" : "خیر"]))}><FileSpreadsheet className="size-4" /> Excel</Button>
          {canWrite ? <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="size-4" /> کالای جدید</Button> : null}
        </>}
      />
      <Panel>
        <PanelHeader eyebrow="فهرست کالاها" title={`${products?.length ?? 0} کالا و خدمت`} description="جستجو در نام، کد و بارکد." action={<div className="flex flex-wrap items-center gap-2"><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger className="h-8 w-40 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه دسته‌ها</SelectItem>{categories.map((category) => <SelectItem key={category._id} value={category._id}>{category.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant={includeInactive ? "default" : "outline"} size="sm" className="h-8 rounded-lg text-[9px]" onClick={() => setIncludeInactive((value) => !value)}>غیرفعال‌ها</Button><div className="relative w-48"><Search className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-soft" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجو…" className="h-8 rounded-lg pe-8 text-[10px]" /></div></div>} />
        {!products ? <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-11 rounded-lg" />)}</div> : products.length === 0 ? <EmptyState icon={<Package className="size-5" />} title="کالایی پیدا نشد" description="کالای جدید ثبت کنید یا فیلترها را تغییر دهید." action={canWrite ? <Button size="sm" onClick={() => setDialogOpen(true)}>ثبت کالا</Button> : undefined} /> : (
          <>
            <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead className="ps-4 text-[10px]">کد</TableHead><TableHead className="text-[10px]">کالا</TableHead><TableHead className="text-[10px]">دسته</TableHead><TableHead className="text-[10px]">نوع</TableHead><TableHead className="text-[10px]">موجودی</TableHead><TableHead className="text-[10px]">خرید</TableHead><TableHead className="text-[10px]">فروش</TableHead><TableHead className="text-[10px]">وضعیت</TableHead><TableHead className="w-24 pe-4" /></TableRow></TableHeader><TableBody>{products.map((row) => <TableRow key={row._id}><TableCell className="ps-4 font-mono text-[10px] text-ink-soft">{row.code}</TableCell><TableCell><p className="text-[11px] font-semibold">{row.name}</p><p className="text-[9px] text-ink-soft">{row.barcode ?? row.brand ?? "—"}</p></TableCell><TableCell className="text-[10px]">{row.categoryName ?? "—"}</TableCell><TableCell className="text-[10px]">{TYPE_LABELS[row.productType]}</TableCell><TableCell className={cn("num text-[10px] font-semibold", row.lowStock ? "text-destructive" : "text-ink")}>{row.productType === "service" ? "—" : <Qty value={row.quantityMilli} />}{row.lowStock ? " ⚠" : ""}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.purchasePrice, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.salePrice, currency)}</TableCell><TableCell><CommercePill label={row.active ? "فعال" : "غیرفعال"} tone={row.active ? "brand" : "muted"} /></TableCell><TableCell className="pe-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="size-7" onClick={() => setProfileId(row._id)} aria-label="مشاهده"><Eye className="size-3.5" /></Button>{canWrite ? <Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditing(row); setDialogOpen(true); }} aria-label="ویرایش"><Pencil className="size-3.5" /></Button> : null}</div></TableCell></TableRow>)}</TableBody></Table></div>
            <ul className="divide-y divide-hairline md:hidden">{products.map((row) => <li key={row._id} className="p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-[12px] font-semibold">{row.name}</p><p className="num text-[9px] text-ink-soft">{row.code} · {row.categoryName ?? "بدون دسته"}</p></div><div className="text-end"><p className="num text-[11px] font-bold">{formatMoney(row.salePrice, currency)}</p><p className={cn("num text-[9px]", row.lowStock ? "text-destructive" : "text-ink-soft")}>موجودی <Qty value={row.quantityMilli} /></p></div></div></li>)}</ul>
          </>
        )}
      </Panel>
      {dialogOpen ? <ProductDialog key={editing?._id ?? "new"} open onOpenChange={setDialogOpen} businessId={businessId} product={editing} categories={categories} /> : null}
      <CategoryDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} businessId={businessId} categories={categories} />
      <ProductProfileDialog productId={profileId} onClose={() => setProfileId(null)} currency={currency} />
    </div>
  );
}
