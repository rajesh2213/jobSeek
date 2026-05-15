import { absoluteUrl, getSiteBaseUrl } from "./seoSite";

/** JSON-LD for public feature/tool landing pages (SoftwareApplication). */
export function buildSoftwareApplicationJsonLd(input: {
  name: string;
  description: string;
  path: string;
  applicationCategory: string;
  offers?: { price: string; priceCurrency: string };
}): Record<string, unknown> {
  const url = absoluteUrl(input.path);
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.name,
    description: input.description,
    url,
    applicationCategory: input.applicationCategory,
    operatingSystem: "Web, Chrome",
    provider: {
      "@type": "Organization",
      name: "JobLoom",
      url: getSiteBaseUrl(),
    },
    ...(input.offers
      ? {
          offers: {
            "@type": "Offer",
            price: input.offers.price,
            priceCurrency: input.offers.priceCurrency,
          },
        }
      : {}),
  };
}

export function buildFeatureBreadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${base}${item.path.startsWith("/") ? item.path : `/${item.path}`}`,
    })),
  };
}
