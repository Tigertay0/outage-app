/**
 * Generate the PWA icon set.
 *
 * Written by hand rather than pulled from an image library: the icon is a few
 * geometric shapes, and adding sharp or canvas to the dependency tree just to
 * draw a bolt in a rounded square is not a trade worth making. Node's zlib does
 * the only hard part (PNG's deflate stream).
 *
 *   node scripts/generate-icons.mjs
 *
 * Re-run after changing BRAND or the mark below.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "public/icons");

/** Severity red, the app's one saturated colour. */
const BRAND = [211, 47, 47];
const MARK = [255, 255, 255];

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

/** A lightning bolt in a 0..1 unit square, listed clockwise. */
const BOLT = [
  [0.56, 0.06],
  [0.26, 0.54],
  [0.46, 0.54],
  [0.4, 0.94],
  [0.74, 0.44],
  [0.53, 0.44],
];

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Signed distance to a rounded rectangle, for anti-aliased corners. */
function roundedRectDistance(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return (
    Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) - radius
  );
}

function renderIcon(size) {
  const radius = size * 0.22;
  const pixels = Buffer.alloc(size * size * 4);
  // 3x3 supersampling: enough to keep the corners and the bolt's diagonals
  // from looking like staircases at 72px.
  const samples = 3;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;
      let markCoverage = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          if (roundedRectDistance(px, py, size, radius) <= 0) coverage += 1;
          if (pointInPolygon(px / size, py / size, BOLT)) markCoverage += 1;
        }
      }

      const total = samples * samples;
      const alpha = coverage / total;
      const mark = markCoverage / total;

      const r = BRAND[0] * (1 - mark) + MARK[0] * mark;
      const g = BRAND[1] * (1 - mark) + MARK[1] * mark;
      const b = BRAND[2] * (1 - mark) + MARK[2] * mark;

      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

function encodePng(pixels, size) {
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(
      raw,
      y * (size * 4 + 1) + 1,
      y * size * 4,
      (y + 1) * size * 4,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(renderIcon(size), size));
  console.log(`wrote icons/icon-${size}.png`);
}

// The notification badge is a monochrome mask on Android: shape matters, colour
// does not, so the same bolt is fine at 72px.
writeFileSync(resolve(OUT_DIR, "badge-72.png"), encodePng(renderIcon(72), 72));
console.log("wrote icons/badge-72.png");

// Apple ignores the manifest and looks for this by convention.
writeFileSync(
  resolve(ROOT, "public/apple-touch-icon.png"),
  encodePng(renderIcon(180), 180),
);
console.log("wrote apple-touch-icon.png");
