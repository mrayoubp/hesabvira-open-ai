import { formatJalali, formatMoney, formatNumber, currencyUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExternalLink, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { Ref } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SheetColumn {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "date" | "percent" | "doc";
}

export interface SheetSection {
  key: string;
  title: string;
  columns: SheetColumn[];
  rows: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  totals: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  note?: string;
}

export interface SheetSummary {
  key: string;
  label: string;
  value: number | string;
  kind: "money" | "number" | "percent" | "text";
}

export interface SheetChart {
  title: string;
  type: "bar" | "line";
  xKey: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
}

export interface SheetReport {
  title: string;
  category?: string;
  businessName: string;
  legalName?: string;
  fiscalYear?: string;
  branchName?: string;
  from?: number;
  to?: number;
  generatedAt: number;
  currency?: string;
  summary?: SheetSummary[];
  sections: SheetSection[];
  chart?: SheetChart;
  evidence?: { label: string; detail?: string; reportKey?: string }[];
  note?: string;
}

const chartColors = ["#245C49", "#C5A45B", "#2d6470", "#a77d45", "#6b8a7a"];

function compactNumber(value: number) {
  return new Intl.NumberFormat("fa-IR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function CellValue({
  value,
  kind,
  currency,
  documentId,
}: {
  value: unknown;
  kind: SheetColumn["kind"];
  currency: string;
  documentId?: string;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-soft/60">—</span>;
  }
  if (kind === "money") {
    return (
      <span className="num whitespace-nowrap font-semibold tabular-nums">
        {formatNumber(Number(value))}
      </span>
    );
  }
  if (kind === "number") {
    return (
      <span className="num whitespace-nowrap tabular-nums">
        {formatNumber(Number(value))}
      </span>
    );
  }
  if (kind === "percent") {
    return (
      <span className="num whitespace-nowrap tabular-nums">
        {formatNumber(Number(value))}٪
      </span>
    );
  }
  if (kind === "date") {
    const timestamp = Number(value);
    return timestamp > 0 ? (
      <span className="num whitespace-nowrap">{formatJalali(timestamp)}</span>
    ) : (
      <span className="text-ink-soft/60">—</span>
    );
  }
  if (kind === "doc" && documentId) {
    return (
      <Link
        to={`/dashboard/accounting/documents/${documentId}`}
        className="inline-flex items-center gap-1 font-semibold text-brand-deep underline decoration-gold/60 underline-offset-2 hover:text-brand"
      >
        {String(value)}
        <ExternalLink className="size-3" aria-hidden />
      </Link>
    );
  }
  return <span>{String(value)}</span>;
}

export function ReportTable({
  section,
  currency,
  compact = false,
}: {
  section: SheetSection;
  currency: string;
  compact?: boolean;
}) {
  const totalKeys = section.columns.filter(
    (column) =>
      (column.kind === "money" || column.kind === "number" || column.kind === "percent") &&
      section.totals[column.key] !== undefined &&
      Number(section.totals[column.key]) !== 0,
  );
  return (
    <div className={cn("overflow-x-auto", compact ? "" : "rounded-2xl border border-[#e8e3d5]")}>
      <table className="w-full border-collapse text-right text-[10.5px] leading-5">
        <thead>
          <tr className="bg-[#173D32] text-white">
            {section.columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "whitespace-nowrap px-2.5 py-2 font-bold",
                  column.kind === "money" || column.kind === "number" || column.kind === "percent"
                    ? "text-center"
                    : "text-right",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.length === 0 ? (
            <tr>
              <td
                colSpan={section.columns.length}
                className="px-3 py-6 text-center text-ink-soft"
              >
                در این بازه داده‌ای برای نمایش وجود ندارد.
              </td>
            </tr>
          ) : (
            section.rows.map((row, index) => (
              <tr
                key={`${section.key}-${index}`}
                className={cn(
                  "border-b border-[#eee9dc]",
                  index % 2 === 1 ? "bg-[#faf9f4]" : "bg-white",
                )}
              >
                {section.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2.5 py-1.5 align-top",
                      column.kind === "money" ||
                        column.kind === "number" ||
                        column.kind === "percent"
                        ? "text-center"
                        : "text-right",
                    )}
                  >
                    <CellValue
                      value={row[column.key]}
                      kind={column.kind}
                      currency={currency}
                      documentId={row.documentId ? String(row.documentId) : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {section.rows.length > 0 && totalKeys.length > 0 ? (
          <tfoot>
            <tr className="bg-[#E9E5D5] text-[#173D32]">
              {section.columns.map((column, index) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-2.5 py-2 font-extrabold",
                    column.kind === "money" || column.kind === "number" || column.kind === "percent"
                      ? "num text-center tabular-nums"
                      : "text-right",
                  )}
                >
                  {index === 0
                    ? "جمع کل"
                    : totalKeys.some((item) => item.key === column.key)
                      ? column.kind === "percent"
                        ? `${formatNumber(Number(section.totals[column.key]))}٪`
                        : formatNumber(Number(section.totals[column.key]))
                      : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {section.note ? (
        <p className="border-t border-[#eee9dc] bg-[#fbfaf5] px-3 py-2 text-[9.5px] leading-5 text-[#66726a]">
          {section.note}
        </p>
      ) : null}
    </div>
  );
}

function SummaryValue({
  item,
  currency,
}: {
  item: SheetSummary;
  currency: string;
}) {
  if (item.kind === "money") {
    return (
      <span className="num text-[15px] font-black leading-tight text-[#173D32]">
        {formatMoney(Number(item.value), currency)}
      </span>
    );
  }
  if (item.kind === "percent") {
    return (
      <span className="num text-[15px] font-black leading-tight text-[#173D32]">
        {formatNumber(Number(item.value))}٪
      </span>
    );
  }
  if (item.kind === "number") {
    return (
      <span className="num text-[15px] font-black leading-tight text-[#173D32]">
        {formatNumber(Number(item.value))}
      </span>
    );
  }
  return (
    <span className="text-[13px] font-bold leading-6 text-[#173D32]">
      {String(item.value)}
    </span>
  );
}

function ReportChart({ chart, currency }: { chart: SheetChart; currency: string }) {
  return (
    <div className="rounded-2xl border border-[#e8e3d5] bg-white p-4" dir="ltr">
      <div className="mb-3 flex items-center justify-between" dir="rtl">
        <h3 className="text-[12px] font-extrabold text-[#26352E]">{chart.title}</h3>
        <span className="text-[8px] text-[#8a928c]">{currencyUnit(currency)}</span>
      </div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="#eee9dc" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 9, fontFamily: "Vazirmatn" }} tickLine={false} axisLine={{ stroke: "#dedacb" }} />
              <YAxis tickFormatter={(value) => compactNumber(Number(value))} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={{ direction: "rtl", fontFamily: "Vazirmatn", fontSize: 11, borderRadius: 12, borderColor: "#e8e3d5" }}
                formatter={(value: number) => formatNumber(Number(value))}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "Vazirmatn", direction: "rtl" }} />
              {chart.series.map((series, index) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={2.2}
                  dot={{ r: 2 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="#eee9dc" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 9, fontFamily: "Vazirmatn" }} tickLine={false} axisLine={{ stroke: "#dedacb" }} />
              <YAxis tickFormatter={(value) => compactNumber(Number(value))} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={{ direction: "rtl", fontFamily: "Vazirmatn", fontSize: 11, borderRadius: 12, borderColor: "#e8e3d5" }}
                formatter={(value: number) => formatNumber(Number(value))}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "Vazirmatn", direction: "rtl" }} />
              {chart.series.map((series, index) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label}
                  fill={chartColors[index % chartColors.length]}
                  radius={[5, 5, 0, 0]}
                  maxBarSize={42}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ReportDocument({
  report,
  sheetRef,
}: {
  report: SheetReport;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  const currency = report.currency ?? "IRT";
  return (
    <article
      ref={sheetRef}
      className="report-document print-sheet mx-auto w-full max-w-[1120px] overflow-hidden rounded-[24px] border border-[#e5e0d2] bg-white text-[#26352E] shadow-[0_26px_65px_-50px_rgba(23,61,50,0.65)]"
      dir="rtl"
    >
      <header
        data-pdf-header
        className="relative overflow-hidden bg-[#173D32] px-6 pb-5 pt-6 text-[#F7F6F0] sm:px-8"
      >
        <span className="pointer-events-none absolute -left-10 -top-16 size-52 rounded-full border border-[#c5a45b]/25" />
        <span className="pointer-events-none absolute -left-2 -top-6 size-28 rounded-full border border-[#c5a45b]/20" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[#c5a45b]/50 bg-[#245C49] text-[22px] font-black text-[#E9E5D5] shadow-lg">
              و
            </span>
            <div>
              <p className="text-[9px] font-bold tracking-[0.24em] text-[#c5a45b]">
                HESAB VIRA · گزارش رسمی
              </p>
              <h1 className="mt-1 text-[18px] font-black leading-7">{report.title}</h1>
              <p className="mt-0.5 text-[11px] text-[#d7dfd8]">
                {report.businessName}
                {report.legalName ? ` · ${report.legalName}` : ""}
              </p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 text-[9px] sm:min-w-[260px]">
            <div>
              <span className="block text-[#a9bcb1]">بازه گزارش</span>
              <strong className="mt-0.5 block font-semibold text-[#f7f6f0]">
                {report.from && report.to
                  ? `${formatJalali(report.from)} تا ${formatJalali(report.to)}`
                  : "—"}
              </strong>
            </div>
            <div>
              <span className="block text-[#a9bcb1]">دوره مالی</span>
              <strong className="mt-0.5 block font-semibold text-[#f7f6f0]">
                {report.fiscalYear ?? "—"}
              </strong>
            </div>
            <div>
              <span className="block text-[#a9bcb1]">شعبه</span>
              <strong className="mt-0.5 block font-semibold text-[#f7f6f0]">
                {report.branchName ?? "همه شعب"}
              </strong>
            </div>
            <div>
              <span className="block text-[#a9bcb1]">تاریخ تهیه</span>
              <strong className="mt-0.5 block font-semibold text-[#f7f6f0]">
                {formatJalali(report.generatedAt)}
              </strong>
            </div>
          </div>
        </div>
      </header>

      <div data-pdf-content className="bg-[#ffffff] px-5 py-5 sm:px-7">
        {report.summary?.length ? (
          <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {report.summary.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border border-[#ece7d9] bg-[#faf9f4] px-3 py-3"
              >
                <p className="text-[9px] font-semibold text-[#66726a]">{item.label}</p>
                <div className="mt-1.5">
                  <SummaryValue item={item} currency={currency} />
                </div>
                {item.kind === "money" ? (
                  <p className="mt-1 text-[8px] text-[#8c948e]">{currencyUnit(currency)}</p>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {report.chart && report.chart.data.length > 0 ? (
          <section className="mb-5">
            <ReportChart chart={report.chart} currency={currency} />
          </section>
        ) : null}

        <div className="space-y-5">
          {report.sections.map((section) => (
            <section key={section.key}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-[12px] font-black text-[#173D32]">
                  <span className="h-3.5 w-1 rounded-full bg-[#C5A45B]" aria-hidden />
                  {section.title}
                </h2>
                <span className="text-[8px] text-[#8c948e]">
                  {section.rows.length.toLocaleString("fa-IR")} ردیف
                </span>
              </div>
              <ReportTable section={section} currency={currency} />
            </section>
          ))}
        </div>

        {report.note ? (
          <div className="mt-5 rounded-2xl border border-[#eadfc4] bg-[#fbf6ea] px-4 py-3 text-[9.5px] leading-6 text-[#6f5c31]">
            <strong className="font-bold">یادداشت روش محاسبه: </strong>
            {report.note}
          </div>
        ) : null}

        {report.evidence?.length ? (
          <section className="mt-5 rounded-2xl border border-[#d9eaf2] bg-[#f2f8fa] px-4 py-3">
            <h3 className="flex items-center gap-1.5 text-[9.5px] font-extrabold text-[#2d6470]">
              <Sparkles className="size-3" aria-hidden />
              شواهد و منبع داده
            </h3>
            <ul className="mt-1.5 space-y-1 text-[8.5px] leading-5 text-[#4d6470]">
              {report.evidence.map((item, index) => (
                <li key={`${item.label}-${index}`} className="flex gap-1.5">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-[#2d6470]/60" aria-hidden />
                  <span>
                    <strong className="font-semibold">{item.label}: </strong>
                    {item.detail ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer
        data-pdf-footer
        className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e8e3d5] bg-[#f7f6f0] px-5 py-3 text-[8px] text-[#66726a] sm:px-7"
      >
        <span>
          حساب ویرا · سامانه مدیریت مالی و گزارش‌های مدیریتی
        </span>
        <span>
          {report.category ? `${report.category} · ` : ""}
          این گزارش از داده ثبت‌شده کسب‌وکار تولید شده است.
        </span>
      </footer>
    </article>
  );
}
