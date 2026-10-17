import { readSheet } from "../google/content";
import { appendRow, cellRange, createDocInFolder, fillPlaceholders, hyperlink, readRow, shareFile, writeCells, type BriefSection } from "../google/drive";
import { GoogleAccessError, googleWriteToken } from "../google/oauth";
import { readConfig } from "../tracking/store";
import { boardFromPreview, readBoard, readPlanConfig, writeBoard, writePlanConfig } from "./store";
import { normHeaderText } from "./text";
import { STAGE_LABEL, type ContentBoard, type ContentItem, type ContentPlanConfig, type Stage } from "./types";

/**
 * The content workflow: syncing a project's board from its plan, moving cards (and writing the new status to the
 * plan), creating each article's Google Doc in the project's folder (and linking it in the plan), and sharing
 * Docs with the client. The sample plan simulates every Google write, so the whole flow can be tried without it.
 */

export class ContentError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const isSample = (config: ContentPlanConfig) => config.spreadsheetId === "sample";

export async function requireConfig(projectId: string): Promise<ContentPlanConfig> {
  const config = await readPlanConfig(projectId);
  if (!config) throw new ContentError("Set up this project's content plan first (Articles → Settings → Content plan).", 409);
  return config;
}

export async function syncBoard(projectId: string): Promise<ContentBoard> {
  const config = await requireConfig(projectId);
  const preview = await readSheet(config.sheetUrl, { tab: config.tab, headerRow: config.headerRow });
  if (preview.tab !== config.tab) throw new ContentError(`The tab "${config.tab}" is no longer in this spreadsheet - pick the plan's tab again in Settings.`);
  const board = boardFromPreview(preview, config, await readBoard(projectId));
  await writeBoard(projectId, board);
  return board;
}

/** Values for {{placeholders}} in Doc names and templates. */
export function placeholderValues(item: ContentItem, project: string): Record<string, string> {
  return {
    title: item.title,
    keyword: item.focusKeyword,
    secondary_keywords: item.secondaryKeywords,
    category: item.category,
    writer: item.writer,
    due_date: item.dueDate,
    publish_date: item.publishDate,
    project,
    action: item.action,
  };
}

/** The brief written into a new blank Doc (no template). */
export function briefFor(item: ContentItem, project: string): BriefSection[] {
  const line = (label: string, value: string) => (value ? [`${label}: ${value}`] : []);
  return [
    {
      heading: "Brief",
      lines: [
        ...line("Project", project),
        ...line("Focus keyword", item.focusKeyword),
        ...line("Secondary keywords", item.secondaryKeywords),
        ...line("Category", item.category),
        ...line("Type", item.action),
        ...line("Writer", item.writer),
        ...line("Due", item.dueDate),
        ...line("Publish", item.publishDate),
      ],
    },
    { heading: "Search intent & angle", lines: ["Who is searching, what they need, and what this article offers that the current top results don't."] },
    { heading: "Outline", lines: ["H2: ", "H2: ", "H2: "] },
    { heading: "Draft", lines: [""] },
  ];
}

async function projectName(projectId: string): Promise<string> {
  try {
    return (await readConfig(projectId)).brand.name;
  } catch {
    return "";
  }
}

/** Checks a plan row still holds this article (rows move when people insert or sort), so writes land in the right row. */
async function verifyRow(token: string, config: ContentPlanConfig, item: ContentItem): Promise<void> {
  if (!item.rowNumber) throw new ContentError("This card isn't linked to a plan row.");
  const cells = await readRow(token, config.spreadsheetId, config.tab, item.rowNumber);
  const check = config.mapping.title >= 0 ? { col: config.mapping.title, want: item.title } : { col: config.mapping.focusKeyword, want: item.focusKeyword };
  if (check.col < 0 || !check.want) return;
  if (normHeaderText(cells[check.col] ?? "") !== normHeaderText(check.want)) {
    throw new ContentError(`Row ${item.rowNumber} of the plan no longer holds "${item.title}" - press Sync, then try again.`, 409);
  }
}

/** What to write in the plan's Status column for a stage. */
export const statusValueFor = (config: ContentPlanConfig, stage: Stage) => config.stageValues[stage]?.trim() || STAGE_LABEL[stage];

async function writeToken(config: ContentPlanConfig): Promise<string | null> {
  if (isSample(config)) return null;
  return googleWriteToken();
}

function findItem(board: ContentBoard, key: string): ContentItem {
  const item = board.items.find((i) => i.key === key);
  if (!item) throw new ContentError("That card isn't on the board any more - press Sync.", 404);
  return item;
}

export interface MoveResult {
  item: ContentItem;
  /** What happened in the plan: written, simulated (sample), or kept on the board only (with why). */
  sheet: "written" | "simulated" | "board-only";
  note?: string;
  shared?: string[];
}

