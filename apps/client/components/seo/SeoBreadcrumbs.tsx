import Link from "next/link";

export interface CrumbItem {
  name: string;
  href?: string;
}

export function SeoBreadcrumbs({ items }: { items: CrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink/55">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-center gap-2">
            {i > 0 ? <span className="text-ink/25" aria-hidden>/</span> : null}
            {item.href ? (
              <Link href={item.href} className="font-medium text-brand no-underline hover:underline">
                {item.name}
              </Link>
            ) : (
              <span className={i === items.length - 1 ? "font-semibold text-ink/80" : undefined}>
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
