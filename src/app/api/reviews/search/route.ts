import type { NextRequest } from "next/server";
import { searchPlaces } from "@/lib/reviews/serpapi";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const raw = req.nextUrl.searchParams.get("source");
  const source = raw === "hotels" || raw === "tripadvisor" ? raw : "maps";
  if (!q) return Response.json({ error: "Enter a business name or a link" }, { status: 400 });
  try {
    return Response.json({ candidates: await searchPlaces(q, source) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 502 });
  }
}
