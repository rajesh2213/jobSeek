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
import { jobloomChromeWebStoreUrl } from "../../../../lib/jobloomChromeStore";
import { PLAN_LIMITS } from "../../../../lib/planLimits";
import { signInWithNext } from "../../../../lib/signInUrl";

const WORKSPACE_PATH = "/smart-apply";
const proDailyJobs = PLAN_LIMITS.pro.smartApplyJobs;

function MockFormPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, rotate: -1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.55, delay: 0.2 }}
      className="relative mx-auto max-w-md rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_16px_48px_rgba(20,20,20,0.08)]"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink/50">Employer ATS · Preview</span>
        <motion.span
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700"
        >
          Smart Apply active
        </motion.span>
      </div>
      <motion.div
        initial={{ width: "0%" }}
        animate={{ width: "78%" }}
        transition={{ duration: 1.1, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 h-1.5 rounded-full bg-brand/20"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: "100%" }} />
      </motion.div>
      {[
        { label: "Full name", value: "Alex Morgan", filled: true },
        { label: "Work experience", value: "Senior product designer…", filled: true },
        { label: "Why this role?", value: "Draft ready — review before submit", filled: false },
      ].map((row, i) => (
        <motion.div
          key={row.label}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.35 + i * 0.12 }}
          className="mb-3 rounded-lg border border-ink/8 bg-canvas/80 px-3 py-2.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40">{row.label}</p>
          <p className={`mt-0.5 text-sm ${row.filled ? "text-ink" : "text-brand font-medium"}`}>{row.value}</p>
        </motion.div>
      ))}
      <p className="mt-2 text-center text-[11px] text-ink/45">You review and submit — always in control</p>
    </motion.div>
  );
}

