/**
 * Genereert PNG-extensie-iconen uit public/icon.svg.
 *
 * Browser-extensie-stores willen PNGs in 16/32/48/96/128 px.
 * Render via sharp — pure-JS via libvips, geen browser of Xcode nodig.
 *
 * Run: `pnpm exec node scripts/generate-icons.mjs`
 *
 * Output naar public/icon/{size}.png — WXT pikt die automatisch op.
 */

import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = resolve(ROOT, 'public/icon.svg');
const OUT_DIR = resolve(ROOT, 'public/icon');
const SIZES = [16, 32, 48, 96, 128];

async function main() {
  const svg = await readFile(SVG_PATH);
  await mkdir(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const outPath = resolve(OUT_DIR, `${size}.png`);
    await sharp(svg, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`✓ ${outPath}`);
  }
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
