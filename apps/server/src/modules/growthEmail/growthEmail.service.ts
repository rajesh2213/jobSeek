import type {
  PrismaClient,
} from "@prisma/client";
import { createJobRepository } from "../job/job.repository.js";
import { JobService } from "../job/job.service.js";
import { logger } from "../../utils/logger.js";
import { getGrowthEmailQueue, type GrowthEmailCampaignJobName } from "../../queues/growthEmail.queue.js";
import { sendEmail } from "../../utils/sendEmail.js";
import { signGrowthEmailUnsubscribeToken } from "../../utils/growthEmailToken.js";
import { getGrowthEmailSubject, renderGrowthEmailHtml, type GrowthEmailTemplateJob } from "./growthEmail.templates.js";
import type { GrowthEmailCampaignType, GrowthEmailFrequency } from "./growthEmail.types.js";
import { discoveryFiltersFromSavedSearchQuery } from "../saved-search/savedSearch.service.js";
import type { JobDiscoveryFilters } from "../job/job.repository.js";

const DEFAULT_PAGE_SIZE = 500;
const GLOBAL_THROTTLE_MS = 24 * 60 * 60 * 1000;

function clientPublicUrl(): string {
  return (
    process.env.CLIENT_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "http://localhost:3001"
  );
}

function apiPublicUrl(): string {
  const p = process.env.PORT?.trim();
  return (
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.API_BASE_URL?.trim() ||
    (p ? `http://127.0.0.1:${p}` : "http://127.0.0.1:3000")
  );
}

function campaignToJobName(campaignType: GrowthEmailCampaignType): GrowthEmailCampaignJobName {
  return `growth_email_${campaignType}` as GrowthEmailCampaignJobName;
}

function frequencyForCampaign(campaignType: GrowthEmailCampaignType): GrowthEmailFrequency {
  return campaignType === "weekly_digest" ? "weekly" : "daily";
}

function campaignLabel(campaignType: GrowthEmailCampaignType): string {
  switch (campaignType) {
    case "daily_digest":
      return "Top jobs today";
    case "weekly_digest":
      return "Top companies hiring this week";
    case "reengagement":
      return "You may have missed these opportunities";
    case "event_welcome":
      return "Welcome to JobLoom. Here are jobs to start with.";
    case "event_followup":
      return "More opportunities similar to your recent view";
    case "event_saved_search_suggestions":
      return "Suggestions based on your new saved search";
    case "personalized":
    default:
      return "Fresh opportunities for your profile";
  }
}

function periodKey(campaignType: GrowthEmailCampaignType, now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  if (campaignType === "weekly_digest") {
    const weekStart = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
    const wkY = weekStart.getUTCFullYear();
    const wkM = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
    const wkD = String(weekStart.getUTCDate()).padStart(2, "0");
    return `${campaignType}:${wkY}-${wkM}-${wkD}`;
  }
  return `${campaignType}:${y}-${m}-${d}`;
}

export async function ensureEmailPreference(
  prisma: PrismaClient,
  input: { userId: string; source: string; markActive?: boolean },
): Promise<void> {
  await prisma.emailPreference.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      marketingEnabled: true,
      frequency: "daily",
      source: input.source,
      lastActiveAt: input.markActive ? new Date() : null,
    },
    update: input.markActive ? { lastActiveAt: new Date() } : {},
  });
}

export async function enqueueGrowthEmailEvent(
  input: {
    userId: string;
    campaignType: GrowthEmailCampaignType;
    email?: string;
    jobId?: string;
    savedSearchId?: string;
    source?: string;
  },
): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) return;
  try {
    const queue = getGrowthEmailQueue();
    const dedupeKey =
      input.savedSearchId ??
      input.jobId ??
      "none";
    await queue.add(
      campaignToJobName(input.campaignType),
      {
        userId: input.userId,
        email: input.email,
        jobId: input.jobId,
        savedSearchId: input.savedSearchId,
        source: input.source,
      },
      {
        jobId: `${input.campaignType}:${input.userId}:${dedupeKey}`,
      },
    );
  } catch (err) {
    logger.warn({ event: "growth_email_event_enqueue_failed", err }, "growth_email_event_enqueue_failed");
  }
}

