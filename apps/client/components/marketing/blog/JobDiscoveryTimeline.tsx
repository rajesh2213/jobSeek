const TIMELINE_STEPS = [
  {
    day: "Day 0",
    title: "Recruiter creates a job",
    body: "The role is opened inside the company's applicant tracking system.",
  },
  {
    day: "Day 0",
    title: "Job appears on company career page",
    body: "Publishing the role on the careers site is often the first public signal.",
  },
  {
    day: "Day 1–3",
    title: "Job reaches LinkedIn",
    body: "Distribution to major boards typically lags behind the company site.",
  },
  {
    day: "Day 2–5",
    title: "Appears on additional job boards",
    body: "Aggregators and other boards pick up the listing as it spreads.",
  },
  {
    day: "Day 5+",
    title: "Hundreds of applicants compete",
    body: "By the time most seekers discover the role, the queue is already long.",
  },
] as const;

function TimelineArrow() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <svg
        className="h-6 w-6 text-brand/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
    </div>
  );
}

export function JobDiscoveryTimeline() {
  return (
    <section aria-labelledby="job-discovery-timeline-heading" className="my-12">
      <h2 id="job-discovery-timeline-heading" className="font-sans text-xl font-bold text-ink sm:text-2xl">
        How a job spreads over time
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:text-base">
        The exact timing varies, but this pattern shows up again and again.
      </p>
      <ol className="mt-6 list-none space-y-0">
        {TIMELINE_STEPS.map((step, index) => (
          <li key={step.title}>
            <article className="rounded-2xl border border-ink/10 bg-surface px-5 py-4 shadow-[0_8px_28px_rgba(20,20,20,0.04)] sm:px-6 sm:py-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand">{step.day}</p>
              <h3 className="mt-1.5 text-base font-semibold text-ink sm:text-lg">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </article>
            {index < TIMELINE_STEPS.length - 1 ? <TimelineArrow /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
