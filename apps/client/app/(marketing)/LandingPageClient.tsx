"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  motion,
  AnimatePresence,
  useInView,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import GuidedHookDemo from "../../components/GuidedHookDemo";
import { EmailCaptureCard } from "../../components/email/EmailCaptureCard";
import {
  DESKTOP_RAIL_INSET_CLASS,
  DESKTOP_RAIL_OPTICAL_CENTER_SHIFT_CLASS,
} from "../../components/layout/railInset";
import { HERO_JOB_INDEX_TOTAL, SHOW_LANDING_TESTIMONIALS } from "../../lib/landingPublic";
import { FeatureCtaBand } from "../../components/marketing/featurePagePrimitives";
function mapRange(progress: MotionValue<number>, start: number, end: number, from: number, to: number) {
  return useTransform(progress, [start, end], [from, to]);
}

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let frame = 0;
    const steps = 40;
    const tick = () => {
      frame += 1;
      const progress = Math.min(frame / steps, 1);
      setValue(Math.round(to * progress));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, to]);
  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

const SIGNAL_MESSAGES = [
  "Aggregate listings from career sites and boards in one place",
  "Resume-aware matching helps you spot gaps before you apply",
  "Designed to surface fresh posts as we ingest them",
  "Track applications and saved searches in one workspace",
];

