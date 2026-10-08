import type { NextRequest } from "next/server";
import { brandTerms } from "@/lib/brand/analyze";
import { MAX_PROMPTS, readPrompts, writePrompts } from "@/lib/brand/store";
import type { BrandPrompt, PromptSource } from "@/lib/brand/types";
import { countMentionsAny } from "@/lib/mentions";
import { readConfig, resolveProject } from "@/lib/tracking/store";

const SOURCES: PromptSource[] = ["manual", "upload", "suggested"];
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function project(req: NextRequest, body?: { project?: unknown }) {
  const requested = typeof body?.project === "string" ? body.project : req.nextUrl.searchParams.get("project");
  return resolveProject(requested);
}

export async function GET(req: NextRequest) {
  const projectId = await project(req);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json({ prompts: await readPrompts(projectId), max: MAX_PROMPTS });
}

/** Adds prompts (typed, uploaded or picked from suggestions); duplicates of existing prompts are skipped. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; prompts?: unknown; source?: unknown } | null;
  const projectId = await project(req, body ?? undefined);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const source = SOURCES.includes(body?.source as PromptSource) ? (body?.source as PromptSource) : "manual";
  const [existing, config] = await Promise.all([readPrompts(projectId), readConfig(projectId)]);
  const terms = brandTerms(config.brand);
  const seen = new Set(existing.map((p) => p.text.toLowerCase()));
  const added: BrandPrompt[] = [];
  for (const raw of Array.isArray(body?.prompts) ? body.prompts : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const text = clean(typeof raw === "string" ? raw : r.text, 400);
    if (text.length < 3 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    added.push({
      id: crypto.randomUUID(),
      text,
      topic: clean(r.topic, 40) || "General",
      branded: terms.length > 0 && countMentionsAny(text, terms) > 0,
      source,
      active: true,
      createdAt: new Date().toISOString(),
    });
  }
  const room = MAX_PROMPTS - existing.length;
  const kept = added.slice(0, Math.max(0, room));
  await writePrompts(projectId, [...existing, ...kept]);
  return Response.json({ added: kept.length, skipped: added.length - kept.length, prompts: await readPrompts(projectId) });
}

/** Edits prompts: { ids, active?, topic? } or { id, text }. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = await project(req, body ?? undefined);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const ids = new Set<string>(Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : typeof body?.id === "string" ? [body.id] : []);
  const [prompts, config] = await Promise.all([readPrompts(projectId), readConfig(projectId)]);
  const terms = brandTerms(config.brand);
  const next = prompts.map((p) => {
    if (!ids.has(p.id)) return p;
    const text = clean(body?.text, 400) || p.text;
    return {
      ...p,
      text,
      branded: terms.length > 0 && countMentionsAny(text, terms) > 0,
      active: typeof body?.active === "boolean" ? body.active : p.active,
      topic: clean(body?.topic, 40) || p.topic,
    };
  });
  await writePrompts(projectId, next);
  return Response.json({ prompts: next });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; ids?: unknown } | null;
  const projectId = await project(req, body ?? undefined);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const ids = new Set(Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const next = (await readPrompts(projectId)).filter((p) => !ids.has(p.id));
  await writePrompts(projectId, next);
  return Response.json({ prompts: next });
}
