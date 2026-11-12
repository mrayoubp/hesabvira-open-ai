import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/app/ui";
import { Metric, downloadCsv, printPage } from "@/components/commerce/shared";
import { Button } from "@/components/ui/button";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatJalali, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  BarChart3,
  Boxes,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { useState } from "react";

type ReportKind =
  | "sales-daily" | "sales-monthly" | "sales-yearly" | "sales-by-customer"
  | "sales-by-product" | "sales-by-branch" | "sales-by-user" | "sales-profit"
  | "sales-unpaid" | "purchase-daily" | "purchase-monthly" | "purchase-yearly"
  | "purchase-by-supplier" | "purchase-by-product" | "purchase-payables"
  | "purchase-returns" | "inventory-stock" | "inventory-low"
  | "inventory-movement" | "inventory-cardex" | "inventory-value"
  | "inventory-dead" | "inventory-expiring";

const GROUPS: { key: "sales" | "purchase" | "inventory"; title: string; icon: typeof ShoppingBag; reports: { kind: ReportKind; label: string }[] }[] = [
  {
    key: "sales", title: "گزارش‌های فروش", icon: ShoppingBag,
    reports: [
      { kind: "sales-daily", label: "فروش روزانه" },
      { kind: "sales-monthly", label: "فروش ماهانه" },
      { kind: "sales-yearly", label: "فروش سالانه" },
      { kind: "sales-by-customer", label: "فروش براساس مشتری" },
      { kind: "sales-by-product", label: "فروش براساس کالا" },
      { kind: "sales-by-branch", label: "فروش براساس شعبه" },
      { kind: "sales-by-user", label: "فروش براساس کاربر" },
      { kind: "sales-profit", label: "سود فروش" },
      { kind: "sales-unpaid", label: "فاکتورهای پرداخت‌نشده" },
    ],
  },
  {
    key: "purchase", title: "گزارش‌های خرید", icon: Truck,
    reports: [
      { kind: "purchase-daily", label: "خرید روزانه" },
      { kind: "purchase-monthly", label: "خرید ماهانه" },
      { kind: "purchase-yearly", label: "خرید سالانه" },
      { kind: "purchase-by-supplier", label: "خرید براساس تأمین‌کننده" },
      { kind: "purchase-by-product", label: "خرید براساس کالا" },
      { kind: "purchase-payables", label: "بدهی تأمین‌کنندگان" },
      { kind: "purchase-returns", label: "برگشت از خرید" },
    ],
  },
  {
    key: "inventory", title: "گزارش‌های انبار", icon: Boxes,
    reports: [
      { kind: "inventory-stock", label: "موجودی کالا" },
      { kind: "inventory-low", label: "کالاهای کم‌موجودی" },
      { kind: "inventory-movement", label: "گردش کالا" },
      { kind: "inventory-cardex", label: "کاردکس کالا" },
      { kind: "inventory-value", label: "ارزش موجودی" },
      { kind: "inventory-dead", label: "کالاهای بدون گردش" },
      { kind: "inventory-expiring", label: "کالاهای دارای تاریخ انقضا" },
    ],
  },
];

