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
import type { ReportPayload } from "@/convex/lib/reportTypes";
import { REPORT_BY_KEY } from "@/convex/lib/reportCatalog";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoDateValue, timestampFromDateInput } from "@/lib/accounting";
import { getErrorMessage } from "@/lib/errors";
import { formatJalali } from "@/lib/format";
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
  CalendarDays,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  LockKeyhole,
  Printer,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
} from "lucide-react";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

class ReportErrorBoundary extends Component<
  { children: ReactNode; title: string },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: getErrorMessage(error) };
  }
  componentDidCatch(error: unknown) {
    console.error("[Report]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <Panel className="mx-auto max-w-2xl">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-gold-soft text-[#8a6c2c]">
              <LockKeyhole className="size-5" aria-hidden />
            </span>
            <h2 className="text-sm font-extrabold text-ink">{this.props.title}</h2>
            <p className="max-w-md text-[11px] leading-6 text-ink-soft">
              {this.state.error}
            </p>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="outline" className="rounded-xl">
                <Link to="/dashboard/reports">بازگشت به مرکز گزارشات</Link>
              </Button>
              <Button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-xl bg-brand text-cream hover:bg-brand-deep"
              >
                تلاش دوباره
              </Button>
            </div>
          </div>
        </Panel>
      );
    }
    return this.props.children;
  }
}

function reportToSheet(report: ReportPayload): SheetReport {
  return {
    title: report.title,
    category: report.category,
    businessName: report.meta.businessName,
    legalName: report.meta.legalName,
    fiscalYear: report.meta.fiscalYear,
    branchName: report.meta.branchName,
    from: report.meta.from,
    to: report.meta.to,
    generatedAt: report.generatedAt,
    currency: report.meta.currency,
    summary: report.summary,
    sections: report.sections,
    chart: report.chart,
    evidence: report.evidence,
    note: report.note,
  };
}

