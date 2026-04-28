import { logger } from "./logger.js";

export interface EmailSendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  eventName: string;
}): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() ?? "noreply@jobseek.app";

  if (!key) {
    logger.warn({ event: `${params.eventName}_skipped`, reason: "no_resend_key" }, `${params.eventName}_skipped`);
    return { ok: false, error: "RESEND_API_KEY not set" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { event: `${params.eventName}_failed`, status: res.status, body: text.slice(0, 500) },
      `${params.eventName}_failed`,
    );
    return { ok: false, error: text || `HTTP ${res.status}` };
  }

  const payload = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, messageId: payload.id };
}
