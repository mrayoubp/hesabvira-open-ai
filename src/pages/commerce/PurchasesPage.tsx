import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import {
  CommercePill,
  DateText,
  Metric,
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
import { formatJalali, formatMoney, formatQuantity } from "@/lib/format";
import { lineTotal, parseAmount, parseQuantityMilli } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Banknote,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type PurchaseRow = {
  _id: string;
  number: string;
  kind: "purchase" | "return";
  status: "draft" | "posted" | "paid" | "cancelled";
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  issueDate: number;
  dueDate: number | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  extraCosts: number;
  total: number;
  paidAmount: number;
  returnedAmount: number;
  outstanding: number;
  accountingDocumentId?: string;
};

type ProductOption = {
  _id: string;
  name: string;
  code: string;
  unit: string;
  purchasePrice: number;
  taxRateBps: number;
  productType: string;
  active: boolean;
};

const STATUS_LABELS: Record<PurchaseRow["status"], string> = {
  draft: "پیش‌نویس",
  posted: "ثبت‌شده",
  paid: "تسویه‌شده",
  cancelled: "لغوشده",
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function NewPurchaseDialog({
  open,
  onOpenChange,
  businessId,
  suppliers,
  warehouses,
  products,
  currency,
  taxRateBps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  suppliers: { _id: string; name: string; code: string; active: boolean }[];
  warehouses: { _id: string; name: string; isDefault: boolean; active: boolean }[];
  products: ProductOption[];
  currency: string;
  taxRateBps: number;
}) {
  const create = useMutation(api.purchases.create);
  const treasury = useQuery(api.treasury.accountBalances, businessId ? { businessId } : "skip");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses.find((row) => row.isDefault)?._id ?? warehouses[0]?._id ?? "");
  const [issueDate, setIssueDate] = useState(isoToday);
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [taxRate, setTaxRate] = useState(String(taxRateBps));
  const [discount, setDiscount] = useState("0");
  const [extraCosts, setExtraCosts] = useState("0");
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<{ method: "cash" | "card" | "bank"; amount: string; accountId: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState([
    { productId: products.find((row) => row.productType !== "service" && row.active)?._id ?? "", quantity: "1", unitCost: String(products.find((row) => row.productType !== "service" && row.active)?.purchasePrice ?? 0), discount: "0" },
  ]);
  const activeProducts = products.filter((row) => row.active && row.productType !== "service");
  const activeSuppliers = suppliers.filter((row) => row.active);
  const updateLine = (index: number, key: string, value: string) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [key]: value };
      if (key === "productId") next.unitCost = String(products.find((row) => row._id === value)?.purchasePrice ?? 0);
      return next;
    }));
  };
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, lineTotal(parseQuantityMilli(line.quantity), parseAmount(line.unitCost)) - parseAmount(line.discount)), 0);
  const invoiceDiscount = Math.min(parseAmount(discount), subtotal);
  const tax = Math.round((subtotal - invoiceDiscount) * (Number(taxRate) || 0) / 10000);
  const total = subtotal - invoiceDiscount + tax + parseAmount(extraCosts);
  const paidTotal = payments.reduce((sum, row) => sum + parseAmount(row.amount), 0);
  const updatePayment = (index: number, patch: Partial<(typeof payments)[number]>) => {
    setPayments((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!supplierId || !warehouseId) { toast.error("تأمین‌کننده و انبار را انتخاب کنید."); return; }
    const selectedLines = lines.filter((line) => line.productId && parseQuantityMilli(line.quantity) > 0).map((line) => ({
      productId: line.productId as Id<"products">,
      quantityMilli: parseQuantityMilli(line.quantity),
      unitCost: parseAmount(line.unitCost),
      discount: parseAmount(line.discount),
      taxRateBps: Number(taxRate) || 0,
    }));
    if (!selectedLines.length) { toast.error("حداقل یک ردیف معتبر لازم است."); return; }
    if (paidTotal > total) { toast.error("جمع پرداخت‌ها از مبلغ فاکتور بیشتر است."); return; }
    if (payments.some((row) => parseAmount(row.amount) > 0 && !row.accountId)) { toast.error("برای هر ردیف پرداخت، صندوق یا حساب بانکی را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const result = await create({
        businessId,
        supplierId: supplierId as Id<"suppliers">,
        warehouseId: warehouseId as Id<"warehouses">,
        issueDate: Date.parse(`${issueDate}T12:00:00Z`),
        dueDate: Date.parse(`${dueDate}T12:00:00Z`),
        lines: selectedLines,
        discount: invoiceDiscount,
        extraCosts: parseAmount(extraCosts),
        taxRateBps: Number(taxRate) || 0,
        notes: notes.trim() || undefined,
        payments: payments
          .filter((row) => parseAmount(row.amount) > 0)
          .map((row) => ({
            method: row.method,
            amount: parseAmount(row.amount),
            bankAccountId: row.method === "cash" ? undefined : (row.accountId as Id<"bankAccounts">),
            cashFundId: row.method === "cash" ? (row.accountId as Id<"cashFunds">) : undefined,
          })),
      });
      toast.success(`فاکتور خرید ${result.number} ثبت شد؛ موجودی افزایش و سند حسابداری ایجاد شد.`);
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[900px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="size-4 text-brand" />فاکتور خرید جدید</DialogTitle><DialogDescription className="text-[11px]">خرید قطعی موجودی انبار را افزایش می‌دهد، بهای تمام‌شده را با هزینه‌های جانبی می‌سازد و بدهی تأمین‌کننده را ثبت می‌کند.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label className="text-[10px]">تأمین‌کننده *</Label><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب تأمین‌کننده" /></SelectTrigger><SelectContent>{activeSuppliers.map((row) => <SelectItem key={row._id} value={row._id}>{row.name} · {row.code}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">انبار *</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب انبار" /></SelectTrigger><SelectContent>{warehouses.filter((row) => row.active).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">تاریخ</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[10px]">سررسید</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div className="space-y-2 sm:col-span-3">
              <div className="flex items-center justify-between"><Label className="text-[10px]">پرداخت‌ها (ترکیبی)</Label><Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-[9px]" onClick={() => setPayments((current) => [...current, { method: "cash", amount: "", accountId: "" }])}><Plus className="size-3.5" /> افزودن پرداخت</Button></div>
              {payments.length === 0 ? <p className="rounded-lg border border-dashed border-hairline p-2 text-[9px] text-ink-soft">بدون پرداخت = خرید اعتباری؛ مانده به بدهی تأمین‌کننده اضافه می‌شود.</p> : null}
              {payments.map((row, index) => <div key={index} className="grid gap-2 rounded-xl border border-hairline p-2 sm:grid-cols-[100px_1fr_120px_32px]">
                <Select value={row.method} onValueChange={(value) => updatePayment(index, { method: value as "cash" | "card" | "bank", accountId: "" })}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدی</SelectItem><SelectItem value="card">کارت‌خوان</SelectItem><SelectItem value="bank">بانکی</SelectItem></SelectContent></Select>
                <Select value={row.accountId} onValueChange={(value) => updatePayment(index, { accountId: value })}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue placeholder={row.method === "cash" ? "صندوق" : "حساب بانکی"} /></SelectTrigger><SelectContent>{row.method === "cash" ? (treasury?.funds ?? []).filter((option) => option.active).map((option) => <SelectItem key={option._id} value={option._id}>{option.name}</SelectItem>) : (treasury?.banks ?? []).filter((option) => option.active).map((option) => <SelectItem key={option._id} value={option._id}>{option.name}</SelectItem>)}</SelectContent></Select>
                <Input value={row.amount} onChange={(e) => updatePayment(index, { amount: e.target.value })} placeholder="مبلغ" inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>×</Button>
              </div>)}
            </div>
            <div className="sm:col-span-3"><Label className="text-[10px]">توضیحات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1.5 rounded-xl text-[11px]" /></div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label className="text-[10px]">اقلام خرید</Label><Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[9px]" onClick={() => setLines((current) => [...current, { productId: activeProducts[0]?._id ?? "", quantity: "1", unitCost: "0", discount: "0" }])}><Plus className="size-3.5" /> ردیف</Button></div>
            {lines.map((line, index) => <div key={`${index}:${line.productId}`} className="grid gap-2 rounded-xl border border-hairline p-2 sm:grid-cols-[1fr_75px_110px_90px_32px]"><Select value={line.productId} onValueChange={(value) => updateLine(index, "productId", value)}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue placeholder="کالا" /></SelectTrigger><SelectContent>{activeProducts.map((product) => <SelectItem key={product._id} value={product._id}>{product.name} · {product.code}</SelectItem>)}</SelectContent></Select><Input value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} inputMode="decimal" dir="ltr" className="num h-8 rounded-lg text-[10px]" /><Input value={line.unitCost} onChange={(e) => updateLine(index, "unitCost", e.target.value)} inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" /><Input value={line.discount} onChange={(e) => updateLine(index, "discount", e.target.value)} inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" /><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)}>×</Button></div>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label className="text-[10px]">تخفیف فاکتور</Label><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[10px]">هزینه‌های جانبی</Label><Input value={extraCosts} onChange={(e) => setExtraCosts(e.target.value)} inputMode="numeric" dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[10px]">نرخ مالیات</Label><Select value={taxRate} onValueChange={setTaxRate}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">بدون مالیات</SelectItem><SelectItem value="600">۶٪</SelectItem><SelectItem value="900">۹٪</SelectItem><SelectItem value="1000">۱۰٪</SelectItem></SelectContent></Select></div>
            <div className="rounded-xl border border-brand/20 bg-brand-soft/40 p-2 text-[9px]"><div className="flex justify-between"><span>جمع</span><span className="num">{formatMoney(subtotal, currency)}</span></div><div className="flex justify-between"><span>مالیات</span><span className="num">{formatMoney(tax, currency)}</span></div><div className="mt-1 flex justify-between border-t border-brand/15 pt-1 text-[11px] font-bold text-brand"><span>نهایی</span><span className="num">{formatMoney(total, currency)}</span></div><div className="mt-1 flex justify-between text-[8px]"><span>پرداخت / مانده</span><span className="num">{formatMoney(paidTotal, currency)} / {formatMoney(Math.max(0, total - paidTotal), currency)}</span></div></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />} ثبت خرید قطعی</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseReturnDialog({ open, onOpenChange, businessId, invoice, currency }: {
  open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">;
  invoice: { _id: string; number: string; items: { _id: string; description: string; quantityMilli: number; returnedQuantityMilli: number; landedUnitCost: number }[] };
  currency: string;
}) {
  const createReturn = useMutation(api.purchases.createReturn);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<"credit" | "cash" | "bank">("credit");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    const lines = invoice.items.filter((item) => parseQuantityMilli(quantities[item._id] ?? "") > 0).map((item) => ({ purchaseItemId: item._id as Id<"purchaseInvoiceItems">, quantityMilli: parseQuantityMilli(quantities[item._id] ?? "") }));
    if (!lines.length) { toast.error("تعداد برگشت را وارد کنید."); return; }
    setSaving(true);
    try {
      const result = await createReturn({ businessId, invoiceId: invoice._id as Id<"purchaseInvoices">, lines, refundMethod });
      toast.success(`برگشت خرید ${result.number} ثبت شد و موجودی کاهش یافت.`);
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[24px] sm:max-w-[560px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="size-4 text-brand" />برگشت به تأمین‌کننده {invoice.number}</DialogTitle><DialogDescription className="text-[11px]">برگشت خرید موجودی را کاهش می‌دهد و سند اصلاحی و بدهی تأمین‌کننده را به‌روز می‌کند.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-2">{invoice.items.map((item) => <div key={item._id} className="flex items-center gap-2 rounded-xl border border-hairline p-2"><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{item.description}</p><p className="num text-[8px] text-ink-soft">باقی‌مانده: {formatQuantity(item.quantityMilli - item.returnedQuantityMilli)} · بهای واحد: {formatMoney(item.landedUnitCost, currency)}</p></div><Input value={quantities[item._id] ?? ""} onChange={(e) => setQuantities((current) => ({ ...current, [item._id]: e.target.value }))} placeholder="۰" inputMode="decimal" dir="ltr" className="num h-8 w-20 rounded-lg text-[10px]" /></div>)}</div>
          <div><Label className="text-[10px]">روش تسویه برگشت</Label><Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as typeof refundMethod)}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="credit">کاهش بدهی تأمین‌کننده</SelectItem><SelectItem value="cash">دریافت نقدی</SelectItem><SelectItem value="bank">دریافت بانکی</SelectItem></SelectContent></Select></div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} ثبت برگشت خرید</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplierPaymentDialog({ open, onOpenChange, businessId, invoice, currency, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; businessId?: Id<"businesses">;
  invoice: { _id: string; number: string; supplierId: string; supplierName: string; outstanding: number };
  currency: string; onDone: () => void;
}) {
  const treasury = useQuery(api.treasury.accountBalances, businessId ? { businessId } : "skip");
  const createVoucher = useMutation(api.paymentVouchers.create);
  const postVoucher = useMutation(api.paymentVouchers.post);
  const [amount, setAmount] = useState(String(invoice.outstanding));
  const [sourceType, setSourceType] = useState<"bank" | "cash">("bank");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!accountId) { toast.error("حساب پرداخت را انتخاب کنید."); return; }
    setSaving(true);
    try {
      const created = await createVoucher({
        businessId,
        partyType: "supplier",
        partyName: invoice.supplierName,
        supplierId: invoice.supplierId as Id<"suppliers">,
        purchaseInvoiceId: invoice._id as Id<"purchaseInvoices">,
        amount: parseAmount(amount),
        method: sourceType === "bank" ? "bank_transfer" : "cash",
        sourceType,
        bankAccountId: sourceType === "bank" ? (accountId as Id<"bankAccounts">) : undefined,
        cashFundId: sourceType === "cash" ? (accountId as Id<"cashFunds">) : undefined,
        description: `پرداخت فاکتور خرید ${invoice.number}`,
      });
      const posted = await postVoucher({ businessId, voucherId: created.voucherId as Id<"paymentVouchers"> });
      toast.success(`پرداخت ${created.number} ثبت و سند ${posted.accountingNumber} صادر شد.`);
      onDone();
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-[460px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Banknote className="size-4 text-brand" />پرداخت به تأمین‌کننده</DialogTitle><DialogDescription className="text-[11px]">مانده فاکتور {invoice.number}: {formatMoney(invoice.outstanding, currency)}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div><Label className="text-[10px]">مبلغ *</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
          <div><Label className="text-[10px]">منبع پرداخت</Label><Select value={sourceType} onValueChange={(value) => { setSourceType(value as typeof sourceType); setAccountId(""); }}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank">حساب بانکی</SelectItem><SelectItem value="cash">صندوق</SelectItem></SelectContent></Select></div>
          <div><Label className="text-[10px]">{sourceType === "bank" ? "حساب بانکی" : "صندوق"}</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب" /></SelectTrigger><SelectContent>{sourceType === "bank" ? (treasury?.banks ?? []).filter((row) => row.active).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>) : (treasury?.funds ?? []).filter((row) => row.active).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />} ثبت پرداخت</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PurchasePrintSheet({ detail, businessName, currency }: {
  detail: {
    number: string; issueDate: number; dueDate: number | null; kind: "purchase" | "return";
    supplier: { name: string; code: string; phone: string | null; mobile: string | null; address: string | null } | null;
    warehouseName: string | null; subtotal: number; discount: number; taxAmount: number; extraCosts: number; total: number; paidAmount: number; outstanding: number; notes: string | null;
    items: { _id: string; description: string; quantityMilli: number; unit: string; unitCost: number; discount: number; taxAmount: number; lineTotal: number; landedUnitCost: number }[];
    accountingNumber?: string | null;
  };
  businessName: string; currency: string;
}) {
  return (
    <div className="print-sheet hidden bg-white p-6 text-[#26352e] print:block" dir="rtl">
      <div className="flex items-start justify-between border-b-2 border-[#245c49] pb-4"><div className="flex items-center gap-3"><div className="flex size-14 items-center justify-center rounded-2xl bg-[#245c49] text-xl font-black text-[#e9e5d5]">ح‌و</div><div><p className="text-lg font-black text-[#173d32]">حساب ویرا</p><p className="text-[9px] text-[#66726a]">سیستم جامع مالی و حسابداری</p><p className="mt-1 text-[10px] font-semibold">{businessName}</p></div></div><div className="text-left"><p className="text-sm font-black">{detail.kind === "return" ? "برگشت خرید" : "فاکتور خرید"}</p><p className="num mt-1 text-[11px]">شماره: {detail.number}</p><p className="num text-[10px]">تاریخ: {formatJalali(detail.issueDate)}</p><p className="num text-[10px]">سررسید: {detail.dueDate ? formatJalali(detail.dueDate) : "—"}</p></div></div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-[10px]"><div className="rounded-xl border border-[#dedacb] p-3"><p className="mb-1 font-bold text-[#245c49]">تأمین‌کننده</p><p className="font-semibold">{detail.supplier?.name ?? "—"}</p><p className="num">کد: {detail.supplier?.code ?? "—"}</p><p className="num">تلفن: {detail.supplier?.mobile ?? detail.supplier?.phone ?? "—"}</p><p>{detail.supplier?.address ?? "—"}</p></div><div className="rounded-xl border border-[#dedacb] p-3"><p className="mb-1 font-bold text-[#245c49]">اطلاعات خرید</p><p>انبار: {detail.warehouseName ?? "—"}</p><p className="num">سند حسابداری: {detail.accountingNumber ?? "—"}</p><p className="num">پرداخت‌شده: {formatMoney(detail.paidAmount, currency)}</p><p className="num">مانده بدهی: {formatMoney(detail.outstanding, currency)}</p></div></div>
      <table className="mt-4 w-full border-collapse text-[10px]"><thead><tr className="bg-[#e4ece5] text-[#173d32]"><th className="border border-[#dedacb] p-1.5">#</th><th className="border border-[#dedacb] p-1.5 text-right">شرح</th><th className="border border-[#dedacb] p-1.5">تعداد</th><th className="border border-[#dedacb] p-1.5">واحد</th><th className="border border-[#dedacb] p-1.5">بهای واحد</th><th className="border border-[#dedacb] p-1.5">تخفیف</th><th className="border border-[#dedacb] p-1.5">مالیات</th><th className="border border-[#dedacb] p-1.5">مبلغ</th></tr></thead><tbody>{detail.items.map((item, index) => <tr key={item._id}><td className="num border border-[#dedacb] p-1.5 text-center">{index + 1}</td><td className="border border-[#dedacb] p-1.5">{item.description}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatQuantity(item.quantityMilli)}</td><td className="border border-[#dedacb] p-1.5 text-center">{item.unit}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.unitCost, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.discount, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.taxAmount, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.lineTotal, currency)}</td></tr>)}</tbody></table>
      <div className="mt-4 grid grid-cols-[1fr_260px] gap-4 text-[10px]"><div>{detail.notes ? <><p className="font-bold text-[#245c49]">توضیحات</p><p className="mt-1 leading-5">{detail.notes}</p></> : null}<div className="mt-10 flex gap-12 text-[9px] text-[#66726a]"><div className="border-t border-dashed border-[#dedacb] pt-2">مهر و امضای خریدار</div><div className="border-t border-dashed border-[#dedacb] pt-2">مهر و امضای فروشنده</div></div></div><div className="space-y-1 rounded-xl border border-[#dedacb] p-3">{[["جمع اقلام", detail.subtotal],["تخفیف", detail.discount],["مالیات", detail.taxAmount],["هزینه‌های جانبی", detail.extraCosts]].map(([label, value]) => <div key={String(label)} className="flex justify-between"><span>{label}</span><span className="num">{formatMoney(Number(value), currency)}</span></div>)}<div className="flex justify-between border-t border-[#245c49] pt-1 text-[12px] font-black text-[#173d32]"><span>مبلغ نهایی</span><span className="num">{formatMoney(detail.total, currency)}</span></div></div></div>
      <p className="mt-6 border-t border-[#dedacb] pt-2 text-center text-[8px] text-[#66726a]">حساب ویرا · سند خرید و اسناد حسابداری مرتبط به‌صورت خودکار و متوازن ثبت شده‌اند.</p>
    </div>
  );
}

export default function PurchasesPage() {
  const { businessId, currency, role, workspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const rows = useQuery(api.purchases.list, businessId ? { businessId, kind: kind === "all" ? undefined : kind as "purchase" | "return", search: search.trim() || undefined } : "skip");
  const suppliers = useQuery(api.suppliers.list, businessId ? { businessId } : "skip");
  const warehouses = useQuery(api.inventory.warehouses, businessId ? { businessId } : "skip") ?? [];
  const products = useQuery(api.products.list, businessId ? { businessId } : "skip") ?? [];
  const detail = useQuery(api.purchases.get, businessId && selectedId ? { businessId, invoiceId: selectedId as Id<"purchaseInvoices"> } : "skip");
  const canWrite = role !== "viewer";
  const list = rows ?? [];
  const purchases = list.filter((row) => row.kind === "purchase");
  const totals = purchases.reduce((acc, row) => ({ total: acc.total + row.total, paid: acc.paid + row.paidAmount, outstanding: acc.outstanding + row.outstanding }), { total: 0, paid: 0, outstanding: 0 });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="خرید · چرخه کامل اسناد" title="خرید، برگشت خرید و بدهی تأمین‌کنندگان" description="خرید قطعی با هزینه‌های جانبی، افزایش موجودی، بدهی تأمین‌کننده و سند حسابداری متوازن؛ برگشت خرید با سند اصلاحی." actions={<><Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => downloadCsv("purchases.csv", ["شماره", "نوع", "تأمین‌کننده", "تاریخ", "مبلغ", "پرداخت", "مانده"], list.map((row) => [row.number, row.kind === "return" ? "برگشت" : "خرید", row.supplierName, formatJalali(row.issueDate), row.total, row.paidAmount, row.outstanding]))}><FileSpreadsheet className="size-4" /> Excel</Button>{canWrite ? <Button size="sm" className="h-9 gap-1.5" onClick={() => setNewOpen(true)}><Plus className="size-4" /> فاکتور خرید</Button> : null}</>} />
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="جمع خرید" value={formatMoney(totals.total, currency)} tone="brand" /><Metric label="پرداخت‌شده" value={formatMoney(totals.paid, currency)} /><Metric label="بدهی تأمین‌کنندگان" value={formatMoney(totals.outstanding, currency)} tone="danger" /></div>
      <Panel><PanelHeader eyebrow="دفتر خرید" title="فاکتورهای خرید و برگشت" description="خرید نقدی و اعتباری با پرداخت ترکیبی پشتیبانی می‌شود." action={<div className="flex flex-wrap gap-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو شماره یا تأمین‌کننده…" className="h-9 w-56 bg-surface text-[10px]" /><Select value={kind} onValueChange={setKind}><SelectTrigger className="h-9 w-32 bg-surface text-[10px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه</SelectItem><SelectItem value="purchase">خرید</SelectItem><SelectItem value="return">برگشت خرید</SelectItem></SelectContent></Select></div>} />
        {!rows ? <div className="space-y-2 p-4"><Skeleton className="h-12 rounded-[11px]" /><Skeleton className="h-12 rounded-[11px]" /><Skeleton className="h-12 rounded-[11px]" /></div> : list.length === 0 ? <EmptyState icon={<Truck className="size-5" />} title="خریدی ثبت نشده" description="اولین فاکتور خرید را ثبت کنید تا موجودی و بدهی تأمین‌کننده واقعی شود." /> : <div className="overflow-x-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">شماره</TableHead><TableHead className="text-[9px]">نوع</TableHead><TableHead className="text-[9px]">تأمین‌کننده</TableHead><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">وضعیت</TableHead><TableHead className="text-[9px]">مبلغ</TableHead><TableHead className="text-[9px]">پرداخت</TableHead><TableHead className="text-[9px]">مانده</TableHead><TableHead /></TableRow></TableHeader><TableBody>{list.map((row) => <TableRow key={row._id} className="cursor-pointer" onClick={() => setSelectedId(row._id)}><TableCell className="num text-[10px] font-semibold">{row.number}</TableCell><TableCell><CommercePill label={row.kind === "return" ? "برگشت" : "خرید"} tone={row.kind === "return" ? "gold" : "mist"} /></TableCell><TableCell className="text-[10px]">{row.supplierName}</TableCell><TableCell><DateText value={row.issueDate} /></TableCell><TableCell><CommercePill label={STATUS_LABELS[row.status]} tone={row.status === "paid" ? "brand" : row.status === "cancelled" ? "danger" : "muted"} /></TableCell><TableCell className="num text-[10px]">{formatMoney(row.total, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.paidAmount, currency)}</TableCell><TableCell className={cn("num text-[10px]", row.outstanding > 0 && "text-destructive")}>{formatMoney(row.outstanding, currency)}</TableCell><TableCell><Button variant="ghost" size="icon" className="size-7"><Eye className="size-3.5" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
      </Panel>
      {newOpen ? <NewPurchaseDialog open onOpenChange={setNewOpen} businessId={businessId} suppliers={suppliers ?? []} warehouses={warehouses} products={products} currency={currency} taxRateBps={workspace?.business.taxRateBps ?? 900} /> : null}
      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[760px]">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2"><FileText className="size-4 text-brand" />{detail?.kind === "return" ? "برگشت خرید" : "فاکتور خرید"} {detail?.number ?? ""}{detail ? <CommercePill label={STATUS_LABELS[detail.status]} tone={detail.status === "paid" ? "brand" : "muted"} /> : null}</DialogTitle><DialogDescription className="text-[11px]">سند خرید قطعی است؛ اصلاح از طریق برگشت به تأمین‌کننده انجام می‌شود.</DialogDescription></DialogHeader>
          {!detail ? <Skeleton className="h-72 rounded-xl" /> : <>
            <div className="grid gap-2 sm:grid-cols-3"><Metric label="مبلغ نهایی" value={formatMoney(detail.total, currency)} tone="brand" /><Metric label="پرداخت‌شده" value={formatMoney(detail.paidAmount, currency)} /><Metric label="مانده بدهی" value={formatMoney(detail.outstanding, currency)} tone="danger" /></div>
            <div className="grid gap-2 rounded-xl border border-hairline p-3 text-[10px] sm:grid-cols-2"><div className="space-y-1"><p><span className="text-ink-soft">تأمین‌کننده: </span>{detail.supplier?.name ?? "—"}</p><p className="num"><span className="text-ink-soft">کد: </span>{detail.supplier?.code ?? "—"}</p><p className="num"><span className="text-ink-soft">تلفن: </span>{detail.supplier?.mobile ?? "—"}</p></div><div className="space-y-1"><p className="num"><span className="text-ink-soft">تاریخ: </span>{formatJalali(detail.issueDate)}</p><p><span className="text-ink-soft">انبار: </span>{detail.warehouseName ?? "—"}</p><p className="num"><span className="text-ink-soft">سند حسابداری: </span>{detail.accountingNumber ?? "—"}{detail.accountingDocumentId ? " ✓" : ""}</p></div></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-[9px]">شرح</TableHead><TableHead className="text-[9px]">تعداد</TableHead><TableHead className="text-[9px]">بهای واحد</TableHead><TableHead className="text-[9px]">تخفیف</TableHead><TableHead className="text-[9px]">مالیات</TableHead><TableHead className="text-[9px]">مبلغ</TableHead><TableHead className="text-[9px]">بهای موزون</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((item) => <TableRow key={item._id}><TableCell className="text-[10px]">{item.description}</TableCell><TableCell><Qty value={item.quantityMilli} /></TableCell><TableCell className="num text-[10px]">{formatMoney(item.unitCost, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.discount, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.taxAmount, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.lineTotal, currency)}</TableCell><TableCell className="num text-[10px] text-brand">{formatMoney(item.landedUnitCost, currency)}</TableCell></TableRow>)}</TableBody></Table></div>
            <DialogFooter className="gap-2"><Button variant="outline" className="rounded-xl" onClick={() => printPage(`خرید ${detail.number}`)}><FileText className="size-4" /> چاپ / PDF</Button>{canWrite && detail.kind === "purchase" && detail.status !== "cancelled" ? <><Button variant="outline" className="rounded-xl" disabled={detail.outstanding <= 0} onClick={() => setPaymentOpen(true)}><Banknote className="size-4" /> پرداخت</Button><Button variant="outline" className="rounded-xl" onClick={() => setReturnOpen(true)}><RotateCcw className="size-4" /> برگشت خرید</Button></> : null}</DialogFooter>
            <PurchasePrintSheet detail={detail} businessName={workspace?.business.name ?? ""} currency={currency} />
          </>}
        </DialogContent>
      </Dialog>
      {returnOpen && detail ? <PurchaseReturnDialog open onOpenChange={setReturnOpen} businessId={businessId} invoice={detail} currency={currency} /> : null}
      {paymentOpen && detail ? <SupplierPaymentDialog open onOpenChange={setPaymentOpen} businessId={businessId} invoice={detail} currency={currency} onDone={() => undefined} /> : null}
    </div>
  );
}
