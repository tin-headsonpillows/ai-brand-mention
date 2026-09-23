import OpenAI from "openai";

/** True when neither a user-supplied key nor a server-configured key is available. */
export function isMockMode(userApiKey?: string): boolean {
  return !userApiKey?.trim() && !process.env.OPENAI_API_KEY;
}

/**
 * Builds a client for this request only. A visitor-supplied key (bring your
 * own key, kept client-side and sent per-request) takes priority over the
 * server's own OPENAI_API_KEY. Never cached across requests, since different
 * requests may carry different user keys.
 */
export function getOpenAIClient(userApiKey?: string): OpenAI {
  const apiKey = userApiKey?.trim() || process.env.OPENAI_API_KEY;
  return new OpenAI({ apiKey });
}

export const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
