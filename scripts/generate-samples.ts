import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { PALETTES, STORIES, artboardFor } from "../lib/catalog";
import { renderArtwork } from "../lib/fingerprint/render";
import { extractRidges } from "../lib/fingerprint/extract";
import { renderSyntheticPrint, rgbaToPngBuffer } from "../lib/fingerprint/synthetic";
import { loadTypefaceSync } from "../lib/server/fonts";

async function writePrint(kind: "loop" | "whorl" | "arch", file: string) {
  const image = renderSyntheticPrint(kind, 720, 920);
  fs.writeFileSync(file, await rgbaToPngBuffer(image));
  return image;
}

async function writePiece(name: string, storyKey: keyof typeof STORIES, kinds: Array<"loop" | "whorl" | "arch">, paletteId: (typeof PALETTES)[number]["id"]) {
  const story = STORIES[storyKey];
  const palette = PALETTES.find((item) => item.id === paletteId) ?? PALETTES[0];
  const images = [];
  for (const kind of kinds) {
    images.push(renderSyntheticPrint(kind, 640, 820));
  }
  const font = loadTypefaceSync("garamond");
  const art = renderArtwork(
    images.map((image) => extractRidges(image, { density: 1 })),
    {
      prints: images.map((image, index) => ({ image, phrases: story.prints[index].phrases })),
      ink: palette.ink,
      ink2: palette.ink2,
      background: palette.background,
      caption: story.caption,
      artboard: artboardFor("8x10", 1400),
      density: 1,
      tracking: 0.04,
    },
    font,
  );
  const png = Buffer.from(new Resvg(art.svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
  await sharp(png).jpeg({ quality: 84 }).toFile(path.join("public/gallery", `${name}.jpg`));
  console.log(name, art.ridgeCount, art.glyphCount);
}

async function writeIcons() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#f4efe6"/>
  <ellipse cx="256" cy="248" rx="118" ry="156" fill="none" stroke="#1c1916" stroke-width="10"/>
  <ellipse cx="256" cy="248" rx="78" ry="112" fill="none" stroke="#7a5638" stroke-width="8"/>
  <ellipse cx="256" cy="248" rx="40" ry="64" fill="none" stroke="#1c1916" stroke-width="7"/>
</svg>`;
  fs.mkdirSync("public/icons", { recursive: true });
  for (const size of [192, 512, 180]) {
    const png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
    const name = size === 180 ? "public/icons/apple-touch-icon.png" : `public/icons/icon-${size}.png`;
    fs.writeFileSync(name, png);
  }
}

async function main() {
  fs.mkdirSync("public/samples", { recursive: true });
  fs.mkdirSync("public/gallery", { recursive: true });
  await writePrint("loop", "public/samples/loop.png");
  await writePrint("whorl", "public/samples/whorl.png");
  await writePrint("arch", "public/samples/arch.png");
  await writePiece("memorial", "memorial", ["loop"], "ivory");
  await writePiece("retirement", "retirement", ["whorl"], "navy");
  await writePiece("wedding", "wedding", ["loop", "whorl"], "blush");
  await writePiece("founder", "founder", ["arch"], "gilded");
  await writeIcons();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
