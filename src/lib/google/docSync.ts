import { parseDocument } from "htmlparser2";
import { isTag, isText, type ChildNode, type Element } from "domhandler";
import { suggestionsIn } from "./docReview";

/**
 * Writes an edited article back into its Google Doc as small, in-place edits, so the Doc keeps everything the
 * article can't express: its template styling (cell shading, fonts, colours, spacing), page setup, comments and
 * their anchors. It never replaces the Doc.
 *
 * How: the Doc and the article are both cut into text segments (a paragraph, heading, list item, table-cell
 * paragraph). Segments are paired up, the words that differ are edited with insertText / deleteContentRange
 * (new text inherits the neighbouring formatting), paragraphs the article added or removed are inserted or
 * deleted, and only then are headings and bold / italic / underline / link marks brought in line with the
 * article. Anything unchanged produces no request at all.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export type Kind = "title" | "p" | "li" | "h2" | "h3" | "h4" | "h5" | "h6";

export interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  link: string;
}
const PLAIN: Marks = { bold: false, italic: false, underline: false, link: "" };

export interface Segment {
  /** "body", or "t<table>.<row>.<col>" for the paragraphs of one table cell. */
  group: string;
  kind: Kind;
  text: string;
  /** One entry per UTF-16 unit of `text`. */
  marks: Marks[];
  /** Holds an image, smart chip or similar: compared and kept, never edited. */
  locked: boolean;
  // Doc side only (0 / false on the HTML side). Indexes are the Docs API's (UTF-16 units from the body start).
  start: number;
  /** Where the piece of the paragraph this segment came from begins and ends (its surrounding spaces included). */
  rawStart: number;
  rawEnd: number;
  paraStart: number;
  /** End of the paragraph, including its newline. */
  paraEnd: number;
  /** The only segment of its paragraph (no soft line breaks around it). */
  only: boolean;
  prevBreak: boolean;
  nextBreak: boolean;
  /** The paragraph can't be deleted whole: it ends its container or touches a table. */
  keepParagraph: boolean;
  style: string;
}

const KIND_OF_STYLE: Record<string, Kind> = { HEADING_1: "h2", HEADING_2: "h2", HEADING_3: "h3", HEADING_4: "h4", HEADING_5: "h5", HEADING_6: "h6" };
const STYLE_OF_KIND: Partial<Record<Kind, string>> = { p: "NORMAL_TEXT", h2: "HEADING_2", h3: "HEADING_3", h4: "HEADING_4", h5: "HEADING_5", h6: "HEADING_6" };
const WS = /\s/;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function segment(partial: Partial<Segment> & Pick<Segment, "group" | "kind" | "text" | "marks">): Segment {
  return { locked: false, start: 0, rawStart: 0, rawEnd: 0, paraStart: 0, paraEnd: 0, only: true, prevBreak: false, nextBreak: false, keepParagraph: false, style: "", ...partial };
}

// ---------------------------------------------------------------------------------------------------------------
// Doc -> segments (mirrors what docToHtml turns into article HTML, so an untouched Doc matches an untouched article)
// ---------------------------------------------------------------------------------------------------------------

