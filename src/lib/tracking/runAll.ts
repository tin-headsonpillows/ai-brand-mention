import { runWithConcurrency } from "@/lib/concurrency";
import { getSharedRotator, hasServerApiKeys } from "@/lib/serpKeyPool";
import { listProjectIds, readConfig, readHistory, writeHistory } from "./store";
import { todayDateString, trackKeyword } from "./run";
import { mockTrackKeyword } from "./mock";
import type { KeywordDailySnapshot, RunResult, TrackedKeyword, TrackingConfig } from "./types";

const CONCURRENCY = 4;

interface Job {
  projectId: string;
  config: TrackingConfig;
  kw: TrackedKeyword;
}

/** Tracks the given projects' active keywords through one shared pool, then appends each snapshot to its history. */
async function runProjects(projectIds: string[]): Promise<RunResult[]> {
  const date = todayDateString();
  const mock = !hasServerApiKeys();
  const rotator = getSharedRotator();

  const configs = await Promise.all(projectIds.map(async (projectId) => ({ projectId, config: await readConfig(projectId) })));
  const jobs: Job[] = configs.flatMap(({ projectId, config }) =>
    config.keywords.filter((k) => k.active).map((kw) => ({ projectId, config, kw }))
  );

  const done: Array<Job & { snapshot: KeywordDailySnapshot }> = [];
  await runWithConcurrency(
    jobs,
    CONCURRENCY,
    async (job) => ({
      ...job,
      snapshot: mock
        ? mockTrackKeyword(job.kw.keyword, job.config.brand)
        : await trackKeyword(job.kw, job.config.settings, job.config.brand, rotator),
    }),
    (result) => {
      done.push(result);
    },
    () => false
  );

  const results = new Map<string, RunResult>(
    projectIds.map((id) => [id, { date, ranAt: new Date().toISOString(), keywordResults: [], totalSearchesUsed: 0, mock }])
  );
  for (const { projectId, kw, snapshot } of done) {
    const history = (await readHistory(projectId, kw.id)) ?? { keywordId: kw.id, keyword: kw.keyword, days: [] };
    history.days = [...history.days.filter((d) => d.date !== date), snapshot].sort((a, b) => a.date.localeCompare(b.date));
    history.keyword = kw.keyword;
    await writeHistory(projectId, history);
    const result = results.get(projectId) as RunResult;
    result.totalSearchesUsed += snapshot.searchesUsed;
    result.keywordResults.push({ keywordId: kw.id, keyword: kw.keyword, searchesUsed: snapshot.searchesUsed, error: snapshot.error });
  }
  return projectIds.map((id) => results.get(id) as RunResult);
}

export async function runProject(projectId: string): Promise<RunResult> {
  const [result] = await runProjects([projectId]);
  return result;
}

export async function runAllProjects(): Promise<RunResult[]> {
  return runProjects(await listProjectIds());
}
