import { NextResponse, type NextRequest } from "next/server";
import { finishSignIn } from "@/lib/google/oauth";

/** Google redirects here after consent; stores the tokens in an encrypted cookie and returns to the app. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const back = (path: string, status: string) => new URL(`${path}${path.includes("?") ? "&" : "?"}google=${status}`, req.nextUrl.origin);
  if (p.get("error")) return NextResponse.redirect(back("/articles", "denied"), 302);
  try {
    const returnTo = await finishSignIn(req.nextUrl.origin, p.get("code") ?? "", p.get("state") ?? "");
    return NextResponse.redirect(back(returnTo, "connected"), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed";
    return NextResponse.redirect(new URL(`/articles?google=error&message=${encodeURIComponent(message.slice(0, 200))}`, req.nextUrl.origin), 302);
  }
}
