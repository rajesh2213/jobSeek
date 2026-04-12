import { createHmac, timingSafeEqual } from "node:crypto";

export function signJobAlertUnsubscribeToken(
  userId: string,
  searchId: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(`${userId}:${searchId}`).digest("hex");
}

export function verifyJobAlertUnsubscribeToken(
  userId: string,
  searchId: string,
  secret: string,
  token: string,
): boolean {
  const expected = signJobAlertUnsubscribeToken(userId, searchId, secret);
  try {
    const a = Buffer.from(token.trim(), "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
