import fs from "node:fs";
import path from "node:path";
import { parse } from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { extractRidges } from "../lib/fingerprint/extract";
import { renderArtwork, renderRidgePreview } from "../lib/fingerprint/render";
import { renderSyntheticPrint, rgbaToPngBuffer, type PrintKind } from "../lib/fingerprint/synthetic";

const outDir = path.resolve("tmp/preview");
fs.mkdirSync(outDir, { recursive: true });

const fontBuf = fs.readFileSync("public/fonts/CormorantGaramond-Medium.woff");
const font = parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const phrases = [
  "Margaret Anne Hale",
  "1942 — 2019",
  "James, Ruth, and Thomas",
  "Portland · Boise · the house on Alder",
  "She kept the porch light on",
];

async function one(kind: PrintKind) {
  const image = renderSyntheticPrint(kind, 640, 820);
  fs.writeFileSync(path.join(outDir, `${kind}-source.png`), await rgbaToPngBuffer(image));
  const t0 = Date.now();
  const ridges = extractRidges(image, { density: 1 });
  console.log(kind, "paths", ridges.paths.length, "spacing", ridges.spacing.toFixed(2), "ms", Date.now() - t0);
  const stroke = renderRidgePreview(ridges, 800, 1000);
  fs.writeFileSync(path.join(outDir, `${kind}-ridges.png`), new Resvg(stroke, { fitTo: { mode: "width", value: 800 } }).render().asPng());
  const art = renderArtwork(
    [ridges],
    {
      prints: [{ image, phrases }],
      ink: "#1c1916",
      background: "#f4efe6",
      caption: kind === "loop" ? "Margaret Anne Hale  ·  1942 — 2019" : "",
      artboard: { width: 1200, height: 1500 },
      density: 1,
      tracking: 0.04,
    },
    font,
  );
  console.log(kind, "glyphs", art.glyphCount, "svg kb", Math.round(art.svg.length / 1024));
  fs.writeFileSync(path.join(outDir, `${kind}.svg`), art.svg);
  const png = new Resvg(art.svg, { fitTo: { mode: "width", value: 900 } }).render().asPng();
  fs.writeFileSync(path.join(outDir, `${kind}-words.png`), png);
}

async function main() {
  await one("loop");
  await one("whorl");
  await one("arch");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
