import { readSettings, usageHistory } from "@/lib/chatgpt/usage";

/** ChatGPT Mentions API usage per day (last 13 months), by model and by key, plus the key labels. */
export async function GET() {
  const [days, settings] = await Promise.all([usageHistory(13), readSettings()]);
  const labels: Record<string, string> = { server: "Server key" };
  for (const [id, k] of Object.entries(settings.keys)) labels[id] = k.label;
  return Response.json({ days, keyLabels: labels }, { headers: { "Cache-Control": "no-store" } });
}
