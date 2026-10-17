import { getOpenAIClient, isMockMode } from "../openai";
import { isReasoningModel, usageCost } from "../chatgpt/pricing";
import { languageLabel } from "./languages";
import { translateHtml, type Translator, type Unit } from "./translateHtml";
import type { Article } from "./types";

export interface TranslateOptions {
  lang: string;
  model: string;
  /** Extra instructions: tone, terms to keep in English, formal/informal address... */
  instructions?: string;
  /** Point links to the site at the language's section, e.g. https://site.com/ja/... */
  linkPattern?: { host: string; prefix: string };
  brand?: string;
}

export interface TranslationUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}

function systemPrompt(o: TranslateOptions): string {
  return [
    `You are a professional web localizer. Translate each item into ${languageLabel(o.lang)} (${o.lang}) for a website audience.`,
    "Write natural, fluent copy a native speaker would publish - adapt idioms and sentence order, never word-for-word; keep the meaning, facts, numbers, prices and units.",
    "Items are either plain text or text with placeholder tags like <x1>...</x1> and <x2/>. Keep every placeholder exactly once, unchanged; you may move them so they wrap the right words in the translation. Do not add other tags.",
    "Keep &amp; &lt; &gt; entities as they are. Do not translate URLs, email addresses, code, or brand and product names" + (o.brand ? ` (e.g. "${o.brand}")` : "") + ".",
    "SEO fields (titles, meta descriptions, keywords) should read like what people in that language actually search for, keeping length limits similar.",
    o.instructions?.trim() ? `Client instructions: ${o.instructions.trim().slice(0, 1500)}` : "",
    'Return ONLY JSON: {"t": ["translation of item 1", "translation of item 2", ...]} with exactly one string per item, in order.',
  ]
    .filter(Boolean)
    .join(" ");
}

/** A Translator backed by ChatGPT, adding up token usage. In mock mode it tags text with the language code. */
export function chatTranslator(o: TranslateOptions, usage: TranslationUsage): Translator {
  if (isMockMode()) {
    return async (units: Unit[]) => units.map((u) => (u.kind === "html" ? u.source.replace(/(^|>)([^<]+)/g, (m, gt: string, text: string) => (text.trim() ? `${gt}[${o.lang}] ${text}` : m)) : `[${o.lang}] ${u.source}`));
  }
  const client = getOpenAIClient();
  const reasoning = isReasoningModel(o.model);
  return async (units: Unit[]) => {
    const completion = await client.chat.completions.create({
      model: o.model,
      messages: [
        { role: "system", content: systemPrompt(o) },
        { role: "user", content: JSON.stringify({ items: units.map((u) => u.source) }) },
      ],
      response_format: { type: "json_object" },
      ...(reasoning ? { reasoning_effort: "low" as const } : { temperature: 0.2 }),
      max_completion_tokens: 16000,
    });
    usage.calls++;
    usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    usage.outputTokens += completion.usage?.completion_tokens ?? 0;
    usage.costUsd = usageCost(o.model, usage.inputTokens, usage.outputTokens);
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { t?: unknown };
    const t = Array.isArray(parsed.t) ? parsed.t.map((x) => (typeof x === "string" ? x : "")) : [];
    return units.map((_, i) => t[i] ?? "");
  };
}

/** Rewrites links to the site to its language section (https://site.com/x -> https://site.com/ja/x). */
export function hrefRewriter(host: string, prefix: string): (href: string) => string {
  const clean = `/${prefix.replace(/^\/+|\/+$/g, "")}/`;
  return (href) => {
    try {
      const url = new URL(href, `https://${host}`);
      if (url.hostname.replace(/^www\./, "") !== host.replace(/^www\./, "")) return href;
      if (url.pathname.startsWith(clean) || url.pathname === clean.slice(0, -1)) return href;
      url.pathname = `${clean}${url.pathname.replace(/^\//, "")}`;
      return /^https?:/i.test(href) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return href;
    }
  };
}

export interface TranslatedFields {
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  featuredAlt: string;
  contentHtml: string;
  untranslated: number;
  segments: number;
}

/** Translates an article's body and SEO fields into one language. */
export async function translateArticle(article: Article, o: TranslateOptions): Promise<{ fields: TranslatedFields; usage: TranslationUsage }> {
  const usage: TranslationUsage = { model: o.model, inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
  const translator = chatTranslator(o, usage);
  const fieldSources = [article.title, article.metaTitle, article.metaDescription, article.excerpt, article.focusKeyword, article.secondaryKeywords.join("\n"), article.featuredImage?.alt ?? ""];
  const { result, fields } = await translateHtml(article.contentHtml, fieldSources, translator, {
    rewriteHref: o.linkPattern ? hrefRewriter(o.linkPattern.host, o.linkPattern.prefix.replace("{lang}", o.lang.toLowerCase())) : undefined,
  });
  const [title, metaTitle, metaDescription, excerpt, focusKeyword, secondary, featuredAlt] = fields;
  return {
    fields: {
      title,
      metaTitle,
      metaDescription,
      excerpt,
      focusKeyword,
      secondaryKeywords: secondary
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean),
      featuredAlt,
      contentHtml: result.html,
      untranslated: result.untranslated,
      segments: result.segments,
    },
    usage,
  };
}
