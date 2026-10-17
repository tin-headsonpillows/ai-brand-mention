import type { NextRequest } from "next/server";
import { folderInfo, fileName } from "@/lib/google/drive";
import { googleAccessToken } from "@/lib/google/oauth";
import { syncBoard, ContentError } from "@/lib/content/service";
import { writePlanConfig } from "@/lib/content/store";
import { parsePlanConfig } from "@/lib/content/validate";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

/** Saves the project's content plan settings, checks the Drive folder and template when signed in, then syncs the board. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; config?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  let config;
  try {
    config = parsePlanConfig(body?.config);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid settings" }, { status: 400 });
  }
  const warnings: string[] = [];
  const token = config.drive.folderId || config.drive.templateId ? await googleAccessToken() : null;
  if (token && config.drive.folderId) {
    try {
      const folder = await folderInfo(token, config.drive.folderId);
      config.drive.folderName = folder.name;
      if (!folder.canAdd) warnings.push(`You can't add files to "${folder.name}" - ask its owner for edit access.`);
    } catch (err) {
      warnings.push(`Drive folder: ${err instanceof Error ? err.message : "couldn't open it"}`);
    }
  }
  if (token && config.drive.templateId) {
    await fileName(token, config.drive.templateId).catch((err) => warnings.push(`Template: ${err instanceof Error ? err.message : "couldn't open it"}`));
  }
  await writePlanConfig(projectId, config);
  try {
    const board = await syncBoard(projectId);
    return Response.json({ config, board, warnings });
  } catch (err) {
    warnings.push(`Saved, but syncing failed: ${err instanceof Error ? err.message : "error"}`);
    return Response.json({ config, board: null, warnings }, { status: err instanceof ContentError ? err.status : 200 });
  }
}
