import { parseDocument } from "htmlparser2";
import { render } from "dom-serializer";
import { isTag, isText, type ChildNode, type Element, type ParentNode } from "domhandler";
import { prepend, removeElement } from "domutils";

/**
 * Translates article HTML without touching its structure. The HTML is split into text segments (a paragraph,
 * heading, list item, table cell...); tags inside a segment become numbered placeholders (<x1>...</x1>, <x2/>),
 * so the model only sees text and can reorder phrases as the target language needs, while every tag and
 * attribute (links, classes, image sizes) is put back exactly as it was. alt and title texts are translated too.
 * A segment whose placeholders don't come back intact is retried, then left in the source language.
 */

/** Inline elements that stay inside a segment (as placeholders). */
const INLINE = new Set(["a", "strong", "b", "em", "i", "u", "s", "span", "sup", "sub", "mark", "small", "abbr", "cite", "q", "time", "del", "ins", "label", "font", "bdi", "bdo"]);
/** Inline elements kept whole (not translated inside): line breaks, images, code. */
const ATOMIC = new Set(["br", "img", "code", "kbd", "samp", "var", "wbr", "svg", "math", "input", "iframe", "video", "audio", "picture", "source"]);
/** Never translated. */
const SKIP = new Set(["script", "style", "pre", "template", "noscript"]);
const TRANSLATED_ATTRS = ["alt", "title", "aria-label", "placeholder"];

export interface Unit {
  /** html: a segment with placeholders; text: a plain string (attribute or article field). */
  kind: "html" | "text";
  source: string;
}

