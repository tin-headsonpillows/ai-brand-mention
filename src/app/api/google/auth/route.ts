import { NextResponse, type NextRequest } from "next/server";
import { googleConfigured, startUrl } from "@/lib/google/oauth";

/** Sends the viewer to Google's consent screen (read-only Sheets + Docs). */
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("returnTo") ?? "";
  // Only paths on this site, never another host.
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") && !requested.startsWith("/\\") ? requested : "/articles";
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL(`${returnTo}${returnTo.includes("?") ? "&" : "?"}google=not-configured`, req.nextUrl.origin), 302);
  }
  return NextResponse.redirect(await startUrl(req.nextUrl.origin, returnTo), 302);
}
