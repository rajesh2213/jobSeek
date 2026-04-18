/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dynamic filter query strings use string hrefs; keep untyped routes for DX.

  experimental: {
    /** Tree-shake heavy packages in dev/prod (smaller bundles, faster compiles). */
    optimizePackageImports: ["framer-motion", "@clerk/nextjs"],
  },

  webpack: (config, { dev }) => {
    if (dev) {
      /**
       * Webpack 5 persistent cache can hit `RangeError: Array buffer allocation failed` on Windows
       * when serializing large pack entries (see PackFileCacheStrategy warnings). Disabling fixes
       * stability; first compile is similar, repeat navigations stay fast from module memory cache.
       */
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
