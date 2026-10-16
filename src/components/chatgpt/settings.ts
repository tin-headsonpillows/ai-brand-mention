"use client";

import { useCallback, useEffect, useState } from "react";
import { SERVER_KEY_ID, keyIdFromHash, keyLabel } from "@/lib/chatgpt/pricing";

export interface KeyRow {
  id: string;
  label: string;
  lastUsed: string | null;
  ownLimitUsd: number | null;
  limitUsd: number;
  spentTodayUsd: number;
}

export interface MentionsSettingsView {
  model: string | null;
  serverDefaultModel: string;
  dailyLimitUsd: number;
  serverKey: boolean;
  mock: boolean;
  keys: KeyRow[];
}

export interface SettingsUpdate {
  model?: string | null;
  dailyLimitUsd?: number;
  keyLimit?: { id: string; limitUsd: number | null };
  forgetKey?: string;
}

/** The ChatGPT Mentions settings (default model, daily limits, keys with today's spend). */
export function useMentionsSettings() {
  const [settings, setSettings] = useState<MentionsSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/chatgpt/settings", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setSettings((await res.json()) as MentionsSettingsView);
    else setError("Couldn't load the ChatGPT settings.");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/chatgpt/settings", { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? ((await res.json()) as MentionsSettingsView) : null;
      if (cancelled) return;
      if (body) setSettings(body);
      else setError("Couldn't load the ChatGPT settings.");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (update: SettingsUpdate) => {
    const res = await fetch("/api/chatgpt/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
    const body = (await res.json().catch(() => null)) as (MentionsSettingsView & { error?: string }) | null;
    if (!res.ok || !body) throw new Error(body?.error ?? `Couldn't save (status ${res.status})`);
    setSettings(body);
    setError(null);
    return body;
  }, []);

  return { settings, error, reload, save };
}

/** The fingerprint the server keeps for a key (a SHA-256 prefix), computed in the browser so the key isn't sent. */
export async function keyFingerprint(key: string): Promise<{ id: string; label: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { id: SERVER_KEY_ID, label: "Server key" };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { id: keyIdFromHash(hex), label: keyLabel(trimmed) };
}
