import type { SeedCompany } from "../seeding.types.js";

export function getYcDataset(): SeedCompany[] {
  return [
    { name: "Stripe", domain: "stripe.com" },
    { name: "Airbnb", domain: "airbnb.com" },
    { name: "Brex", domain: "brex.com" },
    { name: "Deel", domain: "deel.com" },
    { name: "Rippling", domain: "rippling.com" },
    { name: "Scale AI", domain: "scale.com" },
    { name: "Zapier", domain: "zapier.com" },
    { name: "Rappi", domain: "rappi.com" },
    { name: "Instacart", domain: "instacart.com" },
    { name: "Coinbase", domain: "coinbase.com" },
    { name: "Gusto", domain: "gusto.com" },
    { name: "Retool", domain: "retool.com" },
    { name: "Vercel", domain: "vercel.com" },
    { name: "Sentry", domain: "sentry.io" },
    { name: "Segment", domain: "segment.com" },
  ];
}
