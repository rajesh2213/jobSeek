"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { motion, useInView } from "framer-motion";
import { DESKTOP_RAIL_INSET_CLASS } from "../layout/railInset";

export const featureSectionReveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
} as const;

export function FeaturePageShell({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className={`min-h-screen bg-canvas pb-24 text-ink ${DESKTOP_RAIL_INSET_CLASS}`}
    >
      {children}
    </motion.div>
  );
}

export function FeatureHero({
  eyebrow,
  title,
  titleAccent,
  description,
  badges,
  children,
}: {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  description: string;
  badges?: string[];
  children?: ReactNode;
}) {
  return (
    <header className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14">
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="text-xs font-bold uppercase tracking-[0.16em] text-brand"
      >
        {eyebrow}
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05 }}
        className="mt-3 font-display text-[clamp(2.25rem,8vw,3.5rem)] leading-[1.06] text-ink"
      >
        {title}
        {titleAccent ? (
          <>
            <br />
            <span className="font-semibold text-brand">{titleAccent}</span>
          </>
        ) : null}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.1 }}
        className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg"
      >
        {description}
      </motion.p>
      {badges && badges.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.14 }}
          className="mt-5 flex flex-wrap gap-2"
        >
          {badges.map((b) => (
            <span
              key={b}
              className="rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1.5 text-xs font-semibold text-ink/70"
            >
              {b}
            </span>
          ))}
        </motion.div>
      ) : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </header>
  );
}

export function FeatureSection({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.section {...featureSectionReveal} className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>
      <h2 className="font-sans text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h2>
      {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">{subtitle}</p> : null}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-6"
      >
        {children}
      </motion.div>
    </motion.section>
  );
}

export function FeatureStepCard({
  step,
  title,
  body,
  delay = 0,
}: {
  step: string;
  title: string;
  body: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay }}
      className="rounded-2xl border border-ink/10 bg-white/60 p-5 shadow-[0_8px_28px_rgba(20,20,20,0.04)] transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,20,0.07)]"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand">{step}</span>
      <h3 className="mt-2 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
    </motion.div>
  );
}

export function FeatureHighlightGrid({
  items,
}: {
  items: Array<{ title: string; body: string; icon?: string }>;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.12 }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.07 } },
      }}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {items.map((item) => (
        <motion.div
          key={item.title}
          variants={{
            hidden: { opacity: 0, y: 14 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
          }}
          className="rounded-2xl border border-ink/10 bg-canvas p-4"
        >
          {item.icon ? <span className="text-xl" aria-hidden>{item.icon}</span> : null}
          <p className="mt-1 font-semibold text-ink">{item.title}</p>
          <p className="mt-2 text-sm leading-snug text-ink-muted">{item.body}</p>
        </motion.div>
      ))}
    </motion.div>
  );
}

export function FeatureCtaBand({
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <motion.section
      {...featureSectionReveal}
      className="mx-auto mt-16 w-full max-w-6xl px-4 sm:px-6"
    >
      <motion.div
        whileHover={{ scale: 1.005 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="rounded-2xl border border-ink/10 bg-[linear-gradient(135deg,#1a1a1a_0%,#111_100%)] px-6 py-10 text-center sm:px-10"
      >
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand/80">Ready when you are</p>
        <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/55">{body}</p>
        <motion.div
          className="mt-7 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          <motion.span
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(232,83,58,0.35)",
                "0 0 0 8px rgba(232,83,58,0)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            className="inline-block rounded-full"
          >
            <Link
              href={primaryHref}
              prefetch={false}
              className="inline-flex rounded-full bg-brand px-6 py-2.5 text-sm font-bold !text-white transition-colors hover:bg-brand-hover"
            >
              {primaryLabel}
            </Link>
          </motion.span>
          {secondaryHref && secondaryLabel ? (
            <Link
              href={secondaryHref}
              prefetch={false}
              className="inline-flex rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white/90 transition-colors hover:border-white/40 hover:text-white"
            >
              {secondaryLabel}
            </Link>
          ) : null}
        </motion.div>
      </motion.div>
    </motion.section>
  );
}

export function FeatureCrossLink({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description: string;
}) {
  return (
    <motion.div {...featureSectionReveal} className="mx-auto mt-10 w-full max-w-6xl px-4 text-center sm:px-6">
      <p className="text-sm text-ink-muted">
        {description}{" "}
        <Link href={href} prefetch={false} className="font-semibold text-brand hover:underline">
          {label} →
        </Link>
      </p>
    </motion.div>
  );
}
