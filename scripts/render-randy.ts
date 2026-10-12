import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { plaqueFor } from "../lib/fingerprint/lettering";
import { buildPreviewSvg, mapPrint } from "../lib/fingerprint/preview";
import { renderArtwork } from "../lib/fingerprint/render-print";
import { RANDY_CZYZ_NAMES, RANDY_CZYZ_SCRIPTURES, randyCzyzStyle } from "../lib/pieces";
import type { Ridge } from "../lib/fingerprint/types";

type Sample = { width: number; height: number; period: number; ridges: Ridge[] };

function assertIncludes(haystack: string, needle: string, label: string) {
  const count = haystack.split(needle).length - 1;
  if (count < 1) throw new Error(`Missing ${label}: ${needle}`);
  return count;
}

function assertCode(text: string, char: string, code: number, label: string) {
  const index = text.indexOf(char);
  if (index < 0 || text.codePointAt(index) !== code) {
    throw new Error(`${label} is missing U+${code.toString(16).toUpperCase()}`);
  }
}

async function main() {
  if (RANDY_CZYZ_NAMES.length !== 29) throw new Error(`Expected 29 names, found ${RANDY_CZYZ_NAMES.length}`);
  const joined = RANDY_CZYZ_SCRIPTURES.join("\n");
  assertCode(randyCzyzStyle.footer || "", "—", 0x2014, "footer dash");
  assertCode(joined, "—", 0x2014, "scripture dash");
  assertCode(joined, "–", 0x2013, "Numbers dash");
  assertCode(joined, "“", 0x201c, "opening quote");
  assertCode(joined, "”", 0x201d, "closing quote");
  if (!joined.includes("6:24–26")) throw new Error("Numbers citation changed");

  const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/samples/loop.json"), "utf8")) as Sample;
  const print = {
    ridges: sample.ridges,
    width: sample.width,
    height: sample.height,
    lines: [] as string[],
  };
  const preview = buildPreviewSvg([print], randyCzyzStyle, sample.period);
  for (const name of RANDY_CZYZ_NAMES) assertIncludes(preview.svg, name, "name");
  const jacob = assertIncludes(preview.svg, "Jacob Czyz", "Jacob Czyz");
  const martin = assertIncludes(preview.svg, "Martin Pierce", "Martin Pierce");
  if (jacob < 2 || martin < 2) throw new Error(`Duplicates dropped: Jacob ${jacob}, Martin ${martin}`);
  for (const phrase of ["Isaiah 41:10", "Psalm 73:26", "Psalm 119:105", "Numbers 6:24", "righteous right hand", "portion forever", "lamp to my feet", "give you peace", "Maryanne Czyz", "4.20.1955", "10.17.1955"]) {
    assertIncludes(preview.svg, phrase, "phrase");
  }
  if (!preview.svg.includes("RANDY CZYZ FINGERPRINT LEGACY")) throw new Error("Title missing");
  if (!preview.svg.includes(randyCzyzStyle.footer || "")) throw new Error("Footer missing");

  const out = path.join(process.cwd(), "public/pieces");
  fs.mkdirSync(out, { recursive: true });

  const full = await renderArtwork({
    prints: [print],
    style: randyCzyzStyle,
    period: sample.period,
    dpi: 140,
  });
  fs.writeFileSync(path.join(out, "randy-czyz.png"), full.png);
  fs.writeFileSync(path.join(out, "randy-czyz.pdf"), full.pdf);

  const matched = await renderArtwork({
    prints: [print],
    style: { ...randyCzyzStyle, title: "", footer: "", script: "" },
    period: sample.period,
    matchSource: true,
  });

  const plaque = plaqueFor(mapPrint(print), randyCzyzStyle, sample.period);
  if (!plaque) throw new Error("Core plaque was not placed");
  const cropW = Math.round(plaque.rx * 2 + sample.period * 11);
  const cropH = Math.round(plaque.ry * 2 + sample.period * 16);
  const left = Math.max(0, Math.round(plaque.cx - cropW / 2));
  const top = Math.max(0, Math.round(plaque.cy - cropH / 2));
  const close = await sharp(matched.png)
    .extract({
      left,
      top,
      width: Math.min(cropW, sample.width - left),
      height: Math.min(cropH, sample.height - top),
    })
    .resize({ width: 1680, kernel: "lanczos3" })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(out, "randy-czyz-closeup.png"), close);

  const original = fs.readFileSync(path.join(process.cwd(), "public/samples/loop.png"));
  const leftMeta = await sharp(original).metadata();
  const rightMeta = await sharp(matched.png).metadata();
  const lw = leftMeta.width ?? sample.width;
  const rw = rightMeta.width ?? sample.width;
  const lh = leftMeta.height ?? sample.height;
  const rh = rightMeta.height ?? sample.height;
  const gap = 36;
  const label = 48;
  const boardW = lw + rw + gap * 3;
  const boardH = Math.max(lh, rh) + label + gap;
  const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}">
    <rect width="100%" height="100%" fill="#F6F1E8"/>
    <text x="${gap}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Original print</text>
    <text x="${lw + gap * 2}" y="32" font-family="Georgia" font-size="20" fill="#34383A">Randy Czyz</text>
  </svg>`;
  await sharp(Buffer.from(board))
    .composite([
      { input: original, left: gap, top: label },
      { input: matched.png, left: lw + gap * 2, top: label },
    ])
    .png()
    .toFile(path.join(out, "randy-czyz-compare.png"));

  const artifacts = "/opt/cursor/artifacts";
  fs.mkdirSync(artifacts, { recursive: true });
  fs.copyFileSync(path.join(out, "randy-czyz.png"), path.join(artifacts, "randy_czyz_artwork.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-closeup.png"), path.join(artifacts, "randy_czyz_closeup.png"));
  fs.copyFileSync(path.join(out, "randy-czyz-compare.png"), path.join(artifacts, "randy_czyz_side_by_side.png"));
  fs.copyFileSync(path.join(out, "randy-czyz.pdf"), path.join(artifacts, "randy_czyz.pdf"));

  console.log(`artwork ${full.width}x${full.height}`);
  console.log(`matched ${rightMeta.width}x${rightMeta.height} plaque ${plaque.cx.toFixed(0)},${plaque.cy.toFixed(0)} ${plaque.rx.toFixed(0)}x${plaque.ry.toFixed(0)}`);
  console.log(`closeup crop ${left},${top} ${cropW}x${cropH}`);
  console.log(`names ok, Jacob ${jacob}, Martin ${martin}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
