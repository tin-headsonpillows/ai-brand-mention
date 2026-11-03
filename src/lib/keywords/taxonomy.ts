import { tokenCost } from "../brand/pricing";
import { DEFAULT_MODEL, getOpenAIClient, isMockMode } from "../openai";
import type { BrandProfile } from "../knowledge/types";
import type { TaxonomySub } from "./types";

/** Step 1: category -> sub-categories (from the knowledge base) -> seed keywords people type into Google. */

export const TAXONOMY_MODEL = DEFAULT_MODEL;

const INSTRUCTIONS = [
  "You are a senior SEO consultant building a keyword taxonomy for a client website.",
  "From the brand knowledge base (category, offerings, personas, market) and the real Google queries provided, build: category -> 3-8 sub-categories (one per offering or buyer need) -> 8-15 seed keywords each.",
  "Seeds are what people actually type into Google in the target country and languages: short head terms (2-3 words) and long-tail (4-7 words), across intents (informational, commercial investigation, transactional, local).",
  "Never include the client's brand name (branded demand is tracked separately). No duplicates.",
  'Return ONLY JSON: {"category": string, "subcategories": [{"name": string, "offering": string (an offering name from the knowledge base, or "general"), "seeds": string[]}]}.',
].join(" ");

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));

/** Without ChatGPT: one sub-category per offering, seeded from its name and the closest real queries. */
export function fallbackTaxonomy(profile: Pick<BrandProfile, "category" | "offerings" | "markets"> | null, realQueries: string[], tracked: string[]): { category: string; subs: TaxonomySub[] } {
  const market = profile?.markets[0] ?? "";
  const offerings = profile?.offerings.length ? profile.offerings.map((o) => o.name) : [profile?.category || "general"];
  const subs: TaxonomySub[] = offerings.map((name) => {
    const tk = tokens(name);
    const near = [...realQueries, ...tracked].filter((q) => [...tokens(q)].some((t) => tk.has(t)));
    return { name, offering: name, seeds: [...new Set([name, `best ${name}`, `${name} price`, `${name} ${market}`.trim(), ...near])] };
  });
  const used = new Set(subs.flatMap((s) => s.seeds));
  const left = [...realQueries, ...tracked].filter((q) => !used.has(q));
  if (left.length) subs.push({ name: `General ${profile?.category ?? ""}`.trim(), offering: "general", seeds: [...new Set(left)] });
  return { category: profile?.category ?? "", subs };
}

export async function buildTaxonomy(input: { profile: BrandProfile | null; brandName: string; realQueries: string[]; tracked: string[]; market: string }): Promise<{ category: string; subs: TaxonomySub[]; costUsd: number; mock: boolean }> {
  if (isMockMode() || !input.profile) return { ...fallbackTaxonomy(input.profile, input.realQueries, input.tracked), costUsd: 0, mock: true };
  const p = input.profile;
  const completion = await getOpenAIClient().chat.completions.create({
    model: TAXONOMY_MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: [
          `Client brand (exclude from keywords): ${input.brandName}. Target market: ${input.market}. Languages: ${p.languages.join(", ") || "en"}.`,
          `KNOWLEDGE BASE: ${JSON.stringify({ category: p.category, offerings: p.offerings.map((o) => ({ name: o.name, description: o.description })), personas: p.personas.map((x) => ({ name: x.name, painPoints: x.painPoints })), markets: p.markets })}`,
          input.realQueries.length ? `REAL GOOGLE QUERIES:\n${input.realQueries.slice(0, 80).map((q) => `- ${q}`).join("\n")}` : "",
          input.tracked.length ? `Keywords the team already tracks: ${input.tracked.slice(0, 40).join(", ")}` : "",
        ].filter(Boolean).join("\n\n"),
      },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { category?: unknown; subcategories?: unknown };
  const brand = input.brandName.toLowerCase();
  const subs = (Array.isArray(raw.subcategories) ? raw.subcategories : [])
    .map((s) => s as Record<string, unknown>)
    .map((s): TaxonomySub => ({
      name: String(s.name ?? "").trim().slice(0, 80),
      offering: String(s.offering ?? "general").trim().slice(0, 80),
      seeds: (Array.isArray(s.seeds) ? s.seeds : []).map((x) => String(x).trim().slice(0, 120)).filter((x) => x && !(brand && x.toLowerCase().includes(brand))),
    }))
    .filter((s) => s.name && s.seeds.length)
    .slice(0, 10);
  const u = completion.usage;
  return {
    category: String(raw.category ?? p.category).slice(0, 200),
    subs,
    costUsd: u ? tokenCost(TAXONOMY_MODEL, { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 }) : 0,
    mock: false,
  };
}

export const expectedTaxonomyCost = () => tokenCost(TAXONOMY_MODEL, { input: 4000, output: 2500 });
