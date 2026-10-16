/**
 * A report to export: sections of key facts, tables and bar charts. The same document becomes an Excel workbook,
 * a PDF or a PowerPoint deck, so every section exports the same content in all three formats.
 */

export type ExportFormat = "xlsx" | "pdf" | "pptx";

/** How a column's numbers are shown: "pct" values are fractions (0.42 = 42%). */
export type ColumnFormat = "text" | "int" | "decimal" | "pct" | "usd";

export interface ExportColumn {
  header: string;
  format?: ColumnFormat;
  /** Relative width (characters in Excel). */
  width?: number;
}

export type Cell = string | number | null;

export interface ExportTable {
  name: string;
  columns: ExportColumn[];
  rows: Cell[][];
  note?: string;
}

export interface ExportChart {
  title: string;
  categories: string[];
  /** A series may fix its color (hex, no #) so an entity looks the same in every chart. */
  series: Array<{ name: string; values: number[]; color?: string }>;
  format?: ColumnFormat;
  /** Stack the series (e.g. cost per model per day); otherwise bars sit side by side. */
  stacked?: boolean;
  /** Bars along the x axis (time) instead of horizontal bars (rankings). */
  vertical?: boolean;
}

export interface ExportSection {
  title: string;
  subtitle?: string;
  facts?: Array<[string, string]>;
  charts?: ExportChart[];
  tables: ExportTable[];
}

export interface ExportDoc {
  title: string;
  subtitle: string;
  sections: ExportSection[];
}

export function formatCell(value: Cell, format: ColumnFormat = "text"): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "string") return value;
  switch (format) {
    case "int":
      return Math.round(value).toLocaleString("en-US");
    case "decimal":
      return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
    case "pct":
      return `${Math.round(value * 100)}%`;
    case "usd":
      return value < 0.01 && value > 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
    default:
      return String(value);
  }
}

/** A safe file name: "ChatGPT Mentions - Top beachfront hotel - 2026-10-16". */
export function fileBase(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
