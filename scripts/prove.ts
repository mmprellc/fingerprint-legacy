import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractFromGray } from "../lib/fingerprint/engine";
import { buildPreviewSvg } from "../lib/fingerprint/preview";
import { synthesizePrint } from "../lib/fingerprint/synthesize";
import type { Pt, Ridge } from "../lib/fingerprint/types";

const outDir = path.join(process.cwd(), "tmp-proof");
fs.mkdirSync(outDir, { recursive: true });

function grayToRaw(gray: Float32Array, w: number, h: number, lo?: number, hi?: number) {
  let min = lo ?? Infinity;
  let max = hi ?? -Infinity;
  if (lo === undefined || hi === undefined) {
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
  }
  const span = max - min || 1;
  const raw = Buffer.alloc(w * h);
  for (let i = 0; i < gray.length; i++) {
    raw[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - min) / span) * 255)));
  }
  return raw;
}

async function writeGray(name: string, gray: Float32Array, w: number, h: number, normalize = true) {
  const raw = normalize ? grayToRaw(gray, w, h) : grayToRaw(gray, w, h, 0, 255);
  await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path.join(outDir, name));
}

async function writeMask(name: string, bin: Uint8Array, w: number, h: number) {
  const raw = Buffer.alloc(w * h);
  for (let i = 0; i < bin.length; i++) raw[i] = bin[i] ? 0 : 255;
  await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path.join(outDir, name));
}

function drawPaths(base: Buffer, w: number, h: number, ridges: Ridge[], color: { r: number; g: number; b: number }) {
  const img = Buffer.from(base);
  const stamp = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
    const i = (yi * w + xi) * 4;
    img[i] = color.r;
    img[i + 1] = color.g;
    img[i + 2] = color.b;
    img[i + 3] = 255;
  };
  for (const ridge of ridges) {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  }
  return img;
}

function nearestDistance(points: Pt[], ridges: Ridge[]) {
  const cell = 6;
  const buckets = new Map<string, Pt[]>();
  const add = (p: Pt) => {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const arr = buckets.get(k);
    if (arr) arr.push(p);
    else buckets.set(k, [p]);
  };
  for (const ridge of ridges) {
    for (let i = 1; i < ridge.points.length; i++) {
      const a = ridge.points[i - 1];
      const b = ridge.points[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  const dists: number[] = [];
  for (const p of points) {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    let best = 1e9;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const arr = buckets.get(`${gx + dx},${gy + dy}`);
        if (!arr) continue;
        for (const q of arr) {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < best) best = d;
        }
      }
    }
    if (best < 1e8) dists.push(best);
  }
  dists.sort((a, b) => a - b);
  const pct = (q: number) => dists[Math.min(dists.length - 1, Math.floor(q * (dists.length - 1)))] ?? 999;
  return { n: dists.length, p50: pct(0.5), p90: pct(0.9) };
}

function samplePoints(ridges: Ridge[], step = 4): Pt[] {
  const pts: Pt[] = [];
  for (const ridge of ridges) {
    let acc = 0;
    pts.push(ridge.points[0]);
    for (let i = 1; i < ridge.points.length; i++) {
      const a = ridge.points[i - 1];
      const b = ridge.points[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      acc += d;
      if (acc >= step) {
        pts.push(b);
        acc = 0;
      }
    }
  }
  return pts;
}

async function stripeCheck() {
  const w = 240;
  const h = 180;
  const gray = new Float32Array(w * h);
  gray.fill(230);
  for (let y = 0; y < h; y++) {
    if (Math.floor(y / 8) % 2 === 0) continue;
    for (let x = 30; x < w - 30; x++) gray[y * w + x] = 30;
  }
  const result = extractFromGray(gray, w, h, { rescale: false, ridges: "dark", debug: false });
  let horizontal = 0;
  for (const ridge of result.ridges) {
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < ridge.points.length; i++) {
      dx += Math.abs(ridge.points[i].x - ridge.points[i - 1].x);
      dy += Math.abs(ridge.points[i].y - ridge.points[i - 1].y);
    }
    if (dx > dy * 2) horizontal++;
  }
  const ratio = result.ridges.length ? horizontal / result.ridges.length : 0;
  console.log(`stripe ridges=${result.ridges.length} horizontal=${ratio.toFixed(3)} period=${result.period.toFixed(2)}`);
  if (ratio < 0.75) throw new Error(`Orientation is wrong: only ${(ratio * 100).toFixed(1)}% of stripe ridges are horizontal`);
}

