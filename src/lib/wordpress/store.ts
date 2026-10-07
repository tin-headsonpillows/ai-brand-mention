import { readJson, writeJson, deleteJson } from "../blobJson";
import { open, seal } from "../secretBox";

export type SeoPlugin = "yoast" | "rankmath" | "none";

export interface WordPressTest {
  ok: boolean;
  at: string;
  message: string;
  user?: string;
  canPublish?: boolean;
  canUpload?: boolean;
  /** SEO plugins found on the site (from its REST namespaces). */
  detected?: SeoPlugin[];
  /** True when our helper plugin is active, so SEO meta can be written. */
  helper?: boolean;
}

interface StoredSettings {
  siteUrl: string;
  username: string;
  /** Application password, sealed with APP_SECRET; never sent to the browser. */
  passwordSealed: string;
  seoPlugin: SeoPlugin;
  lastTest?: WordPressTest;
}

/** What the browser sees. */
export interface WordPressSettingsView {
  siteUrl: string;
  username: string;
  hasPassword: boolean;
  seoPlugin: SeoPlugin;
  lastTest?: WordPressTest;
}

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  password: string;
  seoPlugin: SeoPlugin;
}

const path = (projectId: string) => `wordpress/${projectId}.json`;

export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "").replace(/\/wp-admin.*$/i, "").replace(/\/wp-json.*$/i, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export async function readSettings(projectId: string): Promise<WordPressSettingsView | null> {
  const s = await readJson<StoredSettings>(path(projectId));
  if (!s) return null;
  return { siteUrl: s.siteUrl, username: s.username, hasPassword: Boolean(s.passwordSealed), seoPlugin: s.seoPlugin, lastTest: s.lastTest };
}

export async function readCredentials(projectId: string): Promise<WordPressCredentials | null> {
  const s = await readJson<StoredSettings>(path(projectId));
  if (!s?.passwordSealed) return null;
  const password = open(s.passwordSealed);
  if (!password) return null;
  return { siteUrl: s.siteUrl, username: s.username, password, seoPlugin: s.seoPlugin };
}

/** Saves the connection; an empty password keeps the stored one. */
export async function saveSettings(
  projectId: string,
  input: { siteUrl: string; username: string; password?: string; seoPlugin: SeoPlugin }
): Promise<WordPressSettingsView> {
  const current = await readJson<StoredSettings>(path(projectId));
  const siteUrl = normalizeSiteUrl(input.siteUrl);
  const password = input.password?.replace(/\s+/g, " ").trim();
  const next: StoredSettings = {
    siteUrl,
    username: input.username.trim(),
    passwordSealed: password ? seal(password) : current?.passwordSealed ?? "",
    seoPlugin: input.seoPlugin,
    // A different site or user invalidates the last test.
    lastTest: current && current.siteUrl === siteUrl && current.username === input.username.trim() && !password ? current.lastTest : undefined,
  };
  await writeJson(path(projectId), next);
  return (await readSettings(projectId))!;
}

export async function saveTest(projectId: string, test: WordPressTest): Promise<void> {
  const current = await readJson<StoredSettings>(path(projectId));
  if (current) await writeJson(path(projectId), { ...current, lastTest: test });
}

export async function deleteSettings(projectId: string): Promise<void> {
  await deleteJson([path(projectId)]);
}
