import sanitizeHtml from "sanitize-html";
import type { SheetPreview } from "../articles/types";
import { docToHtml, type DocImage } from "./docs";
import { googleAccessToken, googleConfigured } from "./oauth";
import { SAMPLE_DOCS, SAMPLE_WORKBOOK } from "./sample";
import { pickTab, tabScore, toPreview, workbookFromXlsx, type Cell, type TabMatrix } from "./sheetReader";

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

export { detectMapping } from "./sheetReader";

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

export interface ReadSheetOptions {
  /** Tab name; otherwise the tab in the link (gid), otherwise the most plan-like tab. */
  tab?: string;
  /** 1-based header row; otherwise detected. */
  headerRow?: number;
}

const gridCell = (cell: unknown): Cell => {
  const c = obj(cell);
  const link =
    (typeof c.hyperlink === "string" ? c.hyperlink : null) ??
    arr(c.chipRuns).map((r) => String(obj(obj(obj(r).chip).richLinkProperties).uri ?? "")).find(Boolean) ??
    arr(c.textFormatRuns).map((r) => String(obj(obj(obj(r).format).link).uri ?? "")).find(Boolean) ??
    null;
  return { text: String(c.formattedValue ?? "").replace(/\s+/g, " ").trim(), link };
};

export async function readSheet(url: string, options: ReadSheetOptions = {}): Promise<SheetPreview> {
  if (url.trim() === "sample") return readSampleWorkbook(options);
  const ref = sheetIdFrom(url);
  if (!ref) throw new Error("That isn't a Google Sheets link (it should contain /spreadsheets/d/...)");
  const token = await googleAccessToken();
  if (!token) return readPublicWorkbook(ref.id, ref.gid, options);

  const meta = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?fields=properties.title,sheets.properties(sheetId,title,index,hidden)`,
    token
  );
  const all = arr(meta.sheets)
    .map((s) => obj(s.properties))
    .filter((p) => p.hidden !== true)
    .map((p) => ({ title: String(p.title ?? ""), gid: Number(p.sheetId ?? 0) }));
  if (!all.length) throw new Error("This spreadsheet has no tabs");
  // Score every tab from its first rows (one request), to pick the content plan and show the others.
  const quote = (t: string) => `'${t.replace(/'/g, "''")}'`;
  const ranges = all.slice(0, 40).map((t) => `ranges=${encodeURIComponent(`${quote(t.title)}!A1:AZ25`)}`).join("&");
  const tops = await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${ref.id}/values:batchGet?${ranges}&majorDimension=ROWS`, token).catch(() => ({ valueRanges: [] }));
  const scored: TabMatrix[] = all.map((t, i) => ({
    ...t,
    matrix: arr(obj(arr((tops as Json).valueRanges)[i]).values as unknown).map((row) => (Array.isArray(row) ? row.map((v) => ({ text: String(v ?? "").trim(), link: null })) : [])),
  }));
  const chosen = all.find((t) => t.title === options.tab) ?? (options.tab ? undefined : all.find((t) => ref.gid !== undefined && t.gid === ref.gid)) ?? pickTab(scored) ?? all[0];
  const grid = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?ranges=${encodeURIComponent(`${quote(chosen.title)}!A1:AZ1500`)}&includeGridData=true&fields=${encodeURIComponent(
      "sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns.format.link.uri,chipRuns.chip.richLinkProperties.uri)"
    )}`,
    token
  );
  const rowData = arr(obj(arr(obj(arr(grid.sheets)[0]).data)[0]).rowData);
  const matrix = rowData.map((row) => arr(obj(row).values).map(gridCell));
  const tabs = scored.map((t) => ({ title: t.title, gid: t.gid, score: tabScore(t) }));
  return toPreview(ref.id, String(obj(meta.properties).title ?? "Spreadsheet"), tabs, { title: chosen.title, gid: chosen.gid, matrix }, "google", options.headerRow);
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

const PUBLIC_ERROR = 'Couldn\'t read this sheet. Sign in with Google, or share it as "Anyone with the link can view".';

/**
 * Without sign-in: the .xlsx export has every tab with the links behind cells. The tab in the link (gid) is
 * found by comparing its CSV export with each tab, since the export doesn't carry gids.
 */
