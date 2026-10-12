import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractFromGray } from "../lib/fingerprint/engine";
import { renderArtwork } from "../lib/fingerprint/render-print";
import { synthesizePrint } from "../lib/fingerprint/synthesize";
import type { Ridge } from "../lib/fingerprint/types";

const words = {
  memorial: [
    "Margaret Hale",
    "1942",
    "2019",
    "mother of James and Elise",
    "the yellow house on Kearney",
    "Sunday hymns",
    "teacher",
    "gardener",
    "she stayed",
  ],
  retirement: [
    "Captain Elias Ward",
    "Engine 12",
    "thirty-one years",
    "the night shift",
    "Harbor Street",
    "he went in first",
    "coach",
    "father of Ruth and Sam",
    "home for supper",
  ],
  weddingA: ["Elena Voss", "June 14", "the orchard", "I choose you", "your laugh in the kitchen"],
  weddingB: ["Jonah Ellis", "June 14", "the orchard", "I choose you", "the song we danced"],
};

async function writePrint(kind: "loop" | "whorl", name: string) {
  const synth = synthesizePrint(kind, kind === "loop" ? 4 : 9);
  const extracted = extractFromGray(synth.gray, synth.width, synth.height, { ridges: "dark", rescale: false });
  const dir = path.join(process.cwd(), "public", "samples");
  fs.mkdirSync(dir, { recursive: true });
  await sharp(synth.rgba, { raw: { width: synth.width, height: synth.height, channels: 4 } })
    .png()
    .toFile(path.join(dir, `${name}.png`));
  const payload = {
    width: extracted.width,
    height: extracted.height,
    period: extracted.period,
    ridges: extracted.ridges.map(slim),
  };
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(payload));
  console.log(`${name}: ridges ${extracted.ridges.length}, period ${extracted.period.toFixed(2)}, truth ${synth.ridges.length}`);
  return { synth, extracted };
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

async function main() {
  const loop = await writePrint("loop", "loop");
  const whorl = await writePrint("whorl", "whorl");
  const gallery = path.join(process.cwd(), "public", "gallery");
  fs.mkdirSync(gallery, { recursive: true });

  const memorial = await renderArtwork({
    prints: [
      {
        ridges: loop.extracted.ridges,
        width: loop.extracted.width,
        height: loop.extracted.height,
        lines: words.memorial,
      },
    ],
    style: { font: "baskerville", preset: "charcoal", textScale: 1, title: "Margaret Hale", script: "Always with you." },
    period: loop.extracted.period,
    dpi: 120,
  });
  fs.writeFileSync(path.join(gallery, "memorial.png"), memorial.png);

  const retirement = await renderArtwork({
    prints: [
      {
        ridges: whorl.extracted.ridges,
        width: whorl.extracted.width,
        height: whorl.extracted.height,
        lines: words.retirement,
      },
    ],
    style: { font: "baskerville", preset: "slate", textScale: 1, title: "Elias Ward", script: "Well done." },
    period: whorl.extracted.period,
    dpi: 120,
  });
  fs.writeFileSync(path.join(gallery, "retirement.png"), retirement.png);

  const wedding = await renderArtwork({
    prints: [
      {
        ridges: loop.extracted.ridges,
        width: loop.extracted.width,
        height: loop.extracted.height,
        lines: words.weddingA,
      },
      {
        ridges: whorl.extracted.ridges,
        width: whorl.extracted.width,
        height: whorl.extracted.height,
        lines: words.weddingB,
        tx: loop.extracted.width * 0.34,
        ty: 30,
        rotation: -8,
        scale: 0.92,
      },
    ],
    style: { font: "cormorant", preset: "charcoal", textScale: 1, title: "Elena and Jonah", script: "June fourteenth" },
    period: loop.extracted.period,
    dpi: 110,
  });
  fs.writeFileSync(path.join(gallery, "wedding.png"), wedding.png);

  const founder = await renderArtwork({
    prints: [
      {
        ridges: whorl.extracted.ridges,
        width: whorl.extracted.width,
        height: whorl.extracted.height,
        lines: ["Northline", "founded 1998", "the first workshop", "keep the promise", "the people who stayed"],
      },
    ],
    style: { font: "cormorant", preset: "gold", textScale: 1, title: "Northline", script: "From the first mark." },
    period: whorl.extracted.period,
    dpi: 110,
  });
  fs.writeFileSync(path.join(gallery, "founder.png"), founder.png);

  const sameFrame = await renderArtwork({
    prints: [
      {
        ridges: loop.extracted.ridges,
        width: loop.extracted.width,
        height: loop.extracted.height,
        lines: words.memorial,
      },
    ],
    style: { font: "baskerville", preset: "charcoal", textScale: 1, title: "", script: "" },
    period: loop.extracted.period,
    dpi: 90,
  });
  const original = await sharp(loop.synth.rgba, {
    raw: { width: loop.synth.width, height: loop.synth.height, channels: 4 },
  })
    .resize({ height: 900, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const wordsPng = await sharp(sameFrame.png).resize({ height: 900, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const gap = 36;
  const label = 48;
  const w = original.info.width + wordsPng.info.width + gap * 3;
  const h = Math.max(original.info.height, wordsPng.info.height) + label + gap;
  const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#F6F1E8"/>
    <text x="${gap}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Original print</text>
    <text x="${original.info.width + gap * 2}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Word-filled ridges</text>
  </svg>`;
  await sharp(Buffer.from(board))
    .composite([
      { input: original.data, left: gap, top: label },
      { input: wordsPng.data, left: original.info.width + gap * 2, top: label },
    ])
    .png()
    .toFile(path.join(process.cwd(), "public", "samples", "side-by-side.png"));

  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="#F6F1E8"/>
    <g fill="none" stroke="#B89A68" stroke-width="1.7" stroke-linecap="round">
      <path d="M32 52c-9 0-15-7-15-17C17 22 23 13 32 13s15 9 15 22c0 6-2 11-5 14"/>
      <path d="M32 46c-6 0-10-5-10-12 0-9 4.5-15 10-15s10 6 10 15c0 4-1 7-3 9"/>
      <path d="M32 40c-3.2 0-5.5-2.6-5.5-7S28.8 26 32 26s5.5 3 5.5 7-1 4.2-2 5.2"/>
      <path d="M22 48c-7-5-9-12-9-18C13 16 21 7 32 7s19 9 19 23c0 9-4 17-9 22"/>
    </g>
  </svg>`;
  const iconDir = path.join(process.cwd(), "public", "icons");
  fs.mkdirSync(iconDir, { recursive: true });
  await sharp(Buffer.from(icon)).resize(192, 192).png().toFile(path.join(iconDir, "icon-192.png"));
  await sharp(Buffer.from(icon)).resize(512, 512).png().toFile(path.join(iconDir, "icon-512.png"));
  await sharp(Buffer.from(icon)).resize(180, 180).png().toFile(path.join(iconDir, "apple-touch-icon.png"));
  console.log("samples ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
