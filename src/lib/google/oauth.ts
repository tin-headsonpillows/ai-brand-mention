import { cookies } from "next/headers";
import { open, seal } from "../secretBox";

/**
 * Google sign-in (OAuth 2.0, web server flow) for the viewer's Sheets, Docs and Drive: reading content plans
 * and Docs, creating Docs in a project's folder, writing their links and statuses back to the plan, and
 * sharing Docs with clients. Tokens live only in an encrypted, httpOnly cookie in that viewer's browser -
 * nothing is stored on the server.
 */
const SESSION_COOKIE = "g_session";
const STATE_COOKIE = "g_oauth_state";
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

/** Scopes needed to create Docs, write to the plan and share (older sign-ins only had read access). */
const WRITE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"];

interface Session {
  refreshToken: string;
  accessToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
  email?: string;
  /** Space-separated scopes Google granted (absent for sessions from before write access existed). */
  scope?: string;
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** Starts sign-in: remembers a random state (CSRF check) and the page to return to, then builds Google's URL. */
export async function startUrl(origin: string, returnTo: string): Promise<string> {
  const state = crypto.randomUUID();
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/articles";
  (await cookies()).set(STATE_COOKIE, seal(JSON.stringify({ state, returnTo: safeReturn })), cookieOptions(600));
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `Google token error ${res.status}`);
  return data;
}

function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

/** Finishes sign-in; returns the page to send the viewer back to. */
export async function finishSignIn(origin: string, code: string, state: string): Promise<string> {
  const jar = await cookies();
  const saved = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  const parsed = saved ? (JSON.parse(open(saved) ?? "null") as { state: string; returnTo: string } | null) : null;
  if (!parsed || parsed.state !== state) throw new Error("Sign-in expired or was started in another browser - try again");
  const data = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!data.refresh_token) throw new Error("Google didn't return a refresh token - remove the app's access in your Google account and sign in again");
  await writeSession({
    refreshToken: data.refresh_token,
    accessToken: data.access_token!,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: emailFromIdToken(data.id_token),
    scope: data.scope,
  });
  return parsed.returnTo;
}

async function writeSession(session: Session) {
  (await cookies()).set(SESSION_COOKIE, seal(JSON.stringify(session)), cookieOptions(60 * 60 * 24 * 180));
}

async function readSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const plain = open(raw);
  return plain ? (JSON.parse(plain) as Session) : null;
}

const canWriteWith = (scope?: string) => Boolean(scope) && WRITE_SCOPES.every((s) => scope!.split(" ").includes(s));

/** Whether a viewer is signed in, and whether they granted the write scopes (create Docs, edit plans, share). */
export async function signedInEmail(): Promise<{ signedIn: boolean; email?: string; canWrite: boolean }> {
  const session = await readSession();
  return { signedIn: Boolean(session), email: session?.email, canWrite: canWriteWith(session?.scope) };
}

/** A token that may write (Drive, Docs, Sheets), or an error explaining what the viewer needs to do. */
export async function googleWriteToken(): Promise<string> {
  if (!googleConfigured()) throw new GoogleAccessError("Google sign-in isn't set up on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", "not_configured");
  const session = await readSession();
  if (!session) throw new GoogleAccessError("Sign in with Google first.", "signed_out");
  if (!canWriteWith(session.scope)) throw new GoogleAccessError("Sign in with Google again to allow creating Docs and editing the plan.", "needs_consent");
  const token = await googleAccessToken();
  if (!token) throw new GoogleAccessError("Your Google sign-in expired - sign in again.", "signed_out");
  return token;
}

export class GoogleAccessError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "signed_out" | "needs_consent"
  ) {
    super(message);
  }
}

/** A valid access token for the signed-in viewer (refreshed when needed), or null when not signed in. */
export async function googleAccessToken(): Promise<string | null> {
  if (!googleConfigured()) return null;
  const session = await readSession();
  if (!session) return null;
  if (session.expiresAt - 60_000 > Date.now()) return session.accessToken;
  try {
    const data = await tokenRequest({ refresh_token: session.refreshToken, grant_type: "refresh_token" });
    const next = { ...session, accessToken: data.access_token!, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, scope: data.scope ?? session.scope };
    await writeSession(next);
    return next.accessToken;
  } catch {
    // Revoked or expired: treat as signed out.
    await signOut();
    return null;
  }
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const session = await readSession();
  jar.delete(SESSION_COOKIE);
  if (session) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.refreshToken)}`, { method: "POST" }).catch(() => {
      // Best effort; the cookie is gone either way.
    });
  }
}
