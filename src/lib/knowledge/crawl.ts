import { parseDocument } from "htmlparser2";
import type { Element } from "domhandler";
import { getAttributeValue, getElementsByTagName, removeElement, textContent } from "domutils";
import type { PageSnap } from "./types";

/**
 * Light site crawler for the knowledge base: the homepage plus the pages most likely to describe what the business
 * sells (about, products, services, pricing, FAQ...), found from the homepage's links and the XML sitemap.
 */

const UA = "Mozilla/5.0 (compatible; AIBrandMentionTracker/1.0; knowledge-base research)";
const TIMEOUT_MS = 10_000;
const MAX_TEXT = 6000;

const GOOD: Record<string, number> = {
  about: 6, product: 6, products: 6, service: 6, services: 6, solution: 6, solutions: 6, feature: 5, features: 5,
  pricing: 5, price: 4, plans: 4, platform: 5, "how-it-works": 5, industries: 4, "use-cases": 4, customers: 3,
  "case-studies": 3, why: 3, compare: 4, faq: 4, faqs: 4, menu: 4, rooms: 5, suites: 4, accommodation: 5,
  dining: 3, spa: 3, experiences: 3, offers: 3, shop: 3, collections: 4, courses: 4, tours: 4, destinations: 3,
  locations: 3, company: 3, "who-we-are": 5, "what-we-do": 6, "our-story": 4,
  "gioi-thieu": 6, "san-pham": 6, "dich-vu": 6, "bang-gia": 5, "giai-phap": 6,
};
const BAD = /(login|signin|sign-in|signup|register|cart|checkout|account|privacy|terms|cookie|legal|careers|jobs|\/tag\/|\/author\/|\/page\/\d|wp-|feed|\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|xml)$|\?|mailto:|tel:|javascript:)/i;

export function normalizeDomain(input: string): string {
  const s = input.trim();
  try {
    return new URL(s.includes("//") ? s : `https://${s}`).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return s.toLowerCase().replace(/^www\./, "");
  }
}

async function get(url: string): Promise<{ status: number; url: string; type: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await res.text();
    return { status: res.status, url: res.url || url, type: res.headers.get("content-type") ?? "", text };
  } catch {
    return null;
  }
}

const KEEP_LD = ["@type", "name", "alternateName", "description", "brand", "category", "areaServed", "address", "priceRange", "offers", "sameAs", "slogan", "audience", "serviceType"];
const SKIP_LD = new Set(["BreadcrumbList", "WebSite", "SearchAction", "ImageObject", "WebPage", "ReadAction"]);

function cleanLd(value: unknown): Array<Record<string, unknown>> {
  const items: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { "@graph"?: unknown })["@graph"])
      ? ((value as { "@graph": unknown[] })["@graph"])
      : [value];
  const out: Array<Record<string, unknown>> = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;
    const type = rec["@type"];
    if (typeof type === "string" && SKIP_LD.has(type)) continue;
    const kept = Object.fromEntries(KEEP_LD.filter((k) => k in rec).map((k) => [k, rec[k]]));
    if (Object.keys(kept).length > 1) out.push(kept);
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Parses one HTML page into the fields the knowledge base uses, plus the page's links. */
export function parsePage(url: string, html: string, status = 200): { page: PageSnap; links: string[] } {
  const doc = parseDocument(html, { decodeEntities: true });
  const all = (tag: string) => getElementsByTagName(tag, doc.children, true);
  const meta = (attr: string, value: string) =>
    all("meta").find((m) => (getAttributeValue(m, attr) ?? "").toLowerCase() === value)?.attribs.content?.trim() ?? "";
  const htmlTag = all("html")[0];
  const jsonLd: Array<Record<string, unknown>> = [];
  for (const s of all("script")) {
    if ((getAttributeValue(s, "type") ?? "").toLowerCase() !== "application/ld+json") continue;
    try {
      jsonLd.push(...cleanLd(JSON.parse(textContent(s))));
    } catch {
      // malformed JSON-LD is ignored, like search engines do
    }
  }
  const links = all("a").map((a) => getAttributeValue(a, "href") ?? "").filter(Boolean);
  for (const tag of ["script", "style", "noscript", "svg", "iframe", "form", "template"]) for (const el of all(tag)) removeElement(el);
  const h1 = all("h1").map((h) => squash(textContent(h))).filter(Boolean).slice(0, 5);
  const headings = [...new Set([...all("h2"), ...all("h3")].map((h) => squash(textContent(h))).filter(Boolean))].slice(0, 40);
  const body: Element | undefined = all("main")[0] ?? all("article")[0] ?? all("body")[0];
  const scope = body ? [body] : doc.children;
  for (const tag of ["nav", "footer", "header", "aside"]) for (const el of getElementsByTagName(tag, scope, true)) removeElement(el);
  return {
    page: {
      url,
      status,
      title: squash(all("title")[0] ? textContent(all("title")[0]) : "").slice(0, 300),
      description: (meta("name", "description") || meta("property", "og:description")).slice(0, 500),
      h1,
      headings,
      text: squash(textContent(scope)).slice(0, MAX_TEXT),
      jsonLd,
      lang: (htmlTag && getAttributeValue(htmlTag, "lang")) || "",
    },
    links,
  };
}

