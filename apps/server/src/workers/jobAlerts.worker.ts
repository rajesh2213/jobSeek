import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { discoveryFiltersFromSavedSearchQuery } from "../modules/saved-search/savedSearch.service.js";
import { isUserPro } from "../utils/userPlan.js";
import { signJobAlertUnsubscribeToken } from "../utils/jobAlertToken.js";
import { formatJobPostedLine, jobAlertEmailHtml } from "../utils/emailTemplates.js";
import { buildJobAlertSubject, sendJobAlertEmail } from "../utils/sendJobAlertEmail.js";
import {
  JOB_ALERTS_QUEUE_NAME,
  JOB_ALERTS_TICK,
  closeJobAlertsQueue,
} from "../queues/jobAlerts.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";

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

function roleLabelFromFilters(filters: ReturnType<typeof discoveryFiltersFromSavedSearchQuery>): string {
  if (filters.roleTerms?.length) {
    return filters.roleTerms[0]!.split(/\s+/).slice(0, 3).join(" ");
  }
  if (filters.roles?.length) {
    return filters.roles[0]!.replace(/-/g, " ");
  }
  if (filters.role) {
    return filters.role.replace(/-/g, " ");
  }
  return "job";
}

async function runJobAlerts(): Promise<{ processed: number; emailsSent: number }> {
  const secret = process.env.JOB_ALERT_HMAC_SECRET?.trim();
  if (!secret) {
    logger.warn({ event: "job_alerts_skipped", reason: "no_hmac" }, "job_alerts_skipped");
    return { processed: 0, emailsSent: 0 };
  }

  const jobRepository = createJobRepository(prisma);
  const jobService = new JobService(jobRepository);

  const rows = await prisma.savedSearch.findMany({
    where: { alertEnabled: true },
    include: {
      user: { select: { id: true, email: true, plan: true, subscription: true } },
    },
  });

  let emailsSent = 0;

  for (const row of rows) {
    const pro = await isUserPro(prisma, row.userId, row.user.email);
    if (!pro) {
      await prisma.savedSearch.update({
        where: { id: row.id },
        data: { alertEnabled: false },
      });
      continue;
    }

    const since = row.alertLastSentAt ?? row.createdAt;
    const baseFilters = discoveryFiltersFromSavedSearchQuery(row.query);
    const filters = {
      ...baseFilters,
      postedAfter: since,
    };

    const newCount = await jobService.count({ filters });
    if (newCount < row.alertThreshold) {
      await prisma.savedSearch.update({
        where: { id: row.id },
        data: { alertJobsSeen: newCount },
      });
      continue;
    }

    const page = await jobService.list({
      filters,
      page: 1,
      limit: 10,
      sort: "latest",
    });

    const clientBase = clientPublicUrl().replace(/\/$/, "");
    const apiBase = apiPublicUrl().replace(/\/$/, "");

    const jobsPayload = page.items.map((j) => {
      const loc =
        [j.locationCity, j.locationCountry].filter(Boolean).join(", ") ||
        j.locationCountry ||
        "—";
      return {
        title: j.title,
        company: j.company.name,
        location: loc,
        url: `${clientBase}/job/${j.id}`,
        postedAt: formatJobPostedLine(j),
      };
    });

    const searchName = row.name?.trim() || "Saved search";
    const userName = row.user.email.split("@")[0] ?? "there";
    const token = signJobAlertUnsubscribeToken(row.userId, row.id, secret);
    const searchPath = row.query.startsWith("/") ? row.query : `/${row.query}`;
    const searchUrl = `${clientBase}${searchPath}`;
    const manageUrl = `${clientBase}/saved-searches`;
    const unsubscribeUrl = `${apiBase}/saved-searches/${encodeURIComponent(row.id)}/unsubscribe?token=${encodeURIComponent(token)}`;

    const subject = buildJobAlertSubject({
      jobCount: newCount,
      roleLabel: roleLabelFromFilters(baseFilters),
    });

    const html = jobAlertEmailHtml({
      userName,
      searchName,
      jobCount: newCount,
      jobs: jobsPayload,
      searchUrl,
      manageUrl,
      unsubscribeUrl,
      brandLogoUrl: `${clientBase}/brand/jobloom-logo-prim.png`,
    });

    const send = await sendJobAlertEmail({
      to: row.user.email,
      subject,
      html,
    });

    if (!send.ok) {
      logger.warn(
        { event: "job_alert_send_failed", searchId: row.id, err: send.error },
        "job_alert_send_failed",
      );
      continue;
    }

    emailsSent += 1;
    await prisma.savedSearch.update({
      where: { id: row.id },
      data: {
        alertLastSentAt: new Date(),
        alertJobsSeen: 0,
      },
    });
    await prisma.emailJobSendLog.createMany({
      data: page.items.map((j) => ({
        userId: row.userId,
        jobId: j.id,
        channel: "saved_search_alert",
        sentAt: new Date(),
      })),
    });
  }

  return { processed: rows.length, emailsSent };
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  logger.info({ event: "job_alerts_worker_start" }, "job_alerts_worker_start");

  const worker = new Worker(
    JOB_ALERTS_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_ALERTS_TICK) {
        return;
      }
      const result = await runJobAlerts();
      logger.info({ event: "job_alerts_tick_done", ...result }, "job_alerts_tick_done");
      return result;
    },
    { connection: getRedisConnection() },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeJobAlertsQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "job_alerts_worker_boot_failed", err }, "job_alerts_worker_boot_failed");
  process.exitCode = 1;
});