function paragraphSegments(block: Json, group: string, kind: Kind, keepParagraph: boolean): Segment[] {
  const p = obj(block.paragraph);
  const paraStart = Number(block.startIndex ?? 0);
  const paraEnd = Number(block.endIndex ?? 0);
  const style = str(obj(p.paragraphStyle).namedStyleType) || "NORMAL_TEXT";
  let text = "";
  const marks: Marks[] = [];
  let locked = false;
  for (const el of arr(p.elements)) {
    if (el.textRun) {
      const run = obj(el.textRun);
      const s = str(run.content);
      const ts = obj(run.textStyle);
      const link = str(obj(ts.link).url);
      // A SUBTITLE paragraph reads back as italic, so compare it as italic.
      const m: Marks = { bold: ts.bold === true, italic: ts.italic === true || style === "SUBTITLE", underline: ts.underline === true && !link, link };
      for (let i = 0; i < s.length; i++) marks.push(m);
      text += s;
    } else if (el.inlineObjectElement) {
      text += "￼";
      marks.push(PLAIN);
      locked = true;
    } else if (el.richLink) {
      const props = obj(obj(el.richLink).richLinkProperties);
      const label = str(props.title) || str(props.uri);
      text += label;
      for (let i = 0; i < label.length; i++) marks.push({ ...PLAIN, link: str(props.uri) });
      locked = true;
    } else {
      // People, dates, footnote references, page breaks...: not part of the HTML, so the paragraph is left alone.
      locked = true;
    }
  }
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
    marks.pop();
  }
  const pieces: Array<{ from: number; to: number }> = [];
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\u000b") {
      pieces.push({ from, to: i });
      from = i + 1;
    }
  }
  const out: Segment[] = [];
  pieces.forEach((piece, n) => {
    let a = piece.from;
    let b = piece.to;
    while (a < b && WS.test(text[a])) a++;
    while (b > a && WS.test(text[b - 1])) b--;
    if (a === b) return;
    out.push(
      segment({
        group,
        kind: n === 0 || kind !== "title" ? kind : "p",
        text: text.slice(a, b),
        marks: marks.slice(a, b),
        locked,
        start: paraStart + a,
        rawStart: paraStart + piece.from,
        rawEnd: paraStart + piece.to,
        paraStart,
        paraEnd,
        only: pieces.length === 1,
        prevBreak: n > 0,
        nextBreak: n < pieces.length - 1,
        keepParagraph,
        style,
      })
    );
  });
  return out;
}

