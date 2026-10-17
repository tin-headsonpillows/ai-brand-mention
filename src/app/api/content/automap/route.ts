import type { NextRequest } from "next/server";
import { autoMap } from "@/lib/content/automap";
import { readSheet } from "@/lib/google/content";

export const maxDuration = 60;

/** Reads a plan tab and suggests the column for each field and the stage for each status value (ChatGPT, else rules). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: unknown; tab?: unknown; headerRow?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  try {
    const preview = await readSheet(url, { tab: typeof body?.tab === "string" ? body.tab : undefined, headerRow: Number(body?.headerRow) || undefined });
    return Response.json({ preview, ...(await autoMap(preview)) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read the sheet" }, { status: 400 });
  }
}
