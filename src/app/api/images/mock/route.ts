import type { NextRequest } from "next/server";

/** Placeholder images for mock mode (no SerpApi keys), so search, crop and download stay testable. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const w = Math.max(16, Math.min(4000, Number(p.get("w")) || 800));
  const h = Math.max(16, Math.min(4000, Number(p.get("h")) || 600));
  const seed = p.get("seed") ?? "x";
  const label = (p.get("label") ?? "").slice(0, 40).replace(/[<>&"]/g, "");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},65%,32%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.12}" fill="rgba(255,255,255,0.55)"/><text x="50%" y="88%" fill="#fff" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 14)}" text-anchor="middle">${label} ${w}×${h}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
