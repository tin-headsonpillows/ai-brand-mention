import { hasServerApiKeys } from "../serpKeyPool";
import { serpRequest } from "../serpRequest";
import type { KwSerp } from "./types";

/** Step 2: live Google result per keyword - SERP features (AI Overview first of all), top-10 URLs and titles. */

const FEATURES: Array<[string, string]> = [
  ["ai_overview", "AI Overview"], ["answer_box", "Featured snippet"], ["related_questions", "People also ask"], ["local_results", "Local pack"],
  ["local_map", "Local pack"], ["shopping_results", "Shopping"], ["immersive_products", "Shopping"], ["ads", "Ads"], ["inline_videos", "Videos"],
  ["video_results", "Videos"], ["top_stories", "Top stories"], ["knowledge_graph", "Knowledge panel"], ["inline_images", "Images"],
];

export const kwSerpIsMock = () => !hasServerApiKeys();

export async function keywordSerp(keyword: string, gl: string, hl: string): Promise<KwSerp> {
  const checkedAt = new Date().toISOString();
  if (kwSerpIsMock()) return mockSerp(keyword, checkedAt);
  try {
    const d = await serpRequest({ engine: "google", q: keyword, gl, hl, num: "10" });
    const present = (k: string) => {
      const v = (d as Record<string, unknown>)[k];
      return Array.isArray(v) ? v.length > 0 : !!v;
    };
    const organic = (Array.isArray(d.organic_results) ? d.organic_results : []) as Array<Record<string, unknown>>;
    return {
      checkedAt,
      features: [...new Set(FEATURES.filter(([k]) => present(k)).map(([, label]) => label))],
      urls: organic.slice(0, 10).map((o) => String(o.link ?? "")).filter(Boolean),
      titles: organic.slice(0, 10).map((o) => String(o.title ?? "")),
    };
  } catch (err) {
    return { checkedAt, features: [], urls: [], titles: [], error: err instanceof Error ? err.message.slice(0, 300) : "SerpApi failed" };
  }
}

/** Sample SERP: keywords sharing their first two words share most results, so clustering has something to group. */
function mockSerp(keyword: string, checkedAt: string): KwSerp {
  const stem = keyword.toLowerCase().split(/\s+/).filter((w) => !["best", "top", "cheap", "the", "for"].includes(w)).slice(0, 2).join("-") || "x";
  const urls = [1, 2, 3, 4, 5, 6].map((i) => `https://sample-site-${i}.example/${stem}`).concat([`https://other.example/${encodeURIComponent(keyword)}`]);
  const h = [...keyword].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  return { checkedAt, features: [h % 2 ? "AI Overview" : "", "People also ask", h % 5 === 0 ? "Local pack" : ""].filter(Boolean), urls, titles: urls.map(() => `Sample result for ${keyword}`) };
}
