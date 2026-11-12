import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  REPORT_CATEGORIES,
  REPORT_CATALOG,
  reportCategoryLabel,
} from "@/convex/lib/reportCatalog";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  Clock3,
  Coins,
  FileSpreadsheet,
  GitCompare,
  Landmark,
  LayoutGrid,
  Package,
  Pin,
  Receipt,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const categoryIcons: Record<string, ComponentType<{ className?: string }>> = {
  accounting: BookOpen,
  financial: BarChart3,
  sales: Receipt,
  purchases: ShoppingCart,
  inventory: Package,
  customers: Users,
  suppliers: Truck,
  banking: Landmark,
  cash: Coins,
  payroll: Wallet,
  tax: Receipt,
  assets: Building2,
  branches: GitCompare,
  management: Sparkles,
};

function safeFilters(config: string): {
  from?: number;
  to?: number;
  branchId?: string;
  fiscalYearId?: string;
} {
  try {
    const value = JSON.parse(config) as Record<string, unknown>;
    return {
      from:
        typeof value.from === "number" && Number.isFinite(value.from)
          ? value.from
          : undefined,
      to:
        typeof value.to === "number" && Number.isFinite(value.to)
          ? value.to
          : undefined,
      branchId: typeof value.branchId === "string" ? value.branchId : undefined,
      fiscalYearId:
        typeof value.fiscalYearId === "string" ? value.fiscalYearId : undefined,
    };
  } catch {
    return {};
  }
}

function reportHref(
  reportKey: string,
  filters: { from?: number; to?: number; branchId?: string; fiscalYearId?: string },
) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", String(filters.from));
  if (filters.to) params.set("to", String(filters.to));
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.fiscalYearId) params.set("fiscalYearId", filters.fiscalYearId);
  const query = params.toString();
  return `/dashboard/reports/${reportKey}${query ? `?${query}` : ""}`;
}

