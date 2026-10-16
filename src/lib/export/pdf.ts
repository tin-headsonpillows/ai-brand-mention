import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatCell, type ExportChart, type ExportDoc } from "./types";

/**
 * A landscape A4 report: title, then each section's facts, bar charts and tables. Noto Sans is embedded so
 * Vietnamese and other accented names print correctly (the standard PDF fonts only cover Western Latin).
 */

const PAGE = { w: 842, h: 595, margin: 40 };
const BLUE: [number, number, number] = [42, 120, 214];
const INK: [number, number, number] = [11, 11, 11];
const MUTED: [number, number, number] = [82, 81, 78];
const GRID: [number, number, number] = [225, 224, 217];
const SERIES: Array<[number, number, number]> = [
  [42, 120, 214],
  [235, 104, 52],
  [27, 175, 122],
  [237, 161, 0],
  [232, 123, 164],
  [0, 131, 0],
  [74, 58, 167],
];

let fontCache: Promise<{ regular: string; bold: string } | null> | null = null;

async function loadFonts(): Promise<{ regular: string; bold: string } | null> {
  const toBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  try {
    const [r, b] = await Promise.all(["/fonts/NotoSans-Regular.ttf", "/fonts/NotoSans-Bold.ttf"].map((u) => fetch(u).then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))));
    return { regular: toBase64(r), bold: toBase64(b) };
  } catch {
    return null;
  }
}

/** The PDF fonts can't draw a few symbols even with Noto; swap them for plain equivalents. */
const clean = (s: string) => s.replace(/≈/g, "~").replace(/[▲]/g, "+").replace(/[▼]/g, "-").replace(/[✓]/g, "yes");

function drawChart(pdf: jsPDF, chart: ExportChart, y: number, font: string): number {
  const horizontal = !chart.vertical;
  // Rankings show the top 15; time series show every period.
  const rows = chart.categories.slice(0, horizontal ? 15 : 60);
  const height = horizontal ? 24 + rows.length * 18 : 190;
  if (y + height > PAGE.h - PAGE.margin) {
    pdf.addPage();
    y = PAGE.margin;
  }
  pdf.setFont(font, "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...INK);
  pdf.text(clean(chart.title), PAGE.margin, y + 10);
  const series = chart.series.slice(0, SERIES.length);
  const rgb = (i: number): [number, number, number] => {
    const hex = series[i]?.color;
    return hex && /^[0-9a-f]{6}$/i.test(hex) ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] : SERIES[i];
  };
  // Legend for more than one series.
  if (series.length > 1) {
    let lx = PAGE.margin + pdf.getTextWidth(clean(chart.title)) + 16;
    pdf.setFont(font, "normal");
    pdf.setFontSize(8);
    for (const [i, s] of series.entries()) {
      pdf.setFillColor(...rgb(i));
      pdf.rect(lx, y + 4, 7, 7, "F");
      pdf.setTextColor(...MUTED);
      pdf.text(clean(s.name), lx + 10, y + 10);
      lx += pdf.getTextWidth(clean(s.name)) + 22;
    }
  }
  const total = (i: number) => (chart.stacked ? series.reduce((n, s) => n + (s.values[i] ?? 0), 0) : Math.max(...series.map((s) => s.values[i] ?? 0)));
  const max = Math.max(1e-9, ...rows.map((_, i) => total(i)));
  pdf.setFont(font, "normal");
  pdf.setFontSize(8);
  if (horizontal) {
    const labelW = 180;
    const barX = PAGE.margin + labelW;
    const barMax = PAGE.w - PAGE.margin - barX - 70;
    rows.forEach((cat, i) => {
      const ry = y + 22 + i * 18;
      pdf.setTextColor(...MUTED);
      pdf.text(clean(cat).slice(0, 38), PAGE.margin, ry + 9);
      let x = barX;
      const groupH = chart.stacked ? 10 : 10 / series.length;
      series.forEach((s, j) => {
        const w = ((s.values[i] ?? 0) / max) * barMax;
        pdf.setFillColor(...rgb(j));
        if (chart.stacked) {
          if (w > 0) pdf.rect(x, ry + 1, w, 10, "F");
          x += w;
        } else if (w > 0) pdf.rect(barX, ry + 1 + j * groupH, w, groupH, "F");
      });
      pdf.setTextColor(...INK);
      pdf.text(formatCell(total(i), chart.format), (chart.stacked ? x : barX + (total(i) / max) * barMax) + 6, ry + 9);
    });
  } else {
    const top = y + 22;
    const plotH = 140;
    const left = PAGE.margin + 50;
    const plotW = PAGE.w - PAGE.margin - left;
    pdf.setDrawColor(...GRID);
    for (let t = 0; t <= 4; t++) {
      const ty = top + plotH - (plotH * t) / 4;
      pdf.line(left, ty, left + plotW, ty);
      pdf.setTextColor(...MUTED);
      pdf.text(formatCell((max * t) / 4, chart.format), left - 6, ty + 3, { align: "right" });
    }
    const slot = plotW / rows.length;
    const barW = Math.max(2, Math.min(24, slot * 0.6));
    const every = Math.max(1, Math.ceil(rows.length / 12));
    rows.forEach((cat, i) => {
      let acc = 0;
      const cx = left + slot * i + slot / 2;
      series.forEach((s, j) => {
        const v = s.values[i] ?? 0;
        if (v <= 0) return;
        const h = (v / max) * plotH;
        pdf.setFillColor(...rgb(j));
        if (chart.stacked) {
          pdf.rect(cx - barW / 2, top + plotH - acc - h, barW, h, "F");
          acc += h;
        } else {
          const w = barW / series.length;
          pdf.rect(cx - barW / 2 + j * w, top + plotH - h, w, h, "F");
        }
      });
      if (i % every === 0) {
        pdf.setTextColor(...MUTED);
        pdf.text(clean(cat).slice(0, 10), cx, top + plotH + 11, { align: "center" });
      }
    });
  }
  return y + height + 14;
}

