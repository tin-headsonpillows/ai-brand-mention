import { gzipSync } from "zlib";
import type { NextRequest } from "next/server";
import { readPlace } from "@/lib/reviews/store";

/** The full review set for one business, gzipped - a few thousand reviews would otherwise approach Vercel's 4.5 MB response cap. */
export async function GET(req: NextRequest) {
  const doc = await readPlace(req.nextUrl.searchParams.get("id") ?? "");
  if (!doc) return Response.json({ error: "Unknown business" }, { status: 404 });
  return new Response(gzipSync(JSON.stringify(doc)), {
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store" },
  });
}