export function docSegments(doc: Json): Segment[] {
  const body = arr(obj(doc.body).content);
  const styleOf = (b: Json) => str(obj(obj(b.paragraph).paragraphStyle).namedStyleType) || "NORMAL_TEXT";
  const hasTitleStyle = body.some((b) => b.paragraph && styleOf(b) === "TITLE");
  let titleTaken = false;
  let tableIndex = -1;
  const out: Segment[] = [];
  body.forEach((block, i) => {
    if (block.paragraph) {
      const style = styleOf(block);
      const titleish = style === "TITLE" || (style === "HEADING_1" && !hasTitleStyle && !titleTaken);
      const kind: Kind = obj(block.paragraph).bullet ? "li" : titleish ? (titleTaken ? "h2" : "title") : KIND_OF_STYLE[style] ?? "p";
      const touchesTable = Boolean(body[i - 1]?.table || body[i + 1]?.table);
      const segs = paragraphSegments(block, "body", kind, i === body.length - 1 || touchesTable);
      if (segs.length && kind === "title") titleTaken = true;
      out.push(...segs);
    } else if (block.table) {
      tableIndex++;
      arr(obj(block.table).tableRows).forEach((row, r) =>
        arr(obj(row).tableCells).forEach((cell, c) => {
          const content = arr(obj(cell).content);
          content.forEach((cb, ci) => {
            if (cb.paragraph) out.push(...paragraphSegments(cb, `t${tableIndex}.${r}.${c}`, "p", ci === content.length - 1));
          });
        })
      );
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Article HTML -> segments
// ---------------------------------------------------------------------------------------------------------------

const HEADING: Record<string, Kind> = { h1: "h2", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6" };
const BLOCKS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "blockquote", "section", "article", "figure", "figcaption", "pre", "hr", "header", "footer"]);

class Buffer {
  text = "";
  marks: Marks[] = [];
  locked = false;
  push(s: string, m: Marks) {
    for (let i = 0; i < s.length; i++) {
      const space = WS.test(s[i]);
      // Whitespace collapses like it does in a browser.
      if (space && (this.text === "" || WS.test(this.text[this.text.length - 1]))) continue;
      this.text += space ? " " : s[i];
      this.marks.push(m);
    }
  }
  take(group: string, kind: Kind): Segment | null {
    let t = this.text;
    let m = this.marks;
    const locked = this.locked;
    this.text = "";
    this.marks = [];
    this.locked = false;
    if (t.endsWith(" ")) {
      t = t.slice(0, -1);
      m = m.slice(0, -1);
    }
    return t ? segment({ group, kind, text: t, marks: m, locked }) : null;
  }
}

export function htmlSegments(html: string, title: string): Segment[] {
  const out: Segment[] = [];
  if (title.trim()) out.push(segment({ group: "body", kind: "title", text: norm(title), marks: Array.from({ length: norm(title).length }, () => PLAIN) }));
  let tableCount = -1;

  const inline = (node: ChildNode, m: Marks, buf: Buffer, onBreak: () => void) => {
    if (isText(node)) return buf.push(node.data, m);
    if (!isTag(node)) return;
    let next = m;
    switch (node.name) {
      case "br":
        return onBreak();
      case "img":
        buf.push("￼", PLAIN);
        buf.locked = true;
        return;
      case "strong":
      case "b":
        next = { ...m, bold: true };
        break;
      case "em":
      case "i":
        next = { ...m, italic: true };
        break;
      case "u":
        next = { ...m, underline: true };
        break;
      case "a":
        next = { ...m, link: node.attribs.href ?? "" };
        break;
    }
    for (const c of node.children) inline(c, next, buf, onBreak);
  };

  const flowInto = (children: ChildNode[], group: string, kind: Kind) => {
    const buf = new Buffer();
    const flush = () => {
      const s = buf.take(group, kind);
      if (s) out.push(s);
    };
    for (const node of children) {
      if (isTag(node) && BLOCKS.has(node.name)) {
        flush();
        block(node, group, kind);
      } else inline(node, PLAIN, buf, flush);
    }
    flush();
  };

  const rowsOf = (table: Element): Element[] => {
    const rows: Element[] = [];
    for (const c of table.children) {
      if (!isTag(c)) continue;
      if (c.name === "tr") rows.push(c);
      else if (c.name === "thead" || c.name === "tbody" || c.name === "tfoot") rows.push(...c.children.filter((x): x is Element => isTag(x) && x.name === "tr"));
    }
    return rows;
  };

  const block = (el: Element, group: string, inherited: Kind) => {
    switch (el.name) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return flowInto(el.children, group, HEADING[el.name]);
      case "ul":
      case "ol":
        return el.children.forEach((c) => isTag(c) && block(c, group, "li"));
      case "li":
        return flowInto(el.children, group, "li");
      case "table": {
        tableCount++;
        const t = tableCount;
        rowsOf(el).forEach((tr, r) =>
          tr.children.filter((c): c is Element => isTag(c) && (c.name === "td" || c.name === "th")).forEach((cell, c) => flowInto(cell.children, `t${t}.${r}.${c}`, "p"))
        );
        return;
      }
      case "hr":
        return;
      default:
        // p, div, blockquote...: inside a list item the paragraph is the item.
        return flowInto(el.children, group, inherited === "li" ? "li" : "p");
    }
  };

  flowInto(parseDocument(html, { decodeEntities: true }).children, "body", "p");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------------------------------------------

const bigrams = (s: string): Set<string> => {
  const t = norm(s).toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  if (t.length === 1) set.add(t);
  return set;
};
const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
};

/** A segment edited a little still counts as the same segment from this similarity up. */
const MATCH_FROM = 0.5;

export interface Pair {
  doc: Segment;
  html: Segment;
  exact: boolean;
}

export interface Alignment {
  pairs: Pair[];
  /** Doc segments the article no longer has. */
  docOnly: Segment[];
  /** Article segments the Doc doesn't have, with the Doc segment to put them after (or before, when none precedes). */
  htmlOnly: Array<{ seg: Segment; after: Segment | null; before: Segment | null }>;
  /** Parts of the article that can't be placed in the Doc (new tables or cells). */
  unplaced: Segment[];
}

function alignSequence(doc: Segment[], html: Segment[]): { pairs: Pair[]; docOnly: Segment[]; htmlOnly: Segment[]; order: Array<{ side: "d" | "h"; seg: Segment }> } {
  const n = doc.length;
  const m = html.length;
  const dn = doc.map((s) => norm(s.text));
  const hn = html.map((s) => norm(s.text));
  const db = doc.map((s) => bigrams(s.text));
  const hb = html.map((s) => bigrams(s.text));
  // Whole numbers, so the traceback's equality checks are exact: identical = 2000, similar = 500..1000.
  const score = (i: number, j: number): number => {
    if (dn[i] === hn[j]) return 2000;
    const s = dice(db[i], hb[j]);
    return s >= MATCH_FROM ? Math.round(s * 1000) : 0;
  };
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(i, j);
      const best = Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      dp[i * W + j] = s > 0 ? Math.max(best, s + dp[(i + 1) * W + j + 1]) : best;
    }
  }
  const pairs: Pair[] = [];
  const docOnly: Segment[] = [];
  const htmlOnly: Segment[] = [];
  const order: Array<{ side: "d" | "h"; seg: Segment }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = score(i, j);
    if (s > 0 && dp[i * W + j] === s + dp[(i + 1) * W + j + 1]) {
      pairs.push({ doc: doc[i], html: html[j], exact: dn[i] === hn[j] });
      order.push({ side: "d", seg: doc[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
      docOnly.push(doc[i]);
      order.push({ side: "d", seg: doc[i] });
      i++;
    } else {
      htmlOnly.push(html[j]);
      order.push({ side: "h", seg: html[j] });
      j++;
    }
  }
  for (; i < n; i++) {
    docOnly.push(doc[i]);
    order.push({ side: "d", seg: doc[i] });
  }
  for (; j < m; j++) {
    htmlOnly.push(html[j]);
    order.push({ side: "h", seg: html[j] });
  }

  // A paragraph rewritten past recognition looks like "one removed, one added" side by side. Treat the segments
  // that sit between the same two matches as rewrites of each other, in order, so the old text is replaced
  // rather than deleted with nowhere to put the new.
  const matched = new Set(pairs.map((p) => p.doc));
  let gapDocs: Segment[] = [];
  let gapHtmls: Segment[] = [];
  const closeGap = () => {
    const k = Math.min(gapDocs.length, gapHtmls.length);
    for (let x = 0; x < k; x++) pairs.push({ doc: gapDocs[x], html: gapHtmls[x], exact: false });
    gapDocs = [];
    gapHtmls = [];
  };
  for (const ev of order) {
    if (ev.side === "d" && matched.has(ev.seg)) closeGap();
    else if (ev.side === "d") gapDocs.push(ev.seg);
    else gapHtmls.push(ev.seg);
  }
  closeGap();
  const pairedDocs = new Set(pairs.map((p) => p.doc));
  const pairedHtmls = new Set(pairs.map((p) => p.html));
  return { pairs, docOnly: docOnly.filter((x) => !pairedDocs.has(x)), htmlOnly: htmlOnly.filter((x) => !pairedHtmls.has(x)), order: order.filter((e) => (e.side === "d" ? true : !pairedHtmls.has(e.seg))) };
}

export function align(doc: Segment[], html: Segment[]): Alignment {
  const result: Alignment = { pairs: [], docOnly: [], htmlOnly: [], unplaced: [] };
  const docTitle = doc.find((s) => s.kind === "title");
  const htmlTitle = html.find((s) => s.kind === "title");
  if (docTitle && htmlTitle) result.pairs.push({ doc: docTitle, html: htmlTitle, exact: norm(docTitle.text) === norm(htmlTitle.text) });

  const groups = [...new Set([...doc.map((s) => s.group), ...html.map((s) => s.group)])];
  for (const group of groups) {
    const d = doc.filter((s) => s.group === group && s.kind !== "title");
    const h = html.filter((s) => s.group === group && s.kind !== "title");
    if (!h.length) {
      // Only the body is compared as a whole; a cell the article doesn't show is left as it is.
      if (group === "body") result.docOnly.push(...d.filter((s) => !s.locked));
      continue;
    }
    if (!d.length) {
      result.unplaced.push(...h);
      continue;
    }
    const a = alignSequence(d, h);
    result.pairs.push(...a.pairs);
    result.docOnly.push(...a.docOnly.filter((s) => !s.locked));
    // Anchor each new segment to the closest kept Doc segment before it (else after it).
    let prevKept: Segment | null = null;
    const kept = new Set(a.pairs.map((p) => p.doc));
    const pending: Segment[] = [];
    for (const step of a.order) {
      if (step.side === "d") {
        if (kept.has(step.seg)) {
          for (const seg of pending) result.htmlOnly.push({ seg, after: prevKept, before: step.seg });
          pending.length = 0;
          prevKept = step.seg;
        }
      } else pending.push(step.seg);
    }
    for (const seg of pending) result.htmlOnly.push({ seg, after: prevKept, before: null });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Text edits
// ---------------------------------------------------------------------------------------------------------------

interface Tok {
  s: string;
  i: number;
}
const tokenize = (text: string): Tok[] => [...text.matchAll(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)].map((m) => ({ s: m[0], i: m.index ?? 0 }));
const sameTok = (a: Tok, b: Tok) => (WS.test(a.s[0]) && WS.test(b.s[0])) || a.s === b.s;

interface Change {
  /** Offsets into the Doc segment's text. */
  from: number;
  to: number;
  /** Replacement text (empty = pure deletion; from === to = pure insertion). */
  text: string;
}

/** The words that differ between the Doc's text and the article's, as the fewest changes. Whitespace-only differences are ignored. */
export function diffText(docText: string, htmlText: string): Change[] {
  const a = tokenize(docText);
  const b = tokenize(htmlText);
  const n = a.length;
  const m = b.length;
  // Common head and tail first; the middle only needs the quadratic pass when it's small.
  let head = 0;
  while (head < n && head < m && sameTok(a[head], b[head])) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && sameTok(a[n - 1 - tail], b[m - 1 - tail])) tail++;
  const an = n - head - tail;
  const bn = m - head - tail;
  const matches: Array<[number, number]> = [];
  if (an > 0 && bn > 0 && an * bn <= 2_500_000) {
    const W = bn + 1;
    const dp = new Uint16Array((an + 1) * W);
    for (let i = an - 1; i >= 0; i--)
      for (let j = bn - 1; j >= 0; j--) dp[i * W + j] = sameTok(a[head + i], b[head + j]) ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0;
    let j = 0;
    while (i < an && j < bn) {
      if (sameTok(a[head + i], b[head + j])) {
        matches.push([head + i, head + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
      else j++;
    }
  }
  const anchors: Array<[number, number]> = [[-1, -1], ...Array.from({ length: head }, (_, k): [number, number] => [k, k]), ...matches, ...Array.from({ length: tail }, (_, k): [number, number] => [n - tail + k, m - tail + k]), [n, m]];
  const changes: Change[] = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [pa, pb] = anchors[k];
    const [na, nb] = anchors[k + 1];
    const aFrom = pa + 1;
    const aTo = na; // tokens aFrom..aTo-1 differ
    const bFrom = pb + 1;
    const bTo = nb;
    if (aFrom >= aTo && bFrom >= bTo) continue;
    const from = aFrom < aTo ? a[aFrom].i : aFrom < n ? a[aFrom].i : docText.length;
    const to = aFrom < aTo ? a[aTo - 1].i + a[aTo - 1].s.length : from;
    const text = bFrom < bTo ? htmlText.slice(b[bFrom].i, b[bTo - 1].i + b[bTo - 1].s.length) : "";
    changes.push({ from, to, text });
  }
  return changes;
}

interface Op {
  key: number;
  prio: number;
  requests: Json[];
}
const insertText = (index: number, text: string): Json => ({ insertText: { location: { index }, text } });
const deleteRange = (startIndex: number, endIndex: number): Json => ({ deleteContentRange: { range: { startIndex, endIndex } } });

export interface TextPlan {
  requests: Json[];
  edits: Array<{ before: string; after: string }>;
  added: string[];
  removed: string[];
  /** Why some parts of the article weren't written to the Doc. */
  skipped: string[];
  docSegments: number;
  matched: number;
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function textPlan(doc: Json, article: { title: string; html: string }): TextPlan {
  const d = docSegments(doc);
  const h = htmlSegments(article.html, article.title);
  const a = align(d, h);
  const ops: Op[] = [];
  const plan: TextPlan = { requests: [], edits: [], added: [], removed: [], skipped: [], docSegments: d.length, matched: a.pairs.length };
  let lockedSkipped = 0;

  for (const { doc: ds, html: hs, exact } of a.pairs) {
    if (exact) continue;
    if (ds.locked || hs.locked) {
      lockedSkipped++;
      continue;
    }
    const changes = diffText(ds.text, hs.text);
    if (!changes.length) continue;
    plan.edits.push({ before: short(ds.text), after: short(hs.text) });
    for (const c of changes) {
      const from = ds.start + c.from;
      const to = ds.start + c.to;
      if (from === to) ops.push({ key: from, prio: 1, requests: [insertText(from, c.text)] });
      else if (!c.text) ops.push({ key: to, prio: 2, requests: [deleteRange(from, to)] });
      // Insert at the end of the old words first so the new ones take their formatting, then remove the old ones.
      else ops.push({ key: to, prio: 1, requests: [insertText(to, c.text), deleteRange(from, to)] });
    }
  }

  // New segments, grouped by the place they go in.
  const placed = new Map<string, { index: number; texts: string[]; trailing: boolean }>();
  for (const { seg, after, before } of a.htmlOnly) {
    if (seg.locked) {
      plan.skipped.push("A paragraph with an image wasn't added to the Doc (images aren't synced).");
      continue;
    }
    // New text always goes in as ordinary paragraphs.
    let spot: { index: number; trailing: boolean };
    if (after) spot = { index: after.rawEnd, trailing: false };
    else if (before) spot = { index: before.only ? before.paraStart : before.rawStart, trailing: true };
    else {
      plan.skipped.push(`"${short(seg.text, 60)}" has no place in the Doc to go.`);
      continue;
    }
    const key = `${spot.index}:${spot.trailing}`;
    const slot = placed.get(key) ?? { ...spot, texts: [] };
    slot.texts.push(seg.text);
    placed.set(key, slot);
    plan.added.push(short(seg.text));
  }
  for (const slot of placed.values()) {
    const text = slot.trailing ? slot.texts.map((t) => `${t}\n`).join("") : slot.texts.map((t) => `\n${t}`).join("");
    ops.push({ key: slot.index, prio: 0, requests: [insertText(slot.index, text)] });
  }

  for (const seg of a.docOnly) {
    plan.removed.push(short(seg.text));
    if (seg.only && !seg.keepParagraph) ops.push({ key: seg.paraEnd, prio: 2, requests: [deleteRange(seg.paraStart, seg.paraEnd)] });
    else if (seg.nextBreak) ops.push({ key: seg.rawEnd + 1, prio: 2, requests: [deleteRange(seg.rawStart, seg.rawEnd + 1)] });
    else if (seg.prevBreak) ops.push({ key: seg.rawEnd, prio: 2, requests: [deleteRange(seg.rawStart - 1, seg.rawEnd)] });
    else ops.push({ key: seg.rawEnd, prio: 2, requests: [deleteRange(seg.rawStart, seg.rawEnd)] });
  }

  if (a.unplaced.length) plan.skipped.push(`${a.unplaced.length} paragraph(s) in tables the Doc doesn't have weren't added (table structure isn't synced).`);
  if (lockedSkipped) plan.skipped.push(`${lockedSkipped} paragraph(s) with images or smart chips were left as they are in the Doc.`);

  // Highest index first, so earlier edits don't shift the positions of later ones.
  ops.sort((x, y) => y.key - x.key || x.prio - y.prio);
  plan.requests = ops.flatMap((o) => o.requests);
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------
// Styles: headings and bold / italic / underline / links, once the text matches
// ---------------------------------------------------------------------------------------------------------------

export interface StylePlan {
  requests: Json[];
  headings: number;
  marks: number;
}

/** Links that survive the article's HTML cleaning; other kinds (tel:, bookmarks) are never removed from the Doc. */
const KEEPS_LINK = /^(https?:|mailto:)/i;

export function stylePlan(doc: Json, article: { title: string; html: string }): StylePlan {
  const a = align(docSegments(doc), htmlSegments(article.html, article.title));
  const plan: StylePlan = { requests: [], headings: 0, marks: 0 };
  const style = (startIndex: number, endIndex: number, textStyle: Json, fields: string): Json => ({ updateTextStyle: { range: { startIndex, endIndex }, textStyle, fields } });

  for (const { doc: ds, html: hs, exact } of a.pairs) {
    if (!exact || ds.locked || hs.locked) continue;
    if (ds.kind !== "title" && ds.only && ds.kind !== hs.kind && STYLE_OF_KIND[ds.kind] && STYLE_OF_KIND[hs.kind]) {
      plan.requests.push({ updateParagraphStyle: { range: { startIndex: ds.paraStart, endIndex: ds.paraEnd }, paragraphStyle: { namedStyleType: STYLE_OF_KIND[hs.kind] }, fields: "namedStyleType" } });
      plan.headings++;
    }
    if (ds.text !== hs.text) continue; // whitespace differs: offsets don't line up, leave the marks alone
    for (const prop of ["bold", "italic", "underline", "link"] as const) {
      let range: { from: number; to: number; value: boolean | string } | null = null;
      const close = () => {
        if (!range) return;
        const s = ds.start + range.from;
        const e = ds.start + range.to;
        plan.requests.push(prop === "link" ? style(s, e, range.value ? { link: { url: range.value } } : {}, "link") : style(s, e, { [prop]: range.value }, prop));
        plan.marks++;
        range = null;
      };
      for (let k = 0; k < ds.text.length; k++) {
        const dm = ds.marks[k];
        const hm = hs.marks[k];
        const want: boolean | string = hm[prop];
        let differs = dm[prop] !== hm[prop];
        if (prop === "underline" && (dm.link || hm.link)) differs = false;
        if (prop === "link" && differs && !hm.link && !KEEPS_LINK.test(dm.link)) differs = false;
        // Spaces never start or end a change; a change that continues past them covers them.
        if (WS.test(ds.text[k])) continue;
        if (!differs) {
          close();
          continue;
        }
        if (range && range.value !== want) close();
        range ??= { from: k, to: k, value: want };
        range.to = k + 1;
      }
      close();
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------
// The whole sync
// ---------------------------------------------------------------------------------------------------------------

export interface DocClient {
  get(): Promise<Json>;
  batchUpdate(requests: Json[], revisionId?: string): Promise<void>;
}

export interface SyncSummary {
  /** Nothing differs: no request was sent. */
  unchanged: boolean;
  edits: Array<{ before: string; after: string }>;
  added: string[];
  removed: string[];
  headings: number;
  marks: number;
  skipped: string[];
}

export class DocSyncError extends Error {
  constructor(
    message: string,
    readonly code: "suggestions" | "mismatch"
  ) {
    super(message);
  }
}

/** Applies (or, with dryRun, only plans) the article's changes to the Doc. */
export async function syncArticleToDoc(client: DocClient, article: { title: string; html: string }, options: { dryRun?: boolean } = {}): Promise<SyncSummary> {
  const doc = await client.get();
  const pending = suggestionsIn(doc).length;
  if (pending) {
    throw new DocSyncError(`The Doc has ${pending} pending suggested edit${pending === 1 ? "" : "s"}. Accept or reject them in Google Docs first (they would shift the text this update works on), then re-import.`, "suggestions");
  }
  const text = textPlan(doc, article);
  if (text.docSegments >= 6 && text.matched / text.docSegments < 0.3) {
    throw new DocSyncError("This article no longer lines up with the Doc (most paragraphs differ). Re-import the Doc first so the two start from the same text.", "mismatch");
  }
  const before = stylePlan(doc, article);
  const summary: SyncSummary = { unchanged: false, edits: text.edits, added: text.added, removed: text.removed, headings: before.headings, marks: before.marks, skipped: text.skipped };
  if (options.dryRun) {
    summary.unchanged = !text.requests.length && !before.requests.length;
    return summary;
  }
  let current = doc;
  if (text.requests.length) {
    await client.batchUpdate(text.requests, str(doc.revisionId) || undefined);
    current = await client.get();
  }
  const styles = stylePlan(current, article);
  if (styles.requests.length) await client.batchUpdate(styles.requests, str(current.revisionId) || undefined);
  summary.headings = styles.headings;
  summary.marks = styles.marks;
  summary.unchanged = !text.requests.length && !styles.requests.length;
  return summary;
}
