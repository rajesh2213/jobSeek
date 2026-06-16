"use client";

import Link from "next/link";
import type { BlogCtaLocation } from "../../../lib/analytics/blogFunnel";
import { trackBlogCtaClicked } from "../../../lib/analytics/blogFunnel";

export function BlogTrackedCtaLink({
  href,
  label,
  article,
  location,
  className,
}: {
  href: string;
  label: string;
  article: string;
  location: BlogCtaLocation;
  className: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      onClick={() => trackBlogCtaClicked(article, location)}
    >
      {label}
    </Link>
  );
}