function RotatingSignal() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((v) => (v + 1) % SIGNAL_MESSAGES.length), 3500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-3 flex min-h-9 items-center justify-start overflow-hidden rounded-lg border border-ink/8 bg-white/50 px-3 py-1">
      <span className="mr-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
      <AnimatePresence mode="wait">
        <motion.span
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="text-[13px] font-medium text-ink/55"
        >
          {SIGNAL_MESSAGES[idx]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function HeroSection({ progress }: { progress: MotionValue<number> }) {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobileViewport(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const heroScale = mapRange(
    progress,
    isMobileViewport ? 0.12 : 0,
    isMobileViewport ? 0.42 : 0.16,
    1,
    isMobileViewport ? 0.985 : 0.95,
  );
  const heroY = mapRange(
    progress,
    isMobileViewport ? 0.12 : 0,
    isMobileViewport ? 0.42 : 0.16,
    0,
    isMobileViewport ? -10 : -28,
  );
  const heroOpacity = mapRange(
    progress,
    isMobileViewport ? 0.16 : 0.04,
    isMobileViewport ? 0.48 : 0.15,
    1,
    isMobileViewport ? 0.9 : 0.24,
  );
  const cardRotate = mapRange(
    progress,
    isMobileViewport ? 0.16 : 0,
    isMobileViewport ? 0.48 : 0.16,
    0,
    isMobileViewport ? 4 : 14,
  );
  const cardX = mapRange(
    progress,
    isMobileViewport ? 0.16 : 0,
    isMobileViewport ? 0.48 : 0.16,
    0,
    isMobileViewport ? 18 : 190,
  );
  const cardY = mapRange(
    progress,
    isMobileViewport ? 0.16 : 0,
    isMobileViewport ? 0.48 : 0.16,
    0,
    isMobileViewport ? -8 : -24,
  );
  const cardScale = mapRange(
    progress,
    isMobileViewport ? 0.16 : 0,
    isMobileViewport ? 0.48 : 0.16,
    1,
    isMobileViewport ? 0.98 : 0.92,
  );
  const cardOpacity = mapRange(
    progress,
    isMobileViewport ? 0 : 0.01,
    isMobileViewport ? 1 : 0.17,
    1,
    isMobileViewport ? 1 : 0.2,
  );
  const pulseColor = useTransform(progress, [0, 0.05, 0.1, 0.2], ["#E8533A", "#F97316", "#E8533A", "#E8533A"]);

  const stats = useMemo(
    () =>
      [
        { type: "count" as const, k: "Roles in our index", v: HERO_JOB_INDEX_TOTAL, numberSuffix: "+" as const },
        {
          type: "tagline" as const,
          k: "One workspace",
          sub: "Search across sources, get personalised alerts, then track what you applied to",
        },
      ] as const,
    [],
  );

  return (
    <section
      className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-2 pt-4 sm:px-6 lg:grid-cols-2 lg:items-center"
    >
      <motion.div className="flex flex-col" style={{ scale: heroScale, y: heroY, opacity: heroOpacity }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1.5 text-xs font-semibold text-ink/70 shadow-sm sm:whitespace-nowrap sm:px-3.5">
            Many roles start on <span className="font-extrabold text-brand">company career sites</span>
          </span>
          <span className="rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1.5 text-xs font-semibold text-ink/70 shadow-sm sm:whitespace-nowrap sm:px-3.5">
            <span className="font-extrabold text-brand">Faster triage</span> — less tab-hopping
          </span>
          <span className="rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1.5 text-xs font-semibold text-ink/70 shadow-sm sm:whitespace-nowrap sm:px-3.5">
            Built for people who want to <span className="font-extrabold text-brand">move early &amp; stay organized</span>
          </span>
        </div>
        <h1 className="mt-4 font-display text-[clamp(2.7rem,12vw,3.9rem)] leading-[1.03] text-ink sm:text-6xl">
          <span>You're not getting rejected.</span>
          <br />
          <span className="font-semibold text-ink">You're getting </span>
          <motion.span className="font-semibold text-brand" style={{ color: pulseColor }}>
            filtered out
          </motion.span>
          <br />
          <span className="font-semibold text-ink">and showing up </span>
          <motion.span className="font-semibold text-brand" style={{ color: pulseColor }}>
            too late.
          </motion.span>
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/75 sm:text-base">
          Most resumes <span className="font-semibold text-ink">never reach a human.</span> And by the time you apply, the role is already{" "}
          <span className="font-semibold text-ink">crowded.</span>
          <br />
          <span className="block h-1" aria-hidden />
          JobLoom helps you <span className="font-semibold text-ink">move earlier</span>, <span className="font-semibold text-ink">fix what's missing</span>, and{" "}
          <span className="font-semibold text-ink">track everything</span> - so nothing slips through.
        </p>
        <div className="order-1 mt-2 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2 lg:order-none">
          {stats.map((s, i) => (
            <motion.div
              key={s.k}
              className="rounded-xl border border-ink/10 bg-white/55 p-3"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
            >
              {s.type === "count" ? (
                <>
                  <p className="text-xl font-extrabold tabular-nums text-ink">
                    {s.v > 10 ? <CountUp to={s.v} /> : s.v}
                    {s.numberSuffix ?? ""}
                  </p>
                  <p className="text-xs text-ink/60">{s.k}</p>
                </>
              ) : (
                <>
                  <p className="text-base font-extrabold text-ink">{s.k}</p>
                  <p className="mt-1 text-xs leading-snug text-ink/60">{s.sub}</p>
                </>
              )}
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 lg:order-none">
          <motion.div
            animate={{ boxShadow: ["0 0 0 0 rgba(232,83,58,0.35)", "0 0 0 10px rgba(232,83,58,0)"] }}
            transition={{ repeat: Infinity, duration: 1.8 }}
            className="rounded-full"
          >
            <motion.div whileTap={{ scale: 0.96 }}>
              <Link
                href="/jobs"
                className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold !text-white shadow-md transition-colors hover:bg-brand-hover hover:!text-white"
              >
                Find Jobs Smarter →
              </Link>
            </motion.div>
          </motion.div>
        </div>
        <div className="order-2 mt-4 max-w-xl lg:order-none">
          <EmailCaptureCard
            source="homepage"
            title="Get top jobs daily - free"
            subtitle="High-signal roles delivered daily. Unsubscribe anytime."
            className="rounded-2xl border border-ink/10 bg-white/70 p-2.5 [&_p:nth-of-type(2)]:mt-0.5 [&_form]:mt-2 [&_form]:gap-1.5 [&_input]:py-1.5 [&_button]:py-1.5"
          />
          <RotatingSignal />
        </div>
      </motion.div>

      <motion.div style={{ rotate: cardRotate, x: cardX, y: cardY, scale: cardScale, opacity: cardOpacity }}>
        <GuidedHookDemo />
      </motion.div>
    </section>
  );
}

const PAIN_POINTS = [
  {
    pain: "You apply to 50+ roles. No response.",
    sub: "Your resume never passes ATS filters.",
    fix: "Resume match score + missing keyword detection",
    outcome: "Know your shortlist odds before you click Apply.",
  },
  {
    pain: "You find jobs hours late.",
    sub: "Hundreds have already applied.",
    fix: "Real-time job ingestion + Smart Apply",
    outcome: "See fresh posts sooner and apply with a clearer plan.",
  },
  {
    pain: "You jump between 5+ job boards daily.",
    sub: "Still miss high-quality roles.",
    fix: "Aggregated feed from every major source",
    outcome: "One feed. Every role. Nothing missed.",
  },
  {
    pain: "The same job appears everywhere.",
    sub: "You waste time on duplicates.",
    fix: "Intelligent deduplication engine",
    outcome: "Only unique roles. Zero noise.",
  },
  {
    pain: "Your inbox is chaos.",
    sub: "You miss assessments and follow-ups.",
    fix: "Email job alerts on saved searches (Pro) + Applications view",
    outcome: "Know when new matches land-follow up while the role is still fresh.",
  },
];

function PainSection() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const containerY = mapRange(scrollYProgress, 0.03, 0.2, 110, 0);
  const containerOpacity = useTransform(scrollYProgress, [0.03, 0.2, 0.5, 0.82], [0, 1, 1, 0.6]);
  const handoffX = mapRange(scrollYProgress, 0.5, 0.82, 0, -40);
  return (
    <motion.section ref={ref} className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <motion.div
        className="rounded-2xl border border-[#E8533A]/30 bg-[#E8533A]/5 p-6 sm:p-8"
        style={{ y: containerY, x: handoffX, opacity: containerOpacity }}
      >
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">The hard truth</p>
        <h2 className="mt-3 text-3xl font-semibold leading-snug sm:text-4xl">
          Your job search isn't failing.
          <br />
          It's working exactly how it's designed to.
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PAIN_POINTS.map((p, i) => {
            const start = 0.12 + i * 0.1;
            const cardY = mapRange(scrollYProgress, start, start + 0.062, 48, 0);
            const cardOpacity = mapRange(scrollYProgress, start, start + 0.062, 0, 1);
            const clip = useTransform(
              scrollYProgress,
              [start, start + 0.062],
              ["inset(0% 0% 85% 0% round 12px)", "inset(0% 0% 0% 0% round 12px)"],
            );
            return (
            <motion.div
              key={p.pain}
              style={{ y: cardY, opacity: cardOpacity, clipPath: clip }}
              className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-ink">{p.pain}</p>
              <p className="mt-1 text-xs text-ink/50">{p.sub}</p>
            </motion.div>
          );})}
        </div>
      </motion.div>
    </motion.section>
  );
}

function SolutionSection() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end 45%"],
  });
  const sectionX = mapRange(scrollYProgress, 0, 0.12, 80, 0);
  const sectionOpacity = useTransform(scrollYProgress, [0, 0.1, 0.76, 1], [0, 1, 1, 0.72]);
  const sectionScale = useTransform(scrollYProgress, [0.72, 1], [1, 0.982]);

  return (
    <motion.section ref={ref} className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <motion.div
        className="rounded-2xl"
        style={{
          x: sectionX,
          opacity: sectionOpacity,
          scale: sectionScale,
        }}
      >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Why JobLoom is different</p>
      <h2 className="mt-3 text-3xl font-semibold leading-snug sm:text-4xl">
        Fresh jobs from company career sites, centralized for faster discovery.
      </h2>
        <p className="mt-2 max-w-3xl text-sm text-ink/70">
          JobLoom continuously ingests roles from company career pages and trusted sources, deduplicates them, and organizes them in one place so you can discover and apply early.{" "}
          <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false} className="font-semibold text-brand hover:underline">
            Learn why many jobs appear on company career sites before LinkedIn
          </Link>
          .
        </p>
      <div className="mt-8 space-y-4">
        {PAIN_POINTS.map((p, i) => {
          const rowStart = 0.03 + i * 0.1;
          const problemEnd = rowStart + 0.06;
          const solutionStart = problemEnd + 0.02;
          const solutionEnd = solutionStart + 0.085;

          const rowOpacity = mapRange(scrollYProgress, rowStart, solutionEnd, 0, 1);
          const problemOpacity = mapRange(scrollYProgress, rowStart, problemEnd, 0, 1);
          const problemY = mapRange(scrollYProgress, rowStart, problemEnd, 24, 0);

          const solutionOpacity = mapRange(scrollYProgress, solutionStart, solutionEnd, 0, 1);
          const solutionX = mapRange(scrollYProgress, solutionStart, solutionEnd, 60, 0);
          const solutionGlow = mapRange(scrollYProgress, solutionStart, solutionEnd, 0, 0.18);
          const solutionScale = useTransform(
            scrollYProgress,
            [solutionStart, solutionStart + 0.045, solutionEnd],
            [1, 1.02, 1],
          );
          return (
          <motion.div
            key={p.fix}
            style={{ opacity: rowOpacity }}
            className="group grid overflow-hidden rounded-2xl border border-ink/10 bg-emerald-50/60 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(20,20,20,0.08)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <motion.div style={{ opacity: problemOpacity, y: problemY }} className="bg-red-50/60">
              <div className="h-full px-5 py-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">Problem</span>
                <p className="mt-1.5 text-sm font-semibold text-ink/80 transition-all duration-200 group-hover:font-bold">{p.pain}</p>
                <p className="mt-0.5 text-xs text-ink/45">{p.sub}</p>
              </div>
            </motion.div>
            <motion.div
              style={{
                opacity: solutionOpacity,
                x: solutionX,
                scale: solutionScale,
                boxShadow: useTransform(solutionGlow, (v) => `inset 0 0 0 1px rgba(16,185,129,${v}), 0 0 0 0 rgba(0,0,0,0)`),
              }}
              className="transition-all duration-200"
            >
              <div className="h-full bg-emerald-50/60 px-5 py-4 transition-all duration-300 group-hover:-translate-x-20 group-hover:bg-emerald-50/75">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">JobLoom</span>
                <p className="mt-1.5 text-sm font-semibold text-ink/80 transition-all duration-200 group-hover:font-bold">{p.fix}</p>
                <p className="mt-0.5 text-xs text-ink/45">{p.outcome}</p>
              </div>
            </motion.div>
          </motion.div>
        );})}
      </div>
      </motion.div>
    </motion.section>
  );
}