export async function toPdf(doc: ExportDoc): Promise<Blob> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  fontCache ??= loadFonts();
  const fonts = await fontCache;
  let font = "helvetica";
  if (fonts) {
    pdf.addFileToVFS("NotoSans-Regular.ttf", fonts.regular);
    pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    pdf.addFileToVFS("NotoSans-Bold.ttf", fonts.bold);
    pdf.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    font = "NotoSans";
  }
  pdf.setProperties({ title: doc.title, subject: doc.subtitle, creator: "AI Brand Mention Tracker" });

  pdf.setFillColor(...BLUE);
  pdf.rect(0, 0, PAGE.w, 6, "F");
  pdf.setFont(font, "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(...INK);
  pdf.text(clean(doc.title), PAGE.margin, 46);
  pdf.setFont(font, "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(...MUTED);
  pdf.text(pdf.splitTextToSize(clean(doc.subtitle), PAGE.w - 2 * PAGE.margin), PAGE.margin, 64);
  let y = 92;

  for (const [si, section] of doc.sections.entries()) {
    if (si > 0 && y > PAGE.h - 160) {
      pdf.addPage();
      y = PAGE.margin;
    }
    pdf.setFont(font, "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(...INK);
    pdf.text(clean(section.title), PAGE.margin, y);
    y += 6;
    if (section.subtitle) {
      pdf.setFont(font, "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...MUTED);
      const lines = pdf.splitTextToSize(clean(section.subtitle), PAGE.w - 2 * PAGE.margin);
      pdf.text(lines, PAGE.margin, y + 12);
      y += 12 * lines.length + 4;
    }
    if (section.facts?.length) {
      autoTable(pdf, {
        startY: y + 6,
        body: section.facts.map(([k, v]) => [clean(k), clean(v)]),
        theme: "plain",
        styles: { font, fontSize: 9, cellPadding: 3, textColor: INK },
        columnStyles: { 0: { cellWidth: 170, textColor: MUTED } },
        margin: { left: PAGE.margin, right: PAGE.margin },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    } else y += 12;
    for (const chart of section.charts ?? []) y = drawChart(pdf, chart, y, font);
    for (const table of section.tables) {
      if (y > PAGE.h - 100) {
        pdf.addPage();
        y = PAGE.margin;
      }
      if (section.tables.length > 1 || table.name !== section.title) {
        pdf.setFont(font, "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(...INK);
        pdf.text(clean(table.name), PAGE.margin, y + 4);
        y += 10;
      }
      autoTable(pdf, {
        startY: y,
        head: [table.columns.map((c) => clean(c.header))],
        body: table.rows.map((r) => r.map((v, i) => clean(formatCell(v, table.columns[i]?.format)))),
        styles: { font, fontSize: 8, cellPadding: 3, textColor: INK, lineColor: GRID, lineWidth: 0.5, overflow: "linebreak" },
        headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 249, 247] },
        columnStyles: Object.fromEntries(
          table.columns.map((c, i) => [i, { halign: c.format && c.format !== "text" ? "right" : "left", ...(c.width && c.width >= 50 ? { cellWidth: Math.min(380, c.width * 5) } : {}) }])
        ),
        margin: { left: PAGE.margin, right: PAGE.margin },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
      if (table.note) {
        pdf.setFont(font, "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(...MUTED);
        pdf.text(pdf.splitTextToSize(clean(table.note), PAGE.w - 2 * PAGE.margin), PAGE.margin, y - 4);
        y += 10;
      }
    }
    y += 10;
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont(font, "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(clean(doc.title), PAGE.margin, PAGE.h - 18);
    pdf.text(`${p} / ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 18, { align: "right" });
  }
  return pdf.output("blob");
}
