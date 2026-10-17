import type { NextRequest } from "next/server";
import { readSheet } from "@/lib/google/content";

export const maxDuration = 60;

/** Preview of a content-plan sheet: tabs, header row, rows (with the links behind cells) and a guessed column mapping. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const tab = req.nextUrl.searchParams.get("tab") ?? undefined;
  const headerRow = Number(req.nextUrl.searchParams.get("headerRow")) || undefined;
  try {
    return Response.json(await readSheet(url, { tab, headerRow }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read the sheet" }, { status: 400 });
  }
}
