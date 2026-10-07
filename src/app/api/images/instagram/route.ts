import type { NextRequest } from "next/server";
import { fetchInstagramProfile, parseInstagramUsername } from "@/lib/images/search";

/** An Instagram profile's posts via SerpApi (1 search credit per page). */
export async function GET(req: NextRequest) {
  const username = parseInstagramUsername(req.nextUrl.searchParams.get("username") ?? "");
  if (!username) return Response.json({ error: "Enter an Instagram username or profile link" }, { status: 400 });
  const token = req.nextUrl.searchParams.get("token");
  try {
    return Response.json(await fetchInstagramProfile(username, token));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't load that profile" }, { status: 502 });
  }
}
