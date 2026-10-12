import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractFromGray, rgbaToGray } from "../lib/fingerprint/engine";
import { plaqueFor } from "../lib/fingerprint/lettering";
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
  for (const phrase of ["Isaiah 41:10", "Psalm 73:26", "Psalm 119:105", "6:24–26", "4.20.1955", "10.17.1955"]) {
    assertIncludes(preview.svg, phrase, "phrase");
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

  const plaque = plaqueFor(mapPrint(print), randyCzyzStyle, result.period);
  if (!plaque) throw new Error("Core plaque was not placed");
  const cropW = Math.min(result.width, Math.round(plaque.rx * 2 + result.period * 14));
  const cropH = Math.min(result.height, Math.round(plaque.ry * 2 + result.period * 18));
  const left = Math.max(0, Math.min(result.width - cropW, Math.round(plaque.cx - cropW / 2)));
  const top = Math.max(0, Math.min(result.height - cropH, Math.round(plaque.cy - cropH / 2)));
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

  const artifacts = "/opt/cursor/artifacts";
  fs.mkdirSync(artifacts, { recursive: true });
  fs.copyFileSync(path.join(out, "randy-czyz.png"), path.join(artifacts, "randy_czyz_ink_artwork.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-closeup.png"), path.join(artifacts, "randy_czyz_ink_closeup.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-compare.png"), path.join(artifacts, "randy_czyz_ink_side_by_side.png"));
  fs.copyFileSync(path.join(out, "randy-czyz.pdf"), path.join(artifacts, "randy_czyz_ink.pdf"));
  console.log(`artwork ${full.width}x${full.height} plaque ${plaque.cx.toFixed(0)},${plaque.cy.toFixed(0)} crop ${left},${top} ${cropW}x${cropH}`);
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
