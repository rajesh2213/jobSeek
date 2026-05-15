import type { Metadata } from "next";
import { absoluteUrl } from "../../../../lib/seoSite";
import {
  buildFeatureBreadcrumbJsonLd,
  buildSoftwareApplicationJsonLd,
} from "../../../../lib/featurePageSeo";
import ApplicationTrackerFeaturePage from "./ApplicationTrackerFeaturePage";

const PATH = "/features/application-tracker";

const title = "Application Tracker — job application pipeline & follow-ups | JobLoom";
const description =
  "Track job applications in one workspace: pipeline stages, follow-up reminders for stale roles, notes per company, and auto-capture when you apply from JobLoom.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    title,
    description,
    url: absoluteUrl(PATH),
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JobLoom Application Tracker" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

const softwareJsonLd = buildSoftwareApplicationJsonLd({
  name: "JobLoom Application Tracker",
  description,
  path: PATH,
  applicationCategory: "BusinessApplication",
  offers: { price: "0", priceCurrency: "USD" },
});

const breadcrumbJsonLd = buildFeatureBreadcrumbJsonLd([
  { name: "Home", path: "/" },
  { name: "Application Tracker", path: PATH },
]);

export default function ApplicationTrackerFeatureRoute() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <ApplicationTrackerFeaturePage />
    </>
  );
}
