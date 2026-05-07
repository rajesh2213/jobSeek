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
    source?: string;
  },
): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) return;
  try {
    const queue = getGrowthEmailQueue();
    await queue.add(
      campaignToJobName(input.campaignType),
      {
        userId: input.userId,
        email: input.email,
        jobId: input.jobId,
        source: input.source,
      },
      {
        jobId: `${input.campaignType}:${input.userId}:${input.jobId ?? "none"}`,
      },
    );
  } catch (err) {
    logger.warn({ event: "growth_email_event_enqueue_failed", err }, "growth_email_event_enqueue_failed");
  }
}

export async function runGrowthEmailCampaign(params: {
  prisma: PrismaClient;
  campaignType: GrowthEmailCampaignType;
  userId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ processed: number; sent: number; skipped: number }> {
  const { prisma, campaignType } = params;
  const now = new Date();
  const pKey = periodKey(campaignType, now);
  const frequency = frequencyForCampaign(campaignType);

  const recipients = params.userId
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
        skip: (Math.max(1, params.page ?? 1) - 1) * (params.pageSize ?? DEFAULT_PAGE_SIZE),
        take: params.pageSize ?? DEFAULT_PAGE_SIZE,
      });

  const jobService = new JobService(createJobRepository(prisma));
  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
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

    const listing = await jobService.list({
      page: 1,
      limit: 40,
      sort: "latest",
      filters: {
        postedAfter: campaignType === "weekly_digest"
          ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
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
      recipient.id,
      "growth_all",
      secret,
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    const html = renderGrowthEmailHtml({
      userName: recipient.email.split("@")[0] ?? "there",
      campaignLabel: campaignLabel(campaignType),
      jobs: jobsPayload,
      ctaUrl: `${clientPublicUrl().replace(/\/$/, "")}/jobs`,
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

  return { processed: recipients.length, sent, skipped };
}
