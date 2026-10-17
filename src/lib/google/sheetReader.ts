import ExcelJS from "exceljs";
import type { PlanField, SheetPreview } from "../articles/types";
import { PLAN_FIELDS } from "../articles/types";

/**
 * Reads a content plan from any spreadsheet layout: finds the tab that looks most like a content plan, the row
 * that holds its headers (titles, notes or blank rows above it are skipped), and guesses which column holds
 * each field. Everything guessed can be overridden (tab, header row, column per field) and saved per project.
 */

export interface Cell {
  text: string;
  link: string | null;
}

export interface TabMatrix {
  title: string;
  gid: number;
  matrix: Cell[][];
}

/** How many rows from the top are searched for the header row. */
const HEADER_SEARCH_ROWS = 25;

export const normHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Header names per field, in many agencies' wording (and Vietnamese). Matched against the normalised header
 * (lowercase, no accents or punctuation). Order matters: more specific fields claim their column first.
 */
const HEADER_HINTS: Array<[PlanField, RegExp]> = [
  ["secondaryKeywords", /(secondary|related|lsi|supporting|other|sub|phu).*(key ?words?|kws?|tu khoa|queries)/],
  ["metaTitle", /(meta|seo) title|title tag/],
  ["metaDescription", /(meta )?desc(ription)?|mo ta/],
  ["publishUrl", /(publish(ed)?|live|post|page|website|final|landing) ?(url|link|page)|^(url|link) (bai )?(dang|live|published)/],
  ["focusKeyword", /^(focus |main |primary |target |seed |head )?(key ?words?|kws?|keyphrase|query|search term|tu khoa)( chinh)?$/],
  ["slug", /slug|permalink|duong dan/],
  ["docUrl", /(doc|document|draft|content|article|bai viet|brief|writing|ban thao).*(link|url)|^(google )?docs?$|^(google )?document$|^draft$|^content$|^brief$|^outline$|^link( bai)?$|^ban thao$/],
  ["title", /(^|\b)(title|headline|h1|working title|tieu de|ten bai( viet)?|bai viet)$|^topic s title$/],
  ["categories", /categor|chuyen muc|danh muc|cluster|pillar|silo|^section$|^nhom$/],
  ["tags", /^tags?$|^the$/],
  ["dueDate", /due|deadline|han( chot| nop)?$|submit(ted)? (by|date)|ngay nop/],
  ["publishDate", /(publish|post|go ?live|schedule|release|launch)(ed|ing)?( date| day| month| on)?$|^(date|month|week|ngay( dang)?|thang|tuan|timeline)$/],
  ["writer", /writer|author|^pic$|person in charge|assignee|assigned( to)?|owner|copywriter|nguoi (viet|phu trach)|tac gia/],
  ["priority", /priorit|uu tien|importance/],
  ["action", /^action$|^task$|^type$|content type|new( or|\/)? (update|refresh|revamp)|hanh dong|loai bai/],
  ["status", /status|trang thai|tinh trang|stage|progress|tien do/],
];

/** Fields a header row of a content plan usually has; a tab scores by how many it matches. */
export function headerScore(cells: string[]): number {
  const seen = new Set<PlanField>();
  for (const raw of cells) {
    const h = normHeader(raw);
    if (!h || h.length > 40) continue;
    const hit = HEADER_HINTS.find(([, re]) => re.test(h));
    if (hit) seen.add(hit[0]);
    else if (h === "topic") seen.add("focusKeyword");
  }
  return seen.size;
}

/** The header row: the row near the top that matches the most field names (at least two filled cells). */
export function findHeaderRow(matrix: Cell[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, matrix.length); i++) {
    const cells = matrix[i].map((c) => c.text);
    if (cells.filter(Boolean).length < 2) continue;
    const score = headerScore(cells);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  return matrix.findIndex((r) => r.filter((c) => c.text).length >= 2);
}

/** The tab that looks most like a content plan: best header score, then a plan-like tab name, then most rows. */
export function pickTab(tabs: TabMatrix[]): TabMatrix | undefined {
  const nameBonus = (t: string) => (/content|plan|article|editorial|blog|bai viet|ke hoach/i.test(t) ? 1.5 : 0);
  return [...tabs]
    .map((t) => {
      const row = findHeaderRow(t.matrix);
      return { t, score: (row >= 0 ? headerScore(t.matrix[row].map((c) => c.text)) : 0) + nameBonus(t.title), rows: t.matrix.length };
    })
    .sort((a, b) => b.score - a.score || b.rows - a.rows)[0]?.t;
}

export function tabScore(tab: TabMatrix): number {
  const row = findHeaderRow(tab.matrix);
  return row >= 0 ? headerScore(tab.matrix[row].map((c) => c.text)) : 0;
}

