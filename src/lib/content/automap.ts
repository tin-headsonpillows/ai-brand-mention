import { DEFAULT_MODEL, getOpenAIClient, isMockMode } from "../openai";
import { PLAN_FIELDS, type PlanField, type SheetPreview } from "../articles/types";
import { detectMapping } from "../google/sheetReader";
import { normHeaderText } from "./text";
import { guessStage, STAGES, type Stage, type StatusMap } from "./types";

/** What each field means, for the model (and the setup screen). */
export const FIELD_MEANING: Record<PlanField, string> = {
  title: "article title / headline (H1)",
  docUrl: "link to the article's Google Doc (draft or brief)",
  focusKeyword: "main target keyword or topic",
  secondaryKeywords: "secondary / related keywords",
  slug: "URL slug",
  metaTitle: "SEO title tag",
  metaDescription: "meta description",
  categories: "category, cluster, pillar or section",
  tags: "tags",
  publishDate: "planned publish date or month",
  status: "workflow status (e.g. writing, in review, published)",
  writer: "writer, author or person in charge",
  dueDate: "deadline for the draft",
  priority: "priority",
  action: "type of work: new article, update, refresh...",
  publishUrl: "URL of the published page",
};

/** Distinct values of the mapped Status column, most used first. */
export function statusValues(preview: Pick<SheetPreview, "rows">, statusCol: number): Array<{ value: string; count: number }> {
  if (statusCol < 0) return [];
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of preview.rows) {
    const value = (row.cells[statusCol] ?? "").trim();
    const key = normHeaderText(value);
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 40);
}

/** The stage each status value most likely means, from common wording. */
export function guessStatusMap(values: string[]): StatusMap {
  const map: StatusMap = {};
  for (const v of values) {
    const stage = guessStage(v);
    if (stage) map[normHeaderText(v)] = stage;
  }
  return map;
}

export interface AutoMapResult {
  mapping: Record<PlanField, number>;
  statusMap: StatusMap;
  by: "ai" | "rules";
}

/**
 * Asks ChatGPT which column holds each field (from headers and sample values) and what each status value means.
 * Falls back to the header rules without an API key or on any error.
 */
export async function autoMap(preview: SheetPreview): Promise<AutoMapResult> {
  const rules = detectMapping(preview.headers, preview.rows);
  const fallback = (): AutoMapResult => ({ mapping: rules, statusMap: guessStatusMap(statusValues(preview, rules.status).map((s) => s.value)), by: "rules" });
  if (isMockMode()) return fallback();
  const columns = preview.headers.map((h, i) => {
    const samples = [...new Set(preview.rows.map((r) => r.links[i] ? `${r.cells[i]} <${r.links[i]!.slice(0, 60)}>` : r.cells[i]).filter(Boolean))].slice(0, 5);
    return `${i}: "${h}" e.g. ${samples.map((s) => JSON.stringify(String(s).slice(0, 80))).join(", ") || "(empty)"}`;
  });
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "You map the columns of an SEO agency's content-plan spreadsheet to fields. Headers may be in any language (often Vietnamese or English) and wording varies.",
            "Use the sample values, not only the headers: a column of Google Docs links is docUrl; a column of live website URLs is publishUrl; month names or dates are publishDate unless the header says deadline/due.",
            "Each column maps to at most one field and each field to at most one column; use -1 when the plan has no such column. If the only text column naming the article is a 'Topic' or keyword column, use it for title too.",
            `Fields: ${PLAN_FIELDS.map((f) => `${f} = ${FIELD_MEANING[f]}`).join("; ")}.`,
            `Then map each status value to one workflow stage: ${STAGES.map((s) => `${s.id} (${s.label}: ${s.hint})`).join(", ")}.`,
            'Return ONLY JSON: {"mapping": {"<field>": <column index or -1>}, "statusMap": {"<status value exactly as given>": "<stage id>"}}.',
          ].join(" "),
        },
        {
          role: "user",
          content: [`Tab: ${preview.tab}`, "Columns:", ...columns].join("\n"),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { mapping?: Record<string, unknown>; statusMap?: Record<string, unknown> };
    const mapping = { ...rules };
    const width = preview.headers.length;
    for (const f of PLAN_FIELDS) {
      const v = parsed.mapping?.[f];
      if (typeof v === "number" && Number.isInteger(v) && v >= -1 && v < width) mapping[f] = v;
    }
    const stages = new Set(STAGES.map((s) => s.id));
    const values = statusValues(preview, mapping.status).map((s) => s.value);
    const statusMap = guessStatusMap(values);
    for (const [value, stage] of Object.entries(parsed.statusMap ?? {})) {
      if (typeof stage === "string" && stages.has(stage as Stage)) statusMap[normHeaderText(value)] = stage as Stage;
    }
    return { mapping, statusMap, by: "ai" };
  } catch {
    return fallback();
  }
}
