import type { NextRequest } from "next/server";
import { updateKnowledgeBase } from "@/lib/knowledge/store";
import { resolveProject } from "@/lib/tracking/store";

/**
 * Project context the team adds by hand: notes (add / delete) and answers to the client questions. An answer is
 * also logged as a note, so the history of what the client said stays in one place.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const action = body?.action;
  const author = text(body?.author, 80);
  const now = new Date().toISOString();
  if (action === "add") {
    const note = text(body?.note, 4000);
    if (!note) return Response.json({ error: "Write a note first" }, { status: 400 });
    const kb = await updateKnowledgeBase(projectId, (kb) => {
      kb.notes.push({ id: crypto.randomUUID(), at: now, author, note });
    });
    return Response.json({ kb });
  }
  if (action === "delete") {
    const id = text(body?.id, 80);
    const kb = await updateKnowledgeBase(projectId, (kb) => {
      kb.notes = kb.notes.filter((n) => n.id !== id);
    });
    return Response.json({ kb });
  }
  if (action === "answer") {
    const index = Number(body?.index);
    const answer = text(body?.answer, 2000);
    let error: string | null = null;
    const kb = await updateKnowledgeBase(projectId, (kb) => {
      const fact = kb.profile?.factsToVerify[index];
      if (!fact) {
        error = "That question no longer exists";
        return;
      }
      fact.answer = answer || undefined;
      fact.answeredAt = answer ? now : undefined;
      if (answer) kb.notes.push({ id: crypto.randomUUID(), at: now, author, note: `Client answer: ${fact.question} → ${answer}` });
    });
    return error ? Response.json({ error }, { status: 409 }) : Response.json({ kb });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
