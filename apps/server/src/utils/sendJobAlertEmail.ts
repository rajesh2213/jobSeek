import { logger } from "./logger.js";

export async function sendJobAlertEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() ?? "noreply@jobseek.app";

  if (!key) {
    logger.warn({ event: "job_alert_email_skipped", reason: "no_resend_key" }, "job_alert_email_skipped");
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
      { event: "job_alert_email_failed", status: res.status, body: text.slice(0, 500) },
      "job_alert_email_failed",
    );
    return { ok: false, error: text || `HTTP ${res.status}` };
  }

  return { ok: true };
}

export function buildJobAlertSubject(params: {
  jobCount: number;
  roleLabel: string;
}): string {
  const n = params.jobCount;
  const role = params.roleLabel.trim() || "job";
  return `${n} new ${role} jobs match your search`;
}
