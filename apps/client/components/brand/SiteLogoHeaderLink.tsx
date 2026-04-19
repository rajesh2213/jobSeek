"use client";

import Image from "next/image";
import Link from "next/link";
import { siteLogoBrandDotRef } from "../../lib/siteLogoBrandDotRef";
import { SITE_LOGO_HEADER, SITE_LOGO_PRIM_SRC } from "../../lib/siteLogo";

/**
 * Header / marketing logo: image wordmark + invisible measurement point for `HeaderWorkflow` path.
 */
export function SiteLogoHeaderLink() {
  return (
    <Link
      id="site-logo-link"
      href="/"
      prefetch={false}
      className="group relative z-[80] flex shrink-0 items-center no-underline transition-transform duration-200 hover:scale-[1.02]"
    >
      <Image
        src={SITE_LOGO_PRIM_SRC}
        alt="JobLoom"
        width={SITE_LOGO_HEADER.width}
        height={SITE_LOGO_HEADER.height}
        className="h-8 w-auto max-w-[min(100vw-8rem,220px)] object-contain object-left"
        priority
        sizes="220px"
      />
      <span
        ref={siteLogoBrandDotRef}
        id="site-logo-brand-dot"
        className="pointer-events-none absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 opacity-0"
        aria-hidden
      />
    </Link>
  );
}
