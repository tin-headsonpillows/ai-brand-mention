import type { NextRequest } from "next/server";
import { readSheet } from "@/lib/google/content";

/** Preview of a content-plan sheet: tabs, headers, rows (with the links behind cells) and a guessed column mapping. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const tab = req.nextUrl.searchParams.get("tab") ?? undefined;
  try {
    return Response.json(await readSheet(url, tab));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read the sheet" }, { status: 400 });
  }
}
