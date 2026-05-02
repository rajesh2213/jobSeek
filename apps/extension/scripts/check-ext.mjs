#!/usr/bin/env node
/**
 * Production checks for the packaged extension in dist/. Run after `npm run build:ext`.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, "..");
const dist = join(extRoot, "dist");
const fail = (m) => {
  failed.push(m);
  console.error(`  FAIL: ${m}`);
};

const failed = [];
const pass = (m) => console.log(`  ok: ${m}`);

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function read(p) {
  return readFileSync(p, "utf8");
}

console.log("check:ext — validating dist/ …\n");

if (!existsSync(dist)) {
  fail("dist/ is missing. Run: npm run build:ext");
  process.exit(1);
}

// 1) manifest
const manPath = join(dist, "manifest.json");
if (!existsSync(manPath)) {
  fail("dist/manifest.json missing");
} else {
  let m;
  try {
    m = JSON.parse(read(manPath));
  } catch {
    fail("manifest.json is not valid JSON");
  }
  if (m) {
    if (m.manifest_version !== 3) fail("manifest_version must be 3");
    else pass("manifest_version is 3");
    if (typeof m.name !== "string" || !m.name.trim()) fail("manifest name missing");
    else pass("name present");
    if (typeof m.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(m.version)) {
      fail("manifest version must match MV3 format (e.g. 1.0.0)");
    } else {
      pass(`version ${m.version}`);
    }
    if (typeof m.description !== "string" || m.description.length < 10) {
      fail("description should be at least 10 characters");
    } else if (m.description.length > 132) {
      fail(
        `manifest description must be ≤132 characters (Chrome Web Store limit); got ${m.description.length}`,
      );
    } else {
      pass(`description present (${m.description.length}/132 chars)`);
    }
    const { externally_connectable: _ignoreExt, ...manifestWithoutExternal } = m;
    const manifestProdSlice = JSON.stringify(manifestWithoutExternal);
    if (manifestProdSlice.includes("localhost") || manifestProdSlice.includes("127.0.0.1")) {
      fail("manifest must not reference localhost/127.0.0.1 outside externally_connectable");
    } else {
      pass("manifest has no dev URLs outside externally_connectable");
    }
    if (manifestProdSlice.includes("<all_urls>")) {
      fail("avoid <all_urls> in host_permissions and content matches");
    } else {
      pass("no <all_urls> in manifest");
    }
    const broad = new Set(["https://*/*", "http://*/*"]);
    for (const entry of m.host_permissions ?? []) {
      if (broad.has(String(entry).trim())) {
        fail(`avoid universal host permission ${entry}`);
      }
    }
    pass("host_permissions avoids universal https/http wildcards");
    /** MV3: web_accessible_resources patterns must end with path segment "slash asterisk" only (no slash-apply-slash style paths). */
    function warMatchPatternPathOk(pat) {
      const schemeSep = String(pat).indexOf("://");
      if (schemeSep < 0) return false;
      const afterScheme = String(pat).slice(schemeSep + 3);
      const slashIx = afterScheme.indexOf("/");
      if (slashIx < 0) return false;
      return afterScheme.slice(slashIx) === "/*";
    }
    const war = m.web_accessible_resources;
    if (Array.isArray(war)) {
      let warChecked = false;
      let warOk = true;
      for (const entry of war) {
        const matches = entry?.matches;
        if (!Array.isArray(matches)) continue;
        for (const pat of matches) {
          warChecked = true;
          const trimmed = String(pat).trim();
          if (trimmed === "https://*/*" || trimmed === "http://*/*") {
            fail(`avoid universal web_accessible_resources match ${trimmed}`);
            warOk = false;
          }
          if (!warMatchPatternPathOk(pat)) {
            fail(`web_accessible_resources match pattern path must be exactly /* : ${pat}`);
            warOk = false;
          }
        }
      }
      if (warChecked && warOk) pass("web_accessible_resources matches use path /* only");
    }
    for (const k of ["16", "48", "128"]) {
      if (!m.icons || !m.icons[k]) {
        fail(`icons.${k} missing in manifest`);
      } else {
        const ico = join(dist, m.icons[k]);
        if (!existsSync(ico)) fail(`icon file missing: ${m.icons[k]}`);
        else pass(`icon ${k} file exists`);
      }
    }
  }
}

// 2) required layout
if (existsSync(dist)) {
  for (const r of [
    { path: "manifest.json", isDir: false },
    { path: "background.js", isDir: false },
    { path: "content.js", isDir: false },
    { path: "assets", isDir: true },
  ]) {
    const p = join(dist, r.path);
    if (!existsSync(p)) {
      fail(`required missing: dist/${r.path}`);
    } else if (r.isDir && !statSync(p).isDirectory()) {
      fail(`required must be a directory: dist/${r.path}`);
    } else if (!r.isDir && statSync(p).isDirectory()) {
      fail(`required must be a file: dist/${r.path}`);
    } else {
      pass(`dist/${r.path} present`);
    }
  }
}

// 3) no localhost in JS bundles
const jsFiles = walkFiles(dist).filter((f) => f.endsWith(".js"));
const devRe = /localhost|127\.0\.0\.1/;
let devHit = false;
for (const f of jsFiles) {
  if (read(f).match(devRe)) {
    const rel = f.replace(extRoot, "").replace(/^\//, "");
    fail(`dev URL pattern in ${rel}`);
    devHit = true;
  }
}
if (!devHit) {
  pass("no localhost/127.0.0.1 in .js");
}

// 4) no console.log/debug in JS (strips may remove; this catches stragglers)
const consoleRe = /\bconsole\.(log|debug|info|trace)\s*\(/;
let consoleHit = false;
for (const f of jsFiles) {
  if (read(f).match(consoleRe)) {
    const rel = f.replace(extRoot, "").replace(/^\//, "");
    fail(`console in ${rel}`);
    consoleHit = true;
  }
}
if (!consoleHit) {
  pass("no console.log/debug/info/trace in .js (best-effort)");
}

if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
process.exit(0);
