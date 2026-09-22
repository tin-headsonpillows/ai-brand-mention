import type OpenAI from "openai";
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

async function createChatCompletion(params: ChatParams, attempts = 4): Promise<ChatCompletion> {
  const client = getOpenAIClient();
  let current = { ...params } as Record<string, unknown>;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return (await client.chat.completions.create(current as unknown as ChatParams)) as ChatCompletion;
    } catch (err) {
      const badParam = extractUnsupportedParam(err);
      if (badParam && badParam in current) {
        const { [badParam]: value, ...rest } = current;
        const renamedTo = PARAM_RENAMES[badParam];
        current = renamedTo ? { ...rest, [renamedTo]: value } : rest;
        continue;
      }
      if (attempt === attempts - 1) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error("Failed to get a response from ChatGPT");
}

/** Asks ChatGPT the given prompt, adapting to model-specific parameter quirks. */
export async function askChatGPT(prompt: string, model: string): Promise<string> {
  const completion = await createChatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 500,
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

export { createChatCompletion };
