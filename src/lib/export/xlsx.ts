import ExcelJS from "exceljs";
import type { ColumnFormat, ExportDoc } from "./types";

const NUM_FMT: Record<ColumnFormat, string | undefined> = {
  text: undefined,
  int: "#,##0",
  decimal: "#,##0.0",
  pct: "0%",
  usd: "$#,##0.0000",
};

/** One "Summary" sheet with the key facts, then one sheet per table (filters, frozen header, number formats). */
export async function toXlsx(doc: ExportDoc): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Brand Mention Tracker";
  wb.created = new Date();
  const used = new Set<string>();
  const sheetName = (raw: string) => {
    const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Sheet";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  };

  const summary = wb.addWorksheet(sheetName("Summary"));
  summary.columns = [{ width: 34 }, { width: 70 }];
  summary.addRow([doc.title]).font = { bold: true, size: 14 };
  summary.addRow([doc.subtitle]).font = { color: { argb: "FF52514E" } };
  for (const section of doc.sections) {
    if (!section.facts?.length && !section.subtitle) continue;
    summary.addRow([]);
    summary.addRow([section.title]).font = { bold: true, size: 12 };
    if (section.subtitle) summary.addRow([section.subtitle]).font = { italic: true, color: { argb: "FF52514E" } };
    for (const [k, v] of section.facts ?? []) {
      const row = summary.addRow([k, v]);
      row.getCell(1).font = { color: { argb: "FF52514E" } };
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
  }

  for (const section of doc.sections) {
    for (const table of section.tables) {
      const ws = wb.addWorksheet(sheetName(table.name));
      ws.addRow([section.title === table.name ? table.name : `${section.title} - ${table.name}`]).font = { bold: true, size: 12 };
      ws.addRow([table.note ?? section.subtitle ?? ""]).font = { italic: true, color: { argb: "FF52514E" } };
      const headerRow = ws.addRow(table.columns.map((c) => c.header));
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A78D6" } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      for (const r of table.rows) ws.addRow(r.map((v) => (v === null ? "" : v)));
      table.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = c.width ?? (c.format && c.format !== "text" ? 14 : 28);
        const fmt = NUM_FMT[c.format ?? "text"];
        if (fmt) col.numFmt = fmt;
        if (!c.format || c.format === "text") col.alignment = { wrapText: (c.width ?? 28) >= 50, vertical: "top" };
      });
      const headerIndex = headerRow.number;
      ws.views = [{ state: "frozen", ySplit: headerIndex }];
      if (table.rows.length) ws.autoFilter = { from: { row: headerIndex, column: 1 }, to: { row: headerIndex + table.rows.length, column: table.columns.length } };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
