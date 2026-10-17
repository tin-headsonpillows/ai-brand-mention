import type { NextRequest } from "next/server";
import { addItem, ContentError, moveItem, removeItem, updateItem } from "@/lib/content/service";
import { STAGES, type Stage } from "@/lib/content/types";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

async function project(body: { project?: unknown } | null) {
  return resolveProject(typeof body?.project === "string" ? body.project : null);
}

function fail(err: unknown) {
  return Response.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: err instanceof ContentError ? err.status : 400 });
}

/** Adds an article to the board (and to the plan when it can be written to). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = await project(body);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const title = str(body?.title, 300);
  if (!title) return Response.json({ error: "Give the article a title." }, { status: 400 });
  try {
    return Response.json(
      await addItem(projectId, { title, focusKeyword: str(body?.focusKeyword, 200), writer: str(body?.writer, 100), dueDate: str(body?.dueDate, 20), category: str(body?.category, 100) })
    );
  } catch (err) {
    return fail(err);
  }
}

/** Moves a card to a stage (writing the plan's status), or edits its notes / linked article. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = await project(body);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const key = str(body?.key, 100);
  try {
    if (typeof body?.stage === "string") {
      if (!STAGE_IDS.has(body.stage)) return Response.json({ error: "Unknown stage" }, { status: 400 });
      return Response.json(await moveItem(projectId, key, body.stage as Stage));
    }
    const item = await updateItem(projectId, key, {
      notes: typeof body?.notes === "string" ? body.notes : undefined,
      articleId: body?.articleId === null ? null : typeof body?.articleId === "string" ? body.articleId : undefined,
    });
    return Response.json({ item });
  } catch (err) {
    return fail(err);
  }
}

/** Removes a card added on the board (plan rows are removed in the Sheet). */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = await project(body);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  try {
    await removeItem(projectId, str(body?.key, 100));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
