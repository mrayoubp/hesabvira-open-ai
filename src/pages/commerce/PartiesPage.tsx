import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import {
  CommercePill,
  DateText,
  Money,
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
import { formatMoney } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDownLeft,
  Eye,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Search,
  Truck,
  Users,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

export type PartyMode = "customers" | "suppliers";

type PartyRow = {
  _id: string;
  code: string;
  name: string;
  personType: "individual" | "legal";
  phone: string | null;
  mobile: string | null;
  email: string | null;
  nationalId: string | null;
  economicCode: string | null;
  postalCode?: string | null;
  address: string | null;
  creditLimit: number;
  active: boolean;
  note: string | null;
  createdAt: number;
  invoiceCount?: number;
  purchaseCount?: number;
  totalSales?: number;
  totalPurchases?: number;
  outstanding?: number;
  balance?: number;
  bankAccountNumber?: string | null;
  bankName?: string | null;
};

function PartyDialog({
  open,
  onOpenChange,
  mode,
  businessId,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PartyMode;
  businessId?: Id<"businesses">;
  row: PartyRow | null;
}) {
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const createSupplier = useMutation(api.suppliers.create);
  const updateSupplier = useMutation(api.suppliers.update);
  const [form, setForm] = useState(() => ({
    code: row?.code ?? "",
    name: row?.name ?? "",
    personType: row?.personType ?? "individual",
    phone: row?.phone ?? "",
    mobile: row?.mobile ?? "",
    email: row?.email ?? "",
    nationalId: row?.nationalId ?? "",
    economicCode: row?.economicCode ?? "",
    postalCode: row?.postalCode ?? "",
    address: row?.address ?? "",
    creditLimit: row?.creditLimit ? String(row.creditLimit) : "",
    bankAccountNumber: row?.bankAccountNumber ?? "",
    bankName: row?.bankName ?? "",
    note: row?.note ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    if (!form.name.trim()) {
      toast.error("نام طرف حساب الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const base = {
        businessId,
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        personType: form.personType as "individual" | "legal",
        phone: form.phone.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        nationalId: form.nationalId.trim() || undefined,
        economicCode: form.economicCode.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
        address: form.address.trim() || undefined,
        creditLimit: parseAmount(form.creditLimit),
        note: form.note.trim() || undefined,
      };
      if (mode === "customers") {
        if (row) {
          await updateCustomer({
            ...base,
            customerId: row._id as Id<"customers">,
          });
        } else {
          await createCustomer(base);
        }
      } else {
        const supplierData = {
          ...base,
          bankAccountNumber: form.bankAccountNumber.trim() || undefined,
          bankName: form.bankName.trim() || undefined,
        };
        if (row) {
          await updateSupplier({
            ...supplierData,
            supplierId: row._id as Id<"suppliers">,
          });
        } else {
          await createSupplier(supplierData);
        }
      }
      toast.success(row ? "اطلاعات به‌روزرسانی شد." : "پرونده جدید ثبت شد.");
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            {row ? "ویرایش" : "ثبت"} {mode === "customers" ? "مشتری" : "تأمین‌کننده"}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            اطلاعات هویتی، تماس و سقف اعتبار در پرونده ذخیره می‌شود. کد تکراری
            پذیرفته نمی‌شود.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="کد اختصاصی">
              <Input
                value={form.code}
                onChange={(event) => set("code", event.target.value)}
                placeholder="خالی بگذارید تا خودکار باشد"
                className="h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="نوع شخص">
              <Select
                value={form.personType}
                onValueChange={(value) => set("personType", value)}
              >
                <SelectTrigger className="h-9 rounded-xl text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">حقیقی</SelectItem>
                  <SelectItem value="legal">حقوقی</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="نام / نام شرکت *" className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                className="h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="تلفن ثابت">
              <Input
                value={form.phone}
                onChange={(event) => set("phone", event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="موبایل">
              <Input
                value={form.mobile}
                onChange={(event) => set("mobile", event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="ایمیل">
              <Input
                value={form.email}
                onChange={(event) => set("email", event.target.value)}
                dir="ltr"
                className="h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="شناسه ملی">
              <Input
                value={form.nationalId}
                onChange={(event) => set("nationalId", event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="شناسه اقتصادی">
              <Input
                value={form.economicCode}
                onChange={(event) => set("economicCode", event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="کد پستی">
              <Input
                value={form.postalCode}
                onChange={(event) => set("postalCode", event.target.value)}
                dir="ltr"
                className="num h-9 rounded-xl text-[11px]"
              />
            </Field>
            <Field label="سقف اعتبار">
              <Input
                value={form.creditLimit}
                onChange={(event) => set("creditLimit", event.target.value)}
                dir="ltr"
                inputMode="numeric"
                className="num h-9 rounded-xl text-left text-[11px]"
              />
            </Field>
            {mode === "suppliers" ? (
              <>
                <Field label="شماره حساب بانکی">
                  <Input
                    value={form.bankAccountNumber}
                    onChange={(event) =>
                      set("bankAccountNumber", event.target.value)
                    }
                    dir="ltr"
                    className="num h-9 rounded-xl text-[11px]"
                  />
                </Field>
                <Field label="نام بانک">
                  <Input
                    value={form.bankName}
                    onChange={(event) => set("bankName", event.target.value)}
                    className="h-9 rounded-xl text-[11px]"
                  />
                </Field>
              </>
            ) : null}
          </div>
          <Field label="نشانی">
            <Textarea
              value={form.address}
              onChange={(event) => set("address", event.target.value)}
              rows={2}
              className="rounded-xl text-[11px]"
            />
          </Field>
          <Field label="توضیحات">
            <Textarea
              value={form.note}
              onChange={(event) => set("note", event.target.value)}
              rows={2}
              className="rounded-xl text-[11px]"
            />
          </Field>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              انصراف
            </Button>
            <Button type="submit" disabled={saving} className="rounded-xl">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              ذخیره پرونده
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[10px]">{label}</Label>
      {children}
    </div>
  );
}

function CustomerProfileDialog({
  customerId,
  onClose,
  currency,
}: {
  customerId: string | null;
  onClose: () => void;
  currency: string;
}) {
  const { businessId } = useWorkspace();
  const profile = useQuery(
    api.customers.profile,
    businessId && customerId
      ? { businessId, customerId: customerId as Id<"customers"> }
      : "skip",
  );
  return (
    <Dialog open={Boolean(customerId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[860px]">
        {!profile ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="size-4 text-brand" />
                {profile.name}
                <CommercePill
                  label={profile.active ? "فعال" : "غیرفعال"}
                  tone={profile.active ? "brand" : "muted"}
                />
              </DialogTitle>
              <DialogDescription className="text-[11px]">
                {profile.code} · {profile.personType === "legal" ? "شخص حقوقی" : "شخص حقیقی"} ·{" "}
                <span dir="ltr">{profile.mobile ?? profile.phone ?? "—"}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-4">
              <Summary label="فروش کل" value={formatMoney(profile.totalSales, currency)} />
              <Summary label="دریافت‌ها" value={formatMoney(profile.totalPaid, currency)} />
              <Summary
                label="مانده بدهی"
                value={formatMoney(profile.outstanding, currency)}
                tone={profile.outstanding > 0 ? "danger" : "brand"}
              />
              <Summary label="سقف اعتبار" value={formatMoney(profile.creditLimit, currency)} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-[10px]"
                onClick={() =>
                  downloadCsv(
                    `customer-${profile.code}.csv`,
                    ["شماره", "نوع", "تاریخ", "بدهکار", "بستانکار"],
                    profile.statement.map((event) => [
                      event.reference,
                      event.description,
                      new Date(event.date).toISOString().slice(0, 10),
                      event.debit,
                      event.credit,
                    ]),
                  )
                }
              >
                <FileSpreadsheet className="size-3.5" /> Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-[10px]"
                onClick={() => printPage(`صورت‌حساب ${profile.name}`)}
              >
                <Printer className="size-3.5" /> چاپ صورت‌حساب
              </Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel>
                <PanelHeader title="فاکتورها" eyebrow="فروش" />
                <div className="max-h-64 overflow-auto px-4 pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[9px]">شماره</TableHead>
                        <TableHead className="text-[9px]">تاریخ</TableHead>
                        <TableHead className="text-[9px]">مبلغ</TableHead>
                        <TableHead className="text-[9px]">مانده</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profile.invoices.map((invoice) => (
                        <TableRow key={invoice._id}>
                          <TableCell className="num text-[10px]">{invoice.number}</TableCell>
                          <TableCell><DateText value={invoice.issueDate} /></TableCell>
                          <TableCell><Money value={invoice.total} currency={currency} /></TableCell>
                          <TableCell><Money value={invoice.outstanding} currency={currency} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="گردش حساب" eyebrow="بدهکار / بستانکار" />
                <div className="max-h-64 overflow-auto px-4 pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[9px]">مرجع</TableHead>
                        <TableHead className="text-[9px]">شرح</TableHead>
                        <TableHead className="text-[9px]">بدهکار</TableHead>
                        <TableHead className="text-[9px]">بستانکار</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profile.statement.map((event) => (
                        <TableRow key={event._id}>
                          <TableCell className="num text-[10px]">{event.reference}</TableCell>
                          <TableCell className="text-[10px]">{event.description}</TableCell>
                          <TableCell className="num text-[10px]">{event.debit ? formatMoney(event.debit, currency) : "—"}</TableCell>
                          <TableCell className="num text-[10px]">{event.credit ? formatMoney(event.credit, currency) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SupplierProfileDialog({
  supplierId,
  onClose,
  currency,
}: {
  supplierId: string | null;
  onClose: () => void;
  currency: string;
}) {
  const { businessId } = useWorkspace();
  const detail = useQuery(
    api.suppliers.get,
    businessId && supplierId
      ? { businessId, supplierId: supplierId as Id<"suppliers"> }
      : "skip",
  );
  return (
    <Dialog open={Boolean(supplierId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto rounded-[24px] sm:max-w-[820px]">
        {!detail ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="size-4 text-brand" />
                {detail.name}
                <CommercePill label={detail.active ? "فعال" : "غیرفعال"} tone={detail.active ? "brand" : "muted"} />
              </DialogTitle>
              <DialogDescription className="text-[11px]">
                {detail.code} · <span dir="ltr">{detail.mobile ?? detail.phone ?? "—"}</span>
                {detail.bankAccountNumber ? ` · ${detail.bankName ?? "بانک"} ${detail.bankAccountNumber}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-3">
              <Summary label="مانده بدهی" value={formatMoney(detail.balance, currency)} tone={detail.balance > 0 ? "danger" : "brand"} />
              <Summary label="سقف اعتبار" value={formatMoney(detail.creditLimit, currency)} />
              <Summary label="پرداخت‌ها" value={String(detail.payments.length)} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel>
                <PanelHeader title="سوابق خرید" eyebrow="خرید" />
                <div className="max-h-64 overflow-auto px-4 pb-4">
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-[9px]">شماره</TableHead><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">مانده</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.invoices.map((invoice) => (
                        <TableRow key={invoice._id}>
                          <TableCell className="num text-[10px]">{invoice.number}</TableCell>
                          <TableCell><DateText value={invoice.issueDate} /></TableCell>
                          <TableCell><Money value={invoice.outstanding} currency={currency} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="سوابق پرداخت" eyebrow="پرداخت" />
                <div className="max-h-64 overflow-auto px-4 pb-4">
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-[9px]">شماره</TableHead><TableHead className="text-[9px]">تاریخ</TableHead><TableHead className="text-[9px]">مبلغ</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.payments.map((payment) => (
                        <TableRow key={payment._id}>
                          <TableCell className="num text-[10px]">{payment.number}</TableCell>
                          <TableCell><DateText value={payment.occurredAt} /></TableCell>
                          <TableCell><Money value={payment.amount} currency={currency} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Summary({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "brand" | "danger";
}) {
  return (
    <div className="rounded-xl border border-hairline bg-background/70 p-3">
      <p className="text-[9px] text-ink-soft">{label}</p>
      <p className={cn("num mt-1 text-[13px] font-black", tone === "danger" ? "text-destructive" : tone === "brand" ? "text-brand" : "text-ink")}>{value}</p>
    </div>
  );
}

export function PartiesPage({ mode }: { mode: PartyMode }) {
  const { businessId, currency, role } = useWorkspace();
  const [searchParams] = useSearchParams();
  const linkedId = searchParams.get(mode === "customers" ? "customer" : "supplier");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const customers = useQuery(
    api.customers.list,
    businessId && mode === "customers"
      ? { businessId, search: deferredSearch.trim() || undefined }
      : "skip",
  );
  const suppliers = useQuery(
    api.suppliers.list,
    businessId && mode === "suppliers"
      ? { businessId, search: deferredSearch.trim() || undefined, includeInactive: true }
      : "skip",
  );
  const [dialogOpen, setDialogOpen] = useState(
    searchParams.get("new") === "1" && role !== "viewer",
  );
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [customerProfile, setCustomerProfile] = useState<string | null>(
    mode === "customers" ? linkedId : null,
  );
  const [supplierProfile, setSupplierProfile] = useState<string | null>(
    mode === "suppliers" ? linkedId : null,
  );
  const rows: PartyRow[] = (mode === "customers" ? customers : suppliers) as PartyRow[] | undefined ?? [];
  const canWrite = role !== "viewer";
  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (row: PartyRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`HESAB VIRA · ${mode === "customers" ? "مدیریت مشتریان" : "مدیریت تأمین‌کنندگان"}`}
        title={mode === "customers" ? "پرونده مشتریان" : "پرونده تأمین‌کنندگان"}
        description={
          mode === "customers"
            ? "کد یکتا، اطلاعات هویتی و اعتباری، صورت‌حساب، دریافت‌ها و مانده واقعی بدهی هر مشتری."
            : "اطلاعات حقوقی و بانکی، سوابق خرید، پرداخت‌ها و مانده بدهی تأمین‌کنندگان."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              onClick={() =>
                downloadCsv(
                  `${mode}.csv`,
                  ["کد", "نام", "موبایل", "مانده", "فعال"],
                  rows.map((row) => [
                    row.code,
                    row.name,
                    row.mobile ?? "",
                    mode === "customers" ? (row.outstanding ?? 0) : (row.balance ?? 0),
                    row.active ? "بله" : "خیر",
                  ]),
                )
              }
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={openNew} className="h-9 gap-1.5 rounded-xl">
                <Plus className="size-4" />
                {mode === "customers" ? "مشتری جدید" : "تأمین‌کننده جدید"}
              </Button>
            ) : null}
          </>
        }
      />
      <Panel>
        <PanelHeader
          eyebrow="فهرست"
          title={`${rows.length} پرونده`}
          description="جستجو روی کد، نام، موبایل و شناسه‌ها انجام می‌شود."
          action={
            <div className="relative w-full sm:w-64">
              <Search className="absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-soft" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجو…" className="h-8 rounded-lg pe-8 text-[10px]" />
            </div>
          }
        />
        {!customers && !suppliers ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-11 rounded-lg" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={mode === "customers" ? <Users className="size-5" /> : <Truck className="size-5" />} title="پرونده‌ای پیدا نشد" description="عبارت جستجو را تغییر دهید یا پرونده جدید ثبت کنید." action={canWrite ? <Button size="sm" onClick={openNew} className="rounded-lg">ثبت پرونده</Button> : undefined} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-4 text-[10px]">کد</TableHead>
                    <TableHead className="text-[10px]">نام</TableHead>
                    <TableHead className="text-[10px]">نوع</TableHead>
                    <TableHead className="text-[10px]">تماس</TableHead>
                    <TableHead className="text-[10px]">{mode === "customers" ? "فروش" : "خرید"}</TableHead>
                    <TableHead className="text-[10px]">مانده</TableHead>
                    <TableHead className="text-[10px]">وضعیت</TableHead>
                    <TableHead className="w-24 pe-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="ps-4 font-mono text-[10px] text-ink-soft">{row.code}</TableCell>
                      <TableCell>
                        <p className="text-[11px] font-semibold">{row.name}</p>
                        <p className="text-[9px] text-ink-soft">{row.economicCode ?? row.nationalId ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-[10px]">{row.personType === "legal" ? "حقوقی" : "حقیقی"}</TableCell>
                      <TableCell className="num text-[10px] text-ink-soft" dir="ltr">{row.mobile ?? row.phone ?? "—"}</TableCell>
                      <TableCell className="num text-[10px]">{formatMoney(mode === "customers" ? (row.totalSales ?? 0) : (row.totalPurchases ?? 0), currency)}</TableCell>
                      <TableCell className={cn("num text-[10px] font-semibold", (row.outstanding ?? row.balance ?? 0) > 0 ? "text-[#8a6a20]" : "text-ink-soft")}>
                        {formatMoney(mode === "customers" ? (row.outstanding ?? 0) : (row.balance ?? 0), currency)}
                      </TableCell>
                      <TableCell><CommercePill label={row.active ? "فعال" : "غیرفعال"} tone={row.active ? "brand" : "muted"} /></TableCell>
                      <TableCell className="pe-4">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="size-7 text-ink-soft" onClick={() => mode === "customers" ? setCustomerProfile(row._id) : setSupplierProfile(row._id)} aria-label="پروفایل"><Eye className="size-3.5" /></Button>
                          {canWrite ? <Button variant="ghost" size="icon" className="size-7 text-ink-soft" onClick={() => openEdit(row)} aria-label="ویرایش"><Pencil className="size-3.5" /></Button> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-hairline md:hidden">
              {rows.map((row) => (
                <li key={row._id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold">{row.name}</p>
                    <p className="num text-[9px] text-ink-soft">{row.code} · <span dir="ltr">{row.mobile ?? "—"}</span></p>
                  </div>
                  <div className="text-end">
                    <p className="num text-[10px] font-bold">{formatMoney(mode === "customers" ? (row.outstanding ?? 0) : (row.balance ?? 0), currency)}</p>
                    <Button variant="link" size="sm" className="h-auto px-0 text-[9px]" onClick={() => mode === "customers" ? setCustomerProfile(row._id) : setSupplierProfile(row._id)}>مشاهده پرونده</Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      {dialogOpen ? <PartyDialog key={editing?._id ?? "new"} open onOpenChange={setDialogOpen} mode={mode} businessId={businessId} row={editing} /> : null}
      <CustomerProfileDialog customerId={customerProfile} onClose={() => setCustomerProfile(null)} currency={currency} />
      <SupplierProfileDialog supplierId={supplierProfile} onClose={() => setSupplierProfile(null)} currency={currency} />
    </div>
  );
}
