import type { KeywordDailySnapshot, KeywordHistory } from "./types";

export interface VisibilityTrendPoint {
  date: string;
  organicPct: number;
  aiOverviewPct: number;
  aiModePct: number;
  keywordCount: number;
}

export function computeVisibilityTrend(histories: KeywordHistory[]): VisibilityTrendPoint[] {
  const byDate = new Map<string, { organic: number; aiOverview: number; aiMode: number; count: number }>();

  for (const history of histories) {
    for (const day of history.days) {
      const entry = byDate.get(day.date) ?? { organic: 0, aiOverview: 0, aiMode: 0, count: 0 };
      entry.count++;
      if (day.brandHit.organic.matched) entry.organic++;
      if (day.brandHit.aiOverview.matched) entry.aiOverview++;
      if (day.brandHit.aiMode.matched) entry.aiMode++;
      byDate.set(day.date, entry);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, e]) => ({
      date,
      organicPct: e.count > 0 ? e.organic / e.count : 0,
      aiOverviewPct: e.count > 0 ? e.aiOverview / e.count : 0,
      aiModePct: e.count > 0 ? e.aiMode / e.count : 0,
      keywordCount: e.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function latestSnapshot(history: KeywordHistory): KeywordDailySnapshot | null {
  if (history.days.length === 0) return null;
  return history.days[history.days.length - 1];
}
