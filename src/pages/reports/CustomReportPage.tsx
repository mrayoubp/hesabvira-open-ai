import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import {
  ReportDocument,
  type SheetReport,
} from "@/components/reports/ReportDocument";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { CustomFieldKind } from "@/convex/lib/customReport";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali, formatNumber } from "@/lib/format";
import {
  downloadReportElementPdf,
  downloadReportXlsx,
  printReportElement,
  reportFilename,
} from "@/lib/reportExport";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Layers3,
  Loader2,
  Play,
  Printer,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
} from "lucide-react";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

interface CustomConfig {
  module: string;
  fields: string[];
  groupBy?: string;
  sortKey?: string;
  sortDirection: "asc" | "desc";
  search?: string;
}

interface CustomResult {
  module: string;
  moduleLabel: string;
  title: string;
  columns: { key: string; label: string; kind: CustomFieldKind }[];
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
  rowCount: number;
  from: number;
  to: number;
  businessName: string;
  fiscalYearName: string;
  generatedAt: number;
  note: string;
}

interface ActiveRun {
  configJson: string;
  from: number;
  to: number;
  branchId?: string;
  fiscalYearId?: string;
  search?: string;
}

const GROUPABLE = new Set([
  "status",
  "branch",
  "warehouse",
  "category",
  "kind",
  "group",
  "active",
  "employmentType",
  "period",
  "type",
  "user",
  "product",
  "customer",
  "supplier",
]);

class CustomBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: getErrorMessage(error) };
  }
  componentDidCatch(error: unknown) {
    console.error("[Custom report]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <Panel>
          <EmptyState
            icon={<SlidersHorizontal className="size-5" />}
            title="اجرای گزارش سفارشی ممکن نیست"
            description={this.state.error}
            action={
              <Button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-xl bg-brand text-cream"
              >
                بازگشت به تنظیمات
              </Button>
            }
          />
        </Panel>
      );
    }
    return this.props.children;
  }
}

function customSheet(result: CustomResult): SheetReport {
  const numeric = result.columns.filter(
    (column) =>
      column.kind === "money" ||
      column.kind === "number" ||
      column.kind === "percent",
  );
  const summary = [
    {
      key: "rows",
      label: "ردیف‌های گزارش",
      value: result.rowCount,
      kind: "number" as const,
    },
    ...numeric.slice(0, 4).map((column) => ({
      key: column.key,
      label: column.label,
      value: Number(result.totals[column.key] ?? 0),
      kind:
        column.kind === "money"
          ? ("money" as const)
          : column.kind === "percent"
            ? ("percent" as const)
            : ("number" as const),
    })),
  ];
  const groupColumn = result.columns[0];
  const primaryNumeric = numeric.find((column) => column.key !== groupColumn?.key);
  const chart =
    groupColumn && primaryNumeric && result.rows.length > 1
      ? {
          title: `${primaryNumeric.label} به تفکیک ${groupColumn.label}`,
          type: "bar" as const,
          xKey: "label",
          series: [{ key: primaryNumeric.key, label: primaryNumeric.label }],
          data: result.rows.slice(0, 14).map((row) => {
            const point: Record<string, string | number> = {
              label: String(row[groupColumn.key] ?? "—"),
            };
            point[primaryNumeric.key] = Number(row[primaryNumeric.key] ?? 0);
            return point;
          }),
        }
      : undefined;
  return {
    title: result.title,
    category: "گزارش سفارشی",
    businessName: result.businessName,
    fiscalYear: result.fiscalYearName,
    from: result.from,
    to: result.to,
    generatedAt: result.generatedAt,
    currency: "IRT",
    summary,
    sections: [
      {
        key: "custom",
        title: result.moduleLabel,
        columns: result.columns,
        rows: result.rows,
        totals: result.totals,
        note: result.note,
      },
    ],
    chart,
    evidence: [
      {
        label: "منبع گزارش",
        detail: `${result.rowCount} ردیف از داده مجاز کسب‌وکار؛ فقط ستون‌های انتخاب‌شده در این قالب`,
      },
    ],
    note: "این گزارش با گزارش‌ساز سفارشی و فقط از فیلدهای مجاز ماژول انتخاب‌شده ساخته شده است.",
  };
}

