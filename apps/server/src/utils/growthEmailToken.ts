import { createHmac, timingSafeEqual } from "node:crypto";

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signGrowthEmailUnsubscribeToken(
  userId: string,
  purpose: string,
  secret: string,
  expiresAtMs: number,
): string {
  const payload = `${userId}:${purpose}:${expiresAtMs}`;
  const digest = hmac(secret, payload);
  return Buffer.from(`${payload}:${digest}`, "utf8").toString("base64url");
}

export function verifyGrowthEmailUnsubscribeToken(
  userId: string,
  purpose: string,
  secret: string,
  token: string,
): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 4) return false;
    const [uid, scopedPurpose, expRaw, digest] = parts;
    if (uid !== userId || scopedPurpose !== purpose) return false;
    const expiresAt = Number(expRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const payload = `${uid}:${scopedPurpose}:${expiresAt}`;
    const expected = hmac(secret, payload);
    return timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
  } catch {
    return false;
  }
}