const ALL_REPORTS = GROUPS.flatMap((group) => group.reports);

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export default function CommerceReportsPage() {
  const { businessId, currency, activeBranch, branches } = useWorkspace();
  const [kind, setKind] = useState<ReportKind>("sales-daily");
  const [from, setFrom] = useState(() => isoDate(Date.now() - 365 * 86400000));
  const [to, setTo] = useState(() => isoDate(Date.now()));
  const [branchId, setBranchId] = useState("all");
  const [warehouseId, setWarehouseId] = useState("all");
  const [limit, setLimit] = useState(100);
  const warehouses = useQuery(api.inventory.warehouses, businessId ? { businessId } : "skip") ?? [];
  const report = useQuery(
    api.commerceReports.report,
    businessId ? {
      businessId,
      kind,
      from: Date.parse(`${from}T00:00:00Z`),
      to: Date.parse(`${to}T23:59:59Z`),
      branchId: branchId === "all" ? undefined : branchId as Id<"branches">,
      warehouseId: warehouseId === "all" ? undefined : warehouseId as Id<"warehouses">,
    } : "skip",
  );
  const activeGroup = GROUPS.find((group) => group.reports.some((row) => row.kind === kind));
  const label = ALL_REPORTS.find((row) => row.kind === kind)?.label ?? "گزارش";
  const rows = report?.rows ?? [];
  const visibleRows = rows.slice(0, limit);
  const columns = report?.columns ?? [];

  const reset = (next: ReportKind) => { setKind(next); setLimit(100); };
  const changeDate = (setter: (value: string) => void, value: string) => { setter(value); setLimit(100); };
  const csv = () => {
    if (!report) return;
    downloadCsv(`${kind}.csv`, report.columns.map((column) => column.label), rows.map((row) => report.columns.map((column) => {
      const value = row[column.key];
      if (column.kind === "date" && Number(value) > 0) return formatJalali(Number(value));
      return value ?? "";
    })));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HESAB VIRA · گزارش‌های مدیریتی"
        title="گزارش‌های فروش، خرید و انبار"
        description="۲۳ گزارش واقعی بر پایه فاکتورها، برگشت‌ها، پرداخت‌ها و دفتر گردش موجودی؛ با فیلتر تاریخ، شعبه و انبار."
        actions={<><Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={csv} disabled={!report}><FileSpreadsheet className="size-4" /> Excel</Button><Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => printPage(label)} disabled={!report}><Printer className="size-4" /> چاپ</Button></>}
      />
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="گزارش فعال" value={label} tone="brand" />
        <Metric label="تعداد ردیف" value={formatNumber(rows.length)} />
        <Metric label="بازه" value={`${formatJalali(Date.parse(`${from}T12:00:00Z`))} تا ${formatJalali(Date.parse(`${to}T12:00:00Z`))}`} />
        <Metric label="شعبه" value={branchId === "all" ? activeBranch?.name ?? "همه" : branches.find((row) => row._id === branchId)?.name ?? "—"} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[230px_1fr]">
        <Panel className="h-fit"><PanelHeader eyebrow="انتخاب گزارش" title="کتابخانه گزارش‌ها" />
          <div className="space-y-3 px-3 pb-3">{GROUPS.map((group) => <div key={group.key}><p className="mb-1 flex items-center gap-1.5 px-1 text-[9px] font-bold text-ink-soft"><group.icon className="size-3" />{group.title}</p><div className="space-y-0.5">{group.reports.map((row) => <button key={row.kind} type="button" onClick={() => reset(row.kind)} className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-right text-[10px] transition-colors", kind === row.kind ? "bg-brand text-cream" : "text-ink-soft hover:bg-muted hover:text-ink")}><span>{row.label}</span>{kind === row.kind ? <span className="text-[8px]">●</span> : null}</button>)}</div></div>)}</div>
        </Panel>
        <Panel className="min-w-0 print-sheet"><PanelHeader eyebrow={activeGroup?.title} title={label} description="همه مبالغ از داده واقعی و اسناد قطعی محاسبه شده‌اند." action={<div className="flex flex-wrap items-end gap-2 print:hidden"><div><Label className="text-[8px]">از تاریخ</Label><Input type="date" value={from} onChange={(e) => changeDate(setFrom, e.target.value)} dir="ltr" className="num mt-1 h-8 w-32 rounded-lg text-[9px]" /></div><div><Label className="text-[8px]">تا تاریخ</Label><Input type="date" value={to} onChange={(e) => changeDate(setTo, e.target.value)} dir="ltr" className="num mt-1 h-8 w-32 rounded-lg text-[9px]" /></div><div><Label className="text-[8px]">شعبه</Label><Select value={branchId} onValueChange={(value) => { setBranchId(value); setLimit(100); }}><SelectTrigger className="mt-1 h-8 w-28 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه</SelectItem>{branches.map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-[8px]">انبار</Label><Select value={warehouseId} onValueChange={(value) => { setWarehouseId(value); setLimit(100); }}><SelectTrigger className="mt-1 h-8 w-28 rounded-lg text-[9px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">همه</SelectItem>{warehouses.map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div></div>} />
          {!report ? <Skeleton className="m-4 h-64 rounded-xl" /> : rows.length === 0 ? <EmptyState icon={<PackageSearch className="size-5" />} title="داده‌ای در این بازه نیست" description="بازه تاریخ، شعبه یا انبار را تغییر دهید؛ گزارش‌ها فقط اسناد قطعی را می‌خوانند." /> : <div className="overflow-x-auto px-4 pb-4">
            <Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key} className={cn("whitespace-nowrap text-[9px]", column.kind !== "text" && "text-left")}>{column.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{visibleRows.map((row, index) => <TableRow key={index}>{columns.map((column) => {
                const value = row[column.key];
                return <TableCell key={column.key} className={cn("whitespace-nowrap text-[10px]", column.kind === "money" && "num text-left", column.kind === "number" && "num text-left", column.kind === "date" && "num text-left")}>{column.kind === "money" ? formatMoney(Number(value) || 0, currency) : column.kind === "number" ? formatNumber(Number(value) || 0) : column.kind === "date" ? (Number(value) > 0 ? formatJalali(Number(value)) : "—") : String(value ?? "—")}</TableCell>;
              })}</TableRow>)}</TableBody>
              {report.totals ? <TableFooter><TableRow>{columns.map((column, index) => <TableCell key={column.key} className={cn("text-[10px] font-bold", column.kind === "money" && "num text-left", column.kind === "number" && "num text-left")}>{index === 0 ? "جمع کل" : report.totals && column.key in report.totals ? (column.kind === "money" ? formatMoney(Number(report.totals[column.key]) || 0, currency) : column.kind === "number" ? formatNumber(Number(report.totals[column.key]) || 0) : String(report.totals[column.key] ?? "")) : ""}</TableCell>)}</TableRow></TableFooter> : null}
            </Table>
            <div className="mt-3 flex items-center justify-between print:hidden"><p className="text-[9px] text-ink-soft">نمایش {formatNumber(visibleRows.length)} از {formatNumber(rows.length)} ردیف</p>{rows.length > limit ? <Button variant="outline" size="sm" className="h-7 rounded-lg text-[9px]" onClick={() => setLimit((current) => current + 100)}>نمایش ۱۰۰ ردیف بیشتر</Button> : null}</div>
          </div>}
        </Panel>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-muted/40 p-3 text-[9px] text-ink-soft"><BarChart3 className="size-4 shrink-0 text-brand" /><p>گزارش‌های ارزش موجودی و سود فروش از بهای تمام‌شده ثبت‌شده در اسناد قطعی استفاده می‌کنند؛ تغییر روش ارزش‌گذاری، سوابق قبلی را بازنویسی نمی‌کند.</p></div>
    </div>
  );
}
