import { runWithConcurrency } from "@/lib/concurrency";
import { readConfig, readHistory, writeHistory } from "./store";
import { todayDateString, trackKeyword } from "./run";
import { isSerpTrackingConfigured } from "./serpapi";
import { mockTrackKeyword } from "./mock";
import type { KeywordDailySnapshot, RunResult, TrackedKeyword } from "./types";

const CONCURRENCY = 3;

export async function runAllKeywords(): Promise<RunResult> {
  const config = await readConfig();
  const date = todayDateString();
  const activeKeywords = config.keywords.filter((k) => k.active);
  const mock = !isSerpTrackingConfigured();
  const apiKey = process.env.SERPAPI_API_KEY;

  const snapshots: Array<{ kw: TrackedKeyword; snapshot: KeywordDailySnapshot }> = [];

  await runWithConcurrency(
    activeKeywords,
    CONCURRENCY,
    async (kw) => ({
      kw,
      snapshot: mock
        ? mockTrackKeyword(kw.keyword, config.brand)
        : await trackKeyword(kw, config.settings, config.brand, apiKey as string),
    }),
    (result) => {
      snapshots.push(result);
    },
    () => false
  );

  const keywordResults: RunResult["keywordResults"] = [];
  let totalSearchesUsed = 0;

  for (const { kw, snapshot } of snapshots) {
    totalSearchesUsed += snapshot.searchesUsed;
    const history = (await readHistory(kw.id)) ?? { keywordId: kw.id, keyword: kw.keyword, days: [] };
    const withoutToday = history.days.filter((d) => d.date !== date);
    history.days = [...withoutToday, snapshot].sort((a, b) => a.date.localeCompare(b.date));
    history.keyword = kw.keyword;
    await writeHistory(history);
    keywordResults.push({ keywordId: kw.id, keyword: kw.keyword, searchesUsed: snapshot.searchesUsed, error: snapshot.error });
  }

  return { date, ranAt: new Date().toISOString(), keywordResults, totalSearchesUsed, mock };
}
