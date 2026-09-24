import { fetchAccountUsage, isSerpTrackingConfigured } from "@/lib/tracking/serpapi";
import { mockAccountUsage } from "@/lib/tracking/mock";

export async function GET() {
  if (!isSerpTrackingConfigured()) {
    return Response.json(mockAccountUsage());
  }
  try {
    const usage = await fetchAccountUsage(process.env.SERPAPI_API_KEY as string);
    return Response.json(usage);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