function ReportRunContent() {
  const { reportKey = "" } = useParams();
  const [searchParams] = useSearchParams();
  const definition = REPORT_BY_KEY.get(reportKey);
  const {
    businessId,
    activeFiscalYear,
    fiscalYears,
    branches,
    currency,
    role,
  } = useWorkspace();
  const recordView = useMutation(api.reportCenter.recordView);
  const logExport = useMutation(api.reportCenter.logExport);
  const saveReport = useMutation(api.reportCenter.saveReport);
  const [rangeTouched, setRangeTouched] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [branchId, setBranchId] = useState(
    searchParams.get("branchId") ?? "all",
  );
  const [fiscalYearId, setFiscalYearId] = useState(
    searchParams.get("fiscalYearId") ?? "",
  );
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState(() => {
    const from = Number(searchParams.get("from"));
    const to = Number(searchParams.get("to"));
    return {
      from: Number.isFinite(from) && from > 0 ? from : undefined,
      to: Number.isFinite(to) && to > 0 ? to : undefined,
      branchId: searchParams.get("branchId") ?? "all",
      fiscalYearId: searchParams.get("fiscalYearId") ?? "",
      search: "",
    };
  });
  const [showSave, setShowSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState(definition?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "portrait",
  );
  const [marginMm, setMarginMm] = useState(10);
  const sheetRef = useRef<HTMLDivElement>(null);
  const lastViewKey = useRef<string | null>(null);

  useEffect(() => {
    if (!activeFiscalYear || rangeTouched) return;
    setFromInput(isoDateValue(activeFiscalYear.startAt));
    setToInput(isoDateValue(activeFiscalYear.endAt));
  }, [activeFiscalYear, rangeTouched]);

  useEffect(() => {
    if (!fiscalYearId && activeFiscalYear) {
      setFiscalYearId(activeFiscalYear._id);
    }
  }, [activeFiscalYear, fiscalYearId]);

  useEffect(() => {
    setSaveTitle(definition?.title ?? "");
  }, [definition?.title]);

  const resolvedFiscalYearId =
    (fiscalYears.find((year) => year._id === fiscalYearId)?._id ??
      activeFiscalYear?._id) as Id<"fiscalYears"> | undefined;
  const resolvedBranchId =
    branchId === "all"
      ? undefined
      : ((branches.find((branch) => branch._id === branchId)?._id) as
          | Id<"branches">
          | undefined);
  const appliedFrom = applied.from ?? activeFiscalYear?.startAt;
  const appliedTo = applied.to ?? activeFiscalYear?.endAt;
  const report = useQuery(
    api.analytics.run,
    businessId &&
      resolvedFiscalYearId &&
      appliedFrom &&
      appliedTo &&
      definition?.mode === "run"
      ? {
          businessId,
          reportKey,
          fiscalYearId: resolvedFiscalYearId,
          branchId: resolvedBranchId,
          from: appliedFrom,
          to: appliedTo,
          search: applied.search || undefined,
        }
      : "skip",
  );

  useEffect(() => {
    if (!report || !businessId) return;
    const key = `${report.key}:${report.meta.from}:${report.meta.to}:${report.meta.branchName ?? "all"}`;
    if (lastViewKey.current === key) return;
    lastViewKey.current = key;
    void recordView({
      businessId,
      reportKey: report.key,
      title: report.title,
      category: report.category,
      from: report.meta.from,
      to: report.meta.to,
      branchId: resolvedBranchId,
      fiscalYearId: resolvedFiscalYearId,
      filters: JSON.stringify({
        branchId: resolvedBranchId,
        fiscalYearId: resolvedFiscalYearId,
        search: applied.search || undefined,
      }),
      rowCount: report.meta.rowCount,
    }).catch((error) => {
      // A view-log failure must never hide a report the user is allowed to see.
      console.warn("[Report] view history was not recorded", error);
    });
  }, [
    report,
    businessId,
    recordView,
    resolvedBranchId,
    resolvedFiscalYearId,
    applied.search,
  ]);

  if (!definition) {
    return (
      <Panel>
        <EmptyState
          icon={<FileText className="size-5" />}
          title="گزارش پیدا نشد"
          description="این شناسه در کاتالوگ رسمی حساب ویرا وجود ندارد."
          action={
            <Button asChild className="rounded-xl bg-brand text-cream">
              <Link to="/dashboard/reports">مرکز گزارشات</Link>
            </Button>
          }
        />
      </Panel>
    );
  }
  if (definition.mode === "link") {
    return <Navigate to={definition.path ?? "/dashboard/reports"} replace />;
  }

  const sheet = report ? reportToSheet(report) : null;
  const filtersJson = JSON.stringify({
    from: appliedFrom,
    to: appliedTo,
    branchId: resolvedBranchId,
    fiscalYearId: resolvedFiscalYearId,
    search: applied.search || undefined,
  });

  const applyFilters = () => {
    const from = fromInput ? timestampFromDateInput(fromInput) : undefined;
    const to = toInput ? timestampFromDateInput(toInput, true) : undefined;
    if (
      from !== undefined &&
      to !== undefined &&
      (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
    ) {
      toast.error("بازه تاریخ معتبر نیست.");
      return;
    }
    setApplied({
      from: from !== undefined && Number.isFinite(from) ? from : undefined,
      to: to !== undefined && Number.isFinite(to) ? to : undefined,
      branchId,
      fiscalYearId: resolvedFiscalYearId ?? "",
      search,
    });
  };

  const recordExport = async (
    format: "xlsx" | "pdf" | "print",
    status: "success" | "failed",
    error?: string,
  ) => {
    if (!businessId || !report) return;
    try {
      await logExport({
        businessId,
        reportKey: report.key,
        title: report.title,
        format,
        rowCount: report.meta.rowCount,
        filters: filtersJson,
        status,
        error,
      });
    } catch (reason) {
      console.warn("[Report] export log was not recorded", reason);
    }
  };

  const exportExcel = async () => {
    if (!report || !sheet) return;
    setExporting("xlsx");
    try {
      await downloadReportXlsx(
        {
          title: sheet.title,
          category: sheet.category,
          businessName: sheet.businessName,
          fiscalYear: sheet.fiscalYear,
          from: sheet.from,
          to: sheet.to,
          generatedAt: sheet.generatedAt,
          currency: sheet.currency,
          summary: sheet.summary,
          sections: sheet.sections,
          note: sheet.note,
        },
        reportFilename(report.key, "xlsx").replace(/\.xlsx$/, ""),
      );
      toast.success("فایل Excel واقعی با چند شیت ساخته شد.");
      await recordExport("xlsx", "success");
    } catch (error) {
      toast.error(getErrorMessage(error));
      await recordExport("xlsx", "failed", getErrorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!report || !sheetRef.current) return;
    setExporting("pdf");
    try {
      await downloadReportElementPdf(
        sheetRef.current,
        reportFilename(report.key, "pdf").replace(/\.pdf$/, ""),
        { orientation },
      );
      toast.success("PDF فارسی با سربرگ، پابرگ و شماره صفحه ساخته شد.");
      await recordExport("pdf", "success");
    } catch (error) {
      toast.error(getErrorMessage(error));
      await recordExport("pdf", "failed", getErrorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const print = async () => {
    if (!sheetRef.current) return;
    printReportElement(sheetRef.current, { orientation, marginMm });
    await recordExport("print", "success");
  };

  const save = async () => {
    if (!businessId) return;
    if (saveTitle.trim().length < 2) {
      toast.error("عنوان گزارش باید حداقل ۲ نویسه باشد.");
      return;
    }
    setSaving(true);
    try {
      await saveReport({
        businessId,
        title: saveTitle.trim(),
        reportKey: reportKey,
        module: "builtin",
        config: filtersJson,
        pinned: true,
      });
      toast.success("قالب گزارش ذخیره شد.");
      setShowSave(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-soft">
        <Link to="/dashboard/reports" className="inline-flex items-center gap-1 hover:text-brand">
          <ArrowRight className="size-3" aria-hidden />
          مرکز گزارشات
        </Link>
        <span>/</span>
        <span className="font-semibold text-ink">{definition.title}</span>
      </div>

      <PageHeader
        eyebrow={`${definition.mode === "run" ? "گزارش رسمی" : "گزارش تخصصی"} · ${report?.category ?? "HESAB VIRA"}`}
        title={definition.title}
        description={definition.description}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setShowSave((value) => !value)}
              className="rounded-xl"
            >
              <Star className="size-4" aria-hidden />
              ذخیره گزارش
            </Button>
            <Button
              variant="outline"
              onClick={() => void print()}
              disabled={!report}
              className="rounded-xl"
            >
              <Printer className="size-4" aria-hidden />
              چاپ
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportExcel()}
              disabled={!report || exporting !== null}
              className="rounded-xl border-brand/25 text-brand hover:bg-brand-soft"
            >
              {exporting === "xlsx" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet className="size-4" aria-hidden />
              )}
              Excel
            </Button>
            <Button
              onClick={() => void exportPdf()}
              disabled={!report || exporting !== null}
              className="rounded-xl bg-brand text-cream hover:bg-brand-deep"
            >
              {exporting === "pdf" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              PDF
            </Button>
          </>
        }
      />

      {showSave ? (
        <Panel>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1.5">
              <span className="text-[10px] font-semibold text-ink-soft">
                عنوان قالب ذخیره‌شده
              </span>
              <Input
                value={saveTitle}
                onChange={(event) => setSaveTitle(event.target.value)}
                maxLength={100}
                placeholder="مثلاً سود و زیان ماهانه مدیریت"
                className="h-10 rounded-xl text-[12px]"
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSave(false)}
                className="h-10 rounded-xl"
              >
                انصراف
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving}
                className="h-10 rounded-xl bg-brand text-cream"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                ذخیره
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1.5">
            <span className="flex items-center gap-1 text-[9.5px] font-semibold text-ink-soft">
              <CalendarDays className="size-3 text-gold" aria-hidden />
              از تاریخ
            </span>
            <Input
              type="date"
              value={fromInput}
              onChange={(event) => {
                setRangeTouched(true);
                setFromInput(event.target.value);
              }}
              className="h-9 rounded-lg text-[11px]"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[9.5px] font-semibold text-ink-soft">تا تاریخ</span>
            <Input
              type="date"
              value={toInput}
              onChange={(event) => {
                setRangeTouched(true);
                setToInput(event.target.value);
              }}
              className="h-9 rounded-lg text-[11px]"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[9.5px] font-semibold text-ink-soft">شعبه</span>
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
            <span className="text-[9.5px] font-semibold text-ink-soft">دوره مالی</span>
            <Select
              value={resolvedFiscalYearId ?? ""}
              onValueChange={(value) => setFiscalYearId(value)}
            >
              <SelectTrigger className="h-9 rounded-lg text-[11px]">
                <SelectValue placeholder="دوره مالی" />
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
          <label className="space-y-1.5">
            <span className="flex items-center gap-1 text-[9.5px] font-semibold text-ink-soft">
              <Search className="size-3 text-gold" aria-hidden />
              جستجو در ردیف‌ها
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="شرح، شماره، نام…"
              className="h-9 rounded-lg text-[11px]"
            />
          </label>
          <div className="flex items-end">
            <Button
              onClick={applyFilters}
              disabled={!businessId}
              className="h-9 w-full rounded-lg bg-brand text-cream hover:bg-brand-deep"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              اعمال فیلتر
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 px-4 py-2.5 text-[8.5px] text-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-brand" aria-hidden />
            مجوز گزارش سمت سرور بررسی شد · نقش: {role ?? "—"}
          </span>
          <div className="flex items-center gap-2">
            <span>تنظیمات چاپ:</span>
            <Select
              value={orientation}
              onValueChange={(value) =>
                setOrientation(value as "portrait" | "landscape")
              }
            >
              <SelectTrigger className="h-7 w-[105px] rounded-md text-[9px]">
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
              <SelectTrigger className="h-7 w-[95px] rounded-md text-[9px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">حاشیه ۸</SelectItem>
                <SelectItem value="10">حاشیه ۱۰</SelectItem>
                <SelectItem value="15">حاشیه ۱۵</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Panel>

      {!businessId || !resolvedFiscalYearId ? (
        <Panel>
          <EmptyState
            icon={<FileText className="size-5" />}
            title="کسب‌وکار یا دوره مالی فعالی انتخاب نشده است"
            description="از نوار بالای فضای کاری یک کسب‌وکار و دوره مالی را انتخاب کنید."
          />
        </Panel>
      ) : report === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : !sheet ? (
        <Panel>
          <EmptyState
            icon={<FileText className="size-5" />}
            title="گزارشی برای این بازه وجود ندارد"
            description="فیلترها را تغییر دهید یا از دوره مالی دیگری استفاده کنید."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-ink-soft">
            <span>
              {report.meta.rowCount.toLocaleString("fa-IR")} ردیف · تهیه{" "}
              {formatJalali(report.generatedAt)} · واحد {currency}
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="size-3 text-brand" aria-hidden />
              {report.evidence.length.toLocaleString("fa-IR")} شاهد داده ثبت شد
            </span>
          </div>
          <div className="overflow-x-auto pb-2">
            <ReportDocument report={sheet} sheetRef={sheetRef} />
          </div>
          <Panel>
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-mist text-[#2d6470]">
                  <Sparkles className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-[10.5px] font-bold text-ink">
                    به تحلیل این گزارش نیاز دارید؟
                  </p>
                  <p className="mt-0.5 text-[9px] leading-5 text-ink-soft">
                    ویرا AI فقط با داده‌های همین کسب‌وکار و همراه با ارجاع به
                    گزارش‌ها پاسخ می‌دهد؛ هیچ سند مالی را خودکار تغییر نمی‌دهد.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="shrink-0 rounded-xl">
                <Link to="/dashboard/ai">پرسش از ویرا</Link>
              </Button>
            </div>
          </Panel>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[8.5px] text-ink-soft">
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <FileText className="size-3" aria-hidden />
          PDF با فونت فارسی
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <FileSpreadsheet className="size-3" aria-hidden />
          XLSX چندشیت
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white/60 px-2.5 py-1">
          <Printer className="size-3" aria-hidden />
          چاپ A4 با جهت و حاشیه
        </span>
      </div>
    </div>
  );
}

export default function ReportRunPage() {
  const { reportKey = "" } = useParams();
  return (
    <ReportErrorBoundary key={reportKey} title="اجرای این گزارش ممکن نیست">
      <ReportRunContent />
    </ReportErrorBoundary>
  );
}
