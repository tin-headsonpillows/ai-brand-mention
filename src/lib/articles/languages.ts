import { modelPrice } from "../chatgpt/pricing";

/** Target languages for article translation, and the cost estimate shown before translating. Browser-safe. */

export interface Language {
  code: string;
  label: string;
  /** Output tokens per English input token: scripts like Thai or Russian take more tokens for the same text. */
  tokenRatio: number;
}

export const LANGUAGES: Language[] = [
  { code: "ja", label: "Japanese", tokenRatio: 1.3 },
  { code: "ko", label: "Korean", tokenRatio: 1.4 },
  { code: "zh-Hans", label: "Chinese (Simplified)", tokenRatio: 1.1 },
  { code: "zh-Hant", label: "Chinese (Traditional)", tokenRatio: 1.25 },
  { code: "th", label: "Thai", tokenRatio: 1.9 },
  { code: "ru", label: "Russian", tokenRatio: 1.5 },
  { code: "vi", label: "Vietnamese", tokenRatio: 1.35 },
  { code: "id", label: "Indonesian", tokenRatio: 1.2 },
  { code: "fr", label: "French", tokenRatio: 1.25 },
  { code: "de", label: "German", tokenRatio: 1.3 },
  { code: "es", label: "Spanish", tokenRatio: 1.25 },
  { code: "it", label: "Italian", tokenRatio: 1.25 },
  { code: "en", label: "English", tokenRatio: 1 },
];

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

/** Translation models: non-reasoning ones are fast and cheap and translate well. */
export const TRANSLATION_MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "Recommended: good quality, about 1¢ per article." },
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Cheapest; fine for simple pages." },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", note: "More natural phrasing, a few times the cost." },
  { id: "gpt-5.5", label: "GPT-5.5", note: "Best quality, highest cost." },
];

/** Text the model reads and writes for an article: visible text plus alt/title attributes, without markup. */
export function translatableChars(html: string, fields: string[]): number {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/\s(alt|title)="([^"]*)"/gi, " $2 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
  return text.length + fields.join(" ").length;
}

/**
 * Typical cost of translating into one language: the text (~4 characters per token) plus placeholders for tags
 * and the instructions in, the translation out. Real costs usually land within about ±30%.
 */
export function estimateTranslation(model: string, chars: number, lang: string): { inputTokens: number; outputTokens: number; usd: number } {
  const ratio = LANGUAGES.find((l) => l.code === lang)?.tokenRatio ?? 1.4;
  const textTokens = Math.ceil(chars / 4);
  const batches = Math.max(1, Math.ceil(chars / 6000));
  const inputTokens = Math.ceil(textTokens * 1.15) + batches * 450;
  const outputTokens = Math.ceil(textTokens * 1.1 * ratio) + batches * 20;
  const p = modelPrice(model);
  return { inputTokens, outputTokens, usd: (inputTokens * p.input + outputTokens * p.output) / 1_000_000 };
}
