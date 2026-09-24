import { gzipSync } from "zlib";
import type { NextRequest } from "next/server";
import { readConfig, readHistory } from "@/lib/tracking/store";
import type { KeywordHistory } from "@/lib/tracking/types";

/**
 * Tracking up to 100 results per keyword per day makes history large, and Vercel caps a function's
 * response body at 4.5 MB - so the client asks only for its selected range (`since=YYYY-MM-DD`) and the
 * body is sent gzipped (this JSON compresses roughly 8-10x).
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const validSince = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null;
  const config = await readConfig();
  const histories: KeywordHistory[] = [];

  for (const kw of config.keywords) {
    const history = (await readHistory(kw.id)) ?? { keywordId: kw.id, keyword: kw.keyword, days: [] };
    histories.push(validSince ? { ...history, days: history.days.filter((d) => d.date >= validSince) } : history);
  }

  return new Response(gzipSync(JSON.stringify({ histories })), {
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "Cache-Control": "no-store",
    },
  });
}
