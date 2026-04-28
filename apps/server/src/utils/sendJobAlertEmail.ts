import { sendEmail } from "./sendEmail.js";

export async function sendJobAlertEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  return sendEmail({
    ...params,
    eventName: "job_alert_email",
  });
}

export function buildJobAlertSubject(params: {
  jobCount: number;
  roleLabel: string;
}): string {
  const n = params.jobCount;
  const role = params.roleLabel.trim() || "job";
  return `${n} new ${role} jobs match your search`;
}
