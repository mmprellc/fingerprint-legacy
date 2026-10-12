import path from "node:path";
import opentype from "opentype.js";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { pathLength, pointAtLength } from "./geometry";
import { corpusOf, fontById, fontSizeFor, mapPrint, presetById } from "./preview";
import type { PreviewPrint } from "./preview";
import type { PrintStyle, Pt } from "./types";

type GlyphFont = opentype.Font;

const fonts = new Map<string, GlyphFont>();

function loadFace(file: string) {
  const cached = fonts.get(file);
  if (cached) return cached;
  const face = opentype.loadSync(path.join(process.cwd(), "fonts", file));
  fonts.set(file, face);
  return face;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function layoutLine(font: GlyphFont, stream: string, cursor: { i: number }, points: Pt[], fontSize: number) {
  const length = pathLength(points);
  const target = length * 0.93;
  const chars: string[] = [];
  const glyphs: opentype.Glyph[] = [];
  let width = 0;
  let guard = 0;
  while (width < target && guard < 500) {
    const ch = stream[cursor.i % stream.length];
    const glyph = font.charToGlyph(ch);
    const advance = ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * fontSize;
    if (width + advance > target && chars.length > 2) break;
    chars.push(ch);
    glyphs.push(glyph);
    width += advance;
    cursor.i++;
    guard++;
  }
  const gap = chars.length ? Math.max(-0.35, (target - width) / chars.length) : 0;
  let dist = Math.max(1, gap);
  const placed: { d: string; x: number; y: number; angle: number }[] = [];
  for (let n = 0; n < glyphs.length; n++) {
    const glyph = glyphs[n];
    const advance = ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * fontSize;
    const pose = pointAtLength(points, Math.min(length - 0.5, dist + advance / 2));
    const box = glyph.getBoundingBox();
    const scale = fontSize / font.unitsPerEm;
    const cx = ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale) / 2;
    const cy = -((box.y1 + box.y2) / 2) * scale;
    const d = glyph.getPath(-cx, -cy, fontSize).toPathData(1);
    if (d) placed.push({ d, x: pose.x, y: pose.y, angle: (pose.angle * 180) / Math.PI });
    dist += advance + gap;
  }
  return placed;
}

export type RenderRequest = {
  prints: PreviewPrint[];
  style: PrintStyle;
  period: number;
  inches?: [number, number] | null;
  dpi?: number;
  frame?: boolean;
};

export async function renderArtwork(request: RenderRequest) {
  const preset = presetById(request.style.preset);
  const face = loadFace(fontById(request.style.font).file);
  const scriptFace = loadFace("GreatVibes-Regular.ttf");
  const titleFace = loadFace("CormorantGaramond-Medium.ttf");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const print of request.prints) {
    for (const ridge of mapPrint(print)) {
      for (const point of ridge.points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 600;
    maxY = 800;
  }
  const artW = Math.max(40, maxX - minX);
  const artH = Math.max(40, maxY - minY);
  const captionBlock = request.style.title || request.style.script ? Math.round(artH * 0.14) : Math.round(artH * 0.04);

  const dpi = request.dpi ?? 200;
  let paperW: number;
  let paperH: number;
  if (request.inches) {
    paperW = Math.round(request.inches[0] * dpi);
    paperH = Math.round(request.inches[1] * dpi);
  } else {
    const long = 2200;
    const aspect = artW / (artH + captionBlock);
    if (aspect > 1) {
      paperW = long;
      paperH = Math.round(long / aspect);
    } else {
      paperH = long;
      paperW = Math.round(long * aspect);
    }
  }

  const captionPx = request.style.title || request.style.script ? Math.round(paperH * 0.11) : Math.round(paperH * 0.04);
  const margin = Math.round(Math.min(paperW, paperH) * 0.06);
  const availW = paperW - margin * 2;
  const availH = paperH - margin * 2 - captionPx;
  const fit = Math.min(availW / artW, availH / artH);
  const ox = (paperW - artW * fit) / 2;
  const oy = margin + (availH - artH * fit) / 2;
  const fontSize = fontSizeFor(request.period, request.style.textScale || 1) * fit;
  const ink = preset.ink;
  const groups: string[] = [];
  request.prints.forEach((print) => {
    const streamText = corpusOf(print.lines);
    if (!streamText) return;
    const cursor = { i: 0 };
    const ridges = mapPrint(print);
    for (const ridge of ridges) {
      const points = ridge.points.map((point) => ({
        x: ox + (point.x - minX) * fit,
        y: oy + (point.y - minY) * fit,
      }));
      if (pathLength(points) < fontSize * 2) continue;
      const glyphs = layoutLine(face, streamText, cursor, points, fontSize);
      for (const glyph of glyphs) {
        groups.push(
          `<g transform="translate(${glyph.x.toFixed(2)} ${glyph.y.toFixed(2)}) rotate(${glyph.angle.toFixed(2)})"><path d="${glyph.d}" fill="${ink}"/></g>`,
        );
      }
    }
  });

  const caption = captionSvg(request.style, titleFace, scriptFace, paperW, paperH - margin * 0.35, ink, captionPx);
  const frame = request.frame
    ? `<rect x="${margin / 2}" y="${margin / 2}" width="${paperW - margin}" height="${paperH - margin}" fill="none" stroke="#B89A68" stroke-width="${Math.max(2, dpi * 0.01)}"/>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${paperW}" height="${paperH}" viewBox="0 0 ${paperW} ${paperH}"><rect width="100%" height="100%" fill="${preset.paper}"/>${frame}${groups.join("")}${caption}</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const pdf = await pngToPdf(png, request.inches, paperW, paperH, request.style.title || "Fingerprint Legacy");
  return { svg, png, pdf, width: paperW, height: paperH };
}

function captionSvg(style: PrintStyle, titleFace: GlyphFont, scriptFace: GlyphFont, paperW: number, baseline: number, ink: string, captionPx: number) {
  const parts: string[] = [];
  if (style.title) {
    const size = Math.max(28, captionPx * 0.28);
    const text = style.title.toUpperCase();
    const glyphs = layoutCentered(titleFace, text, size, paperW / 2, baseline - captionPx * 0.62, 0.12);
    parts.push(`<g fill="${ink}">${glyphs}</g>`);
  }
  if (style.script) {
    const size = Math.max(42, captionPx * 0.46);
    const glyphs = layoutCentered(scriptFace, style.script, size, paperW / 2, baseline - captionPx * 0.18, 0);
    parts.push(`<g fill="${ink}">${glyphs}</g>`);
  }
  return parts.join("");
}

function layoutCentered(font: GlyphFont, text: string, fontSize: number, centerX: number, baseline: number, trackingEm: number) {
  const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));
  const tracking = fontSize * trackingEm;
  const advances = glyphs.map((glyph) => ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * fontSize + tracking);
  const total = advances.reduce((sum, value) => sum + value, 0) - tracking;
  let x = centerX - total / 2;
  const parts: string[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    const d = glyphs[i].getPath(x, baseline, fontSize).toPathData(1);
    if (d) parts.push(`<path d="${d}"/>`);
    x += advances[i];
  }
  return parts.join("");
}

async function pngToPdf(png: Buffer, inches: [number, number] | null | undefined, pxW: number, pxH: number, title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Fingerprint Legacy");
  doc.setCreator("Fingerprint Legacy");
  const pageW = (inches?.[0] ?? pxW / 200) * 72;
  const pageH = (inches?.[1] ?? pxH / 200) * 72;
  const page = doc.addPage([pageW, pageH]);
  const image = await doc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
  return Buffer.from(await doc.save());
}
