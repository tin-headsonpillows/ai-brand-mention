import { readConfig, readHistory } from "@/lib/tracking/store";
import type { KeywordHistory } from "@/lib/tracking/types";

export async function GET() {
  const config = await readConfig();
  const histories: KeywordHistory[] = [];

  for (const kw of config.keywords) {
    const history = await readHistory(kw.id);
    histories.push(history ?? { keywordId: kw.id, keyword: kw.keyword, days: [] });
  }

  return Response.json({ histories });
}
