import { syncPlace } from "../reviews/sync";
import type { TrackingConfig } from "../tracking/types";
import { compareWithCustomers, type AiClaimGroup } from "./analyze";
import { customerVoice, projectListings } from "./customers";
import { ensureBudget, recordSpend } from "./spend";
import { listCycles, readCycle, writeCustomerGap } from "./store";
import type { BrandSettings, Cycle, CustomerGap } from "./types";

const YEAR_MS = 365 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

/** What the AI answers of one run say about the brand, grouped by attribute. */
export function aiClaimGroups(cycle: Cycle): AiClaimGroup[] {
  const groups = new Map<string, AiClaimGroup>();
  for (const r of cycle.responses) {
    if (!r.analysis?.brandMentioned) continue;
    for (const c of r.analysis.claims) {
      const key = (c.attribute || "General").trim();
      const g = groups.get(key) ?? { attribute: key, positive: 0, negative: 0, neutral: 0, examples: [] };
      g[c.sentiment]++;
      if (g.examples.length < 2 && !g.examples.includes(c.claim)) g.examples.push(c.claim);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.positive + b.negative + b.neutral - (a.positive + a.negative + a.neutral)).slice(0, 30);
}

/**
 * Compares the latest run's AI answers with the last 12 months of the brand's reviews and saves the result. Returns
 * null (and saves nothing) when there are no analysed reviews or no run to compare with.
 */
export async function updateCustomerGap(
  projectId: string,
  config: TrackingConfig,
  settings: BrandSettings,
  cycle?: Cycle | null
): Promise<{ gap: CustomerGap | null; reason?: string }> {
  const voice = await customerVoice(projectId, config, settings, new Date(Date.now() - YEAR_MS).toISOString());
  if (voice.totals.analysed === 0) return { gap: null, reason: "No analysed reviews from the brand's listings yet." };
  let run = cycle ?? null;
  if (!run) {
    const latest = [...(await listCycles(projectId))].reverse().find((c) => c.done > 0);
    run = latest ? await readCycle(projectId, latest.id) : null;
  }
  if (!run) return { gap: null, reason: "Run a brand check first, so there are AI answers to compare." };
  await ensureBudget(0.003);
  const { summary, items, costUsd } = await compareWithCustomers(config.brand, aiClaimGroups(run), voice);
  await recordSpend("openai", costUsd);
  const gap: CustomerGap = { generatedAt: new Date().toISOString(), cycleId: run.id, reviews: voice.totals.analysed, summary, items };
  await writeCustomerGap(projectId, gap);
  return { gap };
}

/**
 * Weekly: checks the brand's own review listings for new reviews (a refresh stops at the first page of reviews it
 * already has, so usually 1-2 SerpApi searches per listing, plus 1 for a Tripadvisor listing's profile).
 */
export async function refreshBrandListings(projectId: string, config: TrackingConfig, settings: BrandSettings, deadline: number): Promise<number> {
  if (!settings.refreshReviews) return 0;
  const { listings } = await projectListings(projectId, config, settings);
  let refreshed = 0;
  for (const l of listings.filter((x) => x.linked)) {
    if (Date.now() > deadline - 20_000) break;
    // Never-finished listings are left to the Reviews tab: a first fetch can take many searches.
    if (!l.lastSyncedAt || Date.now() - Date.parse(l.lastSyncedAt) < WEEK_MS - 3_600_000) continue;
    await syncPlace(l.id, true, () => {}, () => Date.now() > deadline - 10_000).catch(() => {
      // A failed refresh is retried next week; the stored reviews stay as they are.
    });
    refreshed++;
  }
  return refreshed;
}
