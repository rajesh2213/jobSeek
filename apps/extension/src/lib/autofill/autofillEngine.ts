import type { DetectedField } from "../fieldDetector";
import type { ApplyProfile, ResumeFilePayload } from "../formFiller";
import { fillAIAnswersWithFallback, fillStandardFields } from "../formFiller";
import { batchAnswer, consumeSmartApplyUse } from "../api";

export async function runSequentialAutofill(params: {
  fields: DetectedField[];
  profile: ApplyProfile;
  resumeFile: ResumeFilePayload | null;
  jobTitle: string;
  companyName: string;
  onRequestRescan?: () => Promise<DetectedField[]>;
  onFieldStatus: (
    fieldId: string,
    patch: {
      status:
        | "idle"
        | "queued"
        | "loading"
        | "ai_generating"
        | "filled"
        | "failed"
        | "skipped"
        | "manual_required";
      source?: "mapping" | "ai" | "fallback";
      reason?: string;
    },
  ) => void;
  onProgress: (completed: number, total: number) => void;
}): Promise<void> {
  const total = params.fields.length;
  let completed = 0;
  let openEnded: DetectedField[] = [];

  for (const field of params.fields) {
    params.onFieldStatus(field.id, { status: "queued", source: field.isOpenEnded ? "ai" : undefined });
  }

  for (const field of params.fields) {
    if (field.isOpenEnded) {
      openEnded.push(field);
      continue;
    }
    params.onFieldStatus(field.id, { status: "loading" });
    const result = await fillStandardFields([field], params.profile, {
      resumeFile: params.resumeFile,
    });
    const row = result.fieldResults[0];
    const status = row?.status ?? "failed";
    params.onFieldStatus(field.id, {
      status,
      source: row?.source,
      reason: row?.reason,
    });
    completed++;
    params.onProgress(completed, total);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  if (!openEnded.length) return;

  if (params.onRequestRescan) {
    const rescanned = await params.onRequestRescan();
    openEnded = rescanned.filter((f) => f.isOpenEnded);
  }

  const answerPayload = openEnded.map((field) => ({
    id: field.id,
    question: field.questionText?.trim() || field.label || "Open-ended question",
    charLimit: field.charLimit,
    kind: "free_text" as const,
  }));

  for (const field of openEnded) {
    params.onFieldStatus(field.id, { status: "ai_generating", source: "ai" });
  }

  const answerResult = await batchAnswer({
    questions: answerPayload,
    jobTitle: params.jobTitle || "Role",
    companyName: params.companyName || "Company",
  });

  let appliedTotal = 0;
  const usedLlm =
    (answerResult.tokensUsed ?? 0) > 0 ||
    answerResult.answerMeta?.some((m) => m.source === "llm") === true;

  for (const field of openEnded) {
    params.onFieldStatus(field.id, { status: "loading", source: "ai" });
    const answer = answerResult.answers.find((row) => row.id === field.id)?.answer ?? "";
    const apply = await fillAIAnswersWithFallback(
      [
        {
          id: field.id,
          answer,
          question: field.questionText || field.label,
          selector: field.elementSelector,
          questionHash: field.questionHash,
          groupKey: field.groupKey,
        },
      ],
      params.fields,
    );
    params.onFieldStatus(field.id, {
      status: apply.applied > 0 ? "filled" : "failed",
      source: "ai",
      reason: apply.applied > 0 ? undefined : "AI answer did not apply",
    });
    appliedTotal += apply.applied;
    completed++;
    params.onProgress(completed, total);
    await new Promise((resolve) => window.setTimeout(resolve, 220));
  }

  if (appliedTotal > 0 && usedLlm) {
    await consumeSmartApplyUse();
  }
}

