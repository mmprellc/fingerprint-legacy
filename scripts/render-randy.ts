import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractFromGray, rgbaToGray } from "../lib/fingerprint/engine";
import { printCore } from "../lib/fingerprint/lettering";
import { buildPreviewSvg, mapPrint } from "../lib/fingerprint/preview";
import { renderArtwork } from "../lib/fingerprint/render-print";
import { RANDY_CZYZ_NAMES, RANDY_CZYZ_SCRIPTURES, randyCzyzStyle } from "../lib/pieces";
import type { Ridge } from "../lib/fingerprint/types";

const sourcePath = path.join(process.cwd(), "public/pieces/randy-source.jpg");

function assertIncludes(haystack: string, needle: string, label: string) {
  const count = haystack.split(needle).length - 1;
  if (count < 1) throw new Error(`Missing ${label}: ${needle}`);
  return count;
}

async function studioExtract(input: Buffer) {
  const prepared = sharp(input).rotate();
  const meta = await prepared.metadata();
  const long = Math.max(meta.width || 1, meta.height || 1);
  const scale = long > 1600 ? 1600 / long : long < 700 ? 700 / long : 1;
  const pipeline = scale === 1 ? prepared : prepared.resize(Math.round((meta.width || 1) * scale), Math.round((meta.height || 1) * scale), { fit: "fill" });
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const gray = rgbaToGray(data, info.width, info.height);
  const result = extractFromGray(gray, info.width, info.height, { ridges: "auto" });
  const photo = await sharp(input).rotate().resize(result.width, result.height, { fit: "fill" }).png().toBuffer();
  return { result, photo };
}

