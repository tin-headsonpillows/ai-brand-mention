export const MAX_LOCATIONS = 10;
export const LOCATION_PLACEHOLDER = "{location}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(location: string): RegExp {
  // Letter-aware boundaries rather than \b, which doesn't treat accented letters ("Đà Nẵng") as word characters.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(location.trim())}(?![\\p{L}\\p{N}])`, "giu");
}

/** Trims, drops blanks and case-insensitive duplicates, and caps the list. */
export function cleanLocations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = typeof item === "string" ? item.trim().replace(/\s+/g, " ") : "";
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out.slice(0, MAX_LOCATIONS);
}

/** Locations from the list that the prompt names outright (rather than via the placeholder). */
export function namedLocations(prompt: string, locations: string[]): string[] {
  return locations.filter((loc) => mentionPattern(loc).test(prompt));
}

/**
 * The prompt as it should read for one location:
 * - "{location}" is replaced with it;
 * - a mention of another location from the same run is swapped for it (so "hotel in Da Nang" becomes
 *   "hotel in Hoi An" for the Hoi An segment instead of asking about two places at once);
 * - a prompt that already names this location is left alone;
 * - otherwise "in <location>" is appended.
 */
export function regionalPrompt(prompt: string, location: string, allLocations: string[]): string {
  const base = prompt.trim();
  if (!location) return base.replaceAll(LOCATION_PLACEHOLDER, "").replace(/\s{2,}/g, " ").trim();
  if (base.includes(LOCATION_PLACEHOLDER)) return base.replaceAll(LOCATION_PLACEHOLDER, location);
  if (mentionPattern(location).test(base)) return base;
  const other = allLocations.find((loc) => loc !== location && mentionPattern(loc).test(base));
  if (other) return base.replace(mentionPattern(other), location);
  return `${base.replace(/[.?!]+$/, "")} in ${location}`;
}

/** Splits `total` prompts as evenly as possible across `parts` locations, at least one each. */
export function splitCount(total: number, parts: number): number[] {
  const n = Math.max(1, parts);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => Math.max(1, base + (i < total % n ? 1 : 0)));
}
