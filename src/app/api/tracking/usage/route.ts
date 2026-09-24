import { getServerApiKeys, hasServerApiKeys } from "@/lib/serpKeyPool";
import { fetchActiveAccountUsage } from "@/lib/tracking/serpapi";
import { mockAccountUsage } from "@/lib/tracking/mock";

export async function GET() {
  if (!hasServerApiKeys()) {
    return Response.json(mockAccountUsage());
  }
  try {
    const usage = await fetchActiveAccountUsage(getServerApiKeys());
    return Response.json(usage);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
