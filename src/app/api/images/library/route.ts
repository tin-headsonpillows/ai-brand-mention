import type { NextRequest } from "next/server";
import { deleteFromLibrary, listLibrary, saveToLibrary } from "@/lib/images/library";
import { defaultImageModel } from "@/lib/images/generate";
import { isImagesMock } from "@/lib/images/search";
import { isMockMode } from "@/lib/openai";
import { resolveProject } from "@/lib/tracking/store";
import type { ImageKind } from "@/lib/images/types";

const KINDS: ImageKind[] = ["google", "instagram", "generated", "upload"];
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json({
    items: await listLibrary(projectId),
    mock: { search: isImagesMock(), generate: isMockMode() },
    defaultModel: defaultImageModel().id,
  });
}

/** Saves an exported JPG. Body: the image bytes; details in the query string. */
export async function POST(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const projectId = await resolveProject(p.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0];
  if (contentType !== "image/jpeg") return Response.json({ error: "Only JPG images can be saved" }, { status: 400 });
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
    return Response.json({ error: "Image must be under 4 MB" }, { status: 413 });
  }
  const kind = KINDS.includes(p.get("kind") as ImageKind) ? (p.get("kind") as ImageKind) : "upload";
  const url = (v: string | null) => (v && /^(https?:\/\/|\/api\/images\/)/.test(v) ? v.slice(0, 2000) : undefined);
  const item = await saveToLibrary(
    projectId,
    {
      kind,
      title: (p.get("title") ?? "").slice(0, 200) || "Image",
      width: Math.round(Number(p.get("width")) || 0),
      height: Math.round(Number(p.get("height")) || 0),
      contentType,
      sourceUrl: url(p.get("sourceUrl")),
      pageUrl: url(p.get("pageUrl")),
    },
    data
  );
  return Response.json({ item });
}

export async function DELETE(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  const id = req.nextUrl.searchParams.get("id");
  if (!projectId || !id) return Response.json({ error: "Missing project or id" }, { status: 400 });
  await deleteFromLibrary(projectId, id);
  return Response.json({ ok: true });
}
