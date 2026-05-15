"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { motion } from "framer-motion";
import {
  FeatureCtaBand,
  FeatureCrossLink,
  FeatureHero,
  FeatureHighlightGrid,
  FeaturePageShell,
  FeatureSection,
  FeatureStepCard,
  featureSectionReveal,
} from "../../../../components/marketing/featurePagePrimitives";
import { signInWithNext } from "../../../../lib/signInUrl";

const WORKSPACE_PATH = "/applications";

const STAGES = [
  { key: "applied", label: "Applied", color: "bg-slate-200/90 text-slate-800" },
  { key: "acknowledged", label: "Acknowledged", color: "bg-blue-100 text-blue-900" },
  { key: "assessment", label: "Assessment", color: "bg-amber-100 text-amber-950" },
  { key: "interview", label: "Interview", color: "bg-emerald-100 text-emerald-950" },
  { key: "offer", label: "Offer", color: "bg-brand/15 text-[#c43d28]" },
] as const;

function PipelinePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_16px_48px_rgba(20,20,20,0.07)]"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink/50">Your pipeline</p>
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-bold text-ink/55">Active · 4</span>
      </div>
      <motion.div className="space-y-2">
        {[
          { company: "Northwind Labs", role: "Product Designer", status: "interview", days: 3 },
          { company: "Acme Corp", role: "Senior UX", status: "assessment", days: 8 },
          { company: "Bright Health", role: "Design Lead", status: "applied", days: 16, stale: true },
        ].map((row, i) => (
          <motion.div
            key={row.company}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.1 }}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              row.stale ? "border-amber-200/80 bg-amber-50/40" : "border-ink/8 bg-canvas/60"
            }`}
          >
            <motion.div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-xs font-bold text-ink/60"
              whileHover={{ scale: 1.05 }}
            >
              {row.company[0]}
            </motion.div>
            <motion.div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{row.role}</p>
              <p className="truncate text-xs text-ink-muted">{row.company}</p>
            </motion.div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                STAGES.find((s) => s.key === row.status)?.color ?? "bg-ink/10"
              }`}
            >
              {STAGES.find((s) => s.key === row.status)?.label}
            </span>
          </motion.div>
        ))}
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
        className="mt-3 text-center text-[11px] text-amber-700/80"
      >
        Action tab surfaces roles with no response after 14 days
      </motion.p>
    </motion.div>
  );
}