export async function moveItem(projectId: string, key: string, stage: Stage, by = "board"): Promise<MoveResult> {
  const config = await requireConfig(projectId);
  const board = await readBoard(projectId);
  const item = findItem(board, key);
  if (item.stage === stage) return { item, sheet: "board-only" };
  const at = new Date().toISOString();
  const from = item.stage;
  let sheet: MoveResult["sheet"] = "board-only";
  let note: string | undefined;
  const canWriteStatus = config.writeBack.status && config.mapping.status >= 0 && item.rowNumber !== null;
  if (canWriteStatus && isSample(config)) sheet = "simulated";
  else if (canWriteStatus) {
    try {
      const token = await googleWriteToken();
      await verifyRow(token, config, item);
      const value = statusValueFor(config, stage);
      await writeCells(token, config.spreadsheetId, [{ range: cellRange(config.tab, config.mapping.status, item.rowNumber!), value }]);
      item.sheetStatus = value;
      sheet = "written";
    } catch (err) {
      if (!(err instanceof GoogleAccessError)) throw err;
      note = `Kept on the board only: ${err.message}`;
    }
  } else if (!config.writeBack.status) note = "Status write-back is off, so the plan isn't changed.";
  else if (config.mapping.status < 0) note = "The plan has no Status column mapped, so the stage is kept on the board.";
  item.stage = stage;
  // A board-set stage holds until the plan's status for the row changes.
  item.boardStage = sheet === "written" ? undefined : { stage, at, sheetStatusThen: item.sheetStatus };
  item.history = [...item.history, { at, from, to: stage, by }].slice(-30);
  item.updatedAt = at;

  let shared: string[] | undefined;
  if (stage === "client" && config.shareOnClientReview && config.clientEmails.length && item.docUrl) {
    try {
      shared = await shareItemDoc(config, item, config.clientEmails, await projectName(projectId));
    } catch (err) {
      note = [note, `Couldn't share the Doc: ${err instanceof Error ? err.message : "error"}`].filter(Boolean).join(" ");
    }
  }
  await writeBoard(projectId, board);
  return { item, sheet, note, shared };
}

async function shareItemDoc(config: ContentPlanConfig, item: ContentItem, emails: string[], project: string): Promise<string[]> {
  const fileId = item.docUrl.match(/\/document\/d\/([\w-]{20,})/)?.[1];
  let shared: string[];
  if (isSample(config) || item.docUrl.startsWith("sample:")) shared = emails;
  else {
    if (!fileId) throw new ContentError("The card's Doc link isn't a Google Doc.");
    const token = await googleWriteToken();
    shared = await shareFile(token, fileId, emails, `${project ? `${project}: ` : ""}"${item.title}" is ready for your review. Please add comments in the Doc.`);
  }
  item.sharedWith = [...new Set([...(item.sharedWith ?? []), ...shared])];
  return shared;
}

export async function shareItem(projectId: string, key: string, emails?: string[]): Promise<{ item: ContentItem; shared: string[]; simulated: boolean }> {
  const config = await requireConfig(projectId);
  const board = await readBoard(projectId);
  const item = findItem(board, key);
  const to = (emails?.length ? emails : config.clientEmails).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!to.length) throw new ContentError("Add the client's email addresses in Settings → Content plan (or enter one here).");
  if (!item.docUrl) throw new ContentError("Create the article's Doc first.");
  const shared = await shareItemDoc(config, item, to, await projectName(projectId));
  await writeBoard(projectId, board);
  return { item, shared, simulated: isSample(config) };
}

export const MAX_DOCS_PER_CALL = 10;

export interface DocsResult {
  created: Array<{ key: string; title: string; docUrl: string; linked: boolean }>;
  failed: Array<{ key: string; title: string; error: string }>;
  simulated: boolean;
  /** Set when a "Google Doc" column was added to the plan for the links. */
  addedColumn?: string;
}

