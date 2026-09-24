import type { AiTextSnapshot, BrandHit, OrganicResultSnapshot, TrackedBrand } from "./types";

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function textMentionsName(text: string, name: string): boolean {
  if (!name.trim()) return false;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function domainMatches(domain: string, website: string): boolean {
  if (!website.trim() || !domain) return false;
  const site = normalize(website).replace(/^www\./, "");
  return domain === site || domain.endsWith(`.${site}`);
}

export function computeOrganicHit(results: OrganicResultSnapshot[], brand: TrackedBrand): BrandHit {
  const names = [brand.name, ...brand.aliases].filter(Boolean);
  for (const r of results) {
    if (brand.website && domainMatches(r.domain, brand.website)) {
      return { matched: true, matchedBy: ["website"], organicPosition: r.position };
    }
    for (const name of names) {
      if (textMentionsName(`${r.title} ${r.snippet}`, name)) {
        return {
          matched: true,
          matchedBy: [name === brand.name ? "name" : "alias"],
          organicPosition: r.position,
        };
      }
    }
  }
  return { matched: false, matchedBy: [], organicPosition: null };
}

export function computeAiHit(snapshot: AiTextSnapshot, brand: TrackedBrand): BrandHit {
  const matchedBy = new Set<"name" | "alias" | "website">();
  const names = [brand.name, ...brand.aliases].filter(Boolean);

  if (snapshot.text) {
    for (const name of names) {
      if (textMentionsName(snapshot.text, name)) {
        matchedBy.add(name === brand.name ? "name" : "alias");
      }
    }
  }
  if (brand.website && snapshot.sources.some((s) => domainMatches(s.domain, brand.website))) {
    matchedBy.add("website");
  }

  return { matched: matchedBy.size > 0, matchedBy: Array.from(matchedBy), organicPosition: null };
}