function CustomReportContent() {
  const {
    businessId,
    activeFiscalYear,
    fiscalYears,
    branches,
    workspace,
  } = useWorkspace();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const modules = useQuery(
    api.reportCenter.customModules,
    businessId ? { businessId } : "skip",
  );
  const saved = useQuery(
    api.reportCenter.saved,
    businessId ? { businessId } : "skip",
  );
  const saveReport = useMutation(api.reportCenter.saveReport);
  const logExport = useMutation(api.reportCenter.logExport);
  const savedParam = searchParams.get("saved");
  const [moduleKey, setModuleKey] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("none");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [rangeTouched, setRangeTouched] = useState(false);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "landscape",
  );
  const [marginMm, setMarginMm] = useState(8);
  const savedLoaded = useRef<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const module = modules?.find((row) => row.key === moduleKey);
  const availableFields = module?.fields ?? [];

  useEffect(() => {
    if (!activeFiscalYear) return;
    if (!fiscalYearId) setFiscalYearId(activeFiscalYear._id);
    if (!rangeTouched) {
      setFromInput(isoDateValue(activeFiscalYear.startAt));
      setToInput(isoDateValue(activeFiscalYear.endAt));
    }
  }, [activeFiscalYear, fiscalYearId, rangeTouched]);

  useEffect(() => {
    if (moduleKey || !modules?.length) return;
    const first = modules[0];
    if (!first) return;
    setModuleKey(first.key);
    const selected = first.fields
      .filter((field) => !field.sensitive)
      .slice(0, 5)
      .map((field) => field.key);
    setFields(selected);
    setSortKey(selected[0] ?? "");
    setSaveTitle(`گزارش سفارشی ${first.label}`);
  }, [moduleKey, modules]);

  useEffect(() => {
    if (!savedParam || !saved || savedLoaded.current === savedParam) return;
    const row = saved.find((item) => item._id === savedParam);
    if (!row) return;
    try {
      const parsed = JSON.parse(row.config) as Partial<CustomConfig> & {
        from?: number;
        to?: number;
        branchId?: string;
        fiscalYearId?: string;
      };
      if (!parsed.module || !Array.isArray(parsed.fields)) return;
      savedLoaded.current = savedParam;
      setModuleKey(parsed.module);
      setFields(parsed.fields);
      setGroupBy(parsed.groupBy ?? "none");
      setSortKey(parsed.sortKey ?? parsed.fields[0] ?? "");
      setSortDirection(parsed.sortDirection === "asc" ? "asc" : "desc");
      setSearch(parsed.search ?? "");
      setSaveTitle(row.title);
      if (parsed.fiscalYearId) setFiscalYearId(parsed.fiscalYearId);
      if (typeof parsed.from === "number") {
        setFromInput(isoDateValue(parsed.from));
        setRangeTouched(true);
      }
      if (typeof parsed.to === "number") {
        setToInput(isoDateValue(parsed.to));
        setRangeTouched(true);
      }
      if (parsed.branchId) setBranchId(parsed.branchId);
      setActive({
        configJson: JSON.stringify({
          module: parsed.module,
          fields: parsed.fields,
          groupBy: parsed.groupBy,
          sortKey: parsed.sortKey,
          sortDirection: parsed.sortDirection === "asc" ? "asc" : "desc",
          search: parsed.search,
        }),
        from: parsed.from ?? activeFiscalYear?.startAt ?? 0,
        to: parsed.to ?? activeFiscalYear?.endAt ?? 0,
        branchId: parsed.branchId,
        fiscalYearId: parsed.fiscalYearId,
        search: parsed.search,
      });
    } catch {
      toast.error("قالب ذخیره‌شده قابل خواندن نیست.");
    }
  }, [savedParam, saved, activeFiscalYear]);

  const configJson = JSON.stringify({
    module: moduleKey,
    fields,
    groupBy: groupBy === "none" ? undefined : groupBy,
    sortKey: sortKey || fields[0],
    sortDirection,
    search: search || undefined,
  } satisfies CustomConfig);

  const result = useQuery(
    api.reportCenter.runCustom,
    businessId && active
      ? {
          businessId,
          fiscalYearId: active.fiscalYearId as Id<"fiscalYears"> | undefined,
          branchId: active.branchId as Id<"branches"> | undefined,
          config: active.configJson,
          from: active.from,
          to: active.to,
          search: active.search || undefined,
        }
      : "skip",
  ) as CustomResult | undefined;

  const sheet = useMemo(() => (result ? customSheet(result) : null), [result]);

  const chooseModule = (key: string) => {
    const next = modules?.find((row) => row.key === key);
    setModuleKey(key);
    const selected = (next?.fields ?? [])
      .filter((field) => !field.sensitive)
      .slice(0, 5)
      .map((field) => field.key);
    setFields(selected);
    setGroupBy("none");
    setSortKey(selected[0] ?? "");
    setActive(null);
    setSaveTitle(next ? `گزارش سفارشی ${next.label}` : "");
  };

  const toggleField = (key: string) => {
    setFields((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
    setActive(null);
  };

  const run = () => {
    if (!moduleKey) {
      toast.error("یک ماژول انتخاب کنید.");
      return;
    }
    if (fields.length === 0) {
      toast.error("حداقل یک ستون انتخاب کنید.");
      return;
    }
    const from = fromInput ? timestampFromDateInput(fromInput) : activeFiscalYear?.startAt;
    const to = toInput
      ? timestampFromDateInput(toInput, true)
      : activeFiscalYear?.endAt;
    if (
      from === undefined ||
      to === undefined ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from > to
    ) {
      toast.error("بازه تاریخ معتبر نیست.");
      return;
    }
    setActive({
      configJson,
      from,
      to,
      branchId: branchId === "all" ? undefined : branchId,
      fiscalYearId,
      search: search || undefined,
    });
  };

  const saveTemplate = async () => {
    if (!businessId || !moduleKey) return;
    if (saveTitle.trim().length < 2) {
      toast.error("عنوان قالب باید حداقل ۲ نویسه باشد.");
      return;
    }
    setSaving(true);
    try {
      await saveReport({
        businessId,
        title: saveTitle.trim(),
        reportKey: "custom",
        module: moduleKey,
        config: JSON.stringify({
          ...JSON.parse(configJson),
          from: active?.from,
          to: active?.to,
          branchId: active?.branchId,
          fiscalYearId: active?.fiscalYearId,
        }),
        pinned: true,
      });
      toast.success("قالب گزارش سفارشی ذخیره شد.");
      setShowSave(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const log = async (
    format: "xlsx" | "pdf" | "print",
    status: "success" | "failed",
    error?: string,
  ) => {
    if (!businessId || !result) return;
    try {
      await logExport({
        businessId,
        reportKey: "custom",
        title: result.title,
        format,
        rowCount: result.rowCount,
        filters: active ? JSON.stringify({ ...JSON.parse(active.configJson), ...active }) : undefined,
        status,
        error,
      });
    } catch (reason) {
      console.warn("[Custom report] export log was not recorded", reason);
    }
  };

  const exportExcel = async () => {
    if (!sheet) return;
    setExporting("xlsx");
    try {
      await downloadReportXlsx(
        {
          title: sheet.title,
          category: "گزارش سفارشی",
          businessName: sheet.businessName,
          fiscalYear: sheet.fiscalYear,
          from: sheet.from,
          to: sheet.to,
          generatedAt: sheet.generatedAt,
          currency: "IRT",
          summary: sheet.summary,
          sections: sheet.sections,
          note: sheet.note,
        },
        reportFilename("custom-report", "xlsx").replace(/\.xlsx$/, ""),
      );
      toast.success("فایل Excel گزارش سفارشی ساخته شد.");
      await log("xlsx", "success");
    } catch (error) {
      toast.error(getErrorMessage(error));
      await log("xlsx", "failed", getErrorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!sheetRef.current) return;
    setExporting("pdf");
    try {
      await downloadReportElementPdf(
        sheetRef.current,
        reportFilename("custom-report", "pdf").replace(/\.pdf$/, ""),
        { orientation },
      );
      toast.success("PDF فارسی گزارش سفارشی ساخته شد.");
      await log("pdf", "success");
    } catch (error) {
      toast.error(getErrorMessage(error));
      await log("pdf", "failed", getErrorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const customSaved = saved?.filter((row) => row.reportKey === "custom") ?? [];
  const groupOptions = availableFields.filter(
    (field) => fields.includes(field.key) && GROUPABLE.has(field.key),
  );
  const changed =
    active !== null &&
    (active.configJson !== configJson ||
      active.branchId !== (branchId === "all" ? undefined : branchId) ||
      active.fiscalYearId !== fiscalYearId ||
      active.search !== (search || undefined));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-soft">
        <Link to="/dashboard/reports" className="inline-flex items-center gap-1 hover:text-brand">
          <ArrowRight className="size-3" aria-hidden />
          مرکز گزارشات
        </Link>
        <span>/</span>
        <span className="font-semibold text-ink">گزارش‌ساز سفارشی</span>
      </div>

      <PageHeader
        eyebrow="CUSTOM REPORT BUILDER · YOUR FIELDS, YOUR VIEW"
        title="گزارش‌ساز سفارشی"
        description="ماژول و ستون‌های مجاز را انتخاب کنید، فیلتر و گروه‌بندی بگذارید و همان قالب را برای اجرای بعدی ذخیره کنید. اعتبار فیلدها پیش از خواندن داده در سرور بررسی می‌شود."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setShowSave((value) => !value)}
              className="rounded-xl"
            >
              <Save className="size-4" aria-hidden />
              ذخیره قالب
            </Button>
            <Button
              onClick={run}
              className="rounded-xl bg-brand text-cream hover:bg-brand-deep"
            >
              <Play className="size-4" aria-hidden />
              اجرای گزارش
            </Button>
          </>
        }
      />

      {customSaved.length ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="inline-flex items-center gap-1 px-1 text-[9px] font-semibold text-ink-soft">
              <Star className="size-3 text-gold" aria-hidden />
              قالب‌های ذخیره‌شده:
            </span>
            {customSaved.slice(0, 8).map((row) => (
              <button
                key={row._id}
                type="button"
                onClick={() => navigate(`/dashboard/reports/custom?saved=${row._id}`)}
                className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/70 px-2.5 py-1 text-[8.5px] font-semibold text-ink-soft transition hover:border-brand/30 hover:text-brand"
              >
                <SlidersHorizontal className="size-2.5" aria-hidden />
                {row.title}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {showSave ? (
        <Panel>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1.5">
              <span className="text-[10px] font-semibold text-ink-soft">
                عنوان قالب (برای اجرای مجدد)
              </span>
              <Input
                value={saveTitle}
                onChange={(event) => setSaveTitle(event.target.value)}
                maxLength={100}
                className="h-10 rounded-xl text-[12px]"
              />
            </label>
            <Button
              onClick={() => void saveTemplate()}
              disabled={saving || fields.length === 0}
              className="h-10 rounded-xl bg-brand text-cream"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              ذخیره در گزارش‌های من
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[370px_minmax(0,1fr)]">
        <Panel className="h-fit overflow-hidden xl:sticky xl:top-4">
          <div className="border-b border-hairline/70 bg-brand-deep px-4 py-4 text-cream">
            <p className="flex items-center gap-1.5 text-[9px] font-semibold text-gold">
              <SlidersHorizontal className="size-3" aria-hidden />
              تنظیمات قالب
            </p>
            <p className="mt-1 text-[11px] font-extrabold">داده را همان‌طور که می‌خواهید ببینید</p>
          </div>
          <div className="space-y-4 p-4">
            <label className="space-y-1.5">
              <span className="flex items-center gap-1 text-[9.5px] font-semibold text-ink-soft">
                <Layers3 className="size-3 text-gold" aria-hidden />
                ماژول گزارش
              </span>
              <Select value={moduleKey} onValueChange={chooseModule}>
                <SelectTrigger className="h-9 rounded-lg text-[11px]">
                  <SelectValue placeholder="انتخاب ماژول" />
                </SelectTrigger>
                <SelectContent>
                  {(modules ?? []).map((row) => (
                    <SelectItem key={row.key} value={row.key}>
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="block text-[8px] text-ink-soft">
                فقط ماژول‌هایی که نقش شما مجاز است اینجا دیده می‌شوند.
              </span>
            </label>

            <div>
              <p className="flex items-center gap-1 text-[9.5px] font-semibold text-ink-soft">
                <Table2 className="size-3 text-gold" aria-hidden />
                ستون‌ها
                <span className="ms-auto text-[8px] font-normal">
                  {fields.length.toLocaleString("fa-IR")} انتخاب‌شده
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {availableFields.map((field) => {
                  const selected = fields.includes(field.key);
                  return (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() => toggleField(field.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[8.5px] transition",
                        selected
                          ? "border-brand/30 bg-brand-soft font-semibold text-brand"
                          : "border-hairline bg-white/60 text-ink-soft hover:border-brand/20",
                        field.sensitive && "border-dashed",
                      )}
                      title={field.sensitive ? "ستون مالی حساس" : undefined}
                    >
                      {selected ? (
                        <Check className="size-2.5" aria-hidden />
                      ) : (
                        <span className="size-2.5 rounded-[3px] border border-current/30" aria-hidden />
                      )}
                      {field.label}
                      {field.sensitive ? (
                        <span className="text-[7px] text-gold">حساس</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5">
                <span className="text-[9.5px] font-semibold text-ink-soft">گروه‌بندی</span>
                <Select
                  value={groupBy}
                  onValueChange={(value) => {
                    setGroupBy(value);
                    setActive(null);
                  }}
                >
                  <SelectTrigger className="h-9 rounded-lg text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون گروه‌بندی</SelectItem>
                    {groupOptions.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[9.5px] font-semibold text-ink-soft">ترتیب</span>
                <Select
                  value={sortKey}
                  onValueChange={(value) => {
                    setSortKey(value);
                    setActive(null);
                  }}
                >
                  <SelectTrigger className="h-9 rounded-lg text-[10px]">
                    <SelectValue placeholder="ستون" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFields
                      .filter((field) => fields.includes(field.key))
                      .map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          {field.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSortDirection("desc")}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-1.5 text-[8.5px] font-semibold transition",
                  sortDirection === "desc"
                    ? "border-brand bg-brand text-cream"
                    : "border-hairline bg-white/60 text-ink-soft",
                )}
              >
                نزولی
              </button>
              <button
                type="button"
                onClick={() => setSortDirection("asc")}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-1.5 text-[8.5px] font-semibold transition",
                  sortDirection === "asc"
                    ? "border-brand bg-brand text-cream"
                    : "border-hairline bg-white/60 text-ink-soft",
                )}
              >
                صعودی
              </button>
            </div>

            <div className="border-t border-hairline/60 pt-3">
              <p className="mb-2 text-[9px] font-extrabold text-ink">فیلترهای اجرا</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[8.5px] text-ink-soft">از تاریخ</span>
                  <Input
                    type="date"
                    value={fromInput}
                    onChange={(event) => {
                      setRangeTouched(true);
                      setFromInput(event.target.value);
                      setActive(null);
                    }}
                    className="h-8 rounded-lg text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[8.5px] text-ink-soft">تا تاریخ</span>
                  <Input
                    type="date"
                    value={toInput}
                    onChange={(event) => {
                      setRangeTouched(true);
                      setToInput(event.target.value);
                      setActive(null);
                    }}
                    className="h-8 rounded-lg text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[8.5px] text-ink-soft">شعبه</span>
                  <Select
                    value={branchId}
                    onValueChange={(value) => {
                      setBranchId(value);
                      setActive(null);
                    }}
                  >
                    <SelectTrigger className="h-8 rounded-lg text-[9px]">
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
                <label className="space-y-1">
                  <span className="text-[8.5px] text-ink-soft">دوره مالی</span>
                  <Select
                    value={fiscalYearId}
                    onValueChange={(value) => {
                      setFiscalYearId(value);
                      setActive(null);
                    }}
                  >
                    <SelectTrigger className="h-8 rounded-lg text-[9px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fiscalYears.map((year) => (
                        <SelectItem key={year._id} value={year._id}>
                          {year.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="mt-2 block space-y-1">
                <span className="flex items-center gap-1 text-[8.5px] text-ink-soft">
                  <Search className="size-2.5" aria-hidden />
                  جستجو در مقادیر
                </span>
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setActive(null);
                  }}
                  placeholder="نام، شرح، شماره…"
                  className="h-8 rounded-lg text-[10px]"
                />
              </label>
              <p className="mt-1 text-[7.5px] leading-5 text-ink-soft">
                بازه: {fromInput ? formatJalali(timestampFromDateInput(fromInput)) : "—"} تا{" "}
                {toInput ? formatJalali(timestampFromDateInput(toInput, true)) : "—"}
              </p>
            </div>

            <Button
              onClick={run}
              disabled={fields.length === 0}
              className="w-full rounded-xl bg-brand text-cream hover:bg-brand-deep"
            >
              {result === undefined && active ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              اجرای گزارش
              {changed ? (
                <span className="rounded bg-gold px-1.5 py-0.5 text-[7px] text-brand-deep">
                  تغییر اعمال‌نشده
                </span>
              ) : null}
            </Button>
          </div>
        </Panel>

        <div className="min-w-0 space-y-3">
          {active && result ? (
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex items-center gap-2 text-[9px] text-ink-soft">
                  <BarChart3 className="size-3.5 text-brand" aria-hidden />
                  {result.rowCount.toLocaleString("fa-IR")} ردیف ·{" "}
                  {formatJalali(result.generatedAt)} · {result.businessName}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select
                    value={orientation}
                    onValueChange={(value) =>
                      setOrientation(value as "portrait" | "landscape")
                    }
                  >
                    <SelectTrigger className="h-8 w-[105px] rounded-lg text-[9px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">A4 عمودی</SelectItem>
                      <SelectItem value="landscape">A4 افقی</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(marginMm)}
                    onValueChange={(value) => setMarginMm(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[90px] rounded-lg text-[9px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8">حاشیه ۸</SelectItem>
                      <SelectItem value="10">حاشیه ۱۰</SelectItem>
                      <SelectItem value="15">حاشیه ۱۵</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!sheetRef.current) return;
                      printReportElement(sheetRef.current, { orientation, marginMm });
                      void log("print", "success");
                    }}
                    className="h-8 rounded-lg px-2.5 text-[9px]"
                  >
                    <Printer className="size-3.5" aria-hidden />
                    چاپ
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void exportExcel()}
                    disabled={exporting !== null}
                    className="h-8 rounded-lg px-2.5 text-[9px]"
                  >
                    {exporting === "xlsx" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <FileSpreadsheet className="size-3.5" aria-hidden />
                    )}
                    Excel
                  </Button>
                  <Button
                    onClick={() => void exportPdf()}
                    disabled={exporting !== null}
                    className="h-8 rounded-lg bg-brand px-2.5 text-[9px] text-cream"
                  >
                    {exporting === "pdf" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Download className="size-3.5" aria-hidden />
                    )}
                    PDF
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}

          {active && result === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          ) : !active ? (
            <Panel className="flex min-h-[500px] items-center justify-center">
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title="قالب گزارش را بسازید"
                description="یک ماژول انتخاب کنید، ستون‌های موردنیاز را علامت بزنید و گزارش را اجرا کنید. فقط فیلدهای مجاز نقش شما در سرور پذیرفته می‌شوند."
                action={
                  <Button
                    onClick={run}
                    className="rounded-xl bg-brand text-cream hover:bg-brand-deep"
                  >
                    <Play className="size-4" aria-hidden />
                    اجرای اولین گزارش
                  </Button>
                }
              />
            </Panel>
          ) : sheet ? (
            <div className="overflow-x-auto pb-2">
              <ReportDocument report={sheet} sheetRef={sheetRef} />
            </div>
          ) : (
            <Panel>
              <EmptyState
                icon={<FileText className="size-5" />}
                title="داده‌ای با این فیلترها پیدا نشد"
                description="بازه تاریخ، شعبه یا عبارت جستجو را تغییر دهید و دوباره اجرا کنید."
              />
            </Panel>
          )}

          <Panel>
            <div className="flex items-start gap-2 p-3 text-[8.5px] leading-5 text-ink-soft">
              <GripVertical className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden />
              ستون‌های حساس فقط برای نقش‌های مجاز برگردانده می‌شوند؛ خروجی و
              اجرای گزارش در تاریخچه ثبت می‌شود. این گزارش از کسب‌وکار فعال{" "}
              <strong className="mx-0.5 font-semibold text-ink">
                {workspace?.business.name ?? "—"}
              </strong>{" "}
              ساخته می‌شود.
            </div>
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[8.5px] text-ink-soft">
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <Check className="size-3 text-brand" aria-hidden />
          اعتبارسنجی فیلد در سرور
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <FileSpreadsheet className="size-3" aria-hidden />
          خروجی XLSX
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <Printer className="size-3" aria-hidden />
          چاپ A4
        </span>
        {result ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft px-2.5 py-1 text-brand">
            جمع ستون‌ها: {formatNumber(result.rowCount)} ردیف
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomReportPage() {
  return (
    <CustomBoundary>
      <CustomReportContent />
    </CustomBoundary>
  );
}
