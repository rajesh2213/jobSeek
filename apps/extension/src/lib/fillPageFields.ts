import type { DetectedField } from "./fieldDetector";
import { detectFormFields } from "./fieldDetector";
import { compositeFieldId, parseCompositeFieldId } from "./frameIds";
import {
  fillAIAnswersWithFallback,
  fillStandardFields,
  type ApplyAiAnswerInput,
  type ApplyProfile,
  type FillFieldResult,
  type FillResult,
  type ResumeFilePayload,
} from "./formFiller";

type RuntimeMessenger = <T>(msg: object) => Promise<T>;

function getCurrentTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (!chrome.tabs?.getCurrent) {
      resolve(undefined);
      return;
    }
    chrome.tabs.getCurrent((tab) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(tab?.id);
    });
  });
}

function withTopFrameCompositeIds(result: FillResult): FillResult {
  return {
    ...result,
    fieldResults: result.fieldResults.map((row) => ({
      ...row,
      id: compositeFieldId(0, row.id),
    })),
    openEnded: result.openEnded.map((field) => ({
      ...field,
      localId: field.id,
      frameId: 0,
      id: compositeFieldId(0, field.id),
    })),
  };
}

/** Fill the current (top) frame without a background round-trip. */
export async function fillTopFrameStandard(
  profile: ApplyProfile,
  resumeFile: ResumeFilePayload | null,
): Promise<FillResult> {
  const result = await fillStandardFields(detectFormFields(), profile, { resumeFile });
  return withTopFrameCompositeIds(result);
}

type FillTabStandardResponse = {
  success?: boolean;
  fieldResults?: FillFieldResult[];
  openEnded?: DetectedField[];
  error?: string;
};

/**
 * Standard autofill for the active tab. Top frame runs in-process because
 * content-script → background → same content-script `FILL_STANDARD` deadlocks.
 */
export async function fillAllTabStandard(
  sendRuntime: RuntimeMessenger,
  profile: ApplyProfile,
  resumeFile: ResumeFilePayload | null,
): Promise<{
  success: boolean;
  fieldResults: FillFieldResult[];
  openEnded: DetectedField[];
  error?: string;
}> {
  const top = await fillTopFrameStandard(profile, resumeFile);

  try {
    const tabId = await getCurrentTabId();
    const timeoutMs = 15_000;
    const timeoutRes = new Promise<FillTabStandardResponse | null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });

    const sub = await Promise.race([
      sendRuntime<FillTabStandardResponse>({
        type: "FILL_TAB_STANDARD",
        tabId,
        profile,
        resumeFile,
        skipFrameIds: [0],
      }),
      timeoutRes,
    ]);

    if (!sub || sub.success === false) {
      return {
        success: true,
        fieldResults: top.fieldResults,
        openEnded: top.openEnded,
        error: sub?.error,
      };
    }

    return {
      success: true,
      fieldResults: [...top.fieldResults, ...(sub.fieldResults ?? [])],
      openEnded: [...top.openEnded, ...(sub.openEnded ?? [])],
    };
  } catch {
    return {
      success: true,
      fieldResults: top.fieldResults,
      openEnded: top.openEnded,
    };
  }
}

type FillTabAiResponse = {
  success?: boolean;
  applied?: number;
  failedIds?: string[];
};

/** Apply AI answers in the top frame in-process; returns composite ids. */
export async function fillTopFrameAiAnswers(
  answers: ApplyAiAnswerInput[],
): Promise<FillTabAiResponse> {
  const localAnswers = answers
    .map((a) => {
      const parsed = parseCompositeFieldId(a.id);
      if (parsed && parsed.frameId !== 0) return null;
      return { ...a, id: parsed?.localId ?? a.id };
    })
    .filter((a): a is ApplyAiAnswerInput => a != null);

  if (!localAnswers.length) {
    return { success: true, applied: 0, failedIds: [] };
  }

  const result = await fillAIAnswersWithFallback(localAnswers, detectFormFields());
  const failedIds = result.failedIds.map((id) => compositeFieldId(0, id));
  return {
    success: true,
    applied: result.applied,
    failedIds,
  };
}

/** AI answer fill across frames without deadlocking the top frame. */
export async function fillAllTabAiAnswers(
  sendRuntime: RuntimeMessenger,
  answers: ApplyAiAnswerInput[],
): Promise<FillTabAiResponse> {
  const topAnswers = answers.filter((a) => {
    const parsed = parseCompositeFieldId(a.id);
    return !parsed || parsed.frameId === 0;
  });
  const subAnswers = answers.filter((a) => {
    const parsed = parseCompositeFieldId(a.id);
    return parsed != null && parsed.frameId !== 0;
  });

  const topRes = await fillTopFrameAiAnswers(topAnswers);

  if (!subAnswers.length) {
    return topRes;
  }

  try {
    const tabId = await getCurrentTabId();
    const subRes = await sendRuntime<FillTabAiResponse>({
      type: "FILL_TAB_AI_ANSWERS",
      tabId,
      answers: subAnswers,
      skipFrameIds: [0],
    });
    return {
      success: topRes.success !== false && subRes?.success !== false,
      applied: (topRes.applied ?? 0) + (subRes?.applied ?? 0),
      failedIds: [...(topRes.failedIds ?? []), ...(subRes?.failedIds ?? [])],
    };
  } catch {
    return topRes;
  }
}
