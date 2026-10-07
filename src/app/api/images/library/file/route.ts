import type { NextRequest } from "next/server";
import { readLibraryFile } from "@/lib/images/library";
import { resolveProject } from "@/lib/tracking/store";

export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const file = await readLibraryFile(projectId, id);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.item.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(file.item.contentType === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
