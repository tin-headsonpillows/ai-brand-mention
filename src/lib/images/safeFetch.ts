import { lookup } from "dns/promises";
import { isIP } from "net";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a valid image link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) image links are supported");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That address isn't reachable from here");
  }
  return url;
}

/**
 * Downloads an image from a public URL on the server - so the browser can crop it on a canvas (most image
 * hosts don't send CORS headers) and so reference images can be passed to the image model. Refuses private /
 * internal addresses (checked on every redirect), non-images and anything over 20 MB.
 */
export async function fetchPublicImage(raw: string): Promise<{ data: Uint8Array; contentType: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AIBrandMentionTracker/1.0)", Accept: "image/*" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("Image link redirected nowhere");
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The image host answered ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) throw new Error("That link isn't an image");
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("Image is larger than 20 MB");
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength > MAX_BYTES) throw new Error("Image is larger than 20 MB");
    return { data, contentType };
  }
  throw new Error("Too many redirects");
}
