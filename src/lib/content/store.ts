import { readJson, writeJson } from "../blobJson";
import { PLAN_FIELDS, type PlanField, type SheetPreview } from "../articles/types";
import { normHeaderText, planDate } from "./text";
import { guessStage, type ContentBoard, type ContentItem, type ContentPlanConfig, type Stage } from "./types";

/** Per-project content plan settings and the board built from it, in the private Blob store. */
const configPath = (projectId: string) => `content/${projectId}/config.json`;
const boardPath = (projectId: string) => `content/${projectId}/board.json`;

export const DEFAULT_DRIVE: ContentPlanConfig["drive"] = { folderUrl: "", folderId: "", templateUrl: "", templateId: "", docName: "{{title}}" };

export async function readPlanConfig(projectId: string): Promise<ContentPlanConfig | null> {
  const c = await readJson<ContentPlanConfig>(configPath(projectId));
  if (!c) return null;
  // Configs saved before a field existed get its default.
  return {
    ...c,
    mapping: { ...(Object.fromEntries(PLAN_FIELDS.map((f) => [f, -1])) as Record<PlanField, number>), ...c.mapping },
    stageValues: c.stageValues ?? {},
    drive: { ...DEFAULT_DRIVE, ...(c.drive as Partial<ContentPlanConfig["drive"]> | undefined) },
    clientEmails: c.clientEmails ?? [],
    writeBack: { docLinks: true, status: true, ...(c.writeBack as Partial<ContentPlanConfig["writeBack"]> | undefined) },
    shareOnClientReview: c.shareOnClientReview ?? false,
  };
}

export async function writePlanConfig(projectId: string, config: ContentPlanConfig): Promise<void> {
  await writeJson(configPath(projectId), config);
}

export async function readBoard(projectId: string): Promise<ContentBoard> {
  return (await readJson<ContentBoard>(boardPath(projectId))) ?? { syncedAt: null, source: null, items: [], warnings: [] };
}

export async function writeBoard(projectId: string, board: ContentBoard): Promise<void> {
  await writeJson(boardPath(projectId), board);
}

type Row = SheetPreview["rows"][number];

export function cellOf(row: Row, mapping: Record<PlanField, number>, field: PlanField): string {
  const col = mapping[field];
  if (col === undefined || col < 0) return "";
  if (field === "docUrl" || field === "publishUrl") {
    const text = row.cells[col] ?? "";
    return row.links[col] ?? (/^https?:\/\//.test(text) || text.startsWith("sample:") ? text : "");
  }
  return row.cells[col] ?? "";
}

/** The stage a sheet status means for this project (its mapping, then common wording). */
export function stageForStatus(config: Pick<ContentPlanConfig, "statusMap">, status: string, publishUrl = ""): Stage {
  const mapped = config.statusMap[normHeaderText(status)];
  if (mapped) return mapped;
  if (!status.trim() && publishUrl) return "published";
  return guessStage(status) ?? "brief";
}

const sameText = (a: string, b: string) => Boolean(a) && normHeaderText(a) === normHeaderText(b);

/** Finds a plan row's board item from the last sync: same Doc, else same title, else same keyword. */
export function matchItem(items: ContentItem[], fields: { docUrl: string; title: string; focusKeyword: string }): ContentItem | undefined {
  return (
    (fields.docUrl ? items.find((i) => i.docUrl === fields.docUrl) : undefined) ??
    items.find((i) => sameText(i.title, fields.title)) ??
    (fields.title ? undefined : items.find((i) => sameText(i.focusKeyword, fields.focusKeyword)))
  );
}

/**
 * Rebuilds the board from the plan. Items keep their board-only data (article link, sharing, notes, history),
 * and a stage set on the board stays until the sheet's status for that row changes.
 */
export function boardFromPreview(preview: SheetPreview, config: ContentPlanConfig, previous: ContentBoard, now = new Date()): ContentBoard {
  const at = now.toISOString();
  const used = new Set<string>();
  const items: ContentItem[] = [];
  for (const row of preview.rows) {
    const get = (f: PlanField) => cellOf(row, config.mapping, f).trim();
    const fields = { docUrl: get("docUrl"), title: get("title"), focusKeyword: get("focusKeyword") };
    if (!fields.title && !fields.focusKeyword && !fields.docUrl) continue;
    const prev = matchItem(
      previous.items.filter((i) => !used.has(i.key)),
      fields
    );
    if (prev) used.add(prev.key);
    const sheetStatus = get("status");
    const publishUrl = get("publishUrl");
    const sheetStage = stageForStatus(config, sheetStatus, publishUrl);
    const keepBoard = prev?.boardStage && normHeaderText(prev.boardStage.sheetStatusThen) === normHeaderText(sheetStatus);
    const stage = keepBoard && prev?.boardStage ? prev.boardStage.stage : sheetStage;
    const history = [...(prev?.history ?? [])];
    if (prev && prev.stage !== stage) history.push({ at, from: prev.stage, to: stage, by: "sheet" });
    items.push({
      key: prev?.key ?? `p:${crypto.randomUUID()}`,
      rowNumber: row.rowNumber,
      title: fields.title || fields.focusKeyword || "Untitled",
      focusKeyword: fields.focusKeyword,
      secondaryKeywords: get("secondaryKeywords"),
      category: get("categories"),
      writer: get("writer"),
      dueDate: planDate(get("dueDate")),
      publishDate: planDate(get("publishDate")) || get("publishDate"),
      priority: get("priority"),
      action: get("action"),
      docUrl: fields.docUrl || prev?.docUrl || "",
      publishUrl,
      sheetStatus,
      stage,
      boardStage: keepBoard ? prev?.boardStage : undefined,
      articleId: prev?.articleId,
      sharedWith: prev?.sharedWith,
      notes: prev?.notes,
      history: history.slice(-30),
      updatedAt: prev && prev.stage === stage && prev.sheetStatus === sheetStatus ? prev.updatedAt : at,
    });
  }
  // Items added on the board (not in the sheet) stay.
  for (const item of previous.items) if (item.key.startsWith("local:")) items.push(item);
  const warnings: string[] = [];
  if (config.mapping.title < 0 && config.mapping.focusKeyword < 0) warnings.push("No Title or Keyword column is mapped, so cards have no names.");
  if (config.mapping.status < 0) warnings.push("No Status column is mapped: stages are only kept on the board.");
  return { syncedAt: at, source: { title: preview.title, tab: preview.tab, via: preview.via }, items, warnings };
}
