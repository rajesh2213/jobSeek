#!/usr/bin/env node
/**
 * Writes extension.zip at apps/extension/extension.zip with dist/* at archive root
 * (not dist/ as a parent folder). No OS `zip` binary required.
 */
import { createWriteStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, "..");
const dist = join(extRoot, "dist");
const out = join(extRoot, "extension.zip");

if (!existsSync(dist)) {
  console.error("dist/ missing. Run: npm run build:ext");
  process.exit(1);
}

const output = createWriteStream(out);
const archive = archiver("zip", { zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on("close", () => resolve(archive.pointer()));
  archive.on("error", reject);
});

archive.pipe(output);
archive.directory(dist, false);
void archive.finalize();

await done;
console.log(`Wrote ${out}`);
