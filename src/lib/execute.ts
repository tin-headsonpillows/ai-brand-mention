import { getOpenAIClient } from "./openai";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Asks ChatGPT the given prompt, retrying transient failures with backoff. */
export async function askChatGPT(prompt: string, model: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      });
      return completion.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to get a response from ChatGPT");
}
