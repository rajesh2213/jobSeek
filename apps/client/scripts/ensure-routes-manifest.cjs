"use strict";

/**
 * Next 15 dev expects `.next/routes-manifest.json` before some RSC renders.
 * It is normally written in `setup-dev-bundler` after `hotReloader.start()`;
 * on Windows a race or partial `.next` can leave this file missing → ENOENT + 500.
 * This writes a minimal valid v3 manifest only when absent; Next overwrites it
 * once the dev bundler finishes the same step.
 */

const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", ".next");
const manifestPath = path.join(distDir, "routes-manifest.json");

if (fs.existsSync(manifestPath)) {
  process.exit(0);
}

fs.mkdirSync(distDir, { recursive: true });

const routesManifest = {
  version: 3,
  caseSensitive: false,
  basePath: "",
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  redirects: [],
  headers: [],
};

fs.writeFileSync(manifestPath, JSON.stringify(routesManifest));
