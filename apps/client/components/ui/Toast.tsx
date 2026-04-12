"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

export type ToastType = "success" | "info" | "error";

export interface ToastPayload {
  message: string;
  type?: ToastType;
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastPayload, "message">> {
  id: string;
  type: ToastType;
  durationMs: number;
}

interface ToastContextValue {
  showToast: (payload: ToastPayload) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-100",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-100",
  error: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-100",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const baseId = useId();

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((payload: ToastPayload) => {
    const id = `${baseId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const type = payload.type ?? "info";
    const durationMs = payload.durationMs ?? 3000;
    setItems((prev) => [...prev, { id, message: payload.message, type, durationMs }]);
  }, [baseId]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[200] flex max-w-[min(100vw-2rem,22rem)] flex-col gap-2"
      aria-live="polite"
    >
      {items.map((t) => (
        <ToastItemView key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItemView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, item.durationMs, onDismiss]);

  return (
    <motion.div
      role="status"
      initial={{ x: 48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "pointer-events-auto rounded-xl border px-4 py-3 text-sm font-medium shadow-lg",
        TYPE_STYLES[item.type],
      )}
    >
      {item.message}
    </motion.div>
  );
}