async function main() {
  console.time("stripe");
  await stripeCheck();
  console.timeEnd("stripe");

  console.time("synth");
  const print = synthesizePrint("loop", 3);
  console.timeEnd("synth");
  await sharp(print.rgba, { raw: { width: print.width, height: print.height, channels: 4 } })
    .png()
    .toFile(path.join(outDir, "original.png"));

  console.time("extract");
  const result = extractFromGray(print.gray, print.width, print.height, {
    rescale: false,
    ridges: "dark",
    debug: true,
  });
  console.timeEnd("extract");
  console.log(
    `extracted ridges=${result.ridges.length} period=${result.period.toFixed(2)} truth=${print.ridges.length} warnings=${result.warnings.join(" | ")}`,
  );

  if (result.debug) {
    await writeGray("normalized.png", result.debug.normalized, result.width, result.height, true);
    await writeGray("enhanced.png", result.debug.enhanced, result.width, result.height, true);
    await writeMask("binary.png", result.debug.binary, result.width, result.height);
    await writeMask("skeleton.png", result.debug.skeleton, result.width, result.height);
  }

  const truthPts = samplePoints(print.ridges, 5);
  const extractedPts = samplePoints(result.ridges, 5);
  const recall = nearestDistance(truthPts, result.ridges);
  const precision = nearestDistance(extractedPts, print.ridges);
  console.log(`recall p50=${recall.p50.toFixed(2)} p90=${recall.p90.toFixed(2)} n=${recall.n}`);
  console.log(`precision p50=${precision.p50.toFixed(2)} p90=${precision.p90.toFixed(2)} n=${precision.n}`);

  const overlay = drawPaths(Buffer.from(print.rgba), print.width, print.height, result.ridges, { r: 184, g: 90, b: 40 });
  await sharp(overlay, { raw: { width: print.width, height: print.height, channels: 4 } })
    .png()
    .toFile(path.join(outDir, "overlay.png"));

  const words = [
    "Margaret Hale",
    "1942",
    "2019",
    "mother of James and Elise",
    "the yellow house on Kearney",
    "Sunday hymns",
    "teacher",
    "gardener",
    "she stayed",
  ];
  const { svg, width, height } = buildPreviewSvg(
    [{ ridges: result.ridges, width: result.width, height: result.height, lines: words }],
    { font: "baskerville", preset: "charcoal", textScale: 1, title: "Margaret Hale", script: "Always with you." },
    result.period,
  );
  fs.writeFileSync(path.join(outDir, "words.svg"), svg);
  try {
    await sharp(Buffer.from(svg), { density: 144 }).png().toFile(path.join(outDir, "words.png"));
    console.log(`words raster ${width}x${height}`);
  } catch (error) {
    console.log("svg raster failed", error instanceof Error ? error.message : error);
  }

  const side = await sideBySide(
    path.join(outDir, "original.png"),
    fs.existsSync(path.join(outDir, "words.png")) ? path.join(outDir, "words.png") : path.join(outDir, "overlay.png"),
  );
  await sharp(side).png().toFile(path.join(outDir, "side-by-side.png"));
  console.log(`wrote ${outDir}`);

  if (recall.p50 > 3.2 || precision.p50 > 3.5) {
    throw new Error(`Ridge fidelity is too low (recall p50 ${recall.p50.toFixed(2)}, precision p50 ${precision.p50.toFixed(2)})`);
  }
}

async function sideBySide(left: string, right: string) {
  const a = sharp(left).resize({ height: 900, fit: "inside" });
  const b = sharp(right).resize({ height: 900, fit: "inside" });
  const [ai, bi] = await Promise.all([a.png().toBuffer({ resolveWithObject: true }), b.png().toBuffer({ resolveWithObject: true })]);
  const gap = 28;
  const label = 36;
  const w = ai.info.width + bi.info.width + gap * 3;
  const h = Math.max(ai.info.height, bi.info.height) + label + gap * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#F6F1E8"/>
    <text x="${gap}" y="28" font-family="Georgia" font-size="18" fill="#34383A">Original print</text>
    <text x="${ai.info.width + gap * 2}" y="28" font-family="Georgia" font-size="18" fill="#34383A">Word-filled ridges</text>
  </svg>`;
  return sharp(Buffer.from(svg))
    .composite([
      { input: ai.data, left: gap, top: label + 8 },
      { input: bi.data, left: ai.info.width + gap * 2, top: label + 8 },
    ])
    .png()
    .toBuffer();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
