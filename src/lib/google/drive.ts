import { columnLetter } from "./sheetReader";

/**
 * Writes to the viewer's Google account: creates article Docs in a project's Drive folder (from a template Doc
 * or as a generated brief), writes Doc links and statuses into the content plan, and shares Docs with clients.
 * Every call uses the signed-in viewer's token, so it can only touch files that viewer can edit.
 */

type Json = Record<string, unknown>;

async function google(url: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<Json> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string } };
  if (!res.ok) {
    const message = data.error?.message ?? `Google API error ${res.status}`;
    if (res.status === 403 || res.status === 404) throw new Error(`Google says: ${message} - check that the signed-in account can edit this file or folder.`);
    throw new Error(message);
  }
  return data;
}

export function folderIdFrom(url: string): string | null {
  const v = url.trim();
  return v.match(/\/folders\/([\w-]{10,})/)?.[1] ?? v.match(/[?&]id=([\w-]{10,})/)?.[1] ?? (/^[\w-]{20,}$/.test(v) ? v : null);
}

export function fileIdFrom(url: string): string | null {
  const v = url.trim();
  return v.match(/\/d\/([\w-]{20,})/)?.[1] ?? v.match(/[?&]id=([\w-]{20,})/)?.[1] ?? (/^[\w-]{20,}$/.test(v) ? v : null);
}

export const docUrlOf = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

const DRIVE = "https://www.googleapis.com/drive/v3/files";

/** A folder's name, and whether the viewer can add files to it. */
export async function folderInfo(token: string, folderId: string): Promise<{ id: string; name: string; canAdd: boolean }> {
  const f = await google(`${DRIVE}/${folderId}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`, token);
  if (f.mimeType !== "application/vnd.google-apps.folder") throw new Error("That link isn't a Drive folder.");
  return { id: String(f.id), name: String(f.name ?? ""), canAdd: (f.capabilities as Json | undefined)?.canAddChildren !== false };
}

export async function fileName(token: string, fileId: string): Promise<string> {
  const f = await google(`${DRIVE}/${fileId}?fields=name,mimeType&supportsAllDrives=true`, token);
  if (f.mimeType !== "application/vnd.google-apps.document") throw new Error("The template must be a Google Doc.");
  return String(f.name ?? "");
}

/** Fills {{placeholder}} tokens (case and spacing ignored) from values. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w ]+?)\s*\}\}/g, (_, key: string) => values[key.toLowerCase().replace(/ /g, "_")] ?? "");
}

export interface BriefSection {
  heading: string;
  lines: string[];
}

/** A new Doc in the folder: a copy of the template with placeholders filled, or a blank Doc with a brief. */
export async function createDocInFolder(
  token: string,
  input: { folderId: string; name: string; templateId?: string; values: Record<string, string>; title: string; brief: BriefSection[] }
): Promise<{ id: string; url: string }> {
  let id: string;
  if (input.templateId) {
    const copy = await google(`${DRIVE}/${input.templateId}/copy?supportsAllDrives=true&fields=id`, token, {
      method: "POST",
      body: { name: input.name, parents: [input.folderId] },
    });
    id = String(copy.id);
    const requests = Object.entries(input.values).flatMap(([key, value]) =>
      [`{{${key}}}`, `{{ ${key} }}`, `{{${key.toUpperCase()}}}`].map((token) => ({ replaceAllText: { containsText: { text: token, matchCase: true }, replaceText: value } }))
    );
    if (requests.length) await google(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, token, { method: "POST", body: { requests } });
  } else {
    const created = await google(`${DRIVE}?supportsAllDrives=true&fields=id`, token, {
      method: "POST",
      body: { name: input.name, mimeType: "application/vnd.google-apps.document", parents: [input.folderId] },
    });
    id = String(created.id);
    await google(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, token, { method: "POST", body: { requests: briefRequests(input.title, input.brief) } });
  }
  return { id, url: docUrlOf(id) };
}

/** Docs API requests that write a title, then each brief section as a Heading 2 with its lines. */
export function briefRequests(title: string, sections: BriefSection[]): Json[] {
  const parts: Array<{ text: string; style: "TITLE" | "HEADING_2" | "NORMAL_TEXT" }> = [{ text: title, style: "TITLE" }];
  for (const s of sections) {
    parts.push({ text: s.heading, style: "HEADING_2" });
    for (const line of s.lines.length ? s.lines : [""]) parts.push({ text: line, style: "NORMAL_TEXT" });
  }
  const text = parts.map((p) => p.text).join("\n") + "\n";
  const requests: Json[] = [{ insertText: { location: { index: 1 }, text } }];
  // Docs indexes count UTF-16 code units, like JS string lengths.
  let index = 1;
  for (const p of parts) {
    const end = index + p.text.length + 1;
    if (p.style !== "NORMAL_TEXT") requests.push({ updateParagraphStyle: { range: { startIndex: index, endIndex: end }, paragraphStyle: { namedStyleType: p.style }, fields: "namedStyleType" } });
    index = end;
  }
  return requests;
}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
export const cellRange = (tab: string, col: number, row: number) => `${quoteTab(tab)}!${columnLetter(col)}${row}`;

/** A HYPERLINK formula showing `label` (Sheets formulas escape quotes by doubling them). */
export const hyperlink = (url: string, label: string) => `=HYPERLINK("${url.replace(/"/g, '""')}","${(label || url).replace(/"/g, '""').slice(0, 250)}")`;

/** Writes cells as if typed (so =HYPERLINK formulas and dates work). */
export async function writeCells(token: string, spreadsheetId: string, cells: Array<{ range: string; value: string }>): Promise<void> {
  if (!cells.length) return;
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, token, {
    method: "POST",
    body: { valueInputOption: "USER_ENTERED", data: cells.map((c) => ({ range: c.range, values: [[c.value]] })) },
  });
}

/** One row's cell text, to check a row still holds the article before writing to it. */
export async function readRow(token: string, spreadsheetId: string, tab: string, row: number): Promise<string[]> {
  const data = await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoteTab(tab)}!A${row}:AZ${row}`)}`, token);
  const values = (data.values as unknown[][] | undefined)?.[0] ?? [];
  return values.map((v) => String(v ?? "").trim());
}

/** Adds a row after the plan's last row; returns its row number. */
export async function appendRow(token: string, spreadsheetId: string, tab: string, headerRow: number, values: string[]): Promise<number | null> {
  const data = await google(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoteTab(tab)}!A${headerRow}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: "POST", body: { values: [values] } }
  );
  const range = String((data.updates as Json | undefined)?.updatedRange ?? "");
  const row = range.match(/![A-Z]+(\d+)/)?.[1];
  return row ? Number(row) : null;
}

/** Gives each email comment access to a file (Google emails them a link), skipping people who already have access. */
export async function shareFile(token: string, fileId: string, emails: string[], message: string, role: "commenter" | "reader" | "writer" = "commenter"): Promise<string[]> {
  const existing = await google(`${DRIVE}/${fileId}/permissions?fields=permissions(emailAddress,role)&supportsAllDrives=true`, token).catch(() => ({ permissions: [] }));
  const have = new Set(((existing.permissions as Json[] | undefined) ?? []).map((p) => String(p.emailAddress ?? "").toLowerCase()));
  const shared: string[] = [];
  for (const email of emails) {
    if (have.has(email.toLowerCase())) {
      shared.push(email);
      continue;
    }
    await google(`${DRIVE}/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=true&emailMessage=${encodeURIComponent(message.slice(0, 1000))}`, token, {
      method: "POST",
      body: { type: "user", role, emailAddress: email },
    });
    shared.push(email);
  }
  return shared;
}
