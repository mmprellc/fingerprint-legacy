import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { artboardFor, printPixelWidth, SIZES, type SizeId } from "../catalog";
import type { DesignInput } from "../design";
import { artworkFromPrints } from "../fingerprint/render";
import type { RGBA } from "../fingerprint/types";
import { loadTypefaceSync } from "./fonts";

export function decodeDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) throw new Error("Upload a PNG, JPEG, or WebP photograph of the print.");
  return Buffer.from(match[1], "base64");
}

export async function bufferToRgba(buffer: Buffer): Promise<RGBA> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

export async function buildArtwork(design: DesignInput) {
  const images = await Promise.all(design.prints.map((print) => bufferToRgba(decodeDataUrl(print.imageDataUrl))));
  const font = loadTypefaceSync(design.fontId);
  const artboard = artboardFor(design.sizeId as SizeId, 1500);
  const artwork = artworkFromPrints(
    images.map((image, index) => ({
      image,
      phrases: design.prints[index].phrases,
    })),
    {
      ink: design.ink,
      ink2: design.ink2,
      background: design.background,
      caption: design.caption,
      density: design.density,
      tracking: design.tracking,
      invert: design.invert,
      artboard,
    },
    font,
  );
  if (artwork.ridgeCount < 8) {
    throw new Error("We couldn't find enough ridge lines. Try a clearer photograph, with the print large in the frame.");
  }
  return artwork;
}

export function rasterizeSvg(svg: string, width: number): Buffer {
  const attempts = [width, Math.round(width * 0.72), 1600];
  let last: unknown;
  for (const value of attempts) {
    try {
      return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value } }).render().asPng());
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("The print file could not be rasterized.");
}

export async function pngToPdf(png: Buffer, sizeId: SizeId): Promise<Buffer> {
  const size = SIZES[sizeId];
  const pdf = await PDFDocument.create();
  pdf.setTitle("Fingerprint Legacy");
  pdf.setAuthor("Fingerprint Legacy");
  const page = pdf.addPage([size.widthIn * 72, size.heightIn * 72]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await pdf.save());
}

export async function renderPrintFiles(design: DesignInput) {
  const artwork = await buildArtwork(design);
  const png = rasterizeSvg(artwork.svg, printPixelWidth(design.sizeId));
  const pdf = await pngToPdf(png, design.sizeId);
  return { ...artwork, png, pdf };
}
