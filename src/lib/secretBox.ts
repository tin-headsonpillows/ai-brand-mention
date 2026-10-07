import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Small AES-256-GCM box for secrets the server must keep but never show: the Google sign-in cookie and
 * stored WordPress application passwords. The key comes from APP_SECRET (a long random string set on Vercel).
 */
function key(): Buffer {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") throw new Error("APP_SECRET is not set on the server");
    // Local development only.
    return createHash("sha256").update("local-dev-secret-not-for-production").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns null for anything tampered with or sealed under another key. */
export function open(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
