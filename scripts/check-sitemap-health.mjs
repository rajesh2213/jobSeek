/**
 * Smoke-check public SEO endpoints (sitemap + robots).
 * Usage: NEXT_PUBLIC_SITE_URL=https://your.domain node scripts/check-sitemap-health.mjs
 */
const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const urls = [
  `${base}/sitemap.xml`,
  `${base}/sitemap-static.xml`,
  `${base}/sitemap-landing.xml`,
  `${base}/sitemap-companies.xml`,
  `${base}/sitemap-jobs-1.xml`,
  `${base}/robots.txt`,
];

let failed = false;
for (const u of urls) {
  try {
    const res = await fetch(u, { redirect: "follow" });
    const ok = res.ok;
    console.log(`${ok ? "OK" : "FAIL"} ${res.status} ${u}`);
    if (!ok) failed = true;
  } catch (e) {
    console.error(`FAIL ${u}`, e);
    failed = true;
  }
}
if (failed) process.exit(1);
