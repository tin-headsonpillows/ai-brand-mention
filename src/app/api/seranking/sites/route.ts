import type { NextRequest } from "next/server";
import { isSeRankingMock } from "@/lib/seranking/client";
import { listSites } from "@/lib/seranking/store";

/** The account's SE Ranking projects, for linking an app project to one. */
export async function GET(req: NextRequest) {
  try {
    const sites = await listSites(req.nextUrl.searchParams.get("refresh") === "1");
    return Response.json({ sites, mock: isSeRankingMock() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't load SE Ranking projects" }, { status: 502 });
  }
}