const isDocLink = (s: string | null | undefined) => Boolean(s && /docs\.google\.com\/document\//.test(s));
const isWebLink = (s: string | null | undefined) => Boolean(s && /^https?:\/\//.test(s) && !/docs\.google\.com|drive\.google\.com/.test(s));

/** Guesses which column holds each field: header names first, then what the cells link to. */
export function detectMapping(headers: string[], rows: SheetPreview["rows"]): Record<PlanField, number> {
  const normalized = headers.map(normHeader);
  const used = new Set<number>();
  const mapping = Object.fromEntries(PLAN_FIELDS.map((f) => [f, -1])) as Record<PlanField, number>;
  for (const [field, re] of HEADER_HINTS) {
    if (mapping[field] >= 0) continue;
    const index = normalized.findIndex((h, i) => !used.has(i) && h.length <= 40 && re.test(h));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  // "Topic" is the keyword when the plan also has a title column, otherwise it's the title.
  const topic = normalized.findIndex((h, i) => !used.has(i) && h === "topic");
  if (topic >= 0) {
    if (mapping.focusKeyword < 0 && mapping.title >= 0) mapping.focusKeyword = topic;
    else if (mapping.title < 0) mapping.title = topic;
    else if (mapping.focusKeyword < 0) mapping.focusKeyword = topic;
  }
  // The Doc column is whichever column links to Google Docs most often, whatever its header says.
  const linkCount = (c: number, test: (s: string | null) => boolean) => rows.filter((r) => test(r.links[c] ?? r.cells[c] ?? null)).length;
  let bestDoc = -1;
  let bestDocCount = 0;
  let bestWeb = -1;
  let bestWebCount = 1;
  headers.forEach((_, c) => {
    const docs = linkCount(c, isDocLink);
    if (docs > bestDocCount) {
      bestDoc = c;
      bestDocCount = docs;
    }
    const web = linkCount(c, isWebLink);
    if (web > bestWebCount) {
      bestWeb = c;
      bestWebCount = web;
    }
  });
  if (bestDoc >= 0 && mapping.docUrl !== bestDoc) {
    for (const f of PLAN_FIELDS) if (mapping[f] === bestDoc && f !== "title") mapping[f] = -1;
    mapping.docUrl = bestDoc;
  }
  if (mapping.publishUrl < 0 && bestWeb >= 0 && !Object.values(mapping).includes(bestWeb)) mapping.publishUrl = bestWeb;
  // A column holding Doc links with the article title as its text can serve as both.
  if (mapping.title < 0 && mapping.docUrl >= 0) mapping.title = mapping.docUrl;
  return mapping;
}

/** Builds the preview of one tab: header row (detected or chosen), data rows with their links, guessed mapping. */
export function toPreview(
  spreadsheetId: string,
  title: string,
  tabs: SheetPreview["tabs"],
  tab: TabMatrix,
  via: SheetPreview["via"],
  headerRowOverride?: number
): SheetPreview {
  const matrix = tab.matrix;
  const detected = findHeaderRow(matrix);
  const headerIndex = headerRowOverride && headerRowOverride >= 1 && headerRowOverride <= matrix.length ? headerRowOverride - 1 : detected;
  if (headerIndex < 0) throw new Error(`Couldn't find a header row in "${tab.title}" (a row with at least two column names). Pick another tab.`);
  const width = Math.max(1, ...matrix.slice(headerIndex, headerIndex + 400).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, c) => matrix[headerIndex][c]?.text || `Column ${columnLetter(c)}`);
  const rows = matrix
    .slice(headerIndex + 1)
    .map((r, i) => ({
      rowNumber: headerIndex + 2 + i,
      cells: Array.from({ length: width }, (_, c) => r[c]?.text ?? ""),
      links: Array.from({ length: width }, (_, c) => r[c]?.link ?? (/^https?:\/\//.test(r[c]?.text ?? "") ? r[c].text : null)),
    }))
    // Rows with a single filled cell are section headings ("March", "Phase 2"), not articles.
    .filter((r) => r.cells.filter(Boolean).length >= 2 || r.links.some(Boolean));
  const topRows = matrix.slice(0, HEADER_SEARCH_ROWS).map((r, i) => ({
    rowNumber: i + 1,
    preview: r
      .map((c) => c.text)
      .filter(Boolean)
      .slice(0, 6)
      .join(" · ")
      .slice(0, 120),
  }));
  return { spreadsheetId, title, tabs, tab: tab.title, headerRow: headerIndex + 1, topRows, headers, rows, mapping: detectMapping(headers, rows), via };
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Text and link of an Excel cell (plain values, rich text, hyperlinks and HYPERLINK() formulas). */
function excelCell(cell: ExcelJS.Cell): Cell {
  const v = cell.value as unknown;
  let link: string | null = null;
  if (v && typeof v === "object") {
    const o = v as { hyperlink?: string; formula?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof o.hyperlink === "string") link = o.hyperlink;
    else if (typeof o.formula === "string") link = o.formula.match(/HYPERLINK\(\s*"([^"]+)"/i)?.[1] ?? null;
  }
  const hl = (cell as unknown as { hyperlink?: string }).hyperlink;
  if (!link && typeof hl === "string") link = hl;
  let text = "";
  try {
    text = cell.text ?? "";
  } catch {
    text = String(v ?? "");
  }
  return { text: String(text).replace(/\s+/g, " ").trim(), link: link && /^https?:\/\//.test(link) ? link : null };
}

/** All tabs of a workbook from its .xlsx export (works for "Anyone with the link" sheets, links included). */
export async function workbookFromXlsx(data: ArrayBuffer): Promise<{ title: string; tabs: TabMatrix[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const tabs: TabMatrix[] = [];
  wb.eachSheet((ws, id) => {
    if (ws.state === "hidden" || ws.state === "veryHidden") return;
    const matrix: Cell[][] = [];
    const maxRows = Math.min(ws.rowCount, 1500);
    const maxCols = Math.min(ws.columnCount, 60);
    for (let r = 1; r <= maxRows; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= maxCols; c++) cells.push(excelCell(row.getCell(c)));
      while (cells.length && !cells[cells.length - 1].text && !cells[cells.length - 1].link) cells.pop();
      matrix.push(cells);
    }
    while (matrix.length && matrix[matrix.length - 1].length === 0) matrix.pop();
    tabs.push({ title: ws.name, gid: id, matrix });
  });
  return { title: wb.title || "", tabs };
}
