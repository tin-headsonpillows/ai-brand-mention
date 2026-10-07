import type { NextRequest } from "next/server";
import { searchGoogleImages } from "@/lib/images/search";

/** Google Images via SerpApi: ~100 images per page, 1 search credit per page. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = p.get("q")?.trim() ?? "";
  if (!q) return Response.json({ error: "Enter something to search for" }, { status: 400 });
  const page = Math.max(0, Math.min(20, Number(p.get("page") ?? 0) || 0));
  try {
    return Response.json(
      await searchGoogleImages(q, page, {
        creativeCommons: p.get("cc") === "1",
        photosOnly: p.get("photos") === "1",
        largeOnly: p.get("large") === "1",
      })
    );
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 502 });
  }
}