export default function ReportsCenterPage() {
  const {
    businessId,
    workspaces,
    activeFiscalYear,
    fiscalYears,
    branches,
    currency,
    setBusinessId,
    setFiscalYearId,
  } = useWorkspace();
  const workspaceData = useQuery(
    api.reportCenter.workspace,
    businessId ? { businessId } : "skip",
  );
  const saveReport = useMutation(api.reportCenter.saveReport);
  const togglePin = useMutation(api.reportCenter.togglePin);
  const archiveReport = useMutation(api.reportCenter.archiveReport);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const rangeTouched = useRef(false);
  const businessRef = useRef<string | undefined>(businessId);

  useEffect(() => {
    if (businessRef.current !== businessId) {
      businessRef.current = businessId;
      rangeTouched.current = false;
      setBranchId("all");
    }
  }, [businessId]);

  useEffect(() => {
    if (!activeFiscalYear || rangeTouched.current) return;
    setFrom(isoDateValue(activeFiscalYear.startAt));
    setTo(isoDateValue(activeFiscalYear.endAt));
  }, [activeFiscalYear]);

  const fromTimestamp = from ? timestampFromDateInput(from) : undefined;
  const toTimestamp = to ? timestampFromDateInput(to, true) : undefined;
  const validRange =
    fromTimestamp === undefined ||
    toTimestamp === undefined ||
    (Number.isFinite(fromTimestamp) &&
      Number.isFinite(toTimestamp) &&
      fromTimestamp <= toTimestamp);
  const activeFilters = {
    from:
      fromTimestamp !== undefined && Number.isFinite(fromTimestamp)
        ? fromTimestamp
        : activeFiscalYear?.startAt,
    to:
      toTimestamp !== undefined && Number.isFinite(toTimestamp)
        ? toTimestamp
        : activeFiscalYear?.endAt,
    branchId: branchId === "all" ? undefined : branchId,
    fiscalYearId: activeFiscalYear?._id,
  };
  const filterConfig = JSON.stringify({
    from: activeFilters.from,
    to: activeFilters.to,
    branchId: activeFilters.branchId,
    fiscalYearId: activeFilters.fiscalYearId,
  });
  const normalizedSearch = search.trim().toLocaleLowerCase("fa");
  const filtered = REPORT_CATALOG.filter((definition) => {
    if (category !== "all" && definition.category !== category) return false;
    if (!normalizedSearch) return true;
    return (
      definition.title.toLocaleLowerCase("fa").includes(normalizedSearch) ||
      definition.description.toLocaleLowerCase("fa").includes(normalizedSearch) ||
      reportCategoryLabel(definition.category)
        .toLocaleLowerCase("fa")
        .includes(normalizedSearch)
    );
  });
  const categoryCounts = new Map<string, number>();
  for (const definition of REPORT_CATALOG) {
    categoryCounts.set(
      definition.category,
      (categoryCounts.get(definition.category) ?? 0) + 1,
    );
  }
  const categoryLabel =
    category === "all"
      ? "همه گزارش‌ها"
      : reportCategoryLabel(category);
  const activeBranchName =
    branchId === "all"
      ? "همه شعب"
      : (branches.find((branch) => branch._id === branchId)?.name ?? "همه شعب");

  const saveQuickReport = async (reportKey: string, title: string) => {
    if (!businessId) return;
    setSavingKey(reportKey);
    try {
      await saveReport({
        businessId,
        title,
        reportKey,
        module: "builtin",
        config: filterConfig,
        pinned: true,
      });
      toast.success("گزارش در «گزارش‌های ذخیره‌شده» قرار گرفت.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingKey(null);
    }
  };

  const resetFilters = () => {
    rangeTouched.current = false;
    setSearch("");
    setCategory("all");
    setBranchId("all");
    setFrom(activeFiscalYear ? isoDateValue(activeFiscalYear.startAt) : "");
    setTo(activeFiscalYear ? isoDateValue(activeFiscalYear.endAt) : "");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PHASE 09 · BUSINESS INTELLIGENCE"
        title="مرکز گزارشات حساب ویرا"
        description="کتابخانه‌ای از گزارش‌های رسمی و تحلیلی که همه ردیف‌های آن از اسناد و تراکنش‌های ثبت‌شده کسب‌وکار شما ساخته می‌شود؛ با کنترل مجوز سمت سرور."
        actions={
          <>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/dashboard/reports/custom">
                <SlidersHorizontal className="size-4" aria-hidden />
                گزارش‌ساز سفارشی
              </Link>
            </Button>
            <Button asChild className="rounded-xl bg-brand text-cream hover:bg-brand-deep">
              <Link to="/dashboard/ai">
                <Bot className="size-4" aria-hidden />
                گفتگو با ویرا AI
              </Link>
            </Button>
          </>
        }
      />

      <section className="relative overflow-hidden rounded-[30px] bg-brand-deep px-5 py-6 text-cream shadow-[0_30px_70px_-50px_rgba(22,58,46,0.9)] sm:px-8 sm:py-8">
        <span className="pointer-events-none absolute -left-20 -top-28 size-80 rounded-full border border-gold/20" />
        <span className="pointer-events-none absolute -left-4 -top-14 size-48 rounded-full border border-gold/15" />
        <span className="pointer-events-none absolute bottom-0 right-1/4 h-px w-72 bg-gradient-to-l from-gold/40 to-transparent" />
        <div className="relative grid gap-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-white/5 px-3 py-1 text-[10px] font-semibold text-gold">
              <Sparkles className="size-3" aria-hidden />
              از سند خام تا تصمیم مدیریتی
            </span>
            <h2 className="mt-4 max-w-2xl text-[24px] font-black leading-[1.55] sm:text-[30px]">
              {REPORT_CATALOG.length.toLocaleString("fa-IR")} گزارش واقعی،
              <span className="text-gold"> ۱۴ خانواده تحلیلی</span> و یک دستیار
              که فقط با شواهد پاسخ می‌دهد.
            </h2>
            <p className="mt-3 max-w-xl text-[12px] leading-7 text-cream/70">
              ترازنامه، سود و زیان، جریان نقد، فروش، انبار، مطالبات و مقایسه
              شعب؛ همه بر پایه وضعیت واقعی دفاتر و با امکان خروجی Excel، PDF
              فارسی و چاپ استاندارد.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-cream/75">
                اسناد قطعی و معکوس
              </span>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-cream/75">
                بدون داده نمایشی
              </span>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-cream/75">
                جداسازی کسب‌وکارها
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
              <FileSpreadsheet className="size-4 text-gold" aria-hidden />
              <p className="mt-3 text-lg font-black">
                {REPORT_CATALOG.length.toLocaleString("fa-IR")}
              </p>
              <p className="mt-0.5 text-[9px] text-cream/60">گزارش قابل اجرا</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
              <LayoutGrid className="size-4 text-gold" aria-hidden />
              <p className="mt-3 text-lg font-black">
                {REPORT_CATEGORIES.length.toLocaleString("fa-IR")}
              </p>
              <p className="mt-0.5 text-[9px] text-cream/60">دسته‌بندی</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
              <Bot className="size-4 text-gold" aria-hidden />
              <p className="mt-3 text-lg font-black">AI</p>
              <p className="mt-0.5 text-[9px] text-cream/60">دستیار تحلیل</p>
            </div>
          </div>
        </div>
      </section>

      <Panel className="overflow-visible">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جستجوی نام یا موضوع گزارش…"
                className="h-10 rounded-xl border-hairline bg-background/60 pr-9 text-[12px]"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFilters((value) => !value)}
              className={cn(
                "h-10 rounded-xl",
                showFilters && "border-brand/30 bg-brand-soft text-brand",
              )}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              فیلترها
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={resetFilters}
              className="h-10 rounded-xl text-ink-soft"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              بازنشانی
            </Button>
          </div>

          {showFilters ? (
            <div className="grid gap-3 rounded-2xl border border-hairline/80 bg-background/50 p-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold text-ink-soft">از تاریخ</span>
                <Input
                  type="date"
                  value={from}
                  onChange={(event) => {
                    rangeTouched.current = true;
                    setFrom(event.target.value);
                  }}
                  className="h-9 rounded-lg text-[11px]"
                />
                <span className="block text-[8px] text-ink-soft">
                  {fromTimestamp && Number.isFinite(fromTimestamp)
                    ? `معادل ${formatJalali(fromTimestamp)}`
                    : "بازه پیش‌فرض دوره مالی"}
                </span>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold text-ink-soft">تا تاریخ</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(event) => {
                    rangeTouched.current = true;
                    setTo(event.target.value);
                  }}
                  className="h-9 rounded-lg text-[11px]"
                />
                <span className="block text-[8px] text-ink-soft">
                  {toTimestamp && Number.isFinite(toTimestamp)
                    ? `معادل ${formatJalali(toTimestamp)}`
                    : "پایان دوره مالی"}
                </span>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold text-ink-soft">شعبه</span>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="h-9 rounded-lg text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه شعب</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch._id} value={branch._id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold text-ink-soft">دوره مالی</span>
                <Select
                  value={activeFiscalYear?._id ?? ""}
                  onValueChange={(value) =>
                    setFiscalYearId(value as Id<"fiscalYears">)
                  }
                >
                  <SelectTrigger className="h-9 rounded-lg text-[11px]">
                    <SelectValue placeholder="دوره مالی" />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYears.map((year) => (
                      <SelectItem key={year._id} value={year._id}>
                        {year.name} {year.status === "closed" ? "· بسته" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold text-ink-soft">کسب‌وکار</span>
                <Select
                  value={businessId ?? ""}
                  onValueChange={(value) =>
                    setBusinessId(value as Id<"businesses">)
                  }
                >
                  <SelectTrigger className="h-9 rounded-lg text-[11px]">
                    <SelectValue placeholder="کسب‌وکار" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem
                        key={workspace.business._id}
                        value={workspace.business._id}
                      >
                        {workspace.business.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {!validRange ? (
                <p className="text-[10px] font-semibold text-destructive sm:col-span-2 lg:col-span-5">
                  بازه تاریخ معتبر نیست؛ تاریخ شروع باید پیش از پایان باشد.
                </p>
              ) : (
                <p className="text-[9px] leading-5 text-ink-soft sm:col-span-2 lg:col-span-5">
                  گزارش‌ها با این فیلترها اجرا می‌شوند: {activeBranchName} ·{" "}
                  {activeFiscalYear?.name ?? "دوره جاری"} · واحد {currency}
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5 border-t border-hairline/60 pt-3">
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[10px] font-semibold transition",
                category === "all"
                  ? "border-brand bg-brand text-cream"
                  : "border-hairline bg-white/60 text-ink-soft hover:border-brand/30 hover:text-brand",
              )}
            >
              همه ({REPORT_CATALOG.length.toLocaleString("fa-IR")})
            </button>
            {REPORT_CATEGORIES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setCategory(item.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[10px] font-semibold transition",
                  category === item.key
                    ? "border-brand bg-brand text-cream"
                    : "border-hairline bg-white/60 text-ink-soft hover:border-brand/30 hover:text-brand",
                )}
              >
                {item.label} ({(categoryCounts.get(item.key) ?? 0).toLocaleString("fa-IR")})
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {workspaceData?.saved.length ? (
        <Panel>
          <div className="flex items-center justify-between gap-1 px-5 pb-3 pt-5">
            <div>
              <p className="text-[10px] font-semibold tracking-wide text-gold">BOOKMARKS</p>
              <h2 className="mt-0.5 text-sm font-extrabold text-ink">گزارش‌های ذخیره‌شده شما</h2>
            </div>
            <span className="rounded-full bg-brand-soft px-2 py-1 text-[9px] font-semibold text-brand">
              {workspaceData.saved.length.toLocaleString("fa-IR")} قالب
            </span>
          </div>
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            {workspaceData.saved.map((row) => {
              const definition = REPORT_CATALOG.find(
                (item) => item.key === row.reportKey,
              );
              const filters = safeFilters(row.config);
              const href =
                row.reportKey === "custom"
                  ? `/dashboard/reports/custom?saved=${row._id}`
                  : reportHref(row.reportKey, filters);
              return (
                <div
                  key={row._id}
                  className="group flex items-start gap-2 rounded-xl border border-hairline/80 bg-white/60 p-3"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold">
                    {row.reportKey === "custom" ? (
                      <SlidersHorizontal className="size-3.5" aria-hidden />
                    ) : (
                      <Star className="size-3.5" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={href}
                      className="line-clamp-1 text-[11px] font-bold text-ink hover:text-brand"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-[9px] text-ink-soft">
                      {row.reportKey === "custom"
                        ? "گزارش سفارشی"
                        : (definition?.title ?? "گزارش")} ·{" "}
                      {filters.from ? formatJalali(filters.from) : "بدون تاریخ"}
                    </p>
                    <div className="mt-1.5 flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          businessId &&
                          togglePin({ businessId, savedReportId: row._id }).catch(
                            (error) => toast.error(getErrorMessage(error)),
                          )
                        }
                        className="rounded p-1 text-ink-soft hover:bg-brand-soft hover:text-brand"
                        title="پین / برداشتن پین"
                      >
                        <Pin className={cn("size-3", row.pinned && "fill-current text-gold")} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          businessId &&
                          archiveReport({ businessId, savedReportId: row._id })
                            .then(() => toast.success("از فهرست ذخیره‌شده‌ها آرشیو شد."))
                            .catch((error) => toast.error(getErrorMessage(error)))
                        }
                        className="rounded p-1 text-ink-soft hover:bg-destructive/5 hover:text-destructive"
                        title="آرشیو"
                      >
                        <Archive className="size-3" aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {workspaceData?.recent.length ? (
        <Panel>
          <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
            <h2 className="flex items-center gap-2 text-sm font-extrabold text-ink">
              <Clock3 className="size-4 text-gold" aria-hidden />
              گزارش‌های اخیر
            </h2>
            <span className="text-[9px] text-ink-soft">۲۰ اجرای آخر شما</span>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-4">
            {workspaceData.recent.slice(0, 10).map((row) => (
              <Link
                key={row._id}
                to={reportHref(row.reportKey, {
                  from: row.from,
                  to: row.to,
                  branchId: row.branchId,
                  fiscalYearId: row.fiscalYearId,
                })}
                className="min-w-[220px] rounded-xl border border-hairline/70 bg-background/40 p-3 transition hover:border-brand/25 hover:bg-brand-soft/40"
              >
                <p className="line-clamp-1 text-[10.5px] font-bold text-ink">{row.title}</p>
                <div className="mt-1.5 flex items-center justify-between text-[8.5px] text-ink-soft">
                  <span>{formatJalali(row.createdAt)}</span>
                  <span>{row.rowCount.toLocaleString("fa-IR")} ردیف</span>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold text-gold">REPORT LIBRARY</p>
          <h2 className="mt-0.5 text-base font-black text-ink">{categoryLabel}</h2>
        </div>
        <span className="text-[10px] text-ink-soft">
          {filtered.length.toLocaleString("fa-IR")} گزارش
        </span>
      </div>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Search className="size-5" />}
            title="گزارشی پیدا نشد"
            description="عبارت جستجو یا دسته‌بندی را تغییر دهید. همه گزارش‌ها از کاتالوگ رسمی حساب ویرا می‌آیند."
            action={
              <Button variant="outline" onClick={resetFilters} className="rounded-xl">
                پاک‌کردن فیلترها
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((definition) => {
            const Icon = categoryIcons[definition.category] ?? BarChart3;
            const href =
              definition.mode === "link"
                ? (definition.path ?? "/dashboard/reports")
                : validRange
                  ? reportHref(definition.key, activeFilters)
                  : "#";
            const saving = savingKey === definition.key;
            return (
              <div
                key={definition.key}
                className="group relative flex flex-col rounded-2xl border border-hairline/80 bg-surface p-4 shadow-[0_18px_45px_-38px_rgba(22,58,46,0.45)] transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[0_24px_55px_-38px_rgba(22,58,46,0.5)]"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand group-hover:text-cream">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-[12px] font-extrabold text-ink">
                        {definition.title}
                      </h3>
                      {definition.mode === "link" ? (
                        <span className="rounded bg-mist px-1.5 py-0.5 text-[7px] font-semibold text-[#2d6470]">
                          صفحه تخصصی
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[9.5px] leading-5 text-ink-soft">
                      {definition.description}
                    </p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline/60 pt-3">
                  <span className="text-[8.5px] font-semibold text-ink-soft">
                    {reportCategoryLabel(definition.category)}
                  </span>
                  <div className="flex items-center gap-1">
                    {definition.mode === "run" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void saveQuickReport(
                            definition.key,
                            `${definition.title} · ${activeFiscalYear?.name ?? "دوره جاری"}`,
                          )
                        }
                        disabled={saving}
                        className={cn(
                          "rounded-lg p-1.5 text-ink-soft transition hover:bg-gold-soft hover:text-[#8a6c2c]",
                          saving && "animate-pulse",
                        )}
                        title="ذخیره در گزارش‌های پرکاربرد"
                      >
                        <Star className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                    {validRange || definition.mode === "link" ? (
                      <Link
                        to={href}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[9px] font-semibold text-cream transition hover:bg-brand-deep"
                      >
                        اجرا
                        <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    ) : (
                      <span className="text-[8.5px] text-destructive">بازه نامعتبر</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className="grid gap-3 lg:grid-cols-2">
        <Link
          to="/dashboard/ai"
          className="group relative overflow-hidden rounded-2xl border border-[#d9eaf2] bg-gradient-to-l from-[#eff7fa] to-white p-5 transition hover:border-[#b8d5df]"
        >
          <span className="absolute -left-6 -top-6 size-24 rounded-full bg-[#d9eaf2]/70 transition group-hover:scale-110" />
          <div className="relative flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#173D32] text-gold">
              <Bot className="size-5" aria-hidden />
            </span>
            <div>
              <h3 className="text-[13px] font-black text-ink">ویرا AI · دستیار مالی فارسی</h3>
              <p className="mt-1 max-w-md text-[10px] leading-6 text-ink-soft">
                درباره سود، هزینه، مطالبات، نقدینگی و موجودی بپرسید. ویرا فقط
                با داده مجاز همان کسب‌وکار و همراه با شواهد پاسخ می‌دهد.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[9.5px] font-semibold text-[#2d6470]">
                شروع گفتگو
                <ArrowUpRight className="size-3" aria-hidden />
              </span>
            </div>
          </div>
        </Link>
        <Link
          to="/dashboard/reports/custom"
          className="group relative overflow-hidden rounded-2xl border border-[#eadfc4] bg-gradient-to-l from-[#fbf6ea] to-white p-5 transition hover:border-gold/50"
        >
          <span className="absolute -left-6 -top-6 size-24 rounded-full bg-gold-soft/70 transition group-hover:scale-110" />
          <div className="relative flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#173D32] text-gold">
              <SlidersHorizontal className="size-5" aria-hidden />
            </span>
            <div>
              <h3 className="text-[13px] font-black text-ink">گزارش‌ساز سفارشی</h3>
              <p className="mt-1 max-w-md text-[10px] leading-6 text-ink-soft">
                ماژول، ستون‌ها، گروه‌بندی و ترتیب را خودتان انتخاب کنید؛ فقط
                فیلدهای مجاز و داده‌های قابل دسترس شما در دسترس‌اند.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[9.5px] font-semibold text-[#8a6c2c]">
                ساخت قالب جدید
                <ArrowUpRight className="size-3" aria-hidden />
              </span>
            </div>
          </div>
        </Link>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-hairline/60 bg-white/40 px-4 py-3 text-[9px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3 text-gold" aria-hidden />
          دوره فعال: {activeFiscalYear?.name ?? "—"}
        </span>
        <span>
          دسترسی هر گزارش پیش از ساخت ردیف‌ها سمت سرور کنترل می‌شود و خروجی‌ها
          در تاریخچه ثبت می‌شوند.
        </span>
      </div>
    </div>
  );
}