async function main() {
  if (RANDY_CZYZ_NAMES.length !== 29) throw new Error(`Expected 29 names, found ${RANDY_CZYZ_NAMES.length}`);
  const joined = RANDY_CZYZ_SCRIPTURES.join("\n");
  if (!joined.includes("—") || !joined.includes("–") || !joined.includes("6:24–26")) {
    throw new Error("Scripture punctuation changed");
  }
  if (!(randyCzyzStyle.footer || "").includes("—")) throw new Error("Footer dash changed");

  const input = fs.readFileSync(sourcePath);
  const { result, photo } = await studioExtract(input);
  const mean = result.ridges.reduce((sum, ridge) => sum + ridge.length, 0) / Math.max(1, result.ridges.length);
  console.log(`extracted ${result.width}x${result.height} period ${result.period.toFixed(2)} ridges ${result.ridges.length} mean ${mean.toFixed(0)} dark ${result.ridgesAreDark}`);
  if (result.ridges.length < 40 || mean < 80) throw new Error("The print did not yield long ridges");

  const print = {
    ridges: result.ridges,
    width: result.width,
    height: result.height,
    lines: [] as string[],
  };
  const preview = buildPreviewSvg([print], randyCzyzStyle, result.period);
  for (const name of new Set(RANDY_CZYZ_NAMES)) assertIncludes(preview.svg, name, "name");
  if (assertIncludes(preview.svg, "Jacob Czyz", "Jacob") < 2) throw new Error("Jacob Czyz was not repeated");
  if (assertIncludes(preview.svg, "Martin Pierce", "Martin") < 2) throw new Error("Martin Pierce was not repeated");
  for (const phrase of ["Isaiah", "41:10", "73:26", "119:105", "6:24–26", "Numbers", "4.20.1955", "10.17.1955", "Maryanne Czyz", "righteous", "lamp"]) {
    assertIncludes(preview.svg, phrase, "phrase");
  }
  if (preview.svg.includes("plaque-name") || preview.svg.includes("ridgekeep")) {
    throw new Error("The dedications are still a separate block instead of ridges");
  }

  const out = path.join(process.cwd(), "public/pieces");
  fs.mkdirSync(out, { recursive: true });
  const payload = {
    width: result.width,
    height: result.height,
    period: result.period,
    ridges: result.ridges.map(slim),
  };
  fs.writeFileSync(path.join(out, "randy-print.json"), JSON.stringify(payload));
  await sharp(photo).png().toFile(path.join(out, "randy-print.png"));

  const full = await renderArtwork({
    prints: [print],
    style: randyCzyzStyle,
    period: result.period,
    dpi: 140,
  });
  fs.writeFileSync(path.join(out, "randy-czyz.png"), full.png);
  fs.writeFileSync(path.join(out, "randy-czyz.pdf"), full.pdf);

  const matched = await renderArtwork({
    prints: [print],
    style: { ...randyCzyzStyle, title: "", footer: "", script: "" },
    period: result.period,
    matchSource: true,
  });
  const footerDates = (randyCzyzStyle.footer || "").split("4.20.1955").length - 1;
  const coreDate = preview.svg.split("4.20.1955").length - 1 - footerDates;
  const secondaryDate = preview.svg.split("10.17.1955").length - 1;
  if (coreDate !== 1) throw new Error(`Center date should appear once on the ridges, found ${coreDate}`);
  if (secondaryDate !== 1) throw new Error(`Secondary date should appear once on the ridges, found ${secondaryDate}`);
  const photoRaw = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const photoGray = rgbaToGray(photoRaw.data, photoRaw.info.width, photoRaw.info.height);
  const stats = coverageStats(photoGray, photoRaw.info.width, photoRaw.info.height, result.ridges, result.period);
  console.log(
    `coverage ${(stats.hit / Math.max(1, stats.ink)).toFixed(3)} ink ${stats.ink} y ${stats.inkMinY}-${stats.inkMaxY} ridges y ${stats.ridgeMinY.toFixed(0)}-${stats.ridgeMaxY.toFixed(0)} spacing p50 ${stats.spacingP50.toFixed(2)} close ${stats.closeFrac.toFixed(3)}`,
  );

  const core = printCore(mapPrint(print), result.period);
  const cropW = Math.min(result.width, Math.round(result.period * 40));
  const cropH = Math.min(result.height, Math.round(result.period * 32));
  const left = Math.max(0, Math.min(result.width - cropW, Math.round(core.x - cropW / 2)));
  const top = Math.max(0, Math.min(result.height - cropH, Math.round(core.y - cropH / 2)));
  const close = await sharp(matched.png)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 1600, kernel: "lanczos3" })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(out, "randy-czyz-closeup.png"), close);

  const gap = 36;
  const label = 48;
  const lw = result.width;
  const rw = result.width;
  const boardW = lw + rw + gap * 3;
  const boardH = result.height + label + gap;
  const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}">
    <rect width="100%" height="100%" fill="#F6F1E8"/>
    <text x="${gap}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Randy's print</text>
    <text x="${lw + gap * 2}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Word-filled ridges</text>
  </svg>`;
  await sharp(Buffer.from(board))
    .composite([
      { input: photo, left: gap, top: label },
      { input: matched.png, left: lw + gap * 2, top: label },
    ])
    .png()
    .toFile(path.join(out, "randy-czyz-compare.png"));

  const fadedRaw = await sharp(matched.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(fadedRaw.data);
  for (let i = 0; i < pixels.length; i += 4) {
    const paper = pixels[i] > 236 && pixels[i + 1] > 230 && pixels[i + 2] > 220;
    pixels[i + 3] = paper ? 0 : 128;
  }
  const faded = await sharp(pixels, { raw: { width: fadedRaw.info.width, height: fadedRaw.info.height, channels: 4 } }).png().toBuffer();
  await sharp(photo).composite([{ input: faded, blend: "over" }]).png().toFile(path.join(out, "randy-czyz-overlay.png"));

  const artifacts = "/opt/cursor/artifacts";
  fs.mkdirSync(artifacts, { recursive: true });
  fs.copyFileSync(path.join(out, "randy-czyz.png"), path.join(artifacts, "randy_czyz_full_artwork.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-closeup.png"), path.join(artifacts, "randy_czyz_full_closeup.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-compare.png"), path.join(artifacts, "randy_czyz_full_side_by_side.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-overlay.png"), path.join(artifacts, "randy_czyz_full_overlay.png"));
  fs.copyFileSync(path.join(out, "randy-czyz.pdf"), path.join(artifacts, "randy_czyz_full.pdf"));
  console.log(`artwork ${full.width}x${full.height} core ${core.x.toFixed(0)},${core.y.toFixed(0)} crop ${left},${top} ${cropW}x${cropH}`);

  const cover = stats.hit / Math.max(1, stats.ink);
  const inkSpan = Math.max(1, stats.inkMaxY - stats.inkMinY);
  const ridgeSpan = stats.ridgeMaxY - stats.ridgeMinY;
  if (cover < 0.82) throw new Error("Text ridges do not cover the ink oval");
  if (ridgeSpan < inkSpan * 0.9) throw new Error("Ridges do not reach the top and bottom of the print");
  if (stats.spacingP50 < result.period * 0.75 || stats.spacingP50 > result.period * 1.45) {
    throw new Error(`Ridge spacing ${stats.spacingP50.toFixed(2)} is off the measured period ${result.period.toFixed(2)}`);
  }
  if (stats.closeFrac > 0.3) throw new Error("Too many ridge samples sit on top of a neighbor");
}

function coverageStats(gray: Float32Array, w: number, h: number, ridges: Ridge[], period: number) {
  const band = Math.max(3, Math.round(h * 0.03));
  const samples: number[] = [];
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < w; x += 2) samples.push(gray[y * w + x]);
  }
  for (let y = Math.max(0, h - band); y < h; y++) {
    for (let x = 0; x < w; x += 2) samples.push(gray[y * w + x]);
  }
  samples.sort((a, b) => a - b);
  const paper = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.72))] ?? 200;
  const cell = Math.max(4, period * 0.45);
  const buckets = new Map<string, { x: number; y: number; id: number }[]>();
  const add = (x: number, y: number, id: number) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = buckets.get(key);
    const point = { x, y, id };
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  };
  let ridgeMinY = Infinity;
  let ridgeMaxY = -Infinity;
  ridges.forEach((ridge, id) => {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        add(x, y, id);
        if (y < ridgeMinY) ridgeMinY = y;
        if (y > ridgeMaxY) ridgeMaxY = y;
      }
    }
  });
  const nearest = (x: number, y: number, skip = -2) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    let best = 1e9;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          if (point.id === skip) continue;
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  let ink = 0;
  let hit = 0;
  const inkYs: number[] = [];
  const step = 4;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (gray[y * w + x] >= paper - 16) continue;
      ink++;
      inkYs.push(y);
      if (nearest(x, y) <= period * 0.65) hit++;
    }
  }
  inkYs.sort((a, b) => a - b);
  const inkMinY = inkYs[Math.floor(inkYs.length * 0.02)] ?? 0;
  const inkMaxY = inkYs[Math.min(inkYs.length - 1, Math.floor(inkYs.length * 0.98))] ?? h;
  const gaps: number[] = [];
  let close = 0;
  let seen = 0;
  ridges.forEach((ridge, id) => {
    const pts = ridge.points;
    for (let i = 0; i < pts.length; i += 4) {
      const d = nearest(pts[i].x, pts[i].y, id);
      if (d > 1e8) continue;
      seen++;
      gaps.push(d);
      if (d < period * 0.72) close++;
    }
  });
  gaps.sort((a, b) => a - b);
  const spacingP50 = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
  return { ink, hit, inkMinY, inkMaxY, ridgeMinY, ridgeMaxY, spacingP50, closeFrac: seen ? close / seen : 0 };
}

function slim(ridge: Ridge) {
  return {
    closed: ridge.closed,
    length: Math.round(ridge.length * 10) / 10,
    points: ridge.points.map((point) => ({
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
    })),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
