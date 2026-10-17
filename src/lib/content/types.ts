import type { PlanField } from "../articles/types";
import { normHeaderText } from "./text";

/** The content workflow every project's articles move through (cards on the content board). */
export type Stage = "brief" | "draft" | "internal" | "client" | "approved" | "published";

export const STAGES: Array<{ id: Stage; label: string; hint: string }> = [
  { id: "brief", label: "Brief", hint: "planned, brief being written" },
  { id: "draft", label: "Draft", hint: "being written" },
  { id: "internal", label: "Internal review", hint: "editor / SEO check" },
  { id: "client", label: "Client review", hint: "sent to the client for approval" },
  { id: "approved", label: "Approved", hint: "ready to publish" },
  { id: "published", label: "Published", hint: "live on the site" },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>;

/** Status wording agencies use, mapped to a stage (checked in order; matched on the normalised value). */
const STATUS_RULES: Array<[Stage, RegExp]> = [
  ["published", /publish|posted|^live$|went live|^done$|completed?|uploaded|da dang|hoan thanh/],
  ["approved", /(client|customer|khach) (has |da )?(approv|signed|duyet|ok)|approved by|da duyet/],
  ["client", /client|customer|khach|sent for (approval|review)|awaiting|waiting|pending (approval|feedback)|feedback|cho (duyet|phan hoi)/],
  ["approved", /approv|signed off|ready to (publish|post|go)|scheduled|^ok$|^final$|duyet/],
  ["internal", /review|edit|proof|^qa$|check|revis|sua|kiem tra/],
  ["draft", /writ|draft|in progress|^wip$|doing|ongoing|dang viet|outline/],
  ["brief", /brief|to ?do|planned|plan|idea|new|not started|backlog|queue|^$/],
];

/** A best guess for an unmapped status value (empty = brief). */
export function guessStage(value: string): Stage | null {
  const v = normHeaderText(value);
  for (const [stage, re] of STATUS_RULES) if (re.test(v)) return stage;
  return null;
}

export type StatusMap = Record<string, Stage>;

/** Where a project's content plan lives and how its columns and status values are read. */
export interface ContentPlanConfig {
  sheetUrl: string;
  spreadsheetId: string;
  tab: string;
  headerRow: number;
  /** Column index per field (-1 = not in the sheet). */
  mapping: Record<PlanField, number>;
  /** Normalised sheet status value -> stage. */
  statusMap: StatusMap;
  /** What to write in the Status column when a card moves to a stage (blank = don't write). */
  stageValues: Partial<Record<Stage, string>>;
  drive: {
    folderUrl: string;
    folderId: string;
    folderName?: string;
    /** Optional template Doc copied for each new article; {{title}}, {{keyword}}... are filled in. */
    templateUrl: string;
    templateId: string;
    /** Doc name, with the same placeholders. */
    docName: string;
  };
  /** Emails that get comment access to a Doc when it's shared for client review. */
  clientEmails: string[];
  writeBack: {
    /** Write the new Doc's link into the plan. */
    docLinks: boolean;
    /** Write the status when a card moves. */
    status: boolean;
  };
  /** Share the Doc with the client emails when its card moves to Client review. */
  shareOnClientReview: boolean;
  updatedAt: string;
}

export interface StageChange {
  at: string;
  from: Stage | null;
  to: Stage;
  by?: string;
}

/** One article on the board, from a plan row (or added on the board). */
export interface ContentItem {
  /** `p:<uuid>` for plan rows (kept across syncs by matching Doc/title), `local:<uuid>` for items added on the board. */
  key: string;
  rowNumber: number | null;
  title: string;
  focusKeyword: string;
  secondaryKeywords: string;
  category: string;
  writer: string;
  dueDate: string;
  publishDate: string;
  priority: string;
  action: string;
  docUrl: string;
  publishUrl: string;
  /** The Status cell as last read from the sheet. */
  sheetStatus: string;
  stage: Stage;
  /** Set when the stage was changed on the board and the sheet hasn't caught up (or isn't written to). */
  boardStage?: { stage: Stage; at: string; sheetStatusThen: string };
  articleId?: string;
  sharedWith?: string[];
  notes?: string;
  history: StageChange[];
  updatedAt: string;
}

export interface ContentBoard {
  syncedAt: string | null;
  /** Where the last sync read from, e.g. "4. Content Plan" via google/public/sample. */
  source: { title: string; tab: string; via: string } | null;
  items: ContentItem[];
  warnings: string[];
}

export const PLACEHOLDERS = ["title", "keyword", "secondary_keywords", "category", "writer", "due_date", "publish_date", "project", "action"] as const;
