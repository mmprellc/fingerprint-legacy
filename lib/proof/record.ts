import sharp from "sharp";
import { designAssetKey, putBytes } from "../files";
import { renderArtwork } from "../fingerprint/render-print";
import type { PrintStyle } from "../fingerprint/types";
import { productById } from "../products";
import { saveDesign, type Design, type ProofVersion } from "../store";
import { capacityLine, contentWords, ridgeCapacity } from "./capacity";
import { proofWarnings } from "./quality";

/** Screen proof of a sized print, long edge about 1600px. The approved file stays 300 DPI. */
function proofDpi(inches: [number, number] | null | undefined) {
  if (!inches) return 72;
  const long = Math.max(inches[0], inches[1]);
  return Math.min(160, Math.max(72, Math.round(1600 / long)));
}

async function crop(png: Buffer, leftRatio: number, topRatio: number, widthRatio: number, heightRatio: number) {
  const meta = await sharp(png).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const left = Math.max(0, Math.min(width - 24, Math.round(width * leftRatio)));
  const top = Math.max(0, Math.min(height - 24, Math.round(height * topRatio)));
  const cropWidth = Math.max(24, Math.min(width - left, Math.round(width * widthRatio)));
  const cropHeight = Math.max(24, Math.min(height - top, Math.round(height * heightRatio)));
  return sharp(png).extract({ left, top, width: cropWidth, height: cropHeight }).resize({ width: 720 }).png().toBuffer();
}

export function proofCapacity(
  design: Pick<Design, "prints" | "period" | "productId" | "sizeId">,
  style: PrintStyle,
  sizeId?: string,
  productId?: string,
) {
  const product = productById(productId || design.productId);
  const size = product.sizes.find((item) => item.id === (sizeId || design.sizeId)) ?? product.sizes[0];
  const ridges = design.prints[0]?.ridges ?? [];
  const sizeLabel = size?.inches ? size.label.replaceAll("×", "x") : undefined;
  return capacityLine(contentWords(style), ridgeCapacity(ridges, design.period, style.textScale || 1), sizeLabel);
}

/** Saves the next numbered proof, its thumbnail, and the two close-ups. */
export async function recordVersion(
  design: Design,
  input: { style: PrintStyle; sizeId?: string; productId?: string; note: string; changes: string[] },
) {
  const product = productById(input.productId || design.productId);
  const size = product.sizes.find((item) => item.id === (input.sizeId || design.sizeId)) ?? product.sizes[0];
  design.productId = product.id;
  design.sizeId = size.id;
  design.style = input.style;
  const number = (design.versions?.at(-1)?.number ?? 0) + 1;
  const warnings = proofWarnings(design.prints, input.style, design.period);
  const art = await renderArtwork({
    prints: design.prints,
    style: input.style,
    period: design.period,
    dpi: proofDpi(size.inches),
    inches: size.inches,
    frame: product.id === "framed",
  });
  const thumb = designAssetKey(design.id, `v${number}.png`);
  const core = designAssetKey(design.id, `core${number}.png`);
  const ridge = designAssetKey(design.id, `ridge${number}.png`);
  if (thumb) await putBytes(thumb, art.png, "image/png");
  if (core) await putBytes(core, await crop(art.png, 0.34, 0.4, 0.32, 0.22), "image/png");
  if (ridge) await putBytes(ridge, await crop(art.png, 0.16, 0.26, 0.3, 0.18), "image/png");
  const version: ProofVersion = {
    number,
    createdAt: new Date().toISOString(),
    note: input.note,
    style: input.style,
    sizeId: size.id,
    productId: product.id,
    warnings,
    changes: input.changes,
  };
  design.versions = [...(design.versions ?? []), version];
  await saveDesign(design);
  return design;
}

export async function renderApproved(design: Design, version: ProofVersion) {
  const product = productById(version.productId);
  const size = product.sizes.find((item) => item.id === version.sizeId) ?? product.sizes[0];
  const art = await renderArtwork({
    prints: design.prints,
    style: version.style,
    period: design.period,
    dpi: size.inches ? 300 : 160,
    inches: size.inches,
    frame: product.id === "framed",
  });
  const key = designAssetKey(design.id, "approved.png");
  if (key) await putBytes(key, art.png, "image/png");
  return art;
}
