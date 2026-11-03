import { isSeRankingMock, num, sePost } from "../seranking/client";

/** Step 3: country-level monthly volume, from SE Ranking's Keyword Research API or an uploaded keyword-tool export. */

export interface VolumeRow {
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  intents: string[];
}

export const volumeIsMock = () => isSeRankingMock();

/** One SE Ranking request per 1,000 keywords (100 credits each, up to 5,000 allowed). */
export async function seRankingVolumes(keywords: string[], country: string): Promise<Map<string, VolumeRow>> {
  const out = new Map<string, VolumeRow>();
  for (let i = 0; i < keywords.length; i += 1000) {
    const rows = await sePost<unknown>("keywords/export", { source: country.toLowerCase() }, { keywords: keywords.slice(i, i + 1000), sort: "volume", sort_order: "desc" });
    for (const r of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
      const kw = typeof r.keyword === "string" ? r.keyword.toLowerCase().trim() : "";
      if (!kw) continue;
      out.set(kw, {
        volume: r.is_data_found === false ? null : num(r.volume),
        kd: num(r.difficulty),
        cpc: num(r.cpc),
        intents: Array.isArray(r.intents) ? r.intents.map(String) : [],
      });
    }
  }
  return out;
}

const KW_COLS = ["keyword", "keywords", "query", "search term", "từ khóa"];
const VOL_COLS = ["volume", "search volume", "avg. monthly searches", "avg monthly searches", "monthly searches", "sv", "search_volume", "lượng tìm kiếm"];
const KD_COLS = ["kd", "keyword difficulty", "difficulty", "kd %", "kd%", "competition (indexed value)"];
const CPC_COLS = ["cpc", "cpc (usd)", "top of page bid (high range)", "cpc usd"];

/** "1,200", "2.5k", "$1.20", "45%", and Keyword Planner ranges like "1K – 10K" (midpoint). */
export function parseNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim().replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?(?:\s*[-–]\s*(\d+(?:\.\d+)?)\s*([kKmM])?)?$/);
  if (!m) return null;
  const val = (n: string, suf?: string) => parseFloat(n) * (suf && /k/i.test(suf) ? 1000 : suf && /m/i.test(suf) ? 1e6 : 1);
  const lo = val(m[1], m[2]);
  return m[3] ? (lo + val(m[3], m[4])) / 2 : lo;
}

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Any keyword-tool export with a keyword column and a volume column (CSV or TSV; Keyword Planner's title rows are skipped). */
export function parseVolumeCsv(text: string): Map<string, VolumeRow> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const isHeader = (l: string) => {
    const cells = l.split(/[\t,;]/).map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
    return cells.some((c) => KW_COLS.includes(c)) && cells.some((c) => VOL_COLS.includes(c));
  };
  const start = lines.slice(0, 10).findIndex(isHeader);
  const out = new Map<string, VolumeRow>();
  if (start < 0) return out;
  const head = lines[start];
  const delim = (head.match(/\t/g)?.length ?? 0) > 0 ? "\t" : (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cols = splitRow(head, delim).map((c) => c.toLowerCase());
  const idx = (names: string[]) => cols.findIndex((c) => names.includes(c));
  const [ki, vi, di, ci] = [idx(KW_COLS), idx(VOL_COLS), idx(KD_COLS), idx(CPC_COLS)];
  for (const line of lines.slice(start + 1)) {
    const cells = splitRow(line, delim);
    const kw = cells[ki]?.toLowerCase().trim();
    if (!kw) continue;
    out.set(kw, { volume: parseNumber(cells[vi]), kd: di >= 0 ? parseNumber(cells[di]) : null, cpc: ci >= 0 ? parseNumber(cells[ci]) : null, intents: [] });
  }
  return out;
}

/** Deterministic sample volumes when no SE Ranking key or file is available (flagged as sample in the UI). */
export function mockVolumes(keywords: string[]): Map<string, VolumeRow> {
  const out = new Map<string, VolumeRow>();
  for (const k of keywords) {
    let h = 0;
    for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const words = k.split(/\s+/).length;
    const volume = [0, 10, 30, 90, 260, 590, 1300, 2900][(h % 6) + (words <= 2 ? 2 : 0)];
    out.set(k.toLowerCase(), { volume, kd: h % 70, cpc: Math.round((h % 300) / 100 * 100) / 100, intents: [] });
  }
  return out;
}
