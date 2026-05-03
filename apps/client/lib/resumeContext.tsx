"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { API_BASE_URL } from "./api";
import { useExtensionAuthSync } from "./useExtensionAuthSync";

interface ResumeState {
  resumeText: string | null;
  resumeBullets: string[];
  hasResume: boolean;
  fileName: string | null;
  wordCount: number;
  resumeUpdatedAt: string | null;
  isUploading: boolean;
  uploadError: string | null;
  isLoading: boolean;
}

interface ResumeContextValue extends ResumeState {
  uploadResume: (file: File) => Promise<void>;
  deleteResume: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const ResumeContext = createContext<ResumeContextValue | null>(null);

export function ResumeProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth();

  useExtensionAuthSync({
    enabled: Boolean(isLoaded && isSignedIn),
    getToken: (opts) => getToken(opts),
  });
  const [state, setState] = useState<ResumeState>({
    resumeText: null,
    resumeBullets: [],
    hasResume: false,
    fileName: null,
    wordCount: 0,
    resumeUpdatedAt: null,
    isUploading: false,
    uploadError: null,
    isLoading: false,
  });

  const fetchResumeData = useCallback(async () => {
    if (!isSignedIn) return;
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const token = await getToken();
      if (!token) {
        setState((s) => ({ ...s, isLoading: false }));
        return;
      }
      const statusRes = await fetch(`${API_BASE_URL}/account/resume/status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const status = (await statusRes.json()) as {
        hasResume?: boolean;
        fileName?: string | null;
        wordCount?: number;
        updatedAt?: string | null;
      };
      if (!status.hasResume) {
        setState((s) => ({
          ...s,
          hasResume: false,
          resumeText: null,
          resumeBullets: [],
          fileName: null,
          wordCount: 0,
          resumeUpdatedAt: null,
          isLoading: false,
        }));
        return;
      }
      const textRes = await fetch(`${API_BASE_URL}/account/resume/text`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const textBody = (await textRes.json()) as { text?: string; bullets?: string[] };
      setState((s) => ({
        ...s,
        hasResume: true,
        resumeText: textBody.text ?? "",
        resumeBullets: textBody.bullets ?? [],
        fileName: status.fileName ?? null,
        wordCount: status.wordCount ?? 0,
        resumeUpdatedAt: status.updatedAt ?? null,
        isLoading: false,
      }));
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void fetchResumeData();
  }, [fetchResumeData]);

  const uploadResume = useCallback(
    async (file: File) => {
      setState((s) => ({ ...s, isUploading: true, uploadError: null }));
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const formData = new FormData();
        formData.append("resume", file);
        const res = await fetch(`${API_BASE_URL}/account/resume`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new Error(err.message ?? err.error ?? "Upload failed");
        }
        const { clearScoreCache } = await import("./resumeScorer");
        clearScoreCache();
        await fetchResumeData();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setState((s) => ({ ...s, uploadError: msg, isUploading: false }));
        throw e instanceof Error ? e : new Error(msg);
      }
      setState((s) => ({ ...s, isUploading: false }));
    },
    [fetchResumeData, getToken],
  );

  const deleteResume = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    await fetch(`${API_BASE_URL}/account/resume`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { clearScoreCache } = await import("./resumeScorer");
    clearScoreCache();
    setState((s) => ({
      ...s,
      hasResume: false,
      resumeText: null,
      resumeBullets: [],
      fileName: null,
      wordCount: 0,
      resumeUpdatedAt: null,
    }));
  }, [getToken]);

  const value = useMemo<ResumeContextValue>(
    () => ({
      ...state,
      uploadResume,
      deleteResume,
      refreshStatus: fetchResumeData,
    }),
    [state, uploadResume, deleteResume, fetchResumeData],
  );

  return <ResumeContext.Provider value={value}>{children}</ResumeContext.Provider>;
}

export function useResume(): ResumeContextValue {
  const ctx = useContext(ResumeContext);
  if (!ctx) throw new Error("useResume must be used inside ResumeProvider");
  return ctx;
}
