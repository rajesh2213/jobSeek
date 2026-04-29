/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@jobseek/skill-constants", "@jobseek/server"],

  serverExternalPackages: ["@prisma/client", "prisma", "ioredis"],

  // Dynamic filter query strings use string hrefs; keep untyped routes for DX.

  experimental: {
    /** Tree-shake heavy packages in dev/prod (smaller bundles, faster compiles). */
    optimizePackageImports: ["framer-motion", "@clerk/nextjs"],
  },

  webpack: (config, { dev }) => {
    /**
     * ESM+TS in workspace packages use `.js` specifiers; Webpack would otherwise not resolve
     * `dictionaryData.js` → `dictionaryData.ts` on disk. Aligns with TypeScript `NodeNext` output.
     */
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
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