async function readPublicWorkbook(id: string, gid: number | undefined, options: ReadSheetOptions): Promise<SheetPreview> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !/spreadsheetml|octet-stream|zip/.test(type)) return readPublicCsv(id, gid, options);
  const book = await workbookFromXlsx(await res.arrayBuffer());
  if (!book.tabs.length) throw new Error("This spreadsheet has no tabs");
  let chosen = book.tabs.find((t) => t.title === options.tab);
  if (!chosen && !options.tab && gid !== undefined) {
    const csv = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: "follow", signal: AbortSignal.timeout(20_000) })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    const sig = (rows: string[][]) => rows.slice(0, 8).map((r) => r.map((c) => c.trim()).filter(Boolean).join("|")).join("\n");
    const target = sig(parseCsv(csv));
    if (target) chosen = book.tabs.find((t) => sig(t.matrix.map((r) => r.map((c) => c.text))) === target);
  }
  chosen ??= pickTab(book.tabs) ?? book.tabs[0];
  const tabs = book.tabs.map((t) => ({ title: t.title, gid: t.gid, score: tabScore(t) }));
  return toPreview(id, book.title || "Spreadsheet (public link)", tabs, chosen, "public", options.headerRow);
}

/** Last resort: one tab as CSV (no tab list, no links). */
async function readPublicCsv(id: string, gid: number | undefined, options: ReadSheetOptions): Promise<SheetPreview> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid !== undefined ? `&gid=${gid}` : ""}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("csv")) throw new Error(PUBLIC_ERROR);
  const matrix = parseCsv(await res.text()).map((r) => r.map((text) => ({ text: text.trim(), link: null })));
  const title = gid !== undefined ? `Tab ${gid}` : "First tab";
  return toPreview(id, "Spreadsheet (public link)", [{ title, gid: gid ?? 0 }], { title, gid: gid ?? 0, matrix }, "public", options.headerRow);
}

function readSampleWorkbook(options: ReadSheetOptions): SheetPreview {
  const tabs = SAMPLE_WORKBOOK.tabs;
  const chosen = tabs.find((t) => t.title === options.tab) ?? pickTab(tabs) ?? tabs[0];
  return toPreview("sample", SAMPLE_WORKBOOK.title, tabs.map((t) => ({ title: t.title, gid: t.gid, score: tabScore(t) })), chosen, "sample", options.headerRow);
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a", "img", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "code", "pre"],
  allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "title", "width", "height", "class"] },
  // WordPress image classes: alignment, the chosen size, and the media id (lets WordPress add srcset).
  allowedClasses: { img: [/^align(none|left|center|right)$/, /^size-[\w-]+$/, /^wp-image-\d+$/] },
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
  /** When the Doc was last changed (Google API reads only), to tell later whether it changed since. */
  modifiedTime?: string;
}

export async function readDoc(url: string): Promise<FetchedDoc> {
  // Docs "created" for the sample plan: an empty brief to import.
  const created = url.match(/^sample:new:(.+)$/);
  if (created) {
    const title = decodeURIComponent(created[1]);
    return { docId: `sample-new`, title, html: cleanHtml("<h2>Brief</h2><p>(Sample Doc - nothing was created in Google Drive.)</p><h2>Outline</h2><p>H2: </p>"), images: [], via: "sample" };
  }
  const sample = url.match(/^sample:(\d+)$/);
  if (sample) {
    const doc = SAMPLE_DOCS[Number(sample[1])] ?? SAMPLE_DOCS[0];
    return { docId: `sample-${sample[1]}`, title: doc.title, html: cleanHtml(doc.html), images: [], via: "sample" };
  }
  const docId = docIdFrom(url);
  if (!docId) throw new Error("That isn't a Google Docs link (it should contain /document/d/...)");
  const token = await googleAccessToken();
  if (token) {
    // The Doc as it reads without pending suggestions (those are listed separately, for review).
    const [doc, meta] = await Promise.all([
      googleJson(`https://docs.googleapis.com/v1/documents/${docId}?suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS`, token),
      googleJson(`https://www.googleapis.com/drive/v3/files/${docId}?fields=modifiedTime&supportsAllDrives=true`, token).catch(() => ({}) as Record<string, unknown>),
    ]);
    const converted = docToHtml(doc);
    const modifiedTime = typeof meta.modifiedTime === "string" ? meta.modifiedTime : undefined;
    return { docId, title: converted.title, html: cleanHtml(converted.html), images: converted.images, via: "google", modifiedTime };
  }
  const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=html`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
    throw new Error(
      googleConfigured()
        ? "This Doc is private: sign in with Google (Articles → Settings) with an account that can open it, or share it as \"Anyone with the link can view\"."
        : "This Doc is private, and Google sign-in isn't set up on this server yet (see Articles → Settings → Google). Until then only Docs shared as \"Anyone with the link can view\" can be read."
    );
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
