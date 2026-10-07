import { DEFAULT_MODEL, getOpenAIClient, isMockMode } from "../openai";
import { analyzeSeo, htmlToText, imagesIn, slugify } from "./seo";
import type { Article, ArticleSuggestions } from "./types";

/** Article text with headings marked, trimmed to what the model needs. */
function outline(html: string, maxChars: number): string {
  const marked = html
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<h4[^>]*>/gi, "\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ");
  const text = htmlToText(marked);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[...truncated]` : text;
}

const strings = (v: unknown, max: number, len = 400) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, max) : [];
const one = (v: unknown, len: number) => (typeof v === "string" ? v.trim().slice(0, len) : "");

/**
 * Asks ChatGPT for on-page SEO elements: SEO title and meta description options, slug, keywords, excerpt,
 * missing subheadings, image alt texts, categories/tags and concrete fixes - in the article's own language.
 */
export async function suggestSeo(article: Article, context: { siteHost?: string; categories: string[] }): Promise<ArticleSuggestions> {
  const images = [...imagesIn(article.contentHtml), ...(article.featuredImage ? [{ src: article.featuredImage.src, alt: article.featuredImage.alt }] : [])];
  if (isMockMode()) return mockSuggestions(article, images, context.categories);

  const report = analyzeSeo(article, context.siteHost);
  const failing = report.checks.filter((c) => c.status !== "good").map((c) => `- ${c.label}: ${c.detail}`);
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "You are a senior on-page SEO editor. Suggest on-page SEO elements for the article below.",
          "Write in the same language as the article. Be specific to its content; no generic filler, no clickbait, no invented facts.",
          "Rules: SEO titles 50-60 characters with the focus keyword near the start; meta descriptions 130-155 characters, include the focus keyword naturally and end with a reason to click;",
          "slug lowercase ASCII words joined by hyphens, max 6 words, include the keyword, drop stop words; excerpt 1-2 sentences (max 45 words);",
          "secondaryKeywords 4-8 related search phrases people actually type; headings 3-5 H2s for subtopics the article is missing (not ones it already has);",
          "altTexts: one per image index, describing the image in context (max 120 characters), using the keyword only where it fits;",
          "categories: 1-2, chosen from the site's existing categories when any fit; tags 3-6 short phrases;",
          "improvements: 3-6 concrete edits that would most improve rankings, referring to actual sections of this article.",
          "If no focus keyword is given, propose the best one; otherwise return it unchanged in focusKeyword.",
          'Return ONLY JSON: {"metaTitles": string[3], "metaDescriptions": string[3], "slug": string, "focusKeyword": string, "secondaryKeywords": string[], "excerpt": string, "headings": string[], "altTexts": [{"index": number, "alt": string}], "categories": string[], "tags": string[], "improvements": string[]}.',
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Site: ${context.siteHost ?? "(not connected)"}`,
          `Existing site categories: ${context.categories.length ? context.categories.slice(0, 60).join(", ") : "(none known)"}`,
          `Title (H1): ${article.title || "(none)"}`,
          `Focus keyword: ${article.focusKeyword || "(none - propose one)"}`,
          `Secondary keywords: ${article.secondaryKeywords.join(", ") || "(none)"}`,
          `Current SEO title: ${article.metaTitle || "(none)"}`,
          `Current meta description: ${article.metaDescription || "(none)"}`,
          `Current slug: ${article.slug || "(none)"}`,
          `Images (index: current alt): ${images.length ? images.map((im, i) => `${i}: ${im.alt || "(no alt)"}`).join(" | ") : "(none)"}`,
          `Checks not yet passing:\n${failing.join("\n") || "(all passing)"}`,
          `\nArticle:\n${outline(article.contentHtml, 14000)}`,
        ].join("\n"),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const alts = Array.isArray(parsed.altTexts) ? (parsed.altTexts as Array<{ index?: unknown; alt?: unknown }>) : [];
  return {
    metaTitles: strings(parsed.metaTitles, 3, 120),
    metaDescriptions: strings(parsed.metaDescriptions, 3, 300),
    slug: slugify(one(parsed.slug, 120)),
    focusKeyword: one(parsed.focusKeyword, 120) || article.focusKeyword,
    secondaryKeywords: strings(parsed.secondaryKeywords, 8, 100),
    excerpt: one(parsed.excerpt, 500),
    headings: strings(parsed.headings, 5, 150),
    altTexts: alts
      .map((a) => ({ src: images[Number(a.index)]?.src ?? "", alt: one(a.alt, 200) }))
      .filter((a) => a.src && a.alt),
    categories: strings(parsed.categories, 2, 80),
    tags: strings(parsed.tags, 6, 60),
    improvements: strings(parsed.improvements, 6, 400),
    model: DEFAULT_MODEL,
  };
}

/** Rule-based stand-ins when no OpenAI key is configured, so the editor flow stays testable. */
function mockSuggestions(article: Article, images: Array<{ src: string; alt: string }>, categories: string[]): ArticleSuggestions {
  const kw = article.focusKeyword || article.title.split(/\s+/).slice(0, 3).join(" ");
  const title = article.title || kw;
  const firstSentence = htmlToText(article.contentHtml).split(/(?<=[.!?])\s/)[0] ?? "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    metaTitles: [`${cap(kw)}: ${title}`.slice(0, 60), `${title} | Guide`.slice(0, 60), `${cap(kw)} - What to Know Before You Go`.slice(0, 60)],
    metaDescriptions: [
      `${firstSentence}`.slice(0, 150),
      `Planning around ${kw}? Practical tips, comparisons and what we'd book ourselves. Read the full guide.`.slice(0, 155),
      `Everything about ${kw} in one place: where to start, what it costs and mistakes to avoid.`.slice(0, 155),
    ],
    slug: slugify(kw),
    focusKeyword: kw,
    secondaryKeywords: [`${kw} guide`, `best ${kw}`, `${kw} tips`, `${kw} 2026`],
    excerpt: firstSentence.slice(0, 280),
    headings: [`Frequently asked questions about ${kw}`, `How much does it cost?`, `Getting there`],
    altTexts: images.map((im, i) => ({ src: im.src, alt: im.alt || `${cap(kw)} - photo ${i + 1}` })),
    categories: categories.slice(0, 1),
    tags: kw.split(/\s+/).filter((w) => w.length > 3).slice(0, 4),
    improvements: [
      "Mock mode (no OpenAI key on the server): these suggestions are rule-based placeholders.",
      `Use "${kw}" in the first paragraph and one H2.`,
      "Add two links to related articles on your own site.",
    ],
    model: "mock",
  };
}
