import type { Metadata } from "next";
import { JsonLdScript } from "../../components/seo/JsonLdScript";
import { absoluteUrl } from "../../lib/seoSite";
import { SITE_LOGO_PRIM_SRC } from "../../lib/siteLogo";
import LandingPageClient from "../../components/landing/LandingPageClient";

const homepageTitle = "JobLoom - Real-Time Jobs From Company Career Sites, Faster";
const homepageDescription =
  "Find jobs directly from company career sites before they appear on major job boards. Search thousands of real-time remote and tech jobs in one place.";
const homepageCanonical = "/";
const homepageUrl = absoluteUrl(homepageCanonical);

export const metadata: Metadata = {
  title: homepageTitle,
  description: homepageDescription,
  alternates: {
    canonical: homepageCanonical,
  },
  openGraph: {
    title: homepageTitle,
    description: homepageDescription,
    url: homepageUrl,
    siteName: "JobLoom",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JobLoom" }],
  },
  twitter: {
    card: "summary_large_image",
    title: homepageTitle,
    description: homepageDescription,
    images: ["/og-image.png"],
  },
};

function buildSameAs(): string[] {
  const envCandidates = [
    process.env.NEXT_PUBLIC_SOCIAL_X_URL,
    process.env.NEXT_PUBLIC_SOCIAL_TWITTER_URL,
    process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN_URL,
    process.env.NEXT_PUBLIC_SOCIAL_GITHUB_URL,
    process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE_URL,
  ];
  return envCandidates.filter((url): url is string => Boolean(url && url.trim()));
}

export default function LandingPage() {
  const organizationJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "JobLoom",
    url: homepageUrl,
    logo: absoluteUrl(SITE_LOGO_PRIM_SRC),
    description:
      "JobLoom helps people discover real-time jobs directly from company career sites and apply earlier.",
  };

  const sameAs = buildSameAs();
  if (sameAs.length > 0) {
    organizationJsonLd.sameAs = sameAs;
  }

  const webSiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "JobLoom",
    url: homepageUrl,
    description: homepageDescription,
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/jobs")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <JsonLdScript data={organizationJsonLd} />
      <JsonLdScript data={webSiteJsonLd} />
      <LandingPageClient />
    </>
  );
}
