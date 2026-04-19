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

/**
 * Scale logo up vs plain `contain` so it fills more of the square (closer to other sites’ tab icons).
 * Slightly lower zoom at 16px to avoid mushing fine detail; larger sizes can crop more aggressively.
 */
function zoomForSquareSize(size) {
  if (size <= 16) return 1.35;
  if (size <= 32) return 1.4;
  if (size <= 128) return 1.45;
  return 1.48;
}

/** Extra scale for Chrome extension manifest icons (toolbar) — must reload extension to see changes. */
const EXTENSION_ICON_ZOOM_MULTIPLIER = 1.22;

/** Same idea for Next.js site tab favicons + PWA icons (matches extension toolbar weight). */
const CLIENT_WEB_ICON_ZOOM_MULTIPLIER = 1.22;

/**
 * Scale like `cover`: for a wide logo, match the **short** side to `size * zoom`, then crop a centered
 * square — the mark reads larger in the tab than plain `contain`.
 *
 * @param {{ r: number; g: number; b: number; alpha: number }} background
 * @param {{ zoomMultiplier?: number }} [options]
 */
async function rasterSquareIcon(srcPath, size, background, options = {}) {
  const zoomMultiplier = options.zoomMultiplier ?? 1;
  const meta = await sharp(srcPath).metadata();
  const iw = meta.width || 1;
  const ih = meta.height || 1;
  const zoom = zoomForSquareSize(size) * zoomMultiplier;
  const target = size * zoom;
  let tw;
  let th;
  if (iw >= ih) {
    th = Math.round(target);
    tw = Math.round((iw * th) / ih);
  } else {
    tw = Math.round(target);
    th = Math.round((ih * tw) / iw);
  }
  const buf = await sharp(srcPath).resize(tw, th).png().toBuffer();

  if (tw >= size && th >= size) {
    const left = Math.floor((tw - size) / 2);
    const top = Math.floor((th - size) / 2);
    return sharp(buf).extract({ left, top, width: size, height: size }).png().toBuffer();
  }
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: buf, left: Math.floor((size - tw) / 2), top: Math.floor((size - th) / 2) }])
    .png()
    .toBuffer();
}

async function writeSquareIcon(srcPath, size, outPath) {
  const buf = await rasterSquareIcon(srcPath, size, { r: 0, g: 0, b: 0, alpha: 0 });
  await fs.promises.writeFile(outPath, buf);
}

/** Extension toolbar icons — extra zoom vs browser favicons. */
async function writeExtensionToolbarIcon(srcPath, size, outPath) {
  const buf = await rasterSquareIcon(srcPath, size, { r: 0, g: 0, b: 0, alpha: 0 }, {
    zoomMultiplier: EXTENSION_ICON_ZOOM_MULTIPLIER,
  });
  await fs.promises.writeFile(outPath, buf);
}

/**
 * Trim + resize for inline UI (extension popup/sidebar + client footer): tighter crop reads larger on screen.
 */
async function writeTrimmedUiLogo(srcPath, outPath) {
  const pipeline = async (useTrim) => {
    let p = sharp(srcPath);
    if (useTrim) p = p.trim({ threshold: 12 });
    await p
      .resize({ height: 120, fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
  };
  try {
    await pipeline(true);
  } catch {
    await pipeline(false);
  }
}

async function writeExtensionUiLogo(srcPath, outPath) {
  return writeTrimmedUiLogo(srcPath, outPath);
}

/** Client footer / marketing inline — light canvas background instead of transparent. */
async function writeClientUiLogo(srcPath, outPath) {
  const pipeline = async (useTrim) => {
    let p = sharp(srcPath);
    if (useTrim) p = p.trim({ threshold: 12 });
    await p
      .resize({ height: 120, fit: "inside", background: CANVAS })
      .png()
      .toFile(outPath);
  };
  try {
    await pipeline(true);
  } catch {
    await pipeline(false);
  }
}

async function writeClientWebIcon(srcPath, size, outPath) {
  const buf = await rasterSquareIcon(srcPath, size, CANVAS, {
    zoomMultiplier: CLIENT_WEB_ICON_ZOOM_MULTIPLIER,
  });
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
  await fs.promises.copyFile(srcPath, path.join(extPublicBrand, "jobloom-logo-prim.png"));

  const clientUiLogo = path.join(clientBrand, "jobloom-logo-ui.png");
  await writeClientUiLogo(srcPath, clientUiLogo);

  const extUiLogo = path.join(extIcons, "logo-prim.png");
  await writeExtensionUiLogo(srcPath, extUiLogo);

  for (const s of [16, 32, 48, 128]) {
    await writeExtensionToolbarIcon(srcPath, s, path.join(extIcons, `icon-${s}.png`));
  }

  const f16Path = path.join(clientPublic, "favicon-16x16.png");
  const f32Path = path.join(clientPublic, "favicon-32x32.png");
  await writeClientWebIcon(srcPath, 16, f16Path);
  await writeClientWebIcon(srcPath, 32, f32Path);
  const f16 = await fs.promises.readFile(f16Path);
  const f32 = await fs.promises.readFile(f32Path);
  const icoBuf = await pngToIco([f16, f32]);
  await fs.promises.writeFile(path.join(clientPublic, "favicon.ico"), icoBuf);

  await writeClientWebIcon(srcPath, 180, path.join(clientPublic, "apple-touch-icon.png"));
  await writeClientWebIcon(srcPath, 192, path.join(clientPublic, "android-chrome-192x192.png"));
  await writeClientWebIcon(srcPath, 512, path.join(clientPublic, "android-chrome-512x512.png"));

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
