import type { NextRequest } from "next/server";
import { mockSvg } from "@/lib/images/mockSvg";

/** Placeholder images for mock mode (no SerpApi keys), so search, crop and download stay testable. */
export async function GET(req: NextRequest) {
  const { svg } = mockSvg(req.nextUrl.searchParams);
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