export default function ApplicationTrackerFeaturePage() {
  const { isSignedIn, isLoaded } = useAuth();
  const workspaceHref = isLoaded && isSignedIn ? WORKSPACE_PATH : signInWithNext(WORKSPACE_PATH);

  return (
    <FeaturePageShell>
      <FeatureHero
        eyebrow="Job search organization tool"
        title="Application Tracker —"
        titleAccent="one pipeline for every role"
        description="Stop losing applications in email threads and spreadsheets. JobLoom tracks roles you apply to, surfaces follow-ups that need attention, and keeps notes beside each company."
        badges={[
          "Auto-track from Apply",
          "Pipeline stages",
          "Follow-up reminders",
          "Free with account",
        ]}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="flex flex-wrap gap-3"
        >
          <Link
            href={workspaceHref}
            prefetch={false}
            className="inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold !text-white transition-colors hover:bg-brand-hover"
          >
            Open your tracker →
          </Link>
          <Link
            href="/jobs"
            prefetch={false}
            className="inline-flex rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand/30"
          >
            Browse jobs
          </Link>
        </motion.div>
        <motion.div
          className="mt-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-10"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}
        >
          <PipelinePreview />
          <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
            <p className="text-sm font-semibold text-ink">Stages at a glance</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STAGES.map((s, i) => (
                <motion.span
                  key={s.key}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${s.color}`}
                >
                  {s.label}
                </motion.span>
              ))}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">
              Move roles through Applied → Acknowledged → Assessment → Interview → Offer. Archive closed loops or mark
              rejected — your Active view stays focused on what is still in play.
            </p>
          </motion.div>
        </motion.div>
      </FeatureHero>

      <motion.div
        className="mx-auto mt-6 flex max-w-6xl flex-wrap justify-center gap-2 px-4 sm:px-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
      >
        {STAGES.map((s, i) => (
          <motion.div
            key={s.key}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            transition={{ delay: 0.4 + i * 0.05, duration: 0.35 }}
            className="h-1 flex-1 min-w-[3rem] max-w-[4.5rem] overflow-hidden rounded-full bg-ink/8"
          >
            <motion.div
              className="h-full rounded-full bg-brand"
              initial={{ width: "0%" }}
              animate={{ width: `${((i + 1) / STAGES.length) * 100}%` }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.5 }}
            />
          </motion.div>
        ))}
      </motion.div>

      <motion.div className="mt-16 space-y-16">
        <FeatureSection
          title="How tracking works"
          subtitle="Lightweight by design — capture applications without another spreadsheet."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureStepCard
              step="Step 1"
              title="Apply from JobLoom"
              body='Click "Apply" on a job listing. We add the role to your tracker automatically with company and title.'
            />
            <FeatureStepCard
              step="Step 2"
              title="Update as you hear back"
              body="Change status when you get assessments, interviews, or offers. Add private notes per application."
            />
            <FeatureStepCard
              step="Step 3"
              title="Act on stale roles"
              body='The Action tab highlights applications still marked "Applied" with no activity for 14+ days — nudge follow-ups before they go cold.'
            />
          </div>
        </FeatureSection>

        <FeatureSection
          title="Views that match how you work"
          subtitle="Filter by what needs attention, not by scrolling a giant list."
        >
          <FeatureHighlightGrid
            items={[
              {
                icon: "📋",
                title: "Active",
                body: "Everything in progress — the default view when you open Applications.",
              },
              {
                icon: "⚡",
                title: "Action",
                body: "Applied roles with no update in 14 days. Built for polite follow-up reminders.",
              },
              {
                icon: "📦",
                title: "Archived",
                body: "Closed loops you do not need in your daily triage — still searchable.",
              },
              {
                icon: "📝",
                title: "Per-role notes",
                body: "Capture recruiter names, take-home links, or interview prep beside each entry.",
              },
              {
                icon: "🏢",
                title: "Company context",
                body: "Company logo and title at a glance — jump back to the job when you need details.",
              },
              {
                icon: "🔗",
                title: "Works with discovery",
                body: "Search on JobLoom, apply on the employer site, track the outcome here.",
              },
            ]}
          />
        </FeatureSection>

        <motion.section {...featureSectionReveal} className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div
            className="rounded-2xl border border-ink/10 bg-white/50 p-6"
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 14 }}
            viewport={{ once: true }}
          >
            <p className="text-sm font-semibold text-ink">Honest expectations</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Application Tracker organizes your search — it does not contact employers, schedule interviews, or
              guarantee responses. Outcomes still depend on your fit, timing, and how each company hires.
            </p>
          </motion.div>
        </motion.section>
      </motion.div>

      <FeatureCtaBand
        title="Keep every application in one place"
        body="Sign in to start tracking. Pair with Smart Apply on Pro when you want faster ATS form fills."
        primaryHref={workspaceHref}
        primaryLabel="Open Application Tracker"
        secondaryHref="/features/smart-apply"
        secondaryLabel="Explore Smart Apply"
      />

      <FeatureCrossLink
        href="/features/smart-apply"
        label="Smart Apply"
        description="Applying on employer ATS pages? Smart Apply fills forms from your profile —"
      />

      <p className="mx-auto mt-8 max-w-6xl px-4 text-center text-sm text-ink-muted sm:px-6">
        <Link href="/" prefetch={false} className="font-medium text-brand hover:underline">
          ← Back to home
        </Link>
      </p>
    </FeaturePageShell>
  );
}
