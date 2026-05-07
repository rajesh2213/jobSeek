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
import {
  ApiRequestError,
  createApplication,
  deleteApplication,
  fetchApplicationStats,
  fetchApplications,
  patchApplicationNotes,
  patchApplicationStatus,
  type ApplicationListItem,
} from "./api";
import { useToast } from "../components/ui/Toast";

export type ApplicationItem = ApplicationListItem;

export interface ApplicationsContextValue {
  appliedJobIds: Set<string>;
  applications: ApplicationItem[];
  isLoading: boolean;
  markApplied: (jobId: string) => Promise<void>;
  unmarkApplied: (jobId: string) => Promise<void>;
  updateStatus: (id: string, status: string) => Promise<void>;
  updateNotes: (id: string, notes: string | null) => Promise<void>;
  removeApplication: (id: string) => Promise<void>;
  stats: { total: number; needsAction: number } | null;
  refresh: () => Promise<void>;
}

const ApplicationsContext = createContext<ApplicationsContextValue | null>(null);

export function ApplicationsProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  const { showToast } = useToast();

  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [optimisticAppliedJobIds, setOptimisticAppliedJobIds] = useState<string[]>([]);
  const [optimisticUnappliedJobIds, setOptimisticUnappliedJobIds] = useState<string[]>([]);
  const [stats, setStats] = useState<{ total: number; needsAction: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const appliedJobIds = useMemo(() => {
    const s = new Set(applications.map((a) => a.job.id));
    for (const id of optimisticUnappliedJobIds) {
      s.delete(id);
    }
    for (const id of optimisticAppliedJobIds) {
      s.add(id);
    }
    return s;
  }, [applications, optimisticAppliedJobIds, optimisticUnappliedJobIds]);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setApplications([]);
      setStats(null);
      return;
    }

    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setApplications([]);
        setStats(null);
        return;
      }

      const [list, st] = await Promise.all([
        fetchApplications(token),
        fetchApplicationStats(token),
      ]);
      const safeList = Array.isArray(list) ? list : [];
      setApplications(safeList);
      setStats({ total: st.total, needsAction: st.needsAction });
    } catch {
      setApplications([]);
      setStats(null);
    } finally {
      setIsLoading(false);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markApplied = useCallback(
    async (jobId: string) => {
      if (!isSignedIn) return;

      setOptimisticUnappliedJobIds((prev) => prev.filter((id) => id !== jobId));
      setOptimisticAppliedJobIds((prev) =>
        prev.includes(jobId) ? prev : [...prev, jobId],
      );

      try {
        const token = await getToken();
        if (!token) return;
        await createApplication(token, jobId);
        await refresh();
        showToast({ message: "Application tracked ✓", type: "success" });
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          return;
        }
      } finally {
        setOptimisticAppliedJobIds((prev) => prev.filter((id) => id !== jobId));
      }
    },
    [getToken, isSignedIn, refresh, showToast],
  );

  const unmarkApplied = useCallback(
    async (jobId: string) => {
      if (!isSignedIn) return;
      setOptimisticAppliedJobIds((prev) => prev.filter((id) => id !== jobId));
      setOptimisticUnappliedJobIds((prev) =>
        prev.includes(jobId) ? prev : [...prev, jobId],
      );

      try {
        const token = await getToken();
        if (!token) return;
        const existing = applications.find((a) => a.job.id === jobId);
        if (existing) {
          await deleteApplication(token, existing.id);
          showToast({ message: "Marked as not applied", type: "success" });
        }
        await refresh();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          return;
        }
      } finally {
        setOptimisticUnappliedJobIds((prev) => prev.filter((id) => id !== jobId));
      }
    },
    [applications, getToken, isSignedIn, refresh, showToast],
  );

  const updateStatus = useCallback(
    async (id: string, status: string) => {
      const token = await getToken();
      if (!token) return;
      await patchApplicationStatus(token, id, status);
      await refresh();
    },
    [getToken, refresh],
  );

  const updateNotes = useCallback(
    async (id: string, notes: string | null) => {
      const token = await getToken();
      if (!token) return;
      await patchApplicationNotes(token, id, notes);
      await refresh();
    },
    [getToken, refresh],
  );

  const removeApplication = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (!token) return;
      await deleteApplication(token, id);
      await refresh();
    },
    [getToken, refresh],
  );

  const value = useMemo<ApplicationsContextValue>(
    () => ({
      appliedJobIds,
      applications,
      isLoading,
      markApplied,
      unmarkApplied,
      updateStatus,
      updateNotes,
      removeApplication,
      stats,
      refresh,
    }),
    [
      appliedJobIds,
      applications,
      isLoading,
      markApplied,
      unmarkApplied,
      updateStatus,
      updateNotes,
      removeApplication,
      stats,
      refresh,
    ],
  );

  return (
    <ApplicationsContext.Provider value={value}>{children}</ApplicationsContext.Provider>
  );
}

export function useApplications(): ApplicationsContextValue {
  const ctx = useContext(ApplicationsContext);
  if (!ctx) {
    throw new Error("useApplications must be used within ApplicationsProvider");
  }
  return ctx;
}
