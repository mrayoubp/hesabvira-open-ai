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
import {
  currencyUnit,
  formatJalali,
  formatMoney,
  formatQuantity,
  numberToPersianWords,
} from "@/lib/format";
import { lineTotal, parseAmount, parseQuantityMilli } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Send,
  ShoppingBag,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type InvoiceRow = {
  _id: string;
  number: string;
  status: "draft" | "issued" | "paid" | "void";
  customerId: string;
  customerName: string;
  issueDate: number;
  dueDate: number | null;
  subtotal: number;
  discount: number;
  taxRateBps: number;
  taxAmount: number;
  shippingCost: number;
  total: number;
  returnedAmount: number;
  paidAmount: number;
  outstanding: number;
  costOfGoods: number;
  profit: number;
  notes: string | null;
  accountingDocumentId?: string;
};

type ProductOption = {
  _id: string;
  name: string;
  code: string;
  unit: string;
  salePrice: number;
  purchasePrice: number;
  taxRateBps: number;
  productType: "physical" | "service" | "serial" | "expiry";
  active: boolean;
};

const STATUS_LABELS: Record<InvoiceRow["status"], string> = {
  draft: "پیش‌فاکتور",
  issued: "صادرشده",
  paid: "تسویه‌شده",
  void: "ابطال",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "نقدی",
  card: "کارت‌خوان",
  bank: "بانکی",
  credit: "اعتباری",
  mixed: "ترکیبی",
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function NewSaleDialog({
  open,
  onOpenChange,
  businessId,
  customers,
  warehouses,
  products,
  currency,
  taxRateBps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  customers: { _id: string; name: string; code: string; active: boolean; creditLimit: number; outstanding: number }[];
  warehouses: { _id: string; name: string; isDefault: boolean; active: boolean }[];
  products: ProductOption[];
  currency: string;
  taxRateBps: number;
}) {
  const create = useMutation(api.sales.create);
  const treasury = useQuery(api.treasury.accountBalances, businessId ? { businessId } : "skip");
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    warehouses.find((row) => row.isDefault)?._id ?? warehouses[0]?._id ?? "",
  );
  const [issueDate, setIssueDate] = useState(isoToday);
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [payments, setPayments] = useState<{ method: "cash" | "card" | "bank"; amount: string; accountId: string }[]>([]);
  const [saving, setSaving] = useState<"draft" | "issued" | null>(null);
  const [lines, setLines] = useState([
    { productId: products[0]?._id ?? "", quantity: "1", unitPrice: String(products[0]?.salePrice ?? 0), discount: "0", taxRateBps: String(products[0]?.taxRateBps ?? 0) },
  ]);
  const activeProducts = products.filter((row) => row.active);
  const activeCustomers = customers.filter((row) => row.active);
  const updateLine = (index: number, key: string, value: string) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [key]: value };
      if (key === "productId") {
        const product = products.find((row) => row._id === value);
        next.unitPrice = String(product?.salePrice ?? 0);
        next.taxRateBps = String(product?.taxRateBps ?? taxRateBps);
      }
      return next;
    }));
  };
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, lineTotal(parseQuantityMilli(line.quantity), parseAmount(line.unitPrice)) - parseAmount(line.discount)), 0);
  const invoiceDiscount = Math.min(parseAmount(discount), subtotal);
  const ratio = subtotal > 0 ? (subtotal - invoiceDiscount) / subtotal : 0;
  const tax = lines.reduce((sum, line) => sum + Math.round(Math.max(0, lineTotal(parseQuantityMilli(line.quantity), parseAmount(line.unitPrice)) - parseAmount(line.discount)) * ratio * (Number(line.taxRateBps) || 0) / 10000), 0);
  const total = subtotal - invoiceDiscount + tax + parseAmount(shipping);
  const paidTotal = payments.reduce((sum, row) => sum + parseAmount(row.amount), 0);
  const selectedCustomer = customers.find((row) => row._id === customerId);
  const updatePayment = (index: number, patch: Partial<(typeof payments)[number]>) => {
    setPayments((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };

  const submit = async (event: React.FormEvent, status: "draft" | "issued") => {
    event.preventDefault();
    if (!businessId) return;
    if (!customerId || !warehouseId) { toast.error("مشتری و انبار را انتخاب کنید."); return; }
    const selectedLines = lines.filter((line) => line.productId && parseQuantityMilli(line.quantity) > 0).map((line) => ({
      productId: line.productId as Id<"products">,
      quantityMilli: parseQuantityMilli(line.quantity),
      unitPrice: parseAmount(line.unitPrice),
      discount: parseAmount(line.discount),
      taxRateBps: Number(line.taxRateBps) || 0,
    }));
    if (selectedLines.length === 0) { toast.error("حداقل یک ردیف معتبر لازم است."); return; }
    const paidAmount = paidTotal;
    if (status === "draft" && paidAmount > 0) { toast.error("پیش‌فاکتور با پرداخت ذخیره نمی‌شود؛ برای دریافت وجه، فاکتور را قطعی کنید."); return; }
    if (paidAmount > total) { toast.error("جمع پرداخت‌ها از مبلغ فاکتور بیشتر است."); return; }
    if (payments.some((row) => parseAmount(row.amount) > 0 && !row.accountId)) {
      toast.error("برای هر ردیف پرداخت، صندوق یا حساب بانکی را انتخاب کنید.");
      return;
    }
    setSaving(status);
    try {
      const result = await create({
        businessId,
        customerId: customerId as Id<"customers">,
        warehouseId: warehouseId as Id<"warehouses">,
        status,
        issueDate: Date.parse(`${issueDate}T12:00:00Z`),
        dueDate: Date.parse(`${dueDate}T12:00:00Z`),
        lines: selectedLines,
        discount: invoiceDiscount,
        shippingCost: parseAmount(shipping),
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
      toast.success(`${status === "issued" ? "فاکتور" : "پیش‌فاکتور"} ${result.number} ثبت شد${result.accountingDocumentId ? " و سند حسابداری متوازن ایجاد شد" : ""}.`);
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[900px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShoppingBag className="size-4 text-brand" />فاکتور فروش جدید</DialogTitle><DialogDescription className="text-[11px]">محاسبه مالیات، تخفیف، موجودی و بهای تمام‌شده در سرور انجام می‌شود. پیش‌نویس موجودی را کاهش نمی‌دهد.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event, "issued")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label className="text-[10px]">مشتری *</Label><Select value={customerId} onValueChange={setCustomerId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب مشتری" /></SelectTrigger><SelectContent>{activeCustomers.map((row) => <SelectItem key={row._id} value={row._id}>{row.name} · {row.code}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">انبار *</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue placeholder="انتخاب انبار" /></SelectTrigger><SelectContent>{warehouses.filter((row) => row.active).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">تاریخ صدور</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[10px]">سررسید</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div className="space-y-2 sm:col-span-3">
              <div className="flex items-center justify-between"><Label className="text-[10px]">پرداخت‌ها (ترکیبی)</Label><Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-[9px]" onClick={() => setPayments((current) => [...current, { method: "cash", amount: "", accountId: "" }])}><Plus className="size-3.5" /> افزودن پرداخت</Button></div>
              {payments.length === 0 ? <p className="rounded-lg border border-dashed border-hairline p-2 text-[9px] text-ink-soft">بدون پرداخت = فروش اعتباری؛ مانده به بدهی مشتری اضافه می‌شود.</p> : null}
              {payments.map((row, index) => <div key={index} className="grid gap-2 rounded-xl border border-hairline p-2 sm:grid-cols-[100px_1fr_120px_32px]">
                <Select value={row.method} onValueChange={(value) => updatePayment(index, { method: value as "cash" | "card" | "bank", accountId: "" })}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدی</SelectItem><SelectItem value="card">کارت‌خوان</SelectItem><SelectItem value="bank">بانکی</SelectItem></SelectContent></Select>
                <Select value={row.accountId} onValueChange={(value) => updatePayment(index, { accountId: value })}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue placeholder={row.method === "cash" ? "صندوق" : "حساب بانکی"} /></SelectTrigger><SelectContent>{row.method === "cash" ? (treasury?.funds ?? []).filter((option) => option.active).map((option) => <SelectItem key={option._id} value={option._id}>{option.name}</SelectItem>) : (treasury?.banks ?? []).filter((option) => option.active).map((option) => <SelectItem key={option._id} value={option._id}>{option.name}</SelectItem>)}</SelectContent></Select>
                <Input value={row.amount} onChange={(e) => updatePayment(index, { amount: e.target.value })} placeholder="مبلغ" inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>×</Button>
              </div>)}
            </div>
            <div className="sm:col-span-3"><Label className="text-[10px]">توضیحات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5 h-9 rounded-xl text-[11px]" /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label className="text-[10px]">ردیف‌های کالا و خدمات</Label><Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[9px]" onClick={() => setLines((current) => [...current, { productId: activeProducts[0]?._id ?? "", quantity: "1", unitPrice: "0", discount: "0", taxRateBps: String(taxRateBps) }])}><Plus className="size-3.5" /> ردیف</Button></div>
            <div className="hidden gap-2 px-1 text-[9px] text-ink-soft sm:grid sm:grid-cols-[1fr_75px_110px_90px_70px_32px]"><span>کالا / خدمت</span><span>تعداد</span><span>قیمت واحد</span><span>تخفیف</span><span>مالیات</span><span /></div>
            {lines.map((line, index) => (
              <div key={`${index}:${line.productId}`} className="grid gap-2 rounded-xl border border-hairline p-2 sm:grid-cols-[1fr_75px_110px_90px_70px_32px]">
                <Select value={line.productId} onValueChange={(value) => updateLine(index, "productId", value)}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue placeholder="کالا" /></SelectTrigger><SelectContent>{activeProducts.map((product) => <SelectItem key={product._id} value={product._id}>{product.name} · {product.code}</SelectItem>)}</SelectContent></Select>
                <Input value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} inputMode="decimal" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Input value={line.unitPrice} onChange={(e) => updateLine(index, "unitPrice", e.target.value)} inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Input value={line.discount} onChange={(e) => updateLine(index, "discount", e.target.value)} inputMode="numeric" dir="ltr" className="num h-8 rounded-lg text-[10px]" />
                <Select value={line.taxRateBps} onValueChange={(value) => updateLine(index, "taxRateBps", value)}><SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">۰٪</SelectItem><SelectItem value="600">۶٪</SelectItem><SelectItem value="900">۹٪</SelectItem><SelectItem value="1000">۱۰٪</SelectItem></SelectContent></Select>
                <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)}>×</Button>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label className="text-[10px]">تخفیف فاکتور</Label><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div><Label className="text-[10px]">هزینه حمل</Label><Input value={shipping} onChange={(e) => setShipping(e.target.value)} inputMode="numeric" dir="ltr" className="num mt-1.5 h-9 rounded-xl text-[11px]" /></div>
            <div className="rounded-xl border border-brand/20 bg-brand-soft/40 p-3 text-[10px]">
              <div className="flex justify-between"><span>جمع ردیف‌ها</span><span className="num">{formatMoney(subtotal, currency)}</span></div>
              <div className="flex justify-between"><span>مالیات</span><span className="num">{formatMoney(tax, currency)}</span></div>
              <div className="mt-1 flex justify-between border-t border-brand/15 pt-1 font-bold text-brand"><span>مبلغ نهایی</span><span className="num">{formatMoney(total, currency)}</span></div>
              <div className="mt-1 flex justify-between border-t border-brand/15 pt-1 text-[9px]"><span>پرداخت / مانده</span><span className="num">{formatMoney(paidTotal, currency)} / {formatMoney(Math.max(0, total - paidTotal), currency)}</span></div>
              {selectedCustomer && selectedCustomer.creditLimit > 0 ? <p className="mt-1 text-[8px] text-ink-soft">اعتبار مشتری: {formatMoney(selectedCustomer.creditLimit, currency)} · مانده فعلی: {formatMoney(selectedCustomer.outstanding, currency)}</p> : null}
            </div>
          </div>
          <DialogFooter className="gap-2"><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="button" variant="outline" className="rounded-xl" disabled={saving !== null} onClick={(event) => void submit(event, "draft")}>{saving === "draft" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} ذخیره پیش‌فاکتور</Button><Button type="submit" disabled={saving !== null} className="rounded-xl">{saving === "issued" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} صدور قطعی فاکتور</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoicePrintSheet({
  detail,
  businessName,
  currency,
}: {
  detail: {
    number: string; issueDate: number; dueDate: number | null; status: InvoiceRow["status"];
    customer: { name: string; code: string; phone: string | null; mobile: string | null; address: string | null; nationalId: string | null; economicCode: string | null } | null;
    warehouseName: string | null; subtotal: number; discount: number; taxAmount: number; shippingCost: number; total: number; paidAmount: number; outstanding: number; returnedAmount: number; notes: string | null;
    items: { _id: string; description: string; productCode: string | null; quantityMilli: number; unit: string; unitPrice: number; discount: number; taxAmount: number; lineTotal: number }[];
  };
  businessName: string;
  currency: string;
}) {
  return (
    <div className="print-sheet hidden bg-white p-6 text-[#26352e] print:block" dir="rtl">
      <div className="flex items-start justify-between border-b-2 border-[#245c49] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#245c49] text-xl font-black text-[#e9e5d5]">ح‌و</div>
          <div><p className="text-lg font-black text-[#173d32]">حساب ویرا</p><p className="text-[9px] text-[#66726a]">سیستم جامع مالی و حسابداری</p><p className="mt-1 text-[10px] font-semibold">{businessName}</p></div>
        </div>
        <div className="text-left"><p className="text-sm font-black">فاکتور فروش</p><p className="num mt-1 text-[11px]">شماره: {detail.number}</p><p className="num text-[10px]">تاریخ: {formatJalali(detail.issueDate)}</p><p className="num text-[10px]">سررسید: {detail.dueDate ? formatJalali(detail.dueDate) : "—"}</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-[10px]">
        <div className="rounded-xl border border-[#dedacb] p-3"><p className="mb-1 font-bold text-[#245c49]">خریدار</p><p className="font-semibold">{detail.customer?.name ?? "—"}</p><p className="num">کد: {detail.customer?.code ?? "—"}</p><p className="num">شناسه ملی: {detail.customer?.nationalId ?? "—"} · اقتصادی: {detail.customer?.economicCode ?? "—"}</p><p className="num">تلفن: {detail.customer?.mobile ?? detail.customer?.phone ?? "—"}</p><p>{detail.customer?.address ?? "—"}</p></div>
        <div className="rounded-xl border border-[#dedacb] p-3"><p className="mb-1 font-bold text-[#245c49]">اطلاعات فروش</p><p>انبار: {detail.warehouseName ?? "—"}</p><p className="num">وضعیت: {STATUS_LABELS[detail.status]}</p><p className="num">مبلغ پرداخت‌شده: {formatMoney(detail.paidAmount, currency)}</p><p className="num">مانده: {formatMoney(detail.outstanding, currency)}</p>{detail.returnedAmount > 0 ? <p className="num">برگشتی: {formatMoney(detail.returnedAmount, currency)}</p> : null}</div>
      </div>
      <table className="mt-4 w-full border-collapse text-[10px]">
        <thead><tr className="bg-[#e4ece5] text-[#173d32]"><th className="border border-[#dedacb] p-1.5">#</th><th className="border border-[#dedacb] p-1.5 text-right">کالا / خدمت</th><th className="border border-[#dedacb] p-1.5">تعداد</th><th className="border border-[#dedacb] p-1.5">واحد</th><th className="border border-[#dedacb] p-1.5">قیمت واحد</th><th className="border border-[#dedacb] p-1.5">تخفیف</th><th className="border border-[#dedacb] p-1.5">مالیات</th><th className="border border-[#dedacb] p-1.5">مبلغ</th></tr></thead>
        <tbody>{detail.items.map((item, index) => <tr key={item._id}><td className="num border border-[#dedacb] p-1.5 text-center">{index + 1}</td><td className="border border-[#dedacb] p-1.5">{item.description}<span className="num text-[8px] text-[#66726a]">{item.productCode ? ` · ${item.productCode}` : ""}</span></td><td className="num border border-[#dedacb] p-1.5 text-center">{formatQuantity(item.quantityMilli)}</td><td className="border border-[#dedacb] p-1.5 text-center">{item.unit || "—"}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.unitPrice, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.discount, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.taxAmount, currency)}</td><td className="num border border-[#dedacb] p-1.5 text-center">{formatMoney(item.lineTotal, currency)}</td></tr>)}</tbody>
      </table>
      <div className="mt-4 grid grid-cols-[1fr_260px] gap-4 text-[10px]">
        <div><p className="font-bold text-[#245c49]">مبلغ به حروف</p><p className="mt-1 leading-6">{numberToPersianWords(detail.total)} {currencyUnit(currency)}</p>{detail.notes ? <><p className="mt-3 font-bold text-[#245c49]">توضیحات</p><p className="mt-1 leading-5">{detail.notes}</p></> : null}<div className="mt-8 flex gap-12 text-[9px] text-[#66726a]"><div className="border-t border-dashed border-[#dedacb] pt-2">مهر و امضای فروشنده</div><div className="border-t border-dashed border-[#dedacb] pt-2">مهر و امضای خریدار</div></div></div>
        <div className="space-y-1 rounded-xl border border-[#dedacb] p-3">{[[ "جمع ردیف‌ها", detail.subtotal],["تخفیف", detail.discount],["مالیات", detail.taxAmount],["هزینه حمل", detail.shippingCost]].map(([label, value]) => <div key={String(label)} className="flex justify-between"><span>{label}</span><span className="num">{formatMoney(Number(value), currency)}</span></div>)}<div className="flex justify-between border-t border-[#245c49] pt-1 text-[12px] font-black text-[#173d32]"><span>مبلغ نهایی</span><span className="num">{formatMoney(detail.total, currency)}</span></div><div className="flex justify-between text-[9px] text-[#66726a]"><span>پرداخت‌شده</span><span className="num">{formatMoney(detail.paidAmount, currency)}</span></div></div>
      </div>
      <p className="mt-6 border-t border-[#dedacb] pt-2 text-center text-[8px] text-[#66726a]">این فاکتور توسط حساب ویرا صادر شده است · شرایط پرداخت: تسویه تا تاریخ سررسید · پشتیبانی: hesabvira</p>
    </div>
  );
}

function ReturnDialog({
  open,
  onOpenChange,
  businessId,
  invoice,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: Id<"businesses">;
  invoice: {
    _id: string; number: string; total: number;
    items: { _id: string; description: string; quantityMilli: number; returnedQuantityMilli: number; unitPrice: number }[];
  };
  currency: string;
}) {
  const createReturn = useMutation(api.sales.createReturn);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<"credit" | "cash" | "bank">("credit");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    const selectedLines = invoice.items
      .filter((item) => parseQuantityMilli(quantities[item._id] ?? "") > 0)
      .map((item) => ({ invoiceItemId: item._id as Id<"invoiceItems">, quantityMilli: parseQuantityMilli(quantities[item._id] ?? "") }));
    if (!selectedLines.length) { toast.error("تعداد برگشت را وارد کنید."); return; }
    setSaving(true);
    try {
      const result = await createReturn({ businessId, invoiceId: invoice._id as Id<"invoices">, lines: selectedLines, refundMethod });
      toast.success(`برگشت ${result.number} ثبت شد و موجودی/سند اصلاحی به‌روزرسانی شد.`);
      onOpenChange(false);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[24px] sm:max-w-[560px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="size-4 text-brand" />برگشت از فروش {invoice.number}</DialogTitle><DialogDescription className="text-[11px]">فقط تا باقی‌مانده هر ردیف مجاز است؛ سند برگشت و گردش انبار به‌صورت خودکار ثبت می‌شود.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-2">{invoice.items.map((item) => <div key={item._id} className="flex items-center gap-2 rounded-xl border border-hairline p-2"><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{item.description}</p><p className="num text-[8px] text-ink-soft">قابل برگشت: {formatQuantity(item.quantityMilli - item.returnedQuantityMilli)} · {formatMoney(item.unitPrice, currency)}</p></div><Input value={quantities[item._id] ?? ""} onChange={(e) => setQuantities((current) => ({ ...current, [item._id]: e.target.value }))} placeholder="۰" inputMode="decimal" dir="ltr" className="num h-8 w-20 rounded-lg text-[10px]" /></div>)}</div>
          <div><Label className="text-[10px]">روش برگشت وجه</Label><Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as typeof refundMethod)}><SelectTrigger className="mt-1.5 h-9 rounded-xl text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="credit">بستانکاری حساب مشتری</SelectItem><SelectItem value="cash">نقدی</SelectItem><SelectItem value="bank">بانکی</SelectItem></SelectContent></Select></div>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>انصراف</Button><Button type="submit" disabled={saving} className="rounded-xl">{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} ثبت برگشت</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesPage() {
  const { businessId, currency, role, workspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const invoices = useQuery(api.sales.list, businessId ? { businessId, status: status === "all" ? undefined : status as "draft" | "issued" | "paid" | "void", search: search.trim() || undefined } : "skip");
  const customers = useQuery(api.customers.list, businessId ? { businessId } : "skip") ?? [];
  const warehouses = useQuery(api.inventory.warehouses, businessId ? { businessId } : "skip") ?? [];
  const products = useQuery(api.products.list, businessId ? { businessId } : "skip") ?? [];
  const detail = useQuery(api.sales.get, businessId && selectedId ? { businessId, invoiceId: selectedId as Id<"invoices"> } : "skip");
  const issueDraft = useMutation(api.sales.issueDraft);
  const canWrite = role !== "viewer";
  const rows = invoices ?? [];
  const totals = rows.reduce((acc, row) => ({ total: acc.total + row.total, paid: acc.paid + row.paidAmount, outstanding: acc.outstanding + row.outstanding, profit: acc.profit + row.profit }), { total: 0, paid: 0, outstanding: 0, profit: 0 });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="فروش · چرخه کامل اسناد"
        title="پیش‌فاکتور، فاکتور و برگشت فروش"
        description="فروش چندردیفی با تخفیف، مالیات، حمل و پرداخت ترکیبی؛ هر فاکتور قطعی یک سند حسابداری و گردش موجودی متصل دارد."
        actions={<>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => downloadCsv("sales.csv", ["شماره", "مشتری", "تاریخ", "مبلغ", "پرداخت", "مانده", "سود"], rows.map((row) => [row.number, row.customerName, formatJalali(row.issueDate), row.total, row.paidAmount, row.outstanding, row.profit]))}><FileSpreadsheet className="size-4" /> Excel</Button>
          {canWrite ? <Button size="sm" className="h-9 gap-1.5" onClick={() => setNewOpen(true)}><Plus className="size-4" /> فاکتور فروش</Button> : null}
        </>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="جمع فروش" value={formatMoney(totals.total, currency)} tone="brand" /><Metric label="دریافت‌شده" value={formatMoney(totals.paid, currency)} /><Metric label="مطالبات" value={formatMoney(totals.outstanding, currency)} tone="danger" /><Metric label="سود ناخالص" value={formatMoney(totals.profit, currency)} tone="gold" /></div>
      <Panel><PanelHeader eyebrow="دفتر فروش" title="فاکتورهای فروش" description="پیش‌فاکتورها در محاسبه فروش و مطالبات لحاظ نمی‌شوند." action={<div className="flex flex-wrap gap-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو شماره یا مشتری…" className="h-9 w-56 bg-surface text-[10px]" /><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-32 bg-surface text-[10px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه</SelectItem><SelectItem value="draft">پیش‌فاکتور</SelectItem><SelectItem value="issued">صادرشده</SelectItem><SelectItem value="paid">تسویه‌شده</SelectItem></SelectContent></Select></div>} />
        {!invoices ? <div className="space-y-2 p-4"><Skeleton className="h-12 rounded-[11px]" /><Skeleton className="h-12 rounded-[11px]" /><Skeleton className="h-12 rounded-[11px]" /></div> : rows.length === 0 ? <EmptyState icon={<ShoppingBag className="size-5" />} title="فاکتوری ثبت نشده" description="اولین پیش‌فاکتور یا فاکتور فروش را بسازید؛ گزارش‌ها از همین داده واقعی تغذیه می‌شوند." /> : <div className="overflow-x-auto px-4 pb-4"><Table><TableHeader><TableRow><TableHead className="text-[9px]">شماره</TableHead><TableHead className="text-[9px]">مشتری</TableHead><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">وضعیت</TableHead><TableHead className="text-[9px]">مبلغ</TableHead><TableHead className="text-[9px]">پرداخت</TableHead><TableHead className="text-[9px]">مانده</TableHead><TableHead className="text-[9px]">سود</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row._id} className="cursor-pointer" onClick={() => setSelectedId(row._id)}><TableCell className="num text-[10px] font-semibold">{row.number}</TableCell><TableCell className="text-[10px]">{row.customerName}</TableCell><TableCell><DateText value={row.issueDate} /></TableCell><TableCell><CommercePill label={STATUS_LABELS[row.status]} tone={row.status === "draft" ? "muted" : row.status === "paid" ? "brand" : row.status === "void" ? "danger" : "gold"} /></TableCell><TableCell className="num text-[10px]">{formatMoney(row.total, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(row.paidAmount, currency)}</TableCell><TableCell className={cn("num text-[10px]", row.outstanding > 0 && "text-destructive")}>{formatMoney(row.outstanding, currency)}</TableCell><TableCell className="num text-[10px] text-brand">{formatMoney(row.profit, currency)}</TableCell><TableCell><Button variant="ghost" size="icon" className="size-7"><Eye className="size-3.5" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
      </Panel>
      {newOpen ? <NewSaleDialog open onOpenChange={setNewOpen} businessId={businessId} customers={customers} warehouses={warehouses} products={products} currency={currency} taxRateBps={workspace?.business.taxRateBps ?? 900} /> : null}
      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[760px]">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2"><FileText className="size-4 text-brand" />فاکتور فروش {detail?.number ?? ""}{detail ? <CommercePill label={STATUS_LABELS[detail.status]} tone={detail.status === "draft" ? "muted" : "brand"} /> : null}</DialogTitle><DialogDescription className="text-[11px]">فاکتور قطعی قابل ویرایش مستقیم نیست؛ اصلاح از طریق برگشت معتبر انجام می‌شود.</DialogDescription></DialogHeader>
          {!detail ? <Skeleton className="h-72 rounded-xl" /> : <>
            <div className="grid gap-2 sm:grid-cols-3"><Metric label="مبلغ نهایی" value={formatMoney(detail.total, currency)} tone="brand" /><Metric label="پرداخت‌شده" value={formatMoney(detail.paidAmount, currency)} /><Metric label="مانده بدهی" value={formatMoney(detail.outstanding, currency)} tone="danger" /></div>
            <div className="grid gap-2 rounded-xl border border-hairline p-3 text-[10px] sm:grid-cols-2"><div className="space-y-1"><p><span className="text-ink-soft">مشتری: </span>{detail.customer?.name ?? "—"}</p><p className="num"><span className="text-ink-soft">کد: </span>{detail.customer?.code ?? "—"}</p><p className="num"><span className="text-ink-soft">موبایل: </span>{detail.customer?.mobile ?? "—"}</p></div><div className="space-y-1"><p className="num"><span className="text-ink-soft">تاریخ: </span>{formatJalali(detail.issueDate)}</p><p><span className="text-ink-soft">انبار: </span>{detail.warehouseName ?? "—"}</p><p className="num"><span className="text-ink-soft">سند حسابداری: </span>{detail.accountingNumber ?? "—"}{detail.accountingDocumentId ? " ✓" : ""}</p></div></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-[9px]">شرح</TableHead><TableHead className="text-[9px]">تعداد</TableHead><TableHead className="text-[9px]">قیمت</TableHead><TableHead className="text-[9px]">تخفیف</TableHead><TableHead className="text-[9px]">مالیات</TableHead><TableHead className="text-[9px]">مبلغ</TableHead><TableHead className="text-[9px]">برگشتی</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((item) => <TableRow key={item._id}><TableCell className="text-[10px]">{item.description}<span className="num block text-[8px] text-ink-soft">{item.productCode ?? ""}</span></TableCell><TableCell><Qty value={item.quantityMilli} /></TableCell><TableCell className="num text-[10px]">{formatMoney(item.unitPrice, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.discount, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.taxAmount, currency)}</TableCell><TableCell className="num text-[10px]">{formatMoney(item.lineTotal, currency)}</TableCell><TableCell className="text-[10px]"><Qty value={item.returnedQuantityMilli} /></TableCell></TableRow>)}</TableBody></Table></div>
            {detail.returns.length > 0 ? <div className="rounded-xl border border-gold/25 bg-gold-soft/30 p-2 text-[9px]"><p className="mb-1 font-semibold text-gold">برگشت‌های ثبت‌شده</p>{detail.returns.map((row) => <div key={row._id} className="flex justify-between py-0.5"><span className="num">{row.number}</span><span className="num">{formatMoney(row.total, currency)}</span><span className="num">{formatJalali(row.occurredAt)}</span></div>)}</div> : null}
            <DialogFooter className="gap-2">{canWrite && detail.status === "draft" ? <Button className="rounded-xl" onClick={async () => { if (!businessId) return; try { const result = await issueDraft({ businessId, invoiceId: detail._id as Id<"invoices"> }); toast.success(`پیش‌فاکتور ${result.number} قطعی شد؛ موجودی و سند حسابداری ${result.accountingDocumentId ? "ثبت شد" : "بدون کالا ثبت شد"}.`); } catch (error) { toast.error(getErrorMessage(error)); } }}><Send className="size-4" /> صدور قطعی</Button> : null}<Button variant="outline" className="rounded-xl" onClick={() => printPage(`فاکتور ${detail.number}`)}><Printer className="size-4" /> چاپ / PDF</Button>{canWrite && detail.status !== "draft" && detail.status !== "void" ? <Button variant="outline" className="rounded-xl" onClick={() => setReturnOpen(true)}><RotateCcw className="size-4" /> برگشت از فروش</Button> : null}<Button variant="outline" className="rounded-xl" onClick={() => toast.success("برای ارسال، فایل چاپ/PDF را ذخیره یا مستقیم به مشتری ارسال کنید.")}><Send className="size-4" /> ارسال</Button></DialogFooter>
            <InvoicePrintSheet detail={detail} businessName={workspace?.business.name ?? ""} currency={currency} />
          </>}
        </DialogContent>
      </Dialog>
      {returnOpen && detail ? <ReturnDialog open onOpenChange={setReturnOpen} businessId={businessId} invoice={detail} currency={currency} /> : null}
    </div>
  );
}
