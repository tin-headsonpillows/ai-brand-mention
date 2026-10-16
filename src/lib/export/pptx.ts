import PptxGenJS from "pptxgenjs";
import { formatCell, type ExportDoc } from "./types";

/**
 * A 16:9 deck: a title slide, then per section a summary slide (key facts), native (editable) bar charts and
 * tables split across slides. Long cell text is shortened so rows stay readable on a slide.
 */

const BLUE = "2A78D6";
const INK = "0B0B0B";
const MUTED = "52514E";
const PLANE = "F9F9F7";
const SERIES = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7"];
const FONT = "Calibri";
const ROWS_PER_SLIDE = 14;
const MAX_CELL = 260;

const short = (s: string, n = MAX_CELL) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function toPptx(doc: ExportDoc): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = doc.title;
  pptx.company = "AI Brand Mention Tracker";

  const header = (slide: PptxGenJS.Slide, title: string, sub?: string) => {
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.08, fill: { color: BLUE }, line: { color: BLUE } });
    slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.55, fontFace: FONT, fontSize: 22, bold: true, color: INK });
    if (sub) slide.addText(sub, { x: 0.5, y: 0.85, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
    slide.addText(doc.title, { x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED });
  };

  const cover = pptx.addSlide();
  cover.background = { color: PLANE };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BLUE }, line: { color: BLUE } });
  cover.addText(doc.title, { x: 0.8, y: 2.5, w: 11.5, h: 1, fontFace: FONT, fontSize: 36, bold: true, color: INK });
  cover.addText(doc.subtitle, { x: 0.8, y: 3.5, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 16, color: MUTED, valign: "top" });

  for (const section of doc.sections) {
    if (section.facts?.length) {
      const slide = pptx.addSlide();
      header(slide, section.title, section.subtitle);
      slide.addTable(
        section.facts.slice(0, 16).map(([k, v]) => [
          { text: k, options: { color: MUTED, fontSize: 13 } },
          { text: short(v, 200), options: { color: INK, fontSize: 13, bold: true } },
        ]),
        { x: 0.5, y: 1.45, w: 12.3, colW: [3.6, 8.7], fontFace: FONT, border: { type: "solid", pt: 0.5, color: "E1E0D9" }, rowH: 0.36, valign: "middle" }
      );
    }

    for (const chart of section.charts ?? []) {
      const slide = pptx.addSlide();
      header(slide, chart.title, section.facts?.length ? undefined : section.subtitle);
      const categories = chart.categories.slice(0, chart.vertical ? 60 : 15);
      const horizontal = !chart.vertical;
      const data = chart.series.slice(0, SERIES.length).map((s) => ({
        name: s.name,
        labels: horizontal ? [...categories].reverse() : categories,
        values: (horizontal ? [...s.values.slice(0, categories.length)].reverse() : s.values.slice(0, categories.length)).map((v) => (chart.format === "pct" ? Math.round(v * 1000) / 10 : v)),
      }));
      slide.addChart(pptx.ChartType.bar, data, {
        x: 0.5,
        y: 1.35,
        w: 12.3,
        h: 5.55,
        barDir: horizontal ? "bar" : "col",
        barGrouping: chart.stacked ? "stacked" : "clustered",
        chartColors: chart.series.slice(0, data.length).map((s, i) => s.color ?? SERIES[i]),
        showLegend: data.length > 1,
        legendPos: "t",
        legendFontFace: FONT,
        legendFontSize: 11,
        catAxisLabelFontFace: FONT,
        catAxisLabelFontSize: horizontal ? 11 : 9,
        catAxisLabelColor: MUTED,
        valAxisLabelFontFace: FONT,
        valAxisLabelFontSize: 10,
        valAxisLabelColor: MUTED,
        valAxisLabelFormatCode: chart.format === "pct" ? '0"%"' : chart.format === "usd" ? "$#,##0.00" : "#,##0",
        valGridLine: { color: "E1E0D9", size: 0.5 },
        catGridLine: { style: "none" },
        showValue: horizontal && data.length === 1,
        dataLabelFormatCode: chart.format === "pct" ? '0"%"' : chart.format === "usd" ? "$#,##0.00" : "#,##0",
        dataLabelFontSize: 10,
        dataLabelColor: INK,
        barGapWidthPct: 60,
      });
    }

    for (const table of section.tables) {
      // Tables with long text (e.g. full answers) get fewer rows per slide.
      const hasLongText = table.columns.some((c) => (c.width ?? 0) >= 50);
      const perSlide = hasLongText ? 6 : ROWS_PER_SLIDE;
      const count = Math.max(1, Math.ceil(table.rows.length / perSlide));
      for (let p = 0; p < count; p++) {
        const slide = pptx.addSlide();
        const name = table.name === section.title ? section.title : `${section.title}: ${table.name}`;
        header(slide, count > 1 ? `${name} (${p + 1}/${count})` : name, p === 0 ? (table.note ?? section.subtitle) : undefined);
        const rows = table.rows.slice(p * perSlide, (p + 1) * perSlide);
        const weights = table.columns.map((c) => c.width ?? (c.format && c.format !== "text" ? 12 : 26));
        const sum = weights.reduce((a, b) => a + b, 0);
        slide.addTable(
          [
            table.columns.map((c) => ({ text: c.header, options: { bold: true, color: "FFFFFF", fill: { color: BLUE }, align: c.format && c.format !== "text" ? "right" : "left" } })),
            ...rows.map((r, ri) =>
              r.map((v, i) => ({
                text: short(formatCell(v, table.columns[i]?.format)),
                options: { color: INK, fill: { color: ri % 2 ? PLANE : "FFFFFF" }, align: table.columns[i]?.format && table.columns[i]?.format !== "text" ? "right" : "left" },
              }))
            ),
          ] as PptxGenJS.TableRow[],
          {
            x: 0.5,
            y: 1.35,
            w: 12.3,
            colW: weights.map((w) => (w / sum) * 12.3),
            fontFace: FONT,
            fontSize: hasLongText ? 9 : 11,
            border: { type: "solid", pt: 0.5, color: "E1E0D9" },
            valign: "top",
            autoPage: false,
          }
        );
        if (!rows.length) slide.addText("No rows.", { x: 0.5, y: 2, w: 12, h: 0.5, fontFace: FONT, fontSize: 14, color: MUTED });
      }
    }
  }

  return (await pptx.write({ outputType: "blob" })) as Blob;
}
