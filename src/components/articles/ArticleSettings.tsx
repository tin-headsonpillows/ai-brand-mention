"use client";

import { useState } from "react";
import type { SeoPlugin, WordPressSettingsView } from "@/lib/wordpress/store";
import { Panel } from "@/components/tracking/ui";
import type { GoogleStatus } from "./ImportDialog";
import { Field, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}>
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

export function ArticleSettings({
  projectId,
  google,
  onGoogleChange,
  settings,
  onSettingsChange,
}: {
  projectId: string;
  google: GoogleStatus | null;
  onGoogleChange: () => void;
  settings: WordPressSettingsView | null;
  onSettingsChange: (s: WordPressSettingsView | null) => void;
}) {
  const [siteUrl, setSiteUrl] = useState(settings?.siteUrl ?? "");
  const [username, setUsername] = useState(settings?.username ?? "");
  const [password, setPassword] = useState("");
  const [seoPlugin, setSeoPlugin] = useState<SeoPlugin>(settings?.seoPlugin ?? "yoast");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "https://ai-brand-mention.vercel.app" : window.location.origin;
  const test = settings?.lastTest;

  async function saveAndTest() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/wordpress/settings?project=${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl, username, password, seoPlugin }),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: WordPressSettingsView; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error ?? "Couldn't save");
      setPassword("");
      setSiteUrl(data.settings.siteUrl);
      onSettingsChange(data.settings);
      setBusy("test");
      const t = await fetch(`/api/wordpress/test?project=${encodeURIComponent(projectId)}`, { method: "POST" });
      const tested = (await t.json().catch(() => ({}))) as { settings?: WordPressSettingsView; error?: string };
      if (tested.settings) onSettingsChange(tested.settings);
      else if (tested.error) setError(tested.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Remove this project's WordPress connection? Articles keep their links to existing posts.")) return;
    await fetch(`/api/wordpress/settings?project=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    setSiteUrl("");
    setUsername("");
    setPassword("");
    onSettingsChange(null);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="WordPress" subtitle="where this project's articles are published">
        <div className="flex flex-col gap-3">
          <Field label="Site address">
            <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://www.example.com" className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="WordPress username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
            </Field>
            <Field label="Application password" hint={settings?.hasPassword ? "Saved (encrypted). Leave empty to keep it." : "Not your login password - see step 1 below."}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={settings?.hasPassword ? "••••  ••••  ••••  ••••" : "xxxx xxxx xxxx xxxx xxxx xxxx"}
                className="rounded-lg border px-3 py-1.5 text-sm outline-none"
                style={fieldStyle}
              />
            </Field>
          </div>
          <Field label="SEO plugin on the site" hint="Decides where the SEO title, meta description and focus keyword are written.">
            <select value={seoPlugin} onChange={(e) => setSeoPlugin(e.target.value as SeoPlugin)} className="rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle}>
              <option value="yoast">Yoast SEO</option>
              <option value="rankmath">Rank Math</option>
              <option value="none">None (standard WordPress fields only)</option>
            </select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveAndTest()} disabled={busy !== null || !siteUrl.trim() || !username.trim() || (!password.trim() && !settings?.hasPassword)} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              {busy === "save" ? "Saving..." : busy === "test" ? "Testing..." : "Save & test connection"}
            </button>
            {settings ? (
              <button type="button" onClick={() => void disconnect()} className={buttonSecondary} style={{ ...secondaryStyle, color: "var(--status-critical)" }}>
                Disconnect
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm" style={{ color: "var(--status-critical)" }}>
              {error}
            </p>
          ) : null}
          {test ? (
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: test.ok ? "var(--border-hairline)" : "var(--status-critical)", color: "var(--text-secondary)" }}>
              <span className="font-semibold" style={{ color: test.ok ? "var(--success-text)" : "var(--status-critical)" }}>
                {test.ok ? "✓ Connected" : "✕ Not connected"}
              </span>{" "}
              {test.message} <span style={{ color: "var(--text-muted)" }}>({new Date(test.at).toLocaleString()})</span>
              {test.ok && settings?.seoPlugin !== "none" ? (
                <span className="mt-1 block">
                  SEO meta helper plugin: {test.helper ? <b style={{ color: "var(--success-text)" }}>active</b> : <b style={{ color: "var(--status-critical)" }}>not detected - see step 2</b>}
                </span>
              ) : null}
            </div>
          ) : null}

          <ol className="mt-1 flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border-hairline)" }}>
            <Step n={1}>
              In WordPress, go to <b>Users → Profile → Application Passwords</b>, name it &quot;AI Brand Mention Tracker&quot; and click <b>Add New Application Password</b>. Paste the password shown here. Use an Editor or Administrator account. The password is stored encrypted and never shown again.
            </Step>
            <Step n={2}>
              For Yoast or Rank Math fields, install the small helper plugin: <a href="/api/wordpress/plugin" className="font-medium underline" style={{ color: "var(--series-1)" }}>download ai-brand-mention-seo-bridge.zip</a>, then <b>Plugins → Add New → Upload Plugin</b> and activate it. It only lets users who can edit a post set that post&apos;s SEO title, description and focus keyword through the API.
            </Step>
            <Step n={3}>Click Save &amp; test. Security plugins or a firewall that block the REST API (/wp-json) need to allow it.</Step>
          </ol>
        </div>
      </Panel>

      <Panel title="Google Sheets & Docs" subtitle="where content plans and drafts come from">
        <div className="flex flex-col gap-3">
          {google?.configured ? (
            google.signedIn ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                  ✓ Signed in as <b>{google.email ?? "your Google account"}</b>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/google/signout", { method: "POST" });
                    onGoogleChange();
                  }}
                  className={buttonSecondary}
                  style={secondaryStyle}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Sign in to import from private Sheets and Docs you can open. Access is read-only and stays in this browser only (an encrypted cookie).
                </span>
                <a href={`/api/google/auth?returnTo=${encodeURIComponent("/articles?view=settings")}`} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                  Sign in with Google
                </a>
              </div>
            )
          ) : (
            <>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Google sign-in needs a one-time setup in Google Cloud. Until then, files shared as &quot;Anyone with the link can view&quot; can still be imported.
              </p>
              <ol className="flex flex-col gap-2">
                <Step n={1}>
                  In <b>Google Cloud Console</b>, create (or pick) a project and enable the <b>Google Sheets API</b> and <b>Google Docs API</b>.
                </Step>
                <Step n={2}>
                  <b>OAuth consent screen</b>: choose <b>Internal</b> if everyone uses your Google Workspace domain (no Google review needed); add the scopes spreadsheets.readonly and documents.readonly.
                </Step>
                <Step n={3}>
                  <b>Credentials → Create credentials → OAuth client ID → Web application</b>. Authorised redirect URI: <code className="rounded px-1" style={{ background: "var(--page-plane)" }}>{origin}/api/google/callback</code>
                </Step>
                <Step n={4}>
                  Add the client ID and secret to Vercel as <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> (or send them to Claude to add), then redeploy.
                </Step>
              </ol>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
