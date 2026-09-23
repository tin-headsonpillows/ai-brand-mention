import { createChatCompletion } from "./execute";
import { mockVariations } from "./mock";

interface VariationsResponse {
  variations?: unknown;
}

export async function generateVariations(
  seedPrompt: string,
  count: number,
  model: string,
  mock: boolean,
  apiKey?: string
): Promise<string[]> {
  if (mock) return mockVariations(seedPrompt, count);

  const system = [
    "You are helping test how an AI assistant answers a family of related, realistic user questions.",
    `Given one example question, generate exactly ${count} DIFFERENT ways real people might ask about the same underlying need.`,
    "Vary phrasing, specificity, and constraints (budget, trip length, group size, season, neighborhood, etc.), but keep the same core topic and intent as the example.",
    "Do not answer the questions themselves.",
    `Return ONLY a JSON object of the shape {"variations": string[]} with exactly ${count} items, no commentary.`,
  ].join(" ");

  const completion = await createChatCompletion(
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Example question: "${seedPrompt}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    },
    apiKey
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: VariationsResponse;
  try {
    parsed = JSON.parse(raw) as VariationsResponse;
  } catch {
    throw new Error("Model did not return valid JSON for prompt variations");
  }

  if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) {
    throw new Error("Model did not return a variations array");
  }

  const cleaned = parsed.variations.map((v) => String(v).trim()).filter(Boolean);
  return normalizeCount(cleaned, count, seedPrompt);
}

function normalizeCount(list: string[], count: number, fallback: string): string[] {
  if (list.length >= count) return list.slice(0, count);
  const out = [...list];
  let i = 0;
  while (out.length < count) {
    out.push(list[i % list.length] ?? fallback);
    i++;
  }
  return out;
}
