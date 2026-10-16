import type { NextRequest } from "next/server";
import { isMockMode } from "@/lib/openai";
import { SERVER_KEY_ID } from "@/lib/chatgpt/pricing";
import { clampUsd, limitFor, readMonth, readSettings, serverDefaultModel, today, writeSettings, type MentionsSettings } from "@/lib/chatgpt/usage";

/** ChatGPT Mentions settings: default model, daily limits, and the keys seen so far with today's spend. */
async function view(settings: MentionsSettings) {
  const day = today();
  const usage = (await readMonth(day.slice(0, 7))).days[day];
  const serverKey = Boolean(process.env.OPENAI_API_KEY);
  const ids = new Set([...(serverKey ? [SERVER_KEY_ID] : []), ...Object.keys(settings.keys)]);
  return {
    model: settings.model,
    serverDefaultModel: serverDefaultModel(),
    dailyLimitUsd: settings.dailyLimitUsd,
    serverKey,
    mock: isMockMode(),
    keys: [...ids].map((id) => ({
      id,
      label: settings.keys[id]?.label ?? "Server key",
      lastUsed: settings.keys[id]?.lastUsed ?? null,
      ownLimitUsd: typeof settings.keyLimits[id] === "number" ? settings.keyLimits[id] : null,
      limitUsd: limitFor(settings, id),
      spentTodayUsd: usage?.byKey[id]?.costUsd ?? 0,
    })),
  };
}

export async function GET() {
  return Response.json(await view(await readSettings()), { headers: { "Cache-Control": "no-store" } });
}

interface Body {
  model?: string | null;
  dailyLimitUsd?: number;
  keyLimit?: { id: string; limitUsd: number | null };
  forgetKey?: string;
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  if (body.dailyLimitUsd !== undefined && !(typeof body.dailyLimitUsd === "number" && body.dailyLimitUsd >= 0)) {
    return Response.json({ error: "The daily limit must be a number of dollars, 0 or more." }, { status: 400 });
  }
  if (body.keyLimit && body.keyLimit.limitUsd !== null && !(typeof body.keyLimit.limitUsd === "number" && body.keyLimit.limitUsd >= 0)) {
    return Response.json({ error: "A key's limit must be a number of dollars, 0 or more." }, { status: 400 });
  }
  const next = await writeSettings((s) => {
    const out: MentionsSettings = { ...s, keyLimits: { ...s.keyLimits }, keys: { ...s.keys } };
    if (body.model !== undefined) out.model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 80) : null;
    if (body.dailyLimitUsd !== undefined) out.dailyLimitUsd = clampUsd(body.dailyLimitUsd);
    if (body.keyLimit) {
      if (body.keyLimit.limitUsd === null) delete out.keyLimits[body.keyLimit.id];
      else out.keyLimits[body.keyLimit.id] = clampUsd(body.keyLimit.limitUsd);
    }
    if (body.forgetKey && body.forgetKey !== SERVER_KEY_ID) {
      delete out.keys[body.forgetKey];
      delete out.keyLimits[body.forgetKey];
    }
    return out;
  });
  return Response.json(await view(next));
}
