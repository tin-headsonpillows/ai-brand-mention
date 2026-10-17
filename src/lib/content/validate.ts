import { PLAN_FIELDS, type PlanField } from "../articles/types";
import { sheetIdFrom } from "../google/content";
import { fileIdFrom, folderIdFrom } from "../google/drive";
import { DEFAULT_DRIVE } from "./store";
import { normHeaderText } from "./text";
import { STAGES, type ContentPlanConfig, type Stage } from "./types";

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

/** A content plan config from the browser, checked field by field. */
export function parsePlanConfig(input: unknown): ContentPlanConfig {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sheetUrl = str(o.sheetUrl, 1000);
  const spreadsheetId = sheetUrl === "sample" ? "sample" : sheetIdFrom(sheetUrl)?.id;
  if (!spreadsheetId) throw new Error("Paste the content plan's Google Sheets link.");
  const tab = str(o.tab, 200);
  if (!tab) throw new Error("Pick the tab that holds the content plan.");
  const headerRow = Math.round(Number(o.headerRow));
  if (!(headerRow >= 1 && headerRow <= 1000)) throw new Error("The header row must be a row number.");

  const rawMapping = (o.mapping && typeof o.mapping === "object" ? o.mapping : {}) as Record<string, unknown>;
  const mapping = Object.fromEntries(
    PLAN_FIELDS.map((f) => {
      const v = Number(rawMapping[f]);
      return [f, Number.isInteger(v) && v >= 0 && v < 200 ? v : -1];
    })
  ) as Record<PlanField, number>;

  const statusMap: Record<string, Stage> = {};
  for (const [k, v] of Object.entries((o.statusMap ?? {}) as Record<string, unknown>).slice(0, 200)) {
    if (typeof v === "string" && STAGE_IDS.has(v)) statusMap[normHeaderText(k)] = v as Stage;
  }
  const stageValues: Partial<Record<Stage, string>> = {};
  for (const [k, v] of Object.entries((o.stageValues ?? {}) as Record<string, unknown>)) {
    const value = str(v, 100);
    if (STAGE_IDS.has(k) && value) {
      stageValues[k as Stage] = value;
      // What the board writes must read back as the same stage.
      statusMap[normHeaderText(value)] = k as Stage;
    }
  }

  const d = (o.drive && typeof o.drive === "object" ? o.drive : {}) as Record<string, unknown>;
  const folderUrl = str(d.folderUrl, 1000);
  const folderId = folderUrl ? folderIdFrom(folderUrl) : "";
  if (folderUrl && !folderId) throw new Error("That isn't a Google Drive folder link (it should contain /folders/...).");
  const templateUrl = str(d.templateUrl, 1000);
  const templateId = templateUrl ? fileIdFrom(templateUrl) : "";
  if (templateUrl && !templateId) throw new Error("That isn't a Google Docs link for the template.");

  const clientEmails = (Array.isArray(o.clientEmails) ? o.clientEmails : str(o.clientEmails, 2000).split(/[\s,;]+/))
    .map((e) => str(e, 200).toLowerCase())
    .filter(Boolean);
  const bad = clientEmails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) throw new Error(`"${bad}" isn't an email address.`);

  const wb = (o.writeBack && typeof o.writeBack === "object" ? o.writeBack : {}) as Record<string, unknown>;
  return {
    sheetUrl,
    spreadsheetId,
    tab,
    headerRow,
    mapping,
    statusMap,
    stageValues,
    drive: { ...DEFAULT_DRIVE, folderUrl, folderId: folderId ?? "", templateUrl, templateId: templateId ?? "", docName: str(d.docName, 200) || DEFAULT_DRIVE.docName },
    clientEmails: [...new Set(clientEmails)].slice(0, 20),
    writeBack: { docLinks: wb.docLinks !== false, status: wb.status !== false },
    shareOnClientReview: o.shareOnClientReview === true,
    updatedAt: new Date().toISOString(),
  };
}
