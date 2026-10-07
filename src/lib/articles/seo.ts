import type { Article } from "./types";

/**
 * On-page SEO checks for an article, run in the browser as you edit and on the server for the list's score.
 * Plain string/regex work only (no DOM), so it runs in both places. Keyword matching ignores case and accents,
 * so "khách sạn" matches "Khach San".
 */

export type CheckStatus = "good" | "ok" | "bad";
export interface SeoCheck {
  id: string;
  group: "Keyword" | "Title & meta" | "Content" | "Media & links";
  label: string;
  status: CheckStatus;
  detail: string;
  weight: number;
}
export interface SeoReport {
  score: number;
  checks: SeoCheck[];
  stats: { words: number; keywordCount: number; density: number; h2: number; h3: number; images: number; internalLinks: number; externalLinks: number };
}

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export function slugify(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|h[1-6]|li|div|tr|blockquote|figcaption)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

const words = (text: string) => text.split(/[\s ]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
export const wordCount = (html: string) => words(htmlToText(html)).length;

/** Occurrences of the phrase in the text (accent/case-insensitive, whole words). */
export function countPhrase(text: string, phrase: string): number {
  const p = normalize(phrase).trim().replace(/\s+/g, " ");
  if (!p) return 0;
  const t = ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const needle = ` ${p.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  let count = 0;
  for (let i = t.indexOf(needle); i !== -1; i = t.indexOf(needle, i + needle.length - 1)) count++;
  return count;
}
export const containsPhrase = (text: string, phrase: string) => countPhrase(text, phrase) > 0;

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))].map((m) => htmlToText(m[1]));
}
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}
export function imagesIn(html: string): Array<{ src: string; alt: string }> {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ src: attr(m[0], "src") ?? "", alt: attr(m[0], "alt") ?? "" }));
}
export function linksIn(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => attr(m[0], "href") ?? "").filter(Boolean);
}

function isInternal(href: string, siteHost?: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  if (href.startsWith("#")) return true;
  if (!siteHost) return false;
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return host === siteHost.replace(/^www\./, "");
  } catch {
    return false;
  }
}

const range = (value: number, good: [number, number], ok: [number, number]): CheckStatus =>
  value >= good[0] && value <= good[1] ? "good" : value >= ok[0] && value <= ok[1] ? "ok" : "bad";

export function analyzeSeo(
  article: Pick<Article, "title" | "slug" | "focusKeyword" | "metaTitle" | "metaDescription" | "excerpt" | "contentHtml" | "featuredImage">,
  siteHost?: string
): SeoReport {
  const kw = article.focusKeyword.trim();
  const html = article.contentHtml;
  const text = htmlToText(html);
  const bodyWords = words(text);
  const total = bodyWords.length;
  const seoTitle = article.metaTitle.trim() || article.title.trim();
  const h2 = tags(html, "h2");
  const h3 = tags(html, "h3");
  const h1InBody = tags(html, "h1").length;
  const images = imagesIn(html);
  const allImages = article.featuredImage ? [...images, { src: article.featuredImage.src, alt: article.featuredImage.alt }] : images;
  const links = linksIn(html);
  const internal = links.filter((l) => isInternal(l, siteHost)).length;
  const external = links.filter((l) => /^https?:\/\//i.test(l) && !isInternal(l, siteHost)).length;
  const kwCount = kw ? countPhrase(text, kw) : 0;
  const kwWords = Math.max(1, words(kw).length);
  const density = total ? (kwCount * kwWords * 100) / total : 0;
  const intro = bodyWords.slice(0, 100).join(" ");
  const paragraphs = tags(html, "p").map((p) => words(p).length);
  const longParagraphs = paragraphs.filter((n) => n > 150).length;
  const sentences = text.split(/[.!?…]+(?:\s|$)/).map((s) => words(s).length).filter((n) => n > 0);
  const avgSentence = sentences.length ? sentences.reduce((a, b) => a + b, 0) / sentences.length : 0;
  const slugKw = slugify(kw);

  const checks: SeoCheck[] = [];
  const add = (c: SeoCheck) => checks.push(c);
  const needKw = (id: string, group: SeoCheck["group"], label: string, weight: number) =>
    add({ id, group, label, status: "bad", detail: "Set a focus keyword first.", weight });

  if (!kw) {
    add({ id: "kw", group: "Keyword", label: "Focus keyword set", status: "bad", detail: "Add the main search phrase this article should rank for.", weight: 3 });
    needKw("kw-title", "Keyword", "Keyword in SEO title", 3);
    needKw("kw-meta", "Keyword", "Keyword in meta description", 2);
    needKw("kw-slug", "Keyword", "Keyword in URL slug", 2);
    needKw("kw-intro", "Keyword", "Keyword in the first 100 words", 2);
    needKw("kw-headings", "Keyword", "Keyword in a subheading", 1);
    needKw("kw-density", "Keyword", "Keyword density", 1);
  } else {
    add({ id: "kw", group: "Keyword", label: "Focus keyword set", status: "good", detail: `"${kw}"`, weight: 3 });
    const inTitle = containsPhrase(seoTitle, kw);
    const early = inTitle && normalize(seoTitle).indexOf(normalize(kw).split(" ")[0]) < seoTitle.length / 2;
    add({
      id: "kw-title",
      group: "Keyword",
      label: "Keyword in SEO title",
      status: inTitle ? (early ? "good" : "ok") : "bad",
      detail: inTitle ? (early ? "Near the start of the title." : "Present - moving it nearer the start helps.") : "Not in the SEO title.",
      weight: 3,
    });
    add({
      id: "kw-meta",
      group: "Keyword",
      label: "Keyword in meta description",
      status: containsPhrase(article.metaDescription, kw) ? "good" : "bad",
      detail: containsPhrase(article.metaDescription, kw) ? "Present." : "Not in the meta description.",
      weight: 2,
    });
    const slugHas = Boolean(slugKw) && article.slug.includes(slugKw);
    const slugPartial = !slugHas && slugKw.split("-").filter((w) => w.length > 2).some((w) => article.slug.includes(w));
    add({
      id: "kw-slug",
      group: "Keyword",
      label: "Keyword in URL slug",
      status: slugHas ? "good" : slugPartial ? "ok" : "bad",
      detail: slugHas ? "Present." : slugPartial ? "Partly present." : `Try "${slugKw}".`,
      weight: 2,
    });
    add({
      id: "kw-intro",
      group: "Keyword",
      label: "Keyword in the first 100 words",
      status: containsPhrase(intro, kw) ? "good" : "bad",
      detail: containsPhrase(intro, kw) ? "The introduction uses it." : "Mention it early in the introduction.",
      weight: 2,
    });
    const inHeading = [...h2, ...h3].some((h) => containsPhrase(h, kw));
    add({
      id: "kw-headings",
      group: "Keyword",
      label: "Keyword in a subheading",
      status: inHeading ? "good" : h2.length + h3.length ? "ok" : "bad",
      detail: inHeading ? "At least one H2/H3 uses it." : "Use it (or a close variant) in an H2 or H3.",
      weight: 1,
    });
    add({
      id: "kw-density",
      group: "Keyword",
      label: "Keyword density",
      status: range(density, [0.5, 2.5], [0.3, 3.5]),
      detail: `${density.toFixed(1)}% (${kwCount} use${kwCount === 1 ? "" : "s"}); aim for 0.5-2.5%.`,
      weight: 1,
    });
  }

  add({
    id: "title-length",
    group: "Title & meta",
    label: "SEO title length",
    status: seoTitle ? range(seoTitle.length, [40, 60], [25, 70]) : "bad",
    detail: seoTitle ? `${seoTitle.length} characters; Google shows about 50-60.` : "No title yet.",
    weight: 2,
  });
  add({
    id: "meta-length",
    group: "Title & meta",
    label: "Meta description length",
    status: article.metaDescription.trim() ? range(article.metaDescription.trim().length, [120, 160], [70, 175]) : "bad",
    detail: article.metaDescription.trim() ? `${article.metaDescription.trim().length} characters; aim for 120-160.` : "Missing - Google will pick a snippet itself.",
    weight: 2,
  });
  add({
    id: "slug",
    group: "Title & meta",
    label: "Short, clean URL slug",
    status: !article.slug ? "bad" : article.slug.length <= 60 && /^[a-z0-9-]+$/.test(article.slug) ? "good" : "ok",
    detail: article.slug ? `${article.slug.length} characters${/^[a-z0-9-]+$/.test(article.slug) ? "" : "; use lowercase letters, numbers and hyphens"}.` : "No slug yet.",
    weight: 1,
  });
  add({
    id: "excerpt",
    group: "Title & meta",
    label: "Excerpt",
    status: article.excerpt.trim() ? "good" : "ok",
    detail: article.excerpt.trim() ? "Set - used by themes on archive pages." : "Optional; some themes show it on listing pages.",
    weight: 0.5,
  });

  add({
    id: "length",
    group: "Content",
    label: "Content length",
    status: total >= 600 ? "good" : total >= 300 ? "ok" : "bad",
    detail: `${total.toLocaleString()} words${total < 600 ? "; most ranking articles are 600+" : ""}.`,
    weight: 2,
  });
  add({
    id: "headings",
    group: "Content",
    label: "Subheadings structure the text",
    status: h1InBody ? "bad" : h2.length >= 2 || total < 300 ? "good" : h2.length === 1 ? "ok" : "bad",
    detail: h1InBody
      ? `${h1InBody} H1 in the body - WordPress uses the post title as the H1, so make these H2s.`
      : `${h2.length} H2 and ${h3.length} H3.`,
    weight: 1.5,
  });
  add({
    id: "paragraphs",
    group: "Content",
    label: "Paragraph length",
    status: longParagraphs === 0 ? "good" : longParagraphs <= 2 ? "ok" : "bad",
    detail: longParagraphs ? `${longParagraphs} paragraph${longParagraphs === 1 ? " is" : "s are"} over 150 words.` : "All paragraphs are a readable length.",
    weight: 0.5,
  });
  add({
    id: "sentences",
    group: "Content",
    label: "Sentence length",
    status: avgSentence === 0 ? "ok" : avgSentence <= 20 ? "good" : avgSentence <= 25 ? "ok" : "bad",
    detail: avgSentence ? `${avgSentence.toFixed(0)} words per sentence on average.` : "No text yet.",
    weight: 0.5,
  });

  add({
    id: "featured",
    group: "Media & links",
    label: "Featured image",
    status: article.featuredImage ? "good" : "bad",
    detail: article.featuredImage ? "Set - used for social shares and listings." : "Pick one from the library, a link or an upload.",
    weight: 1,
  });
  const missingAlt = allImages.filter((i) => !i.alt.trim()).length;
  add({
    id: "alt",
    group: "Media & links",
    label: "Images have alt text",
    status: allImages.length === 0 ? "ok" : missingAlt === 0 ? "good" : "bad",
    detail: allImages.length === 0 ? "No images yet." : missingAlt ? `${missingAlt} of ${allImages.length} without alt text.` : `All ${allImages.length} have alt text.`,
    weight: 1,
  });
  if (kw) {
    const altKw = allImages.some((i) => containsPhrase(i.alt, kw));
    add({
      id: "alt-kw",
      group: "Media & links",
      label: "Keyword in an image alt",
      status: altKw ? "good" : "ok",
      detail: altKw ? "Present." : "Describe at least one image using the keyword, if it fits naturally.",
      weight: 0.5,
    });
  }
  add({
    id: "internal",
    group: "Media & links",
    label: "Internal links",
    status: internal >= 2 ? "good" : internal === 1 ? "ok" : "bad",
    detail: `${internal} link${internal === 1 ? "" : "s"} to your own site${siteHost ? ` (${siteHost})` : ""}.`,
    weight: 1,
  });
  add({
    id: "external",
    group: "Media & links",
    label: "Outbound links",
    status: external >= 1 ? "good" : "ok",
    detail: `${external} link${external === 1 ? "" : "s"} to other sites.`,
    weight: 0.5,
  });

  const max = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * (c.status === "good" ? 1 : c.status === "ok" ? 0.5 : 0), 0);
  return {
    score: max ? Math.round((got / max) * 100) : 0,
    checks,
    stats: { words: total, keywordCount: kwCount, density, h2: h2.length, h3: h3.length, images: allImages.length, internalLinks: internal, externalLinks: external },
  };
}