function HighlightCarouselCard({
  title,
  body,
  href,
  motionKey,
  motionProps,
}: {
  title: string;
  body: string;
  href?: string;
  motionKey: string;
  motionProps: {
    initial: { opacity: number; y: number; rotate: number };
    whileInView: { opacity: number; y: number; rotate: number };
    viewport: { once: boolean; amount: number };
    transition: { duration: number; delay: number };
  };
}) {
  const inner = (
    <>
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-2 leading-snug">{body}</p>
      {href ? (
        <p className="mt-2 text-xs font-semibold text-brand">Learn more →</p>
      ) : null}
    </>
  );
  const className =
    "w-[320px] rounded-2xl border border-ink/10 bg-canvas p-4 text-sm text-ink/75 transition-shadow hover:shadow-[0_8px_24px_rgba(20,20,20,0.06)]";
  return (
    <motion.div key={motionKey} {...motionProps} className={className}>
      {href ? (
        <Link href={href} prefetch={false} className="block no-underline text-inherit">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </motion.div>
  );
}

/** Product-capability carousel — no named testimonials or outcome guarantees. */
function SocialProofSection() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 88%", "end 20%"],
  });
  const highlights = [
    {
      title: "Aggregated discovery",
      body: "Pull roles from career sites and boards into one searchable place—so you spend less time tab-hopping.",
    },
    {
      title: "Resume-aware matching",
      body: "See fit signals and keyword gaps before you invest time in an application. You stay in control of what you send.",
    },
    {
      title: "Apply on the employer’s site",
      body: "JobLoom helps you discover and evaluate fit; you still submit applications through the company’s own flows.",
    },
    {
      title: "Smart Apply (Pro)",
      body: "Optional browser extension assists with form fields from your saved profile—you review everything before submitting.",
      href: "/features/smart-apply",
    },
    {
      title: "Saved searches & alerts",
      body: "Pro can email you when new roles match filters you care about—useful when you can’t watch the feed all day.",
    },
    {
      title: "Application tracking",
      body: "Keep stages and notes in one workspace so follow-ups don’t get lost in your inbox.",
      href: "/features/application-tracker",
    },
  ];
  const sectionY = mapRange(scrollYProgress, 0, 0.16, 56, 0);
  const sectionOpacity = mapRange(scrollYProgress, 0, 0.14, 0, 1);
  const rowA = highlights.slice(0, 3);
  const rowB = highlights.slice(3);
  const parallaxA = mapRange(scrollYProgress, 0.08, 0.9, -26, 18);
  const parallaxB = mapRange(scrollYProgress, 0.08, 0.9, 20, -16);

  return (
    <motion.section
      ref={ref}
      style={{ y: sectionY, opacity: sectionOpacity }}
      className="border-y border-ink/10 bg-white/40 py-14"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:pl-[136px]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Built for serious job seekers</p>
        <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">What JobLoom is designed to help you do</h2>
        <p className="mt-3 text-sm text-ink/65">
          Software for discovery and organization—not a recruiting agency, and not a promise of interviews or offers.
        </p>
        <div className="mt-6 space-y-4 overflow-hidden">
          <motion.div style={{ x: parallaxA }}>
            <motion.div
              className="flex w-max gap-4 pr-4"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 34, repeat: Infinity, ease: "linear" }}
            >
              {[...rowA, ...rowA].map((t, i) => (
                <HighlightCarouselCard
                  key={`a-${t.title}-${i}`}
                  title={t.title}
                  body={t.body}
                  href={"href" in t ? t.href : undefined}
                  motionKey={`a-${t.title}-${i}`}
                  motionProps={{
                    initial: { opacity: 0, y: 14, rotate: i % 2 === 0 ? -1.8 : 1.8 },
                    whileInView: { opacity: 1, y: 0, rotate: 0 },
                    viewport: { once: true, amount: 0.35 },
                    transition: { duration: 0.55, delay: Math.min(i, 2) * 0.08 },
                  }}
                />
              ))}
            </motion.div>
          </motion.div>

          <motion.div style={{ x: parallaxB }}>
            <motion.div
              className="flex w-max gap-4 pr-4"
              animate={{ x: ["-50%", "0%"] }}
              transition={{ duration: 37, repeat: Infinity, ease: "linear" }}
            >
              {[...rowB, ...rowB].map((t, i) => (
                <HighlightCarouselCard
                  key={`b-${t.title}-${i}`}
                  title={t.title}
                  body={t.body}
                  href={"href" in t ? t.href : undefined}
                  motionKey={`b-${t.title}-${i}`}
                  motionProps={{
                    initial: { opacity: 0, y: 14, rotate: i % 2 === 0 ? 1.8 : -1.8 },
                    whileInView: { opacity: 1, y: 0, rotate: 0 },
                    viewport: { once: true, amount: 0.35 },
                    transition: { duration: 0.55, delay: Math.min(i, 2) * 0.08 },
                  }}
                />
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>
    </motion.section>
  );
}


function ExitIntentCapture() {
  const { isLoaded, isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    if (dismissed) return;
    const onMouseOut = (e: MouseEvent) => {
      if (dismissed) return;
      if (e.clientY > 8) return;
      setOpen((prev) => prev || true);
    };
    window.addEventListener("mouseout", onMouseOut);
    return () => window.removeEventListener("mouseout", onMouseOut);
  }, [dismissed, isLoaded, isSignedIn]);
  if (!isLoaded || isSignedIn) return null;
  if (!open) return null;
  return (
    <div className="fixed right-4 top-20 z-50 w-[min(92vw,420px)] rounded-2xl border border-ink/10 bg-canvas p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink/70">Before you go</p>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            setOpen(false);
          }}
          className="text-xs text-ink/50 hover:text-ink"
        >
          close
        </button>
      </div>
      <EmailCaptureCard
        source="exit_intent"
        title="Don't miss new jobs"
        subtitle="Get a daily shortlist in your inbox."
        onSubscribeSuccess={() => {
          setDismissed(true);
          window.setTimeout(() => setOpen(false), 2400);
        }}
      />
    </div>
  );
}

export default function LandingPageClient() {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: scrollRootRef,
    offset: ["start start", "end end"],
  });
  return (
    <div ref={scrollRootRef} className="relative min-h-screen bg-canvas text-ink">
      <div className={DESKTOP_RAIL_INSET_CLASS}>
        <div className={DESKTOP_RAIL_OPTICAL_CENTER_SHIFT_CLASS}>
          <HeroSection progress={scrollYProgress} />
          <PainSection />
          <SolutionSection />
        </div>
      </div>
      {SHOW_LANDING_TESTIMONIALS ? <SocialProofSection /> : null}
      <div className="pb-16">
        <FeatureCtaBand
          railBleed={false}
          title="Your next shortlist starts here"
          body={`Search ${HERO_JOB_INDEX_TOTAL.toLocaleString()}+ roles from company career sites and boards in one feed, filter by fit, compare against your resume, get email alerts on saved searches and keep every save in one workspace.`}
          primaryHref="/jobs"
          primaryLabel="Find Jobs Smarter →"
        />
      </div>
      <ExitIntentCapture />
    </div>
  );
}