/** Translates a batch of units; must return one string per unit, in order. */
export type Translator = (units: Unit[]) => Promise<string[]>;

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const openTag = (el: Element) => `<${el.name}${Object.entries(el.attribs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`)).join("")}>`;

const hasBlockInside = (el: Element): boolean => el.children.some((c) => isTag(c) && (!INLINE.has(c.name) && !ATOMIC.has(c.name) ? true : hasBlockInside(c)));
const isInline = (n: ChildNode) => isText(n) || (isTag(n) && (ATOMIC.has(n.name) || (INLINE.has(n.name) && !hasBlockInside(n))));
const textOf = (n: ChildNode): string => (isText(n) ? n.data : isTag(n) && !ATOMIC.has(n.name) ? n.children.map(textOf).join("") : "");

interface Segment {
  nodes: ChildNode[];
  encoded: string;
  tokens: Map<number, Element>;
}

function encodeRun(nodes: ChildNode[]): Segment {
  const tokens = new Map<number, Element>();
  let n = 0;
  const enc = (node: ChildNode): string => {
    if (isText(node)) return escapeText(node.data);
    if (!isTag(node)) return "";
    const id = ++n;
    tokens.set(id, node);
    if (ATOMIC.has(node.name)) return `<x${id}/>`;
    return `<x${id}>${node.children.map(enc).join("")}</x${id}>`;
  };
  // Leading/trailing whitespace stays outside the translation.
  return { nodes, encoded: nodes.map(enc).join(""), tokens };
}

/** Collects the segments and translatable attributes of a document, in reading order. */
function collect(root: ParentNode, segments: Segment[], attrs: Array<{ el: Element; name: string }>) {
  let run: ChildNode[] = [];
  const flush = () => {
    if (run.some((n) => textOf(n).trim())) segments.push(encodeRun(run));
    run = [];
  };
  for (const child of [...root.children]) {
    if (isTag(child)) {
      for (const name of TRANSLATED_ATTRS) if (child.attribs[name]?.trim()) attrs.push({ el: child, name });
      // Attributes of atomic/inline descendants are picked up here too.
      if (isInline(child)) {
        const walk = (el: Element) => {
          for (const c of el.children) {
            if (!isTag(c)) continue;
            for (const name of TRANSLATED_ATTRS) if (c.attribs[name]?.trim()) attrs.push({ el: c, name });
            walk(c);
          }
        };
        if (!ATOMIC.has(child.name)) walk(child);
        run.push(child);
        continue;
      }
      flush();
      if (!SKIP.has(child.name)) collect(child, segments, attrs);
      continue;
    }
    if (isText(child)) run.push(child);
  }
  flush();
}

const TOKEN = /<(\/?)x(\d+)(\/?)>/g;

/** The translated segment as HTML, or null when its placeholders don't match the source's. */
export function decodeSegment(translated: string, tokens: Map<number, Element>): string | null {
  const seen: string[] = [];
  for (const m of translated.matchAll(TOKEN)) seen.push(`${m[1]}x${m[2]}${m[3]}`);
  const expected: string[] = [];
  for (const [id, el] of tokens) {
    if (ATOMIC.has(el.name)) expected.push(`x${id}/`);
    else expected.push(`x${id}`, `/x${id}`);
  }
  if (seen.length !== expected.length || [...seen].sort().join() !== [...expected].sort().join()) return null;
  // Closing tokens must follow their opening ones.
  for (const [id, el] of tokens) {
    if (ATOMIC.has(el.name)) continue;
    if (translated.indexOf(`<x${id}>`) > translated.indexOf(`</x${id}>`)) return null;
  }
  // Any stray "<" the model wrote as text is escaped, so the output can't gain markup.
  const safe = translated.replace(/<(?!\/?x\d+\/?>)/g, "&lt;");
  return safe.replace(TOKEN, (_, close: string, id: string) => {
    const el = tokens.get(Number(id))!;
    if (ATOMIC.has(el.name)) return render(el, { encodeEntities: "utf8" });
    return close ? `</${el.name}>` : openTag(el);
  });
}

export interface HtmlTranslation {
  html: string;
  /** Segments left in the source language because their markup didn't survive translation. */
  untranslated: number;
  segments: number;
}

/**
 * Translates article HTML plus extra plain-text fields (title, meta...) in one pass. `rewriteHref` can point
 * internal links at the translated site section.
 */
export async function translateHtml(
  html: string,
  fields: string[],
  translate: Translator,
  options: { batchChars?: number; concurrency?: number; rewriteHref?: (href: string) => string } = {}
): Promise<{ result: HtmlTranslation; fields: string[] }> {
  const doc = parseDocument(html, { decodeEntities: true });
  const segments: Segment[] = [];
  const attrs: Array<{ el: Element; name: string }> = [];
  collect(doc, segments, attrs);
  if (options.rewriteHref) {
    const walk = (node: ParentNode) => {
      for (const c of node.children) {
        if (!isTag(c)) continue;
        if (c.name === "a" && c.attribs.href) c.attribs.href = options.rewriteHref!(c.attribs.href);
        walk(c);
      }
    };
    walk(doc);
  }

  const units: Unit[] = [
    ...fields.map((f) => ({ kind: "text" as const, source: f })),
    ...attrs.map((a) => ({ kind: "text" as const, source: a.el.attribs[a.name] })),
    ...segments.map((s) => ({ kind: "html" as const, source: s.encoded })),
  ];
  const out = await translateUnits(units, translate, options.batchChars ?? 6000, options.concurrency ?? 3);

  const fieldOut = fields.map((f, i) => (f.trim() ? out[i] ?? f : f));
  attrs.forEach((a, i) => {
    const t = out[fields.length + i];
    if (t?.trim()) a.el.attribs[a.name] = t.replace(/[<>]/g, "");
  });
  let untranslated = 0;
  segments.forEach((s, i) => {
    const translated = out[fields.length + attrs.length + i];
    const decoded = translated ? decodeSegment(translated, s.tokens) : null;
    if (decoded === null) {
      untranslated++;
      return;
    }
    const lead = textOf(s.nodes[0]).match(/^\s*/)?.[0] ?? "";
    const trail = textOf(s.nodes[s.nodes.length - 1]).match(/\s*$/)?.[0] ?? "";
    const fresh = parseDocument(`${lead && isText(s.nodes[0]) ? " " : ""}${decoded.trim()}${trail && isText(s.nodes[s.nodes.length - 1]) ? " " : ""}`, { decodeEntities: true });
    for (const node of [...fresh.children]) prepend(s.nodes[0], node);
    for (const node of s.nodes) removeElement(node);
  });
  return { result: { html: render(doc, { encodeEntities: "utf8" }), untranslated, segments: segments.length }, fields: fieldOut };
}

/** Sends units in batches (by size), a few at a time; units the translator dropped are retried one by one. */
async function translateUnits(units: Unit[], translate: Translator, batchChars: number, concurrency: number): Promise<string[]> {
  const batches: number[][] = [];
  let current: number[] = [];
  let size = 0;
  units.forEach((u, i) => {
    if (!u.source.trim()) return;
    if (current.length && size + u.source.length > batchChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += u.source.length;
  });
  if (current.length) batches.push(current);

  const out: string[] = units.map((u) => (u.source.trim() ? "" : u.source));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const result = await translate(batch.map((i) => units[i]));
      batch.forEach((i, k) => (out[i] = result[k] ?? ""));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  // Segments whose placeholders came back broken get one more try on their own.
  const retry = units.map((u, i) => i).filter((i) => units[i].source.trim() && (!out[i] || (units[i].kind === "html" && !sameTokens(units[i].source, out[i]))));
  for (const i of retry.slice(0, 40)) {
    const [again] = await translate([units[i]]).catch(() => [""]);
    if (again) out[i] = again;
  }
  return out;
}

function sameTokens(a: string, b: string): boolean {
  const list = (s: string) => [...s.matchAll(TOKEN)].map((m) => m[0]).sort().join();
  return list(a) === list(b);
}
