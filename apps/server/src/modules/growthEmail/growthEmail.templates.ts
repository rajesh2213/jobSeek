import type { GrowthEmailCampaignType } from "./growthEmail.types.js";

export interface GrowthEmailTemplateJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string;
  category: string;
}

export function getGrowthEmailSubject(input: {
  campaignType: GrowthEmailCampaignType;
  jobCount: number;
}): string {
  const n = Math.max(0, input.jobCount);
  switch (input.campaignType) {
    case "daily_digest":
      return n > 0 ? `You missed ${n} new jobs today` : "Top jobs picked for you today";
    case "weekly_digest":
      return "Top companies hiring this week";
    case "reengagement":
      return n > 0 ? `New jobs added since your last visit (${n})` : "Fresh opportunities are waiting";
    case "event_welcome":
      return "Companies are hiring for your profile";
    case "event_followup":
      return "More jobs similar to what you viewed";
    case "event_saved_search_suggestions":
      return "More suggestions for your new search";
    case "personalized":
    default:
      return "Jobs matching your profile";
  }
}

export function renderGrowthEmailHtml(input: {
  userName: string;
  campaignLabel: string;
  jobs: GrowthEmailTemplateJob[];
  ctaUrl: string;
  managePreferencesUrl: string;
  unsubscribeUrl: string;
}): string {
  const jobsByCategory = new Map<string, GrowthEmailTemplateJob[]>();
  for (const job of input.jobs) {
    const key = (job.category || "other").toLowerCase();
    const existing = jobsByCategory.get(key) ?? [];
    existing.push(job);
    jobsByCategory.set(key, existing);
  }
  const sections = Array.from(jobsByCategory.entries())
    .map(([category, jobs]) => {
      const rows = jobs
        .slice(0, 6)
        .map(
          (job) =>
            `<li style="margin:0 0 10px 0;"><a href="${esc(job.url)}" style="color:#0b57d0;text-decoration:none;">${esc(job.title)}</a> at ${esc(job.company)}<br/><span style="color:#6b7280;">${esc(job.location)} · ${esc(job.postedAt)}</span></li>`,
        )
        .join("");
      return `<h3 style="font-size:14px;margin:18px 0 8px 0;text-transform:capitalize;">${esc(category.replace(/-/g, " "))}</h3><ul style="padding-left:18px;margin:0;">${rows}</ul>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(input.campaignLabel)}</title></head><body style="font-family:system-ui,Arial,sans-serif;background:#f7f8fa;padding:20px;"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;"><p style="margin:0 0 8px 0;color:#111827;">Hi ${esc(input.userName)},</p><p style="margin:0 0 16px 0;color:#374151;">${esc(input.campaignLabel)}</p>${sections}<p style="margin-top:20px;"><a href="${esc(input.ctaUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">View more jobs</a></p><hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0;"/><p style="font-size:12px;color:#6b7280;margin:0;">Manage your emails: <a href="${esc(input.managePreferencesUrl)}">preferences</a> · <a href="${esc(input.unsubscribeUrl)}">unsubscribe</a></p></div></body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
