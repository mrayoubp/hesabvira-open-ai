import { snapdom } from "@zumer/snapdom";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { currencyUnit, formatJalali, formatNumber } from "./format";

export interface ExportableColumn {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "date" | "percent" | "doc";
}

export interface ExportableSection {
  key: string;
  title: string;
  columns: ExportableColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  note?: string;
}

export interface ExportableReport {
  title: string;
  category?: string;
  businessName: string;
  fiscalYear?: string;
  from?: number;
  to?: number;
  generatedAt: number;
  currency?: string;
  summary?: { label: string; value: string | number; kind: string }[];
  sections: ExportableSection[];
  note?: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeSheetName(value: string, used: Set<string>) {
  const base = value.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "گزارش";
  let name = base;
  let index = 2;
  while (used.has(name)) {
    name = `${base.slice(0, 25)} ${index}`;
    index += 1;
  }
  used.add(name);
  return name;
}

function cellValue(
  value: unknown,
  kind: ExportableColumn["kind"],
): string | number {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "date") {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? formatJalali(timestamp) : "";
  }
  if (kind === "money" || kind === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  if (kind === "percent") {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  return String(value);
}

export async function buildReportWorkbook(
  report: ExportableReport,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "حساب ویرا";
  workbook.lastModifiedBy = "حساب ویرا";
  workbook.created = new Date(report.generatedAt);
  const brand = "FF245C49";
  const brandDeep = "FF173D32";
  const cream = "FFE9E5D5";
  const gold = "FFC5A45B";
  const white = "FFFFFFFF";
  const line = "FFDCD8CB";
  const unit = currencyUnit(report.currency);
  const stamp = formatJalali(report.generatedAt);
  const period = report.from && report.to
    ? `${formatJalali(report.from)} تا ${formatJalali(report.to)}`
    : "—";

  const summarySheet = workbook.addWorksheet("خلاصه گزارش");
  summarySheet.views = [{ rightToLeft: true, showGridLines: false }];
  summarySheet.columns = [
    { width: 30 },
    { width: 48 },
    { width: 26 },
  ];
  summarySheet.mergeCells("A1:C1");
  const summaryTitle = summarySheet.getCell("A1");
  summaryTitle.value = report.title;
  summaryTitle.font = { name: "Tahoma", size: 16, bold: true, color: { argb: white } };
  summaryTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
  summaryTitle.alignment = { horizontal: "center", vertical: "middle" };
  summarySheet.getRow(1).height = 34;

  const meta: [string, string | number][] = [
    ["کسب‌وکار", report.businessName],
    ["دوره مالی", report.fiscalYear ?? "—"],
    ["بازه گزارش", period],
    ["تاریخ تهیه", stamp],
    ["دسته گزارش", report.category ?? "—"],
    ["واحد پول", unit],
  ];
  meta.forEach(([label, value], index) => {
    const row = summarySheet.getRow(index + 3);
    row.getCell(1).value = label;
    row.getCell(1).font = { name: "Tahoma", bold: true, color: { argb: brandDeep } };
    row.getCell(2).value = value;
    row.getCell(2).font = { name: "Tahoma", color: { argb: "FF26352E" } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cream } };
    row.height = 22;
    for (let column = 1; column <= 3; column += 1) {
      row.getCell(column).border = {
        top: { style: "hair", color: { argb: line } },
        bottom: { style: "hair", color: { argb: line } },
      };
    }
  });

  let summaryRow = 11;
  if (report.summary?.length) {
    summarySheet.getCell(`A${summaryRow}`).value = "شاخص";
    summarySheet.getCell(`B${summaryRow}`).value = "مقدار";
    for (const cell of [`A${summaryRow}`, `B${summaryRow}`]) {
      summarySheet.getCell(cell).font = { name: "Tahoma", bold: true, color: { argb: white } };
      summarySheet.getCell(cell).fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold } };
      summarySheet.getCell(cell).alignment = { horizontal: "center" };
    }
    summaryRow += 1;
    for (const item of report.summary) {
      summarySheet.getCell(`A${summaryRow}`).value = item.label;
      const valueCell = summarySheet.getCell(`B${summaryRow}`);
      valueCell.value =
        item.kind === "money"
          ? Number(item.value)
          : item.kind === "number" || item.kind === "percent"
            ? Number(item.value)
            : String(item.value);
      if (item.kind === "money") valueCell.numFmt = "#,##0";
      if (item.kind === "percent") valueCell.numFmt = '0.00"٪"';
      summarySheet.getCell(`A${summaryRow}`).font = { name: "Tahoma", color: { argb: "FF26352E" } };
      valueCell.font = { name: "Tahoma", color: { argb: brandDeep }, bold: true };
      summaryRow += 1;
    }
  }
  if (report.note) {
    summarySheet.mergeCells(`A${summaryRow + 1}:C${summaryRow + 1}`);
    const noteCell = summarySheet.getCell(`A${summaryRow + 1}`);
    noteCell.value = report.note;
    noteCell.font = { name: "Tahoma", size: 10, color: { argb: "FF66726A" } };
    noteCell.alignment = { wrapText: true, vertical: "top" };
    summarySheet.getRow(summaryRow + 1).height = 50;
  }

  const used = new Set<string>(["خلاصه گزارش"]);
  for (const section of report.sections) {
    const sheet = workbook.addWorksheet(safeSheetName(section.title, used));
    sheet.views = [{ rightToLeft: true, showGridLines: false }];
    const columnCount = Math.max(1, section.columns.length);
    sheet.mergeCells(1, 1, 1, columnCount);
    const title = sheet.getCell(1, 1);
    title.value = `${report.businessName} · ${section.title}`;
    title.font = { name: "Tahoma", size: 14, bold: true, color: { argb: white } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.mergeCells(2, 1, 2, columnCount);
    const info = sheet.getCell(2, 1);
    info.value = `${report.title} — ${period} — تهیه ${stamp}`;
    info.font = { name: "Tahoma", size: 9, color: { argb: "FF66726A" } };
    info.alignment = { horizontal: "center" };
    sheet.getRow(3).height = 8;

    const header = sheet.getRow(4);
    section.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.label;
      cell.font = { name: "Tahoma", bold: true, color: { argb: white }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brandDeep } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: line } },
        bottom: { style: "thin", color: { argb: line } },
        left: { style: "hair", color: { argb: line } },
        right: { style: "hair", color: { argb: line } },
      };
      const widths: Record<ExportableColumn["kind"], number> = {
        text: 26,
        doc: 18,
        date: 16,
        money: 18,
        number: 14,
        percent: 14,
      };
      sheet.getColumn(index + 1).width = widths[column.kind];
    });
    header.height = 30;

    section.rows.forEach((source, rowIndex) => {
      const row = sheet.getRow(5 + rowIndex);
      section.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        cell.value = cellValue(source[column.key], column.kind);
        cell.font = { name: "Tahoma", size: 9, color: { argb: "FF26352E" } };
        cell.alignment = {
          horizontal: column.kind === "text" || column.kind === "doc" ? "right" : "center",
          vertical: "middle",
          wrapText: column.kind === "text",
        };
        if (column.kind === "money") cell.numFmt = "#,##0";
        if (column.kind === "number") cell.numFmt = "#,##0.###";
        if (column.kind === "percent") cell.numFmt = '0.00"٪"';
        cell.border = {
          bottom: { style: "hair", color: { argb: line } },
          left: { style: "hair", color: { argb: line } },
          right: { style: "hair", color: { argb: line } },
        };
        if (rowIndex % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F6F0" } };
        }
      });
      row.height = 21;
    });

    const totalRow = sheet.getRow(5 + section.rows.length);
    section.columns.forEach((column, index) => {
      const cell = totalRow.getCell(index + 1);
      if (index === 0) cell.value = "جمع کل";
      else if (column.kind === "money" || column.kind === "number" || column.kind === "percent") {
        const value = Number(section.totals[column.key] ?? 0);
        cell.value = value;
        if (column.kind === "money") cell.numFmt = "#,##0";
        if (column.kind === "percent") cell.numFmt = '0.00"٪"';
      }
      cell.font = { name: "Tahoma", bold: true, color: { argb: brandDeep }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cream } };
      cell.alignment = { horizontal: index === 0 ? "right" : "center" };
      cell.border = {
        top: { style: "thin", color: { argb: gold } },
        bottom: { style: "thin", color: { argb: gold } },
      };
    });
    sheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: columnCount },
    };
    sheet.views = [{ rightToLeft: true, showGridLines: false, state: "frozen", ySplit: 4 }];
    if (section.note) {
      const noteRow = 5 + section.rows.length + 2;
      sheet.mergeCells(noteRow, 1, noteRow, columnCount);
      const note = sheet.getCell(noteRow, 1);
      note.value = section.note;
      note.font = { name: "Tahoma", size: 9, italic: true, color: { argb: "FF66726A" } };
      note.alignment = { wrapText: true, horizontal: "right" };
      sheet.getRow(noteRow).height = 30;
    }
  }

  return workbook;
}

