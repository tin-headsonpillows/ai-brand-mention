import type OpenAI from "openai";
import { answerTokenLimit, isReasoningModel, usageCost } from "./chatgpt/pricing";
import type { UsageMeter } from "./chatgpt/usage";
import { getOpenAIClient } from "./openai";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChatParams = Parameters<OpenAI["chat"]["completions"]["create"]>[0];
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;

/**
 * Some models (e.g. reasoning models like o1/o3) reject parameters that
 * regular chat models accept - `temperature` isn't tunable, and they want
 * `max_completion_tokens` instead of `max_tokens`. Rather than hardcode a
 * model-name allowlist that will always be one release behind, adapt to
 * whatever the API actually rejects.
 */
const PARAM_RENAMES: Record<string, string> = {
  max_tokens: "max_completion_tokens",
};

function extractUnsupportedParam(err: unknown): string | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const match = message.match(/Unsupported (?:parameter|value): '([a-zA-Z_]+)'/);
  return match?.[1] ?? null;
}

/** Worst-case cost of a call before it's made: the prompt's size plus the most output it may produce. */
function worstCaseCost(params: ChatParams): number {
  const p = params as unknown as { model: string; messages: unknown; max_tokens?: number; max_completion_tokens?: number };
  const input = Math.ceil(JSON.stringify(p.messages ?? "").length / 3.5);
  const output = p.max_completion_tokens ?? p.max_tokens ?? 2000;
  return usageCost(p.model, input, output);
}

/**
 * One chat completion. With a meter, the call is checked against its key's daily limit first (throwing
 * BudgetExceeded instead of calling) and its token usage is recorded after.
 */
async function createChatCompletion(params: ChatParams, apiKey?: string, meter?: UsageMeter): Promise<ChatCompletion> {
  const attempts = 4;
  const client = getOpenAIClient(apiKey);
  let current = { ...params } as Record<string, unknown>;
  const reservation = meter ? meter.reserve(worstCaseCost(params)) : 0;
  let recorded = false;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const completion = (await client.chat.completions.create(current as unknown as ChatParams)) as ChatCompletion;
      if (meter) {
        const text = completion.choices[0]?.message?.content ?? "";
        meter.record(
          reservation,
          params.model,
          completion.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(params.messages).length / 4),
          completion.usage?.completion_tokens ?? Math.ceil(text.length / 4)
        );
        recorded = true;
      }
      return completion;
    } catch (err) {
      const badParam = extractUnsupportedParam(err);
      if (badParam && badParam in current) {
        const { [badParam]: value, ...rest } = current;
        const renamedTo = PARAM_RENAMES[badParam];
        current = renamedTo ? { ...rest, [renamedTo]: value } : rest;
        continue;
      }
      if (attempt === attempts - 1) {
        if (meter && !recorded) meter.release(reservation);
        throw err;
      }
      await sleep(500 * (attempt + 1));
    }
  }
  if (meter && !recorded) meter.release(reservation);
  throw new Error("Failed to get a response from ChatGPT");
}

/** Asks ChatGPT the given prompt, adapting to model-specific parameter quirks. */
export async function askChatGPT(prompt: string, model: string, apiKey?: string, meter?: UsageMeter): Promise<string> {
  // Reasoning models think before answering (billed as output), so they get a larger limit and low effort.
  const reasoning = isReasoningModel(model);
  const completion = await createChatCompletion(
    {
      model,
      messages: [{ role: "user", content: prompt }],
      ...(reasoning ? { reasoning_effort: "low" as const } : { temperature: 0.7 }),
      max_tokens: answerTokenLimit(model),
    },
    apiKey,
    meter
  );
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

export { createChatCompletion };
