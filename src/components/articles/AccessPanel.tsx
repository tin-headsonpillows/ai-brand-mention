"use client";

import { useState } from "react";
import { ROLES, type Member, type Role } from "@/lib/access/roles";
import { Panel, Switch } from "@/components/tracking/ui";
import { buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

export interface AccessView {
  enabled: boolean;
  shareFolder: boolean;
  members: Member[];
  me: { email?: string; role: Role | null; enforced: boolean };
  googleConfigured: boolean;
}

/**
 * Project access by Google account: off, anyone with the app's link can work on the project; on, only the listed
 * members can, each with a role. Owners can also give members matching access to the project's Drive folder.
 */
export function AccessPanel({ projectId, access, onChange, returnTo }: { projectId: string; access: AccessView | null; onChange: (a: AccessView) => void; returnTo: string }) {
  const [enabled, setEnabled] = useState(access?.enabled ?? false);
  const [shareFolder, setShareFolder] = useState(access?.shareFolder ?? false);
  const [members, setMembers] = useState<Array<{ email: string; role: Role }>>(access?.members.map((m) => ({ email: m.email, role: m.role })) ?? []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  if (!access) return null;
  const me = access.me;
  const canManage = !access.enabled || me.role === "owner";
  const signedIn = Boolean(me.email);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, enabled, shareFolder, members }),
      });
      const data = (await res.json().catch(() => ({}))) as AccessView & { error?: string; warnings?: string[] };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setMembers(data.members.map((m) => ({ email: m.email, role: m.role })));
      onChange(data);
      setMessage({ text: data.warnings?.length ? `Saved. ${data.warnings.join(" ")}` : "Saved.", bad: Boolean(data.warnings?.length) });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Couldn't save", bad: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Project access" subtitle="who can open and edit this project's articles, by Google account">
      <div className="flex flex-col gap-3 text-sm">
        {!access.googleConfigured ? (
          <p style={{ color: "var(--text-secondary)" }}>Members sign in with their Google account, so Google sign-in has to be set up first (Google Sheets, Docs &amp; Drive panel below).</p>
        ) : !signedIn ? (
          <div className="flex flex-wrap items-center gap-3">
            <span style={{ color: "var(--text-secondary)" }}>Sign in with Google to manage who can work on this project.</span>
            <a href={`/api/google/auth?returnTo=${encodeURIComponent(returnTo)}`} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              Sign in with Google
            </a>
          </div>
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Signed in as {me.email}
              {access.enabled ? ` · your role: ${me.role ?? "not a member"}` : ""}. Replies to Doc comments are posted under each person&apos;s own Google account.
            </p>
            <Switch checked={enabled} onChange={(v) => canManage && setEnabled(v)} label="Only members can open this project's articles and content board" />
            {enabled ? (
              <>
                <ul className="flex flex-col divide-y rounded-lg border" style={{ borderColor: "var(--border-hairline)" }}>
                  {members.length === 0 ? (
                    <li className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      You&apos;ll be added as the owner when you save.
                    </li>
                  ) : null}
                  {members.map((m, i) => (
                    <li key={m.email} className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderColor: "var(--border-hairline)" }}>
                      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                        {m.email}
                        {m.email === me.email?.toLowerCase() ? <span style={{ color: "var(--text-muted)" }}> (you)</span> : null}
                      </span>
                      <select
                        value={m.role}
                        disabled={!canManage}
                        onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))}
                        className="rounded-md border px-2 py-1 text-xs"
                        style={fieldStyle}
                        aria-label={`Role for ${m.email}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {canManage ? (
                        <button type="button" onClick={() => setMembers(members.filter((_, j) => j !== i))} className="text-xs underline" style={{ color: "var(--status-critical)" }}>
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = email.trim().toLowerCase();
                      if (!v || members.some((m) => m.email === v)) return;
                      setMembers([...members, { email: v, role }]);
                      setEmail("");
                    }}
                  >
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="min-w-[220px] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} aria-label="Member email" />
                    <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle} aria-label="New member role">
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={buttonSecondary} style={secondaryStyle}>
                      Add
                    </button>
                  </form>
                ) : null}
                <ul className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {ROLES.map((r) => (
                    <li key={r.id}>
                      <b>{r.label}</b>: {r.can}
                    </li>
                  ))}
                </ul>
                <Switch checked={shareFolder} onChange={(v) => canManage && setShareFolder(v)} label="Also give members access to the project's Drive folder (editors can edit, reviewers comment, viewers read)" />
              </>
            ) : null}
            {canManage ? (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {message ? (
                  <span className="mr-auto text-xs" style={{ color: message.bad ? "var(--status-critical)" : "var(--success-text)" }}>
                    {message.text}
                  </span>
                ) : null}
                <button type="button" disabled={saving} onClick={() => void save()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                  {saving ? "Saving..." : "Save access"}
                </button>
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Only owners can change members.
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
