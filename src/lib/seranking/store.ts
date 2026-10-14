import { readJson, writeJson } from "../blobJson";
import { listProjectIds, readConfig } from "../tracking/store";
import { asList, hostOf, isSeRankingMock, num, seGet, str } from "./client";
import type { SeLink, SeSite, SeSnapshot } from "./types";

const SITES_PATH = "seranking/sites.json";
const SITES_TTL_MS = 60 * 60_000;
const linkPath = (projectId: string) => `seranking/${projectId}/link.json`;
const snapshotPath = (projectId: string) => `seranking/${projectId}/snapshot.json`;

interface SitesCache {
  fetchedAt: string;
  sites: SeSite[];
}

function toSite(r: Record<string, unknown>): SeSite | null {
  const id = num(r.id);
  const url = str(r.name) ?? str(r.url);
  if (!id || !url) return null;
  return {
    id,
    title: str(r.title) ?? url,
    url,
    keywordCount: num(r.keyword_count) ?? 0,
    isActive: num(r.is_active) !== 0,
    guestLink: str(r.guest_link) ?? undefined,
  };
}

/** Generated SE Ranking projects for the app's own projects, so linking can be tried without a key. */
async function mockSites(): Promise<SeSite[]> {
  const ids = await listProjectIds();
  const configs = await Promise.all(ids.map((id) => readConfig(id)));
  const sites = configs
    .filter((c) => c.brand.website)
    .map((c, i) => ({ id: 11_400_000 + i, title: c.brand.name || c.brand.website, url: `https://${hostOf(c.brand.website)}/`, keywordCount: 24 + i * 7, isActive: true }));
  return [...sites, { id: 11_399_999, title: "Example Resort", url: "https://example-resort.com/", keywordCount: 40, isActive: true }];
}

/** The account's SE Ranking projects (cached for an hour). */
export async function listSites(force = false): Promise<SeSite[]> {
  if (isSeRankingMock()) return mockSites();
  const cached = await readJson<SitesCache>(SITES_PATH);
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < SITES_TTL_MS) return cached.sites;
  const sites = asList(await seGet("project-management/sites"))
    .map(toSite)
    .filter((s): s is SeSite => s !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
  await writeJson(SITES_PATH, { fetchedAt: new Date().toISOString(), sites } satisfies SitesCache);
  return sites;
}

/** The SE Ranking project tracking a website: same host first, then a parent/sub-domain; the one with most keywords wins. */
export function matchSite(sites: SeSite[], website: string): SeSite | null {
  const host = website.trim() ? hostOf(website) : "";
  if (!host) return null;
  const byKeywords = (a: SeSite, b: SeSite) => b.keywordCount - a.keywordCount;
  const exact = sites.filter((s) => hostOf(s.url) === host).sort(byKeywords);
  if (exact.length) return exact[0];
  const related = sites.filter((s) => {
    const h = hostOf(s.url);
    return h.endsWith(`.${host}`) || host.endsWith(`.${h}`);
  });
  return related.sort(byKeywords)[0] ?? null;
}

export async function readLink(projectId: string): Promise<SeLink> {
  return (await readJson<SeLink>(linkPath(projectId))) ?? { siteId: null };
}

export async function writeLink(projectId: string, link: SeLink): Promise<void> {
  await writeJson(linkPath(projectId), link);
}

/** The SE Ranking project an app project shows: the one chosen, or the one tracking the brand's website. */
export async function resolveSite(projectId: string, sites?: SeSite[]): Promise<{ site: SeSite | null; auto: boolean }> {
  const [link, config] = await Promise.all([readLink(projectId), readConfig(projectId)]);
  const list = sites ?? (await listSites());
  if (link.siteId) {
    const chosen = list.find((s) => s.id === link.siteId);
    if (chosen) return { site: chosen, auto: false };
  }
  return { site: matchSite(list, config.brand.website), auto: true };
}

export async function readSnapshot(projectId: string): Promise<SeSnapshot | null> {
  const snap = await readJson<SeSnapshot>(snapshotPath(projectId));
  // Snapshots synced before competitors and backlinks had their own sections lack these parts.
  return snap ? { ...snap, competition: snap.competition ?? null, rivals: snap.rivals ?? [], linkProfile: snap.linkProfile ?? null } : null;
}

export async function writeSnapshot(projectId: string, snapshot: SeSnapshot): Promise<void> {
  await writeJson(snapshotPath(projectId), snapshot);
}