export async function downloadReportXlsx(
  report: ExportableReport,
  filename: string,
) {
  const workbook = await buildReportWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, `${filename}.xlsx`);
}

async function capture(element: Element, background = "#ffffff") {
  return await snapdom.toCanvas(element, {
    scale: 2,
    backgroundColor: background,
    embedFonts: true,
    cache: "soft",
  });
}

function pdfCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.fillStyle = "#66726a";
  ctx.font = "500 18px Vazirmatn, sans-serif";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Downloads a real multi-page PDF. Persian text is rendered by the browser
 * (including shaping) and embedded as a high-resolution image per page; the
 * report header/footer are repeated on every page and page numbers are drawn
 * with the same Vazirmatn font.
 */
export async function downloadReportElementPdf(
  element: HTMLElement,
  filename: string,
  options: { orientation?: "portrait" | "landscape" } = {},
) {
  const orientation = options.orientation ?? "portrait";
  const header = element.querySelector<HTMLElement>("[data-pdf-header]");
  const content = element.querySelector<HTMLElement>("[data-pdf-content]");
  const footer = element.querySelector<HTMLElement>("[data-pdf-footer]");
  const [contentCanvas, headerCanvas, footerCanvas] = await Promise.all([
    capture(content ?? element),
    header ? capture(header) : Promise.resolve(null),
    footer ? capture(footer) : Promise.resolve(null),
  ]);
  if (!contentCanvas.width || !contentCanvas.height) {
    throw new Error("محتوای گزارش برای تبدیل به PDF در دسترس نیست.");
  }
  const pageWidthMm = orientation === "landscape" ? 297 : 210;
  const pageHeightMm = orientation === "landscape" ? 210 : 297;
  const marginMm = 9;
  const pageWidthPx = orientation === "landscape" ? 1754 : 1240;
  const pageHeightPx = Math.round((pageWidthPx * pageHeightMm) / pageWidthMm);
  const marginPx = Math.round((marginMm / pageWidthMm) * pageWidthPx);
  const contentWidthPx = pageWidthPx - marginPx * 2;
  const headerHeightPx = headerCanvas
    ? Math.round((headerCanvas.height / headerCanvas.width) * contentWidthPx)
    : 0;
  const footerHeightPx = footerCanvas
    ? Math.round((footerCanvas.height / footerCanvas.width) * contentWidthPx)
    : 0;
  const pageNumberHeight = 26;
  const availableHeightPx =
    pageHeightPx -
    marginPx * 2 -
    headerHeightPx -
    footerHeightPx -
    pageNumberHeight;
  const sourceSliceHeight = Math.max(
    60,
    Math.floor((availableHeightPx / contentWidthPx) * contentCanvas.width),
  );
  const pageCount = Math.max(1, Math.ceil(contentCanvas.height / sourceSliceHeight));
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });

  for (let page = 0; page < pageCount; page += 1) {
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = pageWidthPx;
    pageCanvas.height = pageHeightPx;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("مرورگر از خروجی PDF پشتیبانی نمی‌کند.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);
    let cursorY = marginPx;
    if (headerCanvas) {
      ctx.drawImage(headerCanvas, marginPx, cursorY, contentWidthPx, headerHeightPx);
      cursorY += headerHeightPx;
    }
    const sourceY = page * sourceSliceHeight;
    const sliceHeight = Math.min(
      sourceSliceHeight,
      contentCanvas.height - sourceY,
    );
    const drawHeight = (sliceHeight / contentCanvas.width) * contentWidthPx;
    ctx.drawImage(
      contentCanvas,
      0,
      sourceY,
      contentCanvas.width,
      sliceHeight,
      marginPx,
      cursorY,
      contentWidthPx,
      drawHeight,
    );
    cursorY += drawHeight;
    if (footerCanvas) {
      ctx.drawImage(
        footerCanvas,
        marginPx,
        pageHeightPx - marginPx - footerHeightPx,
        contentWidthPx,
        footerHeightPx,
      );
    }
    pdfCanvasText(
      ctx,
      `صفحه ${(page + 1).toLocaleString("fa-IR")} از ${pageCount.toLocaleString("fa-IR")}`,
      pageWidthPx / 2,
      pageHeightPx - marginPx - 5,
    );
    pdf.addImage(
      pageCanvas.toDataURL("image/jpeg", 0.94),
      "JPEG",
      0,
      0,
      pageWidthMm,
      pageHeightMm,
      `report-page-${page + 1}`,
      "FAST",
    );
    if (page < pageCount - 1) pdf.addPage();
  }
  pdf.save(`${filename}.pdf`);
}

export function printReportElement(
  element: HTMLElement,
  options: {
    orientation?: "portrait" | "landscape";
    marginMm?: number;
  } = {},
) {
  const orientation = options.orientation ?? "portrait";
  const margin = options.marginMm ?? 10;
  const style = document.createElement("style");
  style.id = "phase9-print-page-style";
  style.textContent = `@media print { @page { size: A4 ${orientation}; margin: ${margin}mm; } }`;
  document.head.appendChild(style);
  element.classList.add("print-sheet");
  const cleanup = () => {
    style.remove();
    element.classList.remove("print-sheet");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 60_000);
}

export function reportFilename(key: string, extension: "pdf" | "xlsx") {
  const stamp = new Date().toISOString().slice(0, 10);
  return `hesab-vira-${key}-${stamp}.${extension}`;
}

export function summaryValueText(value: string | number, kind: string, currency?: string) {
  if (kind === "money" && typeof value === "number") {
    return `${formatNumber(value)} ${currencyUnit(currency)}`;
  }
  if (kind === "percent" && typeof value === "number") {
    return `${formatNumber(value)}٪`;
  }
  if (typeof value === "number") return formatNumber(value);
  return value;
}
