import type { Metadata } from "next";
import { absoluteUrl } from "../../../../lib/seoSite";
import {
  buildFeatureBreadcrumbJsonLd,
  buildSoftwareApplicationJsonLd,
} from "../../../../lib/featurePageSeo";
import SmartApplyFeaturePage from "./SmartApplyFeaturePage";

const PATH = "/features/smart-apply";

const title = "Smart Apply — ATS autofill & AI application assistant | JobLoom";
const description =
  "Chrome extension and workspace that auto-fills job application forms from your profile and drafts open-ended answers. You review and submit on the employer site — no auto-submit.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    title,
    description,
    url: absoluteUrl(PATH),
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JobLoom Smart Apply" }],
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
  name: "JobLoom Smart Apply",
  description,
  path: PATH,
  applicationCategory: "BusinessApplication",
});

const breadcrumbJsonLd = buildFeatureBreadcrumbJsonLd([
  { name: "Home", path: "/" },
  { name: "Smart Apply", path: PATH },
]);

export default function SmartApplyFeatureRoute() {
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
      <SmartApplyFeaturePage />
    </>
  );
}
