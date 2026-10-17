import { readJson, writeJson } from "../blobJson";
import { googleConfigured, signedInEmail } from "../google/oauth";
import { atLeast, type Member, type Role } from "./roles";

export { atLeast, ROLES, type Member, type Role } from "./roles";

/**
 * Who may work on a project's articles and content plan. Off by default (the project is open to anyone with
 * the app's link); once an owner turns it on, every request needs a Google sign-in whose email is on the list,
 * and the member's role decides what they can do.
 */
export interface ProjectAccess {
  enabled: boolean;
  members: Member[];
  /** Give members matching access to the project's Drive folder (Content plan settings). */
  shareFolder: boolean;
  updatedAt: string | null;
}

const path = (projectId: string) => `access/${projectId}.json`;

export async function readAccess(projectId: string): Promise<ProjectAccess> {
  return (await readJson<ProjectAccess>(path(projectId))) ?? { enabled: false, members: [], shareFolder: false, updatedAt: null };
}

export async function writeAccess(projectId: string, access: ProjectAccess): Promise<void> {
  await writeJson(path(projectId), access);
}

export interface Viewer {
  email?: string;
  /** The viewer's role; "owner" for everyone while access control is off. */
  role: Role | null;
  enforced: boolean;
}

export async function viewerOf(projectId: string, access?: ProjectAccess): Promise<Viewer> {
  const a = access ?? (await readAccess(projectId));
  const { email } = await signedInEmail();
  if (!a.enabled) return { email, role: "owner", enforced: false };
  const member = email ? a.members.find((m) => m.email === email.toLowerCase()) : undefined;
  return { email, role: member?.role ?? null, enforced: true };
}

export type Authorized = { ok: true; viewer: Viewer } | { ok: false; response: Response };

/** Checks the signed-in viewer may act on the project with at least `need`; returns the error response if not. */
export async function authorize(projectId: string, need: Role): Promise<Authorized> {
  const access = await readAccess(projectId);
  if (!access.enabled) return { ok: true, viewer: await viewerOf(projectId, access) };
  if (!googleConfigured()) {
    return { ok: false, response: Response.json({ error: "This project is limited to its members, but Google sign-in isn't set up on the server.", access: "unavailable" }, { status: 403 }) };
  }
  const viewer = await viewerOf(projectId, access);
  if (!viewer.email) return { ok: false, response: Response.json({ error: "Sign in with Google to open this project.", access: "signed_out" }, { status: 401 }) };
  if (!viewer.role) return { ok: false, response: Response.json({ error: `${viewer.email} isn't a member of this project - ask its owner to add you.`, access: "not_member" }, { status: 403 }) };
  if (!atLeast(viewer.role, need)) {
    return { ok: false, response: Response.json({ error: `Your role (${viewer.role}) can't do this - it needs ${need} access.`, access: "role" }, { status: 403 }) };
  }
  return { ok: true, viewer };
}
