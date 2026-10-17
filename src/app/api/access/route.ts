import type { NextRequest } from "next/server";
import { atLeast, readAccess, ROLES, viewerOf, writeAccess, type Member, type ProjectAccess, type Role } from "@/lib/access/store";
import { readPlanConfig } from "@/lib/content/store";
import { removePermission, setPermission } from "@/lib/google/drive";
import { googleConfigured, googleWriteToken } from "@/lib/google/oauth";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));
const DRIVE_ROLE: Record<Role, "writer" | "commenter" | "reader"> = { owner: "writer", editor: "writer", reviewer: "commenter", viewer: "reader" };

/** The project's member list and the viewer's own role (members only see the list once it's on). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const access = await readAccess(projectId);
  const me = await viewerOf(projectId, access);
  const visible = !access.enabled || me.role !== null;
  return Response.json({
    enabled: access.enabled,
    shareFolder: access.shareFolder,
    members: visible ? access.members : [],
    me,
    googleConfigured: googleConfigured(),
  });
}

/** Turns member-only access on or off and edits the members (owners only, once it's on). */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; enabled?: unknown; shareFolder?: unknown; members?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const current = await readAccess(projectId);
  const me = await viewerOf(projectId, current);
  if (!googleConfigured()) return Response.json({ error: "Set up Google sign-in first: members are checked by their Google account." }, { status: 400 });
  const myEmail = me.email?.toLowerCase();
  if (!myEmail) return Response.json({ error: "Sign in with Google first." }, { status: 401 });
  if (current.enabled && !atLeast(me.role, "owner")) return Response.json({ error: "Only the project's owners can change its members." }, { status: 403 });

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const members: Member[] = [];
  for (const raw of Array.isArray(body?.members) ? body.members.slice(0, 200) : []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const email = typeof m.email === "string" ? m.email.trim().toLowerCase() : "";
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: `"${email}" isn't an email address.` }, { status: 400 });
    if (!ROLE_IDS.has(String(m.role))) return Response.json({ error: `Pick a role for ${email}.` }, { status: 400 });
    seen.add(email);
    const before = current.members.find((x) => x.email === email);
    members.push({ email, role: m.role as Role, addedAt: before?.addedAt ?? now, addedBy: before?.addedBy ?? myEmail });
  }
  const enabled = body?.enabled === true;
  // Whoever turns it on stays in as an owner, so nobody locks themselves out.
  const mine = members.find((m) => m.email === myEmail);
  if (enabled && !mine) members.unshift({ email: myEmail, role: "owner", addedAt: now, addedBy: myEmail });
  else if (enabled && mine && mine.role !== "owner" && !members.some((m) => m.role === "owner" && m !== mine)) mine.role = "owner";
  if (enabled && !members.some((m) => m.role === "owner")) return Response.json({ error: "Keep at least one owner." }, { status: 400 });

  const next: ProjectAccess = { enabled, members, shareFolder: body?.shareFolder === true, updatedAt: now };
  await writeAccess(projectId, next);

  // Matching access to the project's Drive folder: added or changed members get it, removed ones lose it.
  const warnings: string[] = [];
  const folderId = (await readPlanConfig(projectId))?.drive.folderId;
  if (next.shareFolder && folderId) {
    try {
      const token = await googleWriteToken();
      for (const m of members) {
        const before = current.members.find((x) => x.email === m.email);
        if (current.shareFolder && before?.role === m.role) continue;
        await setPermission(token, folderId, m.email, DRIVE_ROLE[m.role]).catch((err: unknown) => warnings.push(`${m.email}: ${err instanceof Error ? err.message : "couldn't share the folder"}`));
      }
      for (const gone of current.members.filter((x) => !seen.has(x.email) && x.email !== myEmail)) {
        await removePermission(token, folderId, gone.email).catch((err: unknown) => warnings.push(`${gone.email}: ${err instanceof Error ? err.message : "couldn't remove folder access"}`));
      }
    } catch (err) {
      warnings.push(`Drive folder not shared: ${err instanceof Error ? err.message : "error"}`);
    }
  } else if (next.shareFolder && !folderId) warnings.push("Link the project's Drive folder (Content plan settings) to share it with members.");

  return Response.json({ ...next, me: await viewerOf(projectId, next), googleConfigured: true, warnings });
}
