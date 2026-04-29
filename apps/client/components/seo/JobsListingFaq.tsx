/**
 * FAQ block for job discovery — rendered below the job list (not in the page header).
 */
export function JobsListingFaq() {
  return (
    <section className="text-left">
      <h2 className="text-xs font-bold uppercase tracking-wider text-ink/45">Common questions</h2>
      <dl className="mt-4 space-y-4 text-sm leading-relaxed text-ink/75">
        <div>
          <dt className="font-semibold text-ink">How often are jobs updated?</dt>
          <dd className="mt-1">
            We refresh listings continuously as sources publish new roles. Use posted-date filters to focus on
            recent openings.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">How do free browsing limits work?</dt>
          <dd className="mt-1">
            Free includes a shared daily budget for job list rows across job search and company pages.
            After the daily budget is used, page 1 shows only a short preview of each list and the rest
            stays blurred until reset, or you can upgrade to Pro for unlimited browsing and the full live
            list.
          </dd>
        </div>
      </dl>
    </section>
  );
}
