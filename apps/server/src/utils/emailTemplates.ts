import type { Job } from "@prisma/client";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function jobAlertEmailHtml(params: {
  userName: string;
  searchName: string;
  jobCount: number;
  jobs: Array<{
    title: string;
    company: string;
    location: string;
    url: string;
    postedAt: string;
  }>;
  searchUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
}): string {
  const { userName, searchName, jobCount, jobs, searchUrl, manageUrl, unsubscribeUrl } = params;
  const coral = "#E8533A";
  const cream = "#F4EFE6";
  const cardBg = "#ffffff";

  const rows = jobs
    .map(
      (j) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid rgba(0,0,0,0.06);">
          <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#1a1a1a;">${esc(j.title)}</p>
          <p style="margin:0 0 4px;font-size:14px;color:#444;">${esc(j.company)}</p>
          <p style="margin:0 0 4px;font-size:13px;color:#666;">${esc(j.location)}</p>
          <p style="margin:0 0 8px;font-size:12px;color:#888;">Posted ${esc(j.postedAt)}</p>
          <a href="${esc(j.url)}" style="display:inline-block;font-size:13px;font-weight:600;color:${coral};text-decoration:none;">View →</a>
        </td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New jobs</title>
</head>
<body style="margin:0;padding:0;background:${cream};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${cream};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${cardBg};border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:24px 24px 8px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:${coral};text-transform:uppercase;">JobSeek</p>
              <h1 style="margin:0;font-size:20px;font-weight:600;color:#1a1a1a;">Hi ${esc(userName)}</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#444;">
                ${jobCount} new job${jobCount === 1 ? "" : "s"} match your saved search &ldquo;${esc(searchName)}&rdquo;.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 8px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;text-align:center;">
              <a href="${esc(searchUrl)}" style="display:inline-block;margin:8px 0 0;padding:12px 20px;border-radius:999px;background:${coral};color:#fff;font-size:14px;font-weight:700;text-decoration:none;">See all ${jobCount} new jobs →</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;border-top:1px solid rgba(0,0,0,0.06);">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#666;text-align:center;">
                You&apos;re receiving this because you enabled job alerts for &ldquo;${esc(searchName)}&rdquo;.
              </p>
              <p style="margin:12px 0 0;font-size:12px;text-align:center;">
                <a href="${esc(manageUrl)}" style="color:${coral};font-weight:600;text-decoration:none;">Manage alerts</a>
                <span style="color:#aaa;"> &nbsp;|&nbsp; </span>
                <a href="${esc(unsubscribeUrl)}" style="color:#666;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatJobPostedLine(job: Job): string {
  const d = job.postedAt ?? job.createdAt;
  try {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}