const SAVED_SEARCH_SUGGESTIONS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Filters for event_saved_search_suggestions — matches saved query, recent postings only. */
export function savedSearchSuggestionsFilters(
  normalizedQuery: string,
  now: Date,
): JobDiscoveryFilters {
  return {
    ...discoveryFiltersFromSavedSearchQuery(normalizedQuery),
    postedAfter: new Date(now.getTime() - SAVED_SEARCH_SUGGESTIONS_WINDOW_MS),
  };
}

export async function runGrowthEmailCampaign(params: {
  prisma: PrismaClient;
  campaignType: GrowthEmailCampaignType;
  userId?: string;
  savedSearchId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ processed: number; sent: number; skipped: number }> {
  const { prisma, campaignType } = params;
  const now = new Date();
  const pKey = periodKey(campaignType, now);
  const frequency = frequencyForCampaign(campaignType);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const userRecipients = params.userId
    ? await prisma.user.findMany({
        where: { id: params.userId },
        select: { id: true, email: true },
      })
    : await prisma.user.findMany({
        where: {
          emailPreference: {
            marketingEnabled: true,
            frequency,
          },
        },
        select: { id: true, email: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

  const leadCandidates =
    !params.userId && campaignType === "daily_digest"
      ? await prisma.emailLead.findMany({
          where: {
            marketingEnabled: true,
            frequency: "daily",
            unsubscribedAt: null,
          },
          select: { id: true, email: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
      : [];
  const leadEmails = leadCandidates.map((lead) => lead.email);
  const userEmails =
    leadEmails.length > 0
      ? new Set(
          (
            await prisma.user.findMany({
              where: { email: { in: leadEmails } },
              select: { email: true },
            })
          ).map((row) => row.email),
        )
      : new Set<string>();
  const leadRecipients = leadCandidates.filter((lead) => !userEmails.has(lead.email));

  const jobService = new JobService(createJobRepository(prisma));
  let sent = 0;
  let skipped = 0;

  for (const recipient of userRecipients) {
    const pref = await prisma.emailPreference.upsert({
      where: { userId: recipient.id },
      create: {
        userId: recipient.id,
        marketingEnabled: true,
        frequency: "daily",
        source: "lazy_worker_default",
      },
      update: {},
    });

    if (!pref.marketingEnabled || pref.frequency === "off") {
      skipped += 1;
      continue;
    }

    if (
      pref.lastGrowthEmailSentAt &&
      now.getTime() - pref.lastGrowthEmailSentAt.getTime() < GLOBAL_THROTTLE_MS
    ) {
      skipped += 1;
      continue;
    }

    const existingSend = await prisma.growthEmailSend.findUnique({
      where: {
        userId_campaignType_periodKey: { userId: recipient.id, campaignType, periodKey: pKey },
      },
    });
    if (existingSend) {
      skipped += 1;
      continue;
    }

    const last24h = new Date(now.getTime() - GLOBAL_THROTTLE_MS);
    const recentSent = await prisma.emailJobSendLog.findMany({
      where: { userId: recipient.id, sentAt: { gte: last24h } },
      select: { jobId: true },
    });
    const excludedJobIds = new Set(recentSent.map((x) => x.jobId));

    let listingFilters: JobDiscoveryFilters;
    let ctaUrl = `${clientPublicUrl().replace(/\/$/, "")}/jobs`;
    let emailCampaignLabel = campaignLabel(campaignType);
    let subjectSearchName: string | undefined;

    if (campaignType === "event_saved_search_suggestions") {
      const savedSearchId = params.savedSearchId?.trim();
      if (!savedSearchId) {
        skipped += 1;
        await prisma.growthEmailSend.create({
          data: {
            userId: recipient.id,
            campaignType,
            periodKey: pKey,
            status: "skipped",
            jobCountSent: 0,
            error: "Missing savedSearchId for saved search suggestions",
          },
        });
        continue;
      }

      const savedRow = await prisma.savedSearch.findFirst({
        where: { id: savedSearchId, userId: recipient.id },
      });
      if (!savedRow) {
        skipped += 1;
        await prisma.growthEmailSend.create({
          data: {
            userId: recipient.id,
            campaignType,
            periodKey: pKey,
            status: "skipped",
            jobCountSent: 0,
            error: "Saved search not found for suggestions email",
          },
        });
        continue;
      }

      listingFilters = savedSearchSuggestionsFilters(savedRow.query, now);
      const searchPath = savedRow.query.startsWith("/") ? savedRow.query : `/${savedRow.query}`;
      ctaUrl = `${clientPublicUrl().replace(/\/$/, "")}${searchPath}`;
      subjectSearchName = savedRow.name?.trim() || undefined;
      emailCampaignLabel = subjectSearchName
        ? `Recent jobs matching your saved search “${subjectSearchName}”`
        : "Recent jobs matching your saved search";
    } else {
      listingFilters = {
        postedAfter:
          campaignType === "weekly_digest"
            ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      };
    }

    const listing = await jobService.list({
      page: 1,
      limit: 40,
      sort: "latest",
      filters: listingFilters,
    });
    const selected = listing.items
      .filter((j) => !excludedJobIds.has(j.id))
      .slice(0, 20);
    if (selected.length === 0) {
      skipped += 1;
      await prisma.growthEmailSend.create({
        data: {
          userId: recipient.id,
          campaignType,
          periodKey: pKey,
          status: "skipped",
          jobCountSent: 0,
          error:
            campaignType === "event_saved_search_suggestions"
              ? "No jobs matching saved search filters"
              : "No eligible jobs after dedupe",
        },
      });
      continue;
    }

    const jobsPayload: GrowthEmailTemplateJob[] = selected.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company.name,
      location: [j.locationCity, j.locationCountry].filter(Boolean).join(", ") || "Remote/Unknown",
      url: `${clientPublicUrl().replace(/\/$/, "")}/job/${j.id}`,
      postedAt: j.postedAt ? j.postedAt.toISOString().slice(0, 10) : "Recently posted",
      category: j.category || "other",
    }));
    const subject = getGrowthEmailSubject({
      campaignType,
      jobCount: jobsPayload.length,
      searchName: subjectSearchName,
    });
    const secret = process.env.JOB_ALERT_HMAC_SECRET?.trim();
    if (!secret) {
      skipped += 1;
      continue;
    }
    const token = signGrowthEmailUnsubscribeToken(
      recipient.id,
      "growth_all",
      secret,
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    const html = renderGrowthEmailHtml({
      userName: recipient.email.split("@")[0] ?? "there",
      campaignLabel: emailCampaignLabel,
      jobs: jobsPayload,
      ctaUrl,
      upgradeToProUrl: `${clientPublicUrl().replace(/\/$/, "")}/pricing`,
      managePreferencesUrl: `${clientPublicUrl().replace(/\/$/, "")}/saved-searches`,
      unsubscribeUrl: `${apiPublicUrl().replace(/\/$/, "")}/growth-email/unsubscribe?token=${encodeURIComponent(token)}`,
      brandLogoUrl: `${clientPublicUrl().replace(/\/$/, "")}/brand/jobloom-logo-prim.png`,
    });

    const send = await sendEmail({
      to: recipient.email,
      subject,
      html,
      eventName: "growth_email",
    });

    const growthSend = await prisma.growthEmailSend.create({
      data: {
        userId: recipient.id,
        campaignType,
        periodKey: pKey,
        status: send.ok ? "sent" : "failed",
        providerMessageId: send.messageId,
        subjectUsed: subject,
        jobCountSent: jobsPayload.length,
        sentAt: send.ok ? now : null,
        error: send.ok ? null : send.error,
      },
    });

    if (!send.ok) {
      skipped += 1;
      continue;
    }

    await prisma.emailPreference.update({
      where: { userId: recipient.id },
      data: { lastGrowthEmailSentAt: now },
    });

    await prisma.emailJobSendLog.createMany({
      data: jobsPayload.map((j) => ({
        userId: recipient.id,
        jobId: j.id,
        channel: "growth_email",
        growthSendId: growthSend.id,
        sentAt: now,
      })),
    });
    sent += 1;
  }

  for (const lead of leadRecipients) {
    const leadRecord = await prisma.emailLead.findUnique({
      where: { id: lead.id },
      select: {
        id: true,
        marketingEnabled: true,
        frequency: true,
        lastGrowthEmailSentAt: true,
      },
    });
    if (!leadRecord || !leadRecord.marketingEnabled || leadRecord.frequency === "off") {
      skipped += 1;
      continue;
    }

    if (
      leadRecord.lastGrowthEmailSentAt &&
      now.getTime() - leadRecord.lastGrowthEmailSentAt.getTime() < GLOBAL_THROTTLE_MS
    ) {
      skipped += 1;
      continue;
    }

    const existingLeadSend = await prisma.emailLeadGrowthSend.findUnique({
      where: {
        emailLeadId_campaignType_periodKey: {
          emailLeadId: lead.id,
          campaignType,
          periodKey: pKey,
        },
      },
    });
    if (existingLeadSend) {
      skipped += 1;
      continue;
    }

    const listing = await jobService.list({
      page: 1,
      limit: 20,
      sort: "latest",
      filters: {
        postedAfter: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    });
    const selected = listing.items.slice(0, 20);
    if (selected.length === 0) {
      skipped += 1;
      await prisma.emailLeadGrowthSend.create({
        data: {
          emailLeadId: lead.id,
          campaignType,
          periodKey: pKey,
          status: "skipped",
          jobCountSent: 0,
          error: "No eligible jobs after dedupe",
        },
      });
      continue;
    }

    const jobsPayload: GrowthEmailTemplateJob[] = selected.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company.name,
      location: [j.locationCity, j.locationCountry].filter(Boolean).join(", ") || "Remote/Unknown",
      url: `${clientPublicUrl().replace(/\/$/, "")}/job/${j.id}`,
      postedAt: j.postedAt ? j.postedAt.toISOString().slice(0, 10) : "Recently posted",
      category: j.category || "other",
    }));
    const subject = getGrowthEmailSubject({ campaignType, jobCount: jobsPayload.length });
    const secret = process.env.JOB_ALERT_HMAC_SECRET?.trim();
    if (!secret) {
      skipped += 1;
      continue;
    }
    const token = signGrowthEmailUnsubscribeToken(
      lead.email,
      "growth_all",
      secret,
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    const html = renderGrowthEmailHtml({
      userName: lead.email.split("@")[0] ?? "there",
      campaignLabel: campaignLabel(campaignType),
      jobs: jobsPayload,
      ctaUrl: `${clientPublicUrl().replace(/\/$/, "")}/jobs`,
      upgradeToProUrl: `${clientPublicUrl().replace(/\/$/, "")}/pricing`,
      managePreferencesUrl: `${clientPublicUrl().replace(/\/$/, "")}/jobs`,
      unsubscribeUrl: `${apiPublicUrl().replace(/\/$/, "")}/growth-email/unsubscribe?token=${encodeURIComponent(token)}`,
      brandLogoUrl: `${clientPublicUrl().replace(/\/$/, "")}/brand/jobloom-logo-prim.png`,
    });

    const send = await sendEmail({
      to: lead.email,
      subject,
      html,
      eventName: "growth_email_lead",
    });

    await prisma.emailLeadGrowthSend.create({
      data: {
        emailLeadId: lead.id,
        campaignType,
        periodKey: pKey,
        status: send.ok ? "sent" : "failed",
        providerMessageId: send.messageId,
        subjectUsed: subject,
        jobCountSent: jobsPayload.length,
        sentAt: send.ok ? now : null,
        error: send.ok ? null : send.error,
      },
    });

    if (!send.ok) {
      skipped += 1;
      continue;
    }

    await prisma.emailLead.update({
      where: { id: lead.id },
      data: { lastGrowthEmailSentAt: now },
    });
    sent += 1;
  }

  return { processed: userRecipients.length + leadRecipients.length, sent, skipped };
}