export default function SmartApplyFeaturePage() {
  const { isSignedIn, isLoaded } = useAuth();
  const workspaceHref = isLoaded && isSignedIn ? WORKSPACE_PATH : signInWithNext(WORKSPACE_PATH);

  return (
    <FeaturePageShell>
      <FeatureHero
        eyebrow="Job application tool"
        title="Smart Apply — fill ATS forms faster,"
        titleAccent="without losing your voice"
        description="A Chrome extension plus JobLoom workspace that auto-fills standard fields from your profile and drafts human-sounding answers for open-ended questions. You review everything before you submit on the employer's site."
        badges={[
          "Chrome extension",
          "Profile-driven autofill",
          "Pro feature",
          "No auto-submit",
        ]}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="flex flex-wrap gap-3"
        >
          <Link
            href={workspaceHref}
            prefetch={false}
            className="inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold !text-white transition-colors hover:bg-brand-hover"
          >
            Open Smart Apply Workspace
          </Link>
          <a
            href={jobloomChromeWebStoreUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:text-brand"
          >
            Get the extension →
          </a>
        </motion.div>
        <div className="mt-10 lg:grid lg:grid-cols-2 lg:items-center lg:gap-10">
          <MockFormPreview />
          <motion.ul
            {...featureSectionReveal}
            className="mt-8 space-y-3 text-sm text-ink-muted lg:mt-0"
          >
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              Detects fields on Greenhouse, Lever, Workday, and other common ATS pages.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              Uses your resume-backed profile — not generic filler text.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              AI drafts for long answers respect tone, length, and first-person preferences.
            </li>
          </motion.ul>
        </div>
      </FeatureHero>

      <div className="mt-16 space-y-16">
        <FeatureSection
          title="How Smart Apply works"
          subtitle="Three steps from profile to a reviewed application — on the employer's own site."
        >
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.15 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
            className="grid gap-4 md:grid-cols-3"
          >
            <FeatureStepCard
              step="Step 1"
              title="Build your apply profile"
              body="Upload a resume on JobLoom and refine your Smart Apply workspace — contact info, experience, and optional Q&A examples."
              delay={0}
            />
            <FeatureStepCard
              step="Step 2"
              title="Install the extension"
              body="Add JobLoom Smart Apply from the Chrome Web Store and sign in with the same account you use on jobloom.tech."
              delay={0.08}
            />
            <FeatureStepCard
              step="Step 3"
              title="Fill, review, submit"
              body="Open any supported application form. Smart Apply fills fields and drafts answers — you edit and submit yourself."
              delay={0.16}
            />
          </motion.div>
        </FeatureSection>

        <FeatureSection
          title="Built for serious applicants"
          subtitle="Less repetitive typing, more time on roles that actually fit."
        >
          <FeatureHighlightGrid
            items={[
              {
                icon: "⚡",
                title: "Standard field autofill",
                body: "Name, email, phone, links, and structured experience blocks map from your saved profile.",
              },
              {
                icon: "✍️",
                title: "AI open-ended answers",
                body: `Pro includes up to ${proDailyJobs} job applications per day (UTC) with AI-assisted long-form responses — not a per-question cap.`,
              },
              {
                icon: "🎛️",
                title: "Tone you control",
                body: "Choose professional, friendly, formal, or casual — plus short, medium, or long answer length.",
              },
              {
                icon: "🔒",
                title: "No auto-submit",
                body: "Smart Apply never submits an application for you. Every field stays editable until you click submit.",
              },
              {
                icon: "📄",
                title: "Resume required",
                body: "Your CV is the source of truth for matching answers to your real background.",
              },
              {
                icon: "🔄",
                title: "Daily refresh",
                body: "Profile import from resume is limited to once per UTC day — keeps quality high and costs predictable.",
              },
            ]}
          />
        </FeatureSection>

        <motion.section {...featureSectionReveal} className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="grid overflow-hidden rounded-2xl border border-ink/10 sm:grid-cols-2"
          >
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-red-50/50 px-5 py-6"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Without Smart Apply</p>
              <p className="mt-2 text-sm font-semibold text-ink/85">
                Retyping the same history on every ATS, rushing open-ended answers, losing track of which version you sent.
              </p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-emerald-50/60 px-5 py-6"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">With Smart Apply</p>
              <p className="mt-2 text-sm font-semibold text-ink/85">
                Consistent profile data, draft long answers in your voice, and more energy for choosing the right roles.
              </p>
            </motion.div>
          </motion.div>
        </motion.section>

        <FeatureSection title="Trust and safety" subtitle="Designed for control, not autopilot.">
          <div className="grid gap-4 sm:grid-cols-2">
            <motion.div
              whileHover={{ y: -2 }}
              className="rounded-2xl border border-line bg-surface p-5 shadow-card"
            >
              <p className="text-sm font-bold text-ink">What it does</p>
              <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                <li>Auto-fills repetitive ATS fields from your profile.</li>
                <li>Drafts long written answers aligned to your resume.</li>
                <li>Keeps all output editable before you submit.</li>
              </ul>
            </motion.div>
            <motion.div
              whileHover={{ y: -2 }}
              className="rounded-2xl border border-line bg-surface p-5 shadow-card"
            >
              <p className="text-sm font-bold text-ink">What it does not do</p>
              <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                <li>Does not auto-submit applications.</li>
                <li>Does not replace your judgment on final answers.</li>
                <li>Does not guarantee interviews or offers.</li>
              </ul>
            </motion.div>
          </div>
        </FeatureSection>
      </div>

      <FeatureCtaBand
        title="Start with the extension, then open your workspace"
        body="Pro unlocks Smart Apply AI limits. Free tier lets you explore JobLoom discovery first."
        primaryHref="/pricing"
        primaryLabel="See Pro plans"
        secondaryHref={workspaceHref}
        secondaryLabel="Open Smart Apply workspace"
      />

      <FeatureCrossLink
        href="/features/application-tracker"
        label="Application Tracker"
        description="Pair Smart Apply with a pipeline view — track every role after you apply."
      />

      <p className="mx-auto mt-8 max-w-6xl px-4 text-center text-sm text-ink-muted sm:px-6">
        <Link href="/jobs" prefetch={false} className="font-medium text-brand hover:underline">
          ← Browse jobs
        </Link>
      </p>
    </FeaturePageShell>
  );
}
