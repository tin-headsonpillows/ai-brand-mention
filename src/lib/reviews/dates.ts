const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30.44 * 86_400_000,
  year: 365.25 * 86_400_000,
};

/**
 * Turns Google's relative review dates ("2 weeks ago", "a month ago", "yesterday", "Edited 3 days ago")
 * into an approximate ISO timestamp, measured from `now`. Falls back to absolute dates ("Mar 2025").
 * Returns null when nothing can be parsed.
 */
export function parseRelativeDate(text: string | undefined, now: Date): string | null {
  if (!text) return null;
  const value = text.toLowerCase().replace(/^edited\s+/, "").trim();
  if (/^(just now|today|moments? ago)/.test(value)) return now.toISOString();
  if (value.startsWith("yesterday")) return new Date(now.getTime() - UNIT_MS.day).toISOString();
  const match = value.match(/(a|an|one|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (match) {
    const n = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
    return new Date(now.getTime() - n * UNIT_MS[match[2]]).toISOString();
  }
  const absolute = Date.parse(text);
  return Number.isNaN(absolute) ? null : new Date(absolute).toISOString();
}

/** `date` minus whole months, clamped to the end of shorter months. */
export function monthsBefore(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
