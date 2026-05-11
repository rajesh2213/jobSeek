"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useRef, useState } from "react";
import { trackResumeUploaded } from "../../lib/analytics/resumeMatchFunnel";
import { useResume } from "../../lib/resumeContext";
import { ResumeBodyPortal } from "./ResumeBodyPortal";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}

export function ResumeUploadModal({
  open,
  onClose,
  onUploadSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onUploadSuccess?: () => void;
}) {
  const { getToken } = useAuth();
  const { uploadResume, isUploading, uploadError } = useResume();
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSet = useCallback((f: File | null) => {
    setLocalError(null);
    setSuccess(false);
    if (!f) {
      setFile(null);
      return;
    }
    const name = f.name.toLowerCase();
    const okExt = name.endsWith(".pdf") || name.endsWith(".docx");
    const okMime =
      f.type === "application/pdf" ||
      f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!okExt && !okMime) {
      setLocalError("Please upload a PDF or Word document (.docx)");
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setLocalError("File too large. Maximum size is 5MB");
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      validateAndSet(f ?? null);
    },
    [validateAndSet],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      validateAndSet(f ?? null);
    },
    [validateAndSet],
  );

  const handleUpload = async () => {
    if (!file) return;
    setLocalError(null);
    try {
      await uploadResume(file);
      setSuccess(true);
      void trackResumeUploaded({ getToken, source: "resume_upload_modal" });
      onUploadSuccess?.();
      onClose();
      setFile(null);
      setSuccess(false);
    } catch {
      /* uploadResume sets context error */
    }
  };

  if (!open) return null;

  return (
    <ResumeBodyPortal>
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/45 px-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-upload-title"
      onClick={() => !isUploading && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface p-6 shadow-[0_18px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="resume-upload-title" className="text-xl font-bold text-ink">
          Upload your resume
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Upload once — get AI match scores on jobs (free tier limits apply)</p>

        <div
          className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink/20 bg-ink/[0.02] px-4 py-10 text-center transition-colors hover:border-brand/40 hover:bg-brand/[0.02]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onPick}
          />
          <span className="text-2xl" aria-hidden>
            📄
          </span>
          <p className="mt-2 text-sm font-semibold text-ink">Drop your resume here</p>
          <p className="mt-1 text-xs text-ink-muted">or click to browse</p>
          <p className="mt-4 text-xs text-ink/45">PDF or DOCX · Max 5MB</p>
        </div>

        {file ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink">
              Selected: {file.name} {formatBytes(file.size)}
            </span>
            <button
              type="button"
              className="font-semibold text-brand hover:underline"
              onClick={() => setFile(null)}
              disabled={isUploading}
            >
              Remove
            </button>
          </div>
        ) : null}

        {(localError || uploadError) && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {localError ?? uploadError}
          </p>
        )}

        {success ? (
          <div className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <span aria-hidden>✓</span> Resume ready! Click any job to check your match
          </div>
        ) : (
          <button
            type="button"
            className="mt-5 w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!file || isUploading}
            onClick={() => void handleUpload()}
          >
            {isUploading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Parsing your resume...
              </span>
            ) : (
              "Upload & score jobs →"
            )}
          </button>
        )}

        <p className="mt-5 text-center text-xs leading-relaxed text-ink-muted">
          🔒 Your resume is private and never shared with employers
        </p>
      </div>
    </div>
    </ResumeBodyPortal>
  );
}