async function sitemapUrls(base: string, robotsTxt: string | null, limit = 2000): Promise<string[]> {
  const queue = [...(robotsTxt?.match(/^\s*sitemap:\s*(\S+)/gim) ?? []).map((l) => l.replace(/^\s*sitemap:\s*/i, "")),
    new URL("/sitemap.xml", base).href, new URL("/sitemap_index.xml", base).href];
  const seen = new Set<string>();
  const found: string[] = [];
  while (queue.length && found.length < limit && seen.size < 6) {
    const sm = queue.shift() as string;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await get(sm);
    if (!r || r.status >= 400 || !r.text.trimStart().startsWith("<")) continue;
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(r.text)) queue.push(...locs.sort((a, b) => Number(!/page|product|service|solution/.test(a)) - Number(!/page|product|service|solution/.test(b))));
    else found.push(...locs);
  }
  return found.slice(0, limit);
}

export interface CrawlResult {
  baseUrl: string;
  pages: PageSnap[];
  robotsTxt: string | null;
  llmsTxt: string | null;
  sitemapUrls: number;
  warnings: string[];
}

export async function crawlSite(domainInput: string, maxPages = 10): Promise<CrawlResult> {
  const domain = normalizeDomain(domainInput);
  let home: { page: PageSnap; links: string[] } | null = null;
  let finalUrl = "";
  for (const candidate of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    const r = await get(candidate);
    if (r && r.status < 400 && /html/i.test(r.type || "html")) {
      home = parsePage(r.url, r.text, r.status);
      finalUrl = r.url;
      break;
    }
  }
  if (!home) throw new Error(`Couldn't fetch ${domain}: the site is down, blocks crawlers, or isn't a website`);
  const base = new URL(finalUrl);
  const baseUrl = `${base.protocol}//${base.host}/`;
  const host = base.hostname.replace(/^www\./, "");

  const robots = await get(new URL("/robots.txt", baseUrl).href);
  const robotsTxt = robots && robots.status < 400 && !/html/i.test(robots.type) ? robots.text.slice(0, 50_000) : null;
  const llms = await get(new URL("/llms.txt", baseUrl).href);
  const llmsTxt = llms && llms.status < 400 && !/html/i.test(llms.type) && llms.text.trim() ? llms.text.slice(0, 2000) : null;
  const sm = await sitemapUrls(baseUrl, robotsTxt);

  const score = new Map<string, number>();
  const consider = (raw: string, fromNav: boolean) => {
    let u: URL;
    try {
      u = new URL(raw.trim(), baseUrl);
    } catch {
      return;
    }
    u.hash = "";
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host || BAD.test(u.href)) return;
    if (u.pathname === "/" || u.pathname === "") return;
    const segs = u.pathname.toLowerCase().split(/[/_.]/).filter(Boolean);
    let s = Math.max(0, ...segs.map((x) => GOOD[x] ?? 0), ...segs.flatMap((x) => x.split("-").map((w) => GOOD[w] ?? 0)));
    s += fromNav ? 2 : 0;
    s -= Math.max(0, segs.length - 2);
    if (/\/(blog|news|tin-tuc|articles?|posts?)\//.test(`/${u.pathname.toLowerCase()}/`)) s -= 3;
    score.set(u.href, Math.max(s, score.get(u.href) ?? -99));
  };
  home.links.forEach((l) => consider(l, true));
  sm.forEach((l) => consider(l, false));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([u]) => u);

  const pages: PageSnap[] = [home.page];
  for (let i = 0; i < ranked.length && pages.length < maxPages; i += 4) {
    const batch = await Promise.all(ranked.slice(i, i + 4).map((u) => get(u)));
    for (const r of batch) {
      if (!r || r.status >= 400 || !/html/i.test(r.type || "html") || pages.length >= maxPages) continue;
      const { page } = parsePage(r.url, r.text, r.status);
      if (page.text && !pages.some((p) => p.text.slice(0, 400) === page.text.slice(0, 400))) pages.push(page);
    }
  }
  const warnings = pages.reduce((n, p) => n + p.text.length, 0) < 1500
    ? ["Very little readable text: the site may render its content with JavaScript, so AI crawlers may see little too."]
    : [];
  return { baseUrl, pages, robotsTxt, llmsTxt, sitemapUrls: sm.length, warnings };
}

/** Compact text of the crawl for the research model. */
export function siteDigest(pages: PageSnap[], perPage = 2500, total = 40_000): string {
  const out: string[] = [];
  let used = 0;
  for (const p of pages) {
    const d = [
      `URL: ${p.url}`,
      `Title: ${p.title}`,
      p.description && `Meta description: ${p.description}`,
      p.h1.length ? `H1: ${p.h1.slice(0, 3).join(" | ")}` : "",
      p.headings.length ? `Headings: ${p.headings.slice(0, 25).join(" | ")}` : "",
      ...p.jsonLd.slice(0, 4).map((d) => `Schema.org: ${JSON.stringify(d).slice(0, 600)}`),
      `Text: ${p.text.slice(0, perPage)}`,
    ].filter(Boolean).join("\n");
    if (used + d.length > total) break;
    out.push(d);
    used += d.length;
  }
  return out.join("\n\n---\n\n");
}
