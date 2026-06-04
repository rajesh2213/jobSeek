import type { PrismaClient } from "@prisma/client";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import {
  createAtsEndpointService,
  dedupeRegistrationsByTypeSlug,
} from "../../src/modules/atsEndpoint/atsEndpoint.service.js";

export const RECOVERED_TAG = "class_b_token_recovery:recovered";
export const ACTIVATION_TAG = "class_b_activation";

export type ActivationAction =
  | "create_endpoint"
  | "relink_endpoint"
  | "validate_endpoint"
  | "enqueue_ingest"
  | "no_action_required"
  | "skip_collision"
  | "skip_unparseable"
  | "skip_no_token";

export type RecoveredCompanyRow = {
  id: string;
  name: string;
  atsType: string | null;
  atsBoardToken: string | null;
  careersUrl: string | null;
  status: string;
  discoverySource: string | null;
};

export type ActivationPlan = {
  companyId: string;
  companyName: string;
  atsType: string;
  token: string;
  action: ActivationAction;
  detail: string;
  endpointId?: string;
  parsed?: { type: string; slug: string; baseUrl: string };
};

export async function fetchRecoveredCompanies(prisma: PrismaClient): Promise<RecoveredCompanyRow[]> {
  return prisma.$queryRaw<RecoveredCompanyRow[]>`
    SELECT
      id,
      name,
      "atsType",
      "atsBoardToken",
      "careersUrl",
      status::text AS status,
      "discoverySource"
    FROM "Company"
    WHERE "discoverySource" LIKE ${`%${RECOVERED_TAG}%`}
    ORDER BY name ASC
  `;
}

export async function planActivation(
  prisma: PrismaClient,
  company: RecoveredCompanyRow,
): Promise<ActivationPlan> {
  const atsType = company.atsType?.trim();
  const token = company.atsBoardToken?.trim();
  const base = {
    companyId: company.id,
    companyName: company.name,
    atsType: atsType ?? "",
    token: token ?? "",
  };

  if (!atsType || !token) {
    return { ...base, action: "skip_no_token", detail: "missing atsType or atsBoardToken" };
  }

  const parsed = parseCrawlableBoard(atsType as AtsType, token, company.careersUrl);
  if (!parsed) {
    return { ...base, action: "skip_unparseable", detail: "parseCrawlableBoard returned null" };
  }

  const companyEndpoints = await prisma.atsEndpoint.findMany({
    where: { companyId: company.id },
    select: { id: true, type: true, slug: true, isActive: true, companyId: true },
  });

  const globalEp = await prisma.atsEndpoint.findUnique({
    where: { type_slug: { type: parsed.type, slug: parsed.slug } },
    select: { id: true, type: true, slug: true, isActive: true, companyId: true },
  });

  const activeLinked = companyEndpoints.find((e) => e.isActive);
  if (activeLinked) {
    return {
      ...base,
      action: "no_action_required",
      detail: `active endpoint ${activeLinked.type}/${activeLinked.slug}`,
      endpointId: activeLinked.id,
      parsed,
    };
  }

  const linkedInactive = companyEndpoints.find((e) => !e.isActive);
  if (linkedInactive) {
    return {
      ...base,
      action: "validate_endpoint",
      detail: `inactive linked endpoint ${linkedInactive.type}/${linkedInactive.slug}`,
      endpointId: linkedInactive.id,
      parsed,
    };
  }

  if (globalEp) {
    if (globalEp.companyId === company.id) {
      return {
        ...base,
        action: globalEp.isActive ? "no_action_required" : "validate_endpoint",
        detail: globalEp.isActive ? "global endpoint active" : "global endpoint inactive",
        endpointId: globalEp.id,
        parsed,
      };
    }
    if (globalEp.companyId == null) {
      return {
        ...base,
        action: "relink_endpoint",
        detail: `orphan ${globalEp.type}/${globalEp.slug}`,
        endpointId: globalEp.id,
        parsed,
      };
    }
    return {
      ...base,
      action: "skip_collision",
      detail: `endpoint owned by ${globalEp.companyId}`,
      endpointId: globalEp.id,
      parsed,
    };
  }

  return {
    ...base,
    action: "create_endpoint",
    detail: `register ${parsed.type}/${parsed.slug}`,
    parsed,
  };
}

export function mergeTag(source: string | null, tag: string): string {
  const parts = (source ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(",");
}

export async function executeActivation(
  prisma: PrismaClient,
  plan: ActivationPlan,
  dryRun: boolean,
): Promise<{ endpointId: string | null; action: ActivationAction }> {
  if (
    plan.action === "skip_collision" ||
    plan.action === "skip_unparseable" ||
    plan.action === "skip_no_token" ||
    plan.action === "no_action_required"
  ) {
    return { endpointId: plan.endpointId ?? null, action: plan.action };
  }

  if (!plan.parsed) {
    return { endpointId: null, action: plan.action };
  }

  const { parsed } = plan;

  if (plan.action === "relink_endpoint" && plan.endpointId) {
    if (!dryRun) {
      await prisma.atsEndpoint.update({
        where: { id: plan.endpointId },
        data: { companyId: plan.companyId, companyName: plan.companyName },
      });
    }
    return { endpointId: plan.endpointId, action: "relink_endpoint" };
  }

  if (plan.action === "create_endpoint") {
    if (dryRun) {
      return { endpointId: plan.endpointId ?? null, action: "create_endpoint" };
    }
    const svc = createAtsEndpointService(prisma);
    const reg = dedupeRegistrationsByTypeSlug([
      {
        type: parsed.type,
        slug: parsed.slug,
        baseUrl: parsed.baseUrl,
        crawlToken: parsed.crawlToken,
        companyName: plan.companyName,
        companyId: plan.companyId,
      },
    ])[0]!;
    const row = await svc.registerEndpoint(reg);
    return { endpointId: row?.id ?? null, action: "create_endpoint" };
  }

  return { endpointId: plan.endpointId ?? null, action: plan.action };
}
