import type { NextRequest } from "next/server";
import { fetchPublicImage } from "@/lib/images/safeFetch";

/**
 * Serves a remote image from this origin so the browser can crop it on a canvas (image hosts rarely send CORS
 * headers, and a cross-origin image would block the canvas export).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  try {
    const { data, contentType } = await fetchPublicImage(url);
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't load that image" }, { status: 502 });
  }
}