/** Creates a Doc for each card without one, in the project's Drive folder, and links it in the plan. */
export async function createDocs(projectId: string, keys: string[]): Promise<DocsResult> {
  const config = await requireConfig(projectId);
  const sample = isSample(config);
  if (!sample && !config.drive.folderId) throw new ContentError("Link the project's Google Drive folder first (Settings → Content plan).");
  const board = await readBoard(projectId);
  const items = keys
    .map((k) => board.items.find((i) => i.key === k))
    .filter((i): i is ContentItem => Boolean(i && !i.docUrl))
    .slice(0, MAX_DOCS_PER_CALL);
  const token = await writeToken(config);
  const project = await projectName(projectId);
  const result: DocsResult = { created: [], failed: [], simulated: sample };

  // Plans without a Doc column get one, after the last used column.
  if (!sample && token && config.writeBack.docLinks && config.mapping.docUrl < 0 && items.some((i) => i.rowNumber)) {
    const preview = await readSheet(config.sheetUrl, { tab: config.tab, headerRow: config.headerRow });
    const col = preview.headers.length;
    await writeCells(token, config.spreadsheetId, [{ range: cellRange(config.tab, col, config.headerRow), value: "Google Doc" }]);
    config.mapping = { ...config.mapping, docUrl: col };
    config.updatedAt = new Date().toISOString();
    await writePlanConfig(projectId, config);
    result.addedColumn = "Google Doc";
  }

  for (const item of items) {
    try {
      const values = placeholderValues(item, project);
      const name = fillPlaceholders(config.drive.docName || "{{title}}", values).trim() || item.title;
      let url: string;
      let linked = false;
      if (sample || !token) {
        url = `sample:new:${encodeURIComponent(item.title)}`;
        linked = config.writeBack.docLinks;
      } else {
        if (config.writeBack.docLinks && item.rowNumber) await verifyRow(token, config, item);
        url = (await createDocInFolder(token, { folderId: config.drive.folderId, name, templateId: config.drive.templateId || undefined, values, title: item.title, brief: briefFor(item, project) })).url;
        if (config.writeBack.docLinks && item.rowNumber && config.mapping.docUrl >= 0) {
          // A Doc column that is also the title column keeps the title as the link text.
          const label = config.mapping.docUrl === config.mapping.title ? item.title : name;
          await writeCells(token, config.spreadsheetId, [{ range: cellRange(config.tab, config.mapping.docUrl, item.rowNumber), value: hyperlink(url, label) }]);
          linked = true;
        }
      }
      item.docUrl = url;
      item.updatedAt = new Date().toISOString();
      result.created.push({ key: item.key, title: item.title, docUrl: url, linked });
    } catch (err) {
      result.failed.push({ key: item.key, title: item.title, error: err instanceof Error ? err.message : "Couldn't create the Doc" });
      if (err instanceof GoogleAccessError) break;
    }
  }
  await writeBoard(projectId, board);
  return result;
}

export interface NewItem {
  title: string;
  focusKeyword?: string;
  writer?: string;
  dueDate?: string;
  category?: string;
}

/** Adds an article: as a new plan row when the plan can be written to, otherwise on the board only. */
export async function addItem(projectId: string, input: NewItem): Promise<{ item: ContentItem; sheet: "written" | "board-only"; note?: string }> {
  const config = await requireConfig(projectId);
  const board = await readBoard(projectId);
  const at = new Date().toISOString();
  const item: ContentItem = {
    key: `local:${crypto.randomUUID()}`,
    rowNumber: null,
    title: input.title,
    focusKeyword: input.focusKeyword ?? "",
    secondaryKeywords: "",
    category: input.category ?? "",
    writer: input.writer ?? "",
    dueDate: input.dueDate ?? "",
    publishDate: "",
    priority: "",
    action: "",
    docUrl: "",
    publishUrl: "",
    sheetStatus: "",
    stage: "brief",
    history: [{ at, from: null, to: "brief", by: "board" }],
    updatedAt: at,
  };
  let sheet: "written" | "board-only" = "board-only";
  let note: string | undefined;
  if (!isSample(config)) {
    try {
      const token = await googleWriteToken();
      const width = Math.max(...Object.values(config.mapping)) + 1;
      const row = Array.from({ length: width }, () => "");
      const put = (col: number, value: string) => {
        if (col >= 0 && value) row[col] = value;
      };
      put(config.mapping.title >= 0 ? config.mapping.title : config.mapping.focusKeyword, item.title);
      if (config.mapping.title >= 0) put(config.mapping.focusKeyword, item.focusKeyword);
      put(config.mapping.writer, item.writer);
      put(config.mapping.dueDate, item.dueDate);
      put(config.mapping.categories, item.category);
      put(config.mapping.status, config.writeBack.status ? statusValueFor(config, "brief") : "");
      const rowNumber = await appendRow(token, config.spreadsheetId, config.tab, config.headerRow, row);
      if (rowNumber) {
        item.key = `p:${crypto.randomUUID()}`;
        item.rowNumber = rowNumber;
        item.sheetStatus = row[config.mapping.status] ?? "";
        sheet = "written";
      }
    } catch (err) {
      if (!(err instanceof GoogleAccessError)) throw err;
      note = `Added on the board only: ${err.message}`;
    }
  }
  board.items.push(item);
  await writeBoard(projectId, board);
  return { item, sheet, note };
}

export async function updateItem(projectId: string, key: string, patch: { notes?: string; articleId?: string | null; docUrl?: string }): Promise<ContentItem> {
  const board = await readBoard(projectId);
  const item = findItem(board, key);
  if (patch.notes !== undefined) item.notes = patch.notes.slice(0, 4000);
  if (patch.articleId !== undefined) item.articleId = patch.articleId ?? undefined;
  if (patch.docUrl !== undefined) item.docUrl = patch.docUrl;
  item.updatedAt = new Date().toISOString();
  await writeBoard(projectId, board);
  return item;
}

export async function removeItem(projectId: string, key: string): Promise<void> {
  const board = await readBoard(projectId);
  if (!key.startsWith("local:")) throw new ContentError("Cards from the plan are removed by deleting their row in the Sheet.");
  board.items = board.items.filter((i) => i.key !== key);
  await writeBoard(projectId, board);
}
