import OpenAI from "openai";

let client: OpenAI | null = null;

export function isMockMode(): boolean {
  return !process.env.OPENAI_API_KEY;
}

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
