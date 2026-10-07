import sanitizeHtml from "sanitize-html";
import type { PlanField, SheetPreview } from "../articles/types";
import { docToHtml, type DocImage } from "./docs";
import { googleAccessToken } from "./oauth";
import { SAMPLE_DOCS, SAMPLE_SHEET } from "./sample";

/**
 * Reads content-plan Sheets and article Docs. Signed in with Google, it uses the Sheets/Docs APIs (private
 * files, links behind cells, inline images). Without sign-in it falls back to Google's public export links,
 * which only work for files shared as "Anyone with the link".
 */

export function sheetIdFrom(url: string): { id: string; gid?: number } | null {
  const id = url.match(/\/spreadsheets\/d\/([\w-]{20,})/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  return { id, gid: gid ? Number(gid) : undefined };
}

export function docIdFrom(url: string): string | null {
  return url.match(/\/document\/d\/([\w-]{20,})/)?.[1] ?? null;
}

const HEADER_HINTS: Record<PlanField, RegExp> = {
  title: /^(article |post |blog )?(title|headline|h1|topic|tieu de|ten bai)/,
  focusKeyword: /^(focus |main |primary |target )?(key ?word|kw|tu khoa)( chinh)?$/,
  docUrl: /(doc|document|draft|content|article|bai viet).*(link|url)|^(google )?docs?$|^link$|^url$/,
  slug: /slug|permalink/,
  metaTitle: /(meta|seo) title|title tag/,
  metaDescription: /(meta )?desc/,
  categories: /categor|chuyen muc|danh muc/,
  tags: /^tags?$|^the$/,
  publishDate: /(publish|post|go.?live|schedule|ngay).*(date|ngay)?|^date$/,
  secondaryKeywords: /(secondary|related|lsi|supporting|phu).*(key ?words?|kw|tu khoa)/,
  status: /status|trang thai/,
};

const normHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Guesses which column holds each field; secondary keywords are matched before the plain keyword column. */
export function detectMapping(headers: string[], rows: SheetPreview["rows"]): Record<PlanField, number> {
  const normalized = headers.map(normHeader);
  const used = new Set<number>();
  const mapping = {} as Record<PlanField, number>;
  const order: PlanField[] = ["secondaryKeywords", "metaTitle", "metaDescription", "focusKeyword", "slug", "docUrl", "title", "categories", "tags", "publishDate", "status"];
  for (const field of order) {
    const index = normalized.findIndex((h, i) => !used.has(i) && HEADER_HINTS[field].test(h));
    mapping[field] = index;
    if (index >= 0) used.add(index);
  }
  // The Doc column is whichever column links to Google Docs most often, whatever its header says.
  let best = -1;
  let bestCount = 0;
  headers.forEach((_, c) => {
    const count = rows.filter((r) => /docs\.google\.com\/document\//.test(r.links[c] ?? r.cells[c] ?? "")).length;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  });
  if (best >= 0) {
    if (mapping.title === best) mapping.title = -1;
    mapping.docUrl = best;
  }
  return mapping;
}

async function googleJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      throw new Error(`Google says ${data.error?.message ?? res.status} - check that the signed-in account can open this file.`);
    }
    throw new Error(data.error?.message ?? `Google API error ${res.status}`);
  }
  return data;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

export async function readSheet(url: string, tab?: string): Promise<SheetPreview> {
  if (url.trim() === "sample") return { ...SAMPLE_SHEET, mapping: detectMapping(SAMPLE_SHEET.headers, SAMPLE_SHEET.rows) };
  const ref = sheetIdFrom(url);
  if (!ref) throw new Error("That isn't a Google Sheets link (it should contain /spreadsheets/d/...)");
  const token = await googleAccessToken();
  if (!token) return readPublicSheet(ref.id, ref.gid);

  const meta = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?fields=properties.title,sheets.properties(sheetId,title,index)`,
    token
  );
  const tabs = arr(meta.sheets).map((s) => ({ title: String(obj(s.properties).title ?? ""), gid: Number(obj(s.properties).sheetId ?? 0) }));
  const chosen = tabs.find((t) => t.title === tab) ?? tabs.find((t) => t.gid === ref.gid) ?? tabs[0];
  if (!chosen) throw new Error("This spreadsheet has no tabs");
  const range = `'${chosen.title.replace(/'/g, "''")}'!A1:Z1000`;
  const grid = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(
      "sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns.format.link.uri,chipRuns.chip.richLinkProperties.uri)"
    )}`,
    token
  );
  const rowData = arr(obj(arr(obj(arr(grid.sheets)[0]).data)[0]).rowData);
  const matrix = rowData.map((row) =>
    arr(obj(row).values).map((cell) => {
      const c = obj(cell);
      const link =
        (typeof c.hyperlink === "string" ? c.hyperlink : null) ??
        arr(c.chipRuns).map((r) => String(obj(obj(obj(r).chip).richLinkProperties).uri ?? "")).find(Boolean) ??
        arr(c.textFormatRuns).map((r) => String(obj(obj(obj(r).format).link).uri ?? "")).find(Boolean) ??
        null;
      return { text: String(c.formattedValue ?? "").trim(), link };
    })
  );
  return toPreview(ref.id, String(obj(meta.properties).title ?? "Spreadsheet"), tabs, chosen.title, matrix, "google");
}

function toPreview(
  spreadsheetId: string,
  title: string,
  tabs: SheetPreview["tabs"],
  tab: string,
  matrix: Array<Array<{ text: string; link: string | null }>>,
  via: SheetPreview["via"]
): SheetPreview {
  const headerIndex = matrix.findIndex((r) => r.filter((c) => c.text).length >= 2);
  if (headerIndex < 0) throw new Error("Couldn't find a header row (a row with at least two column names)");
  const headers = matrix[headerIndex].map((c) => c.text);
  const width = Math.max(headers.length, ...matrix.map((r) => r.length));
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const rows = matrix
    .slice(headerIndex + 1)
    .map((r, i) => ({
      rowNumber: headerIndex + 2 + i,
      cells: Array.from({ length: width }, (_, c) => r[c]?.text ?? ""),
      links: Array.from({ length: width }, (_, c) => r[c]?.link ?? (/^https?:\/\//.test(r[c]?.text ?? "") ? r[c].text : null)),
    }))
    .filter((r) => r.cells.some(Boolean));
  return { spreadsheetId, title, tabs, tab, headers, rows, mapping: detectMapping(headers, rows), via };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

async function readPublicSheet(id: string, gid?: number): Promise<SheetPreview> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid !== undefined ? `&gid=${gid}` : ""}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("csv")) {
    throw new Error("Couldn't read this sheet. Sign in with Google, or share it as \"Anyone with the link can view\".");
  }
  const matrix = parseCsv(await res.text()).map((r) => r.map((text) => ({ text: text.trim(), link: null })));
  const tabTitle = gid !== undefined ? `Tab ${gid}` : "First tab";
  return toPreview(id, "Spreadsheet (public link)", [{ title: tabTitle, gid: gid ?? 0 }], tabTitle, matrix, "public");
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a", "img", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "code", "pre"],
  allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "title", "width", "height"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  transformTags: {
    h1: "h2",
    b: "strong",
    i: "em",
    // Google's public export wraps every link in a redirect; keep the real target.
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const real = href.match(/^https:\/\/www\.google\.com\/url\?q=([^&]+)/)?.[1];
      return { tagName, attribs: { ...attribs, href: real ? decodeURIComponent(real) : href } };
    },
  },
  exclusiveFilter: (frame) => ["p", "li", "h2", "h3", "h4", "strong", "em"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren.length,
};

/** Cleans imported or edited HTML down to article markup (no scripts, styles, classes or inline CSS). */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE).replace(/\n{3,}/g, "\n\n").trim();
}

export interface FetchedDoc {
  docId: string;
  title: string;
  html: string;
  images: DocImage[];
  via: "google" | "public" | "sample";
}

export async function readDoc(url: string): Promise<FetchedDoc> {
  const sample = url.match(/^sample:(\d+)$/);
  if (sample) {
    const doc = SAMPLE_DOCS[Number(sample[1])] ?? SAMPLE_DOCS[0];
    return { docId: `sample-${sample[1]}`, title: doc.title, html: cleanHtml(doc.html), images: [], via: "sample" };
  }
  const docId = docIdFrom(url);
  if (!docId) throw new Error("That isn't a Google Docs link (it should contain /document/d/...)");
  const token = await googleAccessToken();
  if (token) {
    const doc = await googleJson(`https://docs.googleapis.com/v1/documents/${docId}`, token);
    const converted = docToHtml(doc);
    return { docId, title: converted.title, html: cleanHtml(converted.html), images: converted.images, via: "google" };
  }
  const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=html`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
    throw new Error("Couldn't read this Doc. Sign in with Google, or share it as \"Anyone with the link can view\".");
  }
  const raw = await res.text();
  const title = (raw.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? raw;
  // The public export marks the Title paragraph with class "title"; use it and drop it from the body.
  const titleMatch = body.match(/<p[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const docTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
  const withoutTitle = titleMatch ? body.replace(titleMatch[0], "") : body;
  const html = cleanHtml(withoutTitle);
  const images = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi)].map((m) => ({ src: m[1].replace(/&amp;/g, "&"), alt: m[0].match(/alt="([^"]*)"/)?.[1] ?? "" }));
  return { docId, title: docTitle || title, html, images, via: "public" };
}
