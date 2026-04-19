/**
 * Generates favicons, PWA icons, OG image, and extension icons from the primary JobLoom logo PNG.
 *
 * Usage: node scripts/generate-jobloom-brand-assets.mjs [path-to-jobLoom_logo-prim.png]
 * Default source: D:/Downloads/jobLoom_logo-prim.png
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CANVAS = { r: 245, g: 242, b: 235, alpha: 1 };

async function writeSquareIcon(srcPath, size, outPath) {
  const buf = await sharp(srcPath)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await fs.promises.writeFile(outPath, buf);
}

async function main() {
  const defaultSrc = "D:/Downloads/jobLoom_logo-prim.png";
  const srcPath = path.resolve(process.argv[2] || defaultSrc);
  if (!fs.existsSync(srcPath)) {
    console.error("Missing source file:", srcPath);
    process.exit(1);
  }

  const clientPublic = path.join(repoRoot, "apps/client/public");
  const clientBrand = path.join(clientPublic, "brand");
  const extIcons = path.join(repoRoot, "apps/extension/icons");
  const extPublic = path.join(repoRoot, "apps/extension/public");
  const extPublicBrand = path.join(extPublic, "brand");

  await fs.promises.mkdir(clientBrand, { recursive: true });
  await fs.promises.mkdir(extIcons, { recursive: true });
  await fs.promises.mkdir(extPublicBrand, { recursive: true });

  const primDest = path.join(clientBrand, "jobloom-logo-prim.png");
  await fs.promises.copyFile(srcPath, primDest);
  await fs.promises.copyFile(srcPath, path.join(extIcons, "logo-prim.png"));
  await fs.promises.copyFile(srcPath, path.join(extPublicBrand, "jobloom-logo-prim.png"));

  for (const s of [16, 32, 48, 128]) {
    await writeSquareIcon(srcPath, s, path.join(extIcons, `icon-${s}.png`));
  }

  const padBg = CANVAS;
  const f16 = await sharp(srcPath)
    .resize(16, 16, { fit: "contain", background: padBg })
    .png()
    .toBuffer();
  const f32 = await sharp(srcPath)
    .resize(32, 32, { fit: "contain", background: padBg })
    .png()
    .toBuffer();
  await fs.promises.writeFile(path.join(clientPublic, "favicon-16x16.png"), f16);
  await fs.promises.writeFile(path.join(clientPublic, "favicon-32x32.png"), f32);
  const icoBuf = await pngToIco([f16, f32]);
  await fs.promises.writeFile(path.join(clientPublic, "favicon.ico"), icoBuf);

  await sharp(srcPath)
    .resize(180, 180, { fit: "contain", background: padBg })
    .png()
    .toFile(path.join(clientPublic, "apple-touch-icon.png"));

  await sharp(srcPath)
    .resize(192, 192, { fit: "contain", background: padBg })
    .png()
    .toFile(path.join(clientPublic, "android-chrome-192x192.png"));

  await sharp(srcPath)
    .resize(512, 512, { fit: "contain", background: padBg })
    .png()
    .toFile(path.join(clientPublic, "android-chrome-512x512.png"));

  const OG_W = 1200;
  const OG_H = 630;
  const inner = await sharp(srcPath)
    .resize(980, 420, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width: iw, height: ih } = inner.info;
  const left = Math.round((OG_W - iw) / 2);
  const top = Math.round((OG_H - ih) / 2);
  await sharp({
    create: {
      width: OG_W,
      height: OG_H,
      channels: 4,
      background: CANVAS,
    },
  })
    .composite([{ input: inner.data, left, top }])
    .png()
    .toFile(path.join(clientPublic, "og-image.png"));

  console.log("Wrote JobLoom brand assets from", srcPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
