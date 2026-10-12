import path from "node:path";
import opentype from "opentype.js";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { toPathD } from "./geometry";
import { ellipsePath, fontSizeFor, inPlaque, packRuns, placeGlyphs, plaqueFor, poseAt, ridgeWidth, ridgeWords, UNDERSTROKE, uprightRuns } from "./lettering";
import { fontById, mapPrint, presetById } from "./preview";
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

function advanceOf(font: GlyphFont, ch: string, fontSize: number) {
  const glyph = font.charToGlyph(ch);
  return ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * fontSize;
}

function measureToken(font: GlyphFont, word: string, fontSize: number, tracking: number, space: number) {
  const parts = word.split(" ");
  let width = 0;
  parts.forEach((part, index) => {
    if (index > 0) width += space;
    for (const ch of part) width += Math.max(0.4, advanceOf(font, ch, fontSize) + tracking);
  });
  return width;
}

function layoutRun(font: GlyphFont, text: string, points: Pt[], fontSize: number) {
  const tracking = -fontSize * 0.055;
  const glyphs = placeGlyphs(
    text,
    pathLengthOf(points),
    (ch) => advanceOf(font, ch, fontSize),
    fontSize * 0.2,
    tracking,
  );
  const placed: { d: string; x: number; y: number; angle: number }[] = [];
  for (const item of glyphs) {
    const glyph = font.charToGlyph(item.text);
    const pose = poseAt(points, item.distance);
    const box = glyph.getBoundingBox();
    const scale = fontSize / font.unitsPerEm;
    const cx = ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale) / 2;
    const cy = -((box.y1 + box.y2) / 2) * scale;
    const d = glyph.getPath(-cx, -cy, fontSize).toPathData(1);
    if (d) placed.push({ d, x: pose.x, y: pose.y, angle: (pose.angle * 180) / Math.PI });
  }
  return placed;
}

function pathLengthOf(points: Pt[]) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

export type RenderRequest = {
  prints: PreviewPrint[];
  style: PrintStyle;
  period: number;
  inches?: [number, number] | null;
  dpi?: number;
  frame?: boolean;
  /** Draw in the source pixel grid, with no paper margin, so the portrait lines up with the print. */
  matchSource?: boolean;
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
  const hasTitle = Boolean(request.style.title?.trim());
  const hasFooter = Boolean(request.style.footer?.trim() || request.style.script?.trim());
  const captionBlock = request.matchSource ? 0 : Math.round(artH * ((hasTitle ? 0.1 : 0.04) + (hasFooter ? 0.09 : 0.02)));

  const dpi = request.dpi ?? 200;
  let paperW: number;
  let paperH: number;
  let fit = 1;
  let ox = 0;
  let oy = 0;
  let margin = 0;
  let topPx = 0;
  let bottomPx = 0;
  if (request.matchSource) {
    paperW = Math.max(...request.prints.map((print) => Math.ceil((print.tx ?? 0) + print.width * (print.scale ?? 1))));
    paperH = Math.max(...request.prints.map((print) => Math.ceil((print.ty ?? 0) + print.height * (print.scale ?? 1))));
    minX = 0;
    minY = 0;
  } else if (request.inches) {
    paperW = Math.round(request.inches[0] * dpi);
    paperH = Math.round(request.inches[1] * dpi);
  } else {
    const long = 2400;
    const aspect = artW / (artH + captionBlock);
    if (aspect > 1) {
      paperW = long;
      paperH = Math.round(long / aspect);
    } else {
      paperH = long;
      paperW = Math.round(long * aspect);
    }
  }
  if (!request.matchSource) {
    margin = Math.round(Math.min(paperW, paperH) * 0.055);
    topPx = hasTitle ? Math.round(paperH * 0.078) : margin;
    bottomPx = hasFooter ? Math.round(paperH * 0.07) : margin;
    const availW = paperW - margin * 2;
    const availH = paperH - topPx - bottomPx;
    fit = Math.min(availW / artW, availH / artH);
    ox = (paperW - artW * fit) / 2;
    oy = topPx + (availH - artH * fit) / 2;
  }
  const fontSize = fontSizeFor(request.period, request.style.textScale || 1) * fit;
  const ink = preset.ink;
  const bridge = ridgeWidth(request.period) * fit * UNDERSTROKE;
  const tracking = -fontSize * 0.055;
  const groups: string[] = [];
  const defs: string[] = [];
  request.prints.forEach((print, printIndex) => {
    const words = ridgeWords(request.style.names, request.style.scriptures, print.lines);
    const gap = fontSize * 0.2;
    const measure = (word: string) => measureToken(face, word, fontSize, tracking, gap);
    const cursor = { i: 0 };
    const ridges = mapPrint(print);
    const sourcePlaque = plaqueFor(ridges, request.style, request.period);
    const plaque = sourcePlaque
      ? {
          cx: ox + (sourcePlaque.cx - minX) * fit,
          cy: oy + (sourcePlaque.cy - minY) * fit,
          rx: sourcePlaque.rx * fit,
          ry: sourcePlaque.ry * fit,
          lines: sourcePlaque.lines.map((line) => ({ ...line, fontSize: line.fontSize * fit })),
          baselines: sourcePlaque.baselines.map((baseline) => oy + (baseline - minY) * fit),
        }
      : null;
    if (plaque) fitPlaque(plaque, face, titleFace, ridgeWidth(request.period) * fit);
    if (plaque) {
      defs.push(
        `<clipPath id="keep${printIndex}"><path fill-rule="evenodd" d="M0 0 H${paperW} V${paperH} H0 Z ${ellipsePath(plaque.cx, plaque.cy, plaque.rx, plaque.ry)}"/></clipPath>`,
      );
    }
    const body: string[] = [];
    const drawn = ridges.map((ridge) => ridge.points.map((point) => ({
      x: ox + (point.x - minX) * fit,
      y: oy + (point.y - minY) * fit,
    }))).filter((points) => pathLengthOf(points) >= fontSize * 1.4);
    const ceiling = drawn.reduce((max, points) => Math.max(max, ...uprightRuns(points).map((run) => pathLengthOf(run))), 0);
    for (const points of drawn) {
      body.push(
        `<path d="${toPathD(points)}" fill="none" stroke="${ink}" stroke-width="${bridge.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      const packed = packRuns(uprightRuns(points), words, measure, gap, cursor, ceiling);
      for (const run of packed) {
        if (!run.text) continue;
        const glyphs = layoutRun(face, run.text, run.points, fontSize);
        for (const glyph of glyphs) {
          if (plaque && inPlaque(glyph.x, glyph.y, plaque, fontSize * 0.45)) continue;
          body.push(
            `<g transform="translate(${glyph.x.toFixed(2)} ${glyph.y.toFixed(2)}) rotate(${glyph.angle.toFixed(2)})"><path d="${glyph.d}" fill="${ink}"/></g>`,
          );
        }
      }
    }
    groups.push(`<g${plaque ? ` clip-path="url(#keep${printIndex})"` : ""}>${body.join("")}</g>`);
    if (!plaque) return;
    groups.push(`<path d="${ellipsePath(plaque.cx, plaque.cy, plaque.rx * 0.98, plaque.ry * 0.98)}" fill="${preset.paper}"/>`);
    plaque.lines.forEach((line, lineIndex) => {
      const font = line.emphasis ? face : titleFace;
      const glyphs = layoutCentered(font, line.text, line.fontSize, plaque.cx, plaque.baselines[lineIndex], line.emphasis ? 0.02 : 0.04);
      groups.push(`<g fill="${ink}">${glyphs}</g>`);
    });
  });

  const caption = request.matchSource ? "" : frameCaption(request.style, titleFace, scriptFace, paperW, paperH, topPx, bottomPx, ink);
  const frame = request.frame
    ? `<rect x="${margin / 2}" y="${margin / 2}" width="${paperW - margin}" height="${paperH - margin}" fill="none" stroke="#B89A68" stroke-width="${Math.max(2, dpi * 0.01)}"/>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${paperW}" height="${paperH}" viewBox="0 0 ${paperW} ${paperH}"><rect width="100%" height="100%" fill="${preset.paper}"/>${frame}<defs>${defs.join("")}</defs>${groups.join("")}${caption}</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const pdf = await pngToPdf(png, request.inches, paperW, paperH, request.style.title || "Fingerprint Legacy");
  return { svg, png, pdf, width: paperW, height: paperH };
}

function fitPlaque(
  plaque: { cx: number; cy: number; rx: number; ry: number; lines: { text: string; fontSize: number; emphasis: boolean }[]; baselines: number[] },
  face: GlyphFont,
  titleFace: GlyphFont,
  pad: number,
) {
  let maxW = 0;
  for (const line of plaque.lines) {
    const font = line.emphasis ? face : titleFace;
    const tracking = line.fontSize * (line.emphasis ? 0.02 : 0.04);
    maxW = Math.max(maxW, measureToken(font, line.text, line.fontSize, tracking, line.fontSize * 0.2));
  }
  const first = plaque.lines[0];
  const last = plaque.lines[plaque.lines.length - 1];
  const top = plaque.baselines[0] - first.fontSize * 0.95;
  const bottom = plaque.baselines[plaque.baselines.length - 1] + last.fontSize * 0.42;
  plaque.rx = Math.max(plaque.rx, (maxW / 2 + pad * 1.6) / 0.98);
  plaque.ry = Math.max(plaque.ry, (Math.max(bottom - plaque.cy, plaque.cy - top) + pad * 1.15) / 0.98);
}

function frameCaption(style: PrintStyle, titleFace: GlyphFont, scriptFace: GlyphFont, paperW: number, paperH: number, topPx: number, bottomPx: number, ink: string) {
  const parts: string[] = [];
  const maxWidth = paperW * 0.86;
  if (style.title?.trim()) {
    const size = fitSize(titleFace, style.title.trim().toUpperCase(), Math.max(26, Math.round(paperH * 0.026)), 18, maxWidth, 0.12);
    parts.push(layoutCentered(titleFace, style.title.trim().toUpperCase(), size, paperW / 2, topPx * 0.66, 0.12));
  }
  if (style.footer?.trim()) {
    const size = fitSize(titleFace, style.footer.trim(), Math.max(22, Math.round(paperH * 0.022)), 16, maxWidth, 0.03);
    parts.push(layoutCentered(titleFace, style.footer.trim(), size, paperW / 2, paperH - bottomPx * 0.42, 0.03));
  } else if (style.script?.trim()) {
    const size = fitSize(scriptFace, style.script.trim(), Math.max(36, Math.round(paperH * 0.034)), 22, maxWidth, 0);
    parts.push(layoutCentered(scriptFace, style.script.trim(), size, paperW / 2, paperH - bottomPx * 0.4, 0));
  }
  return parts.length ? `<g fill="${ink}">${parts.join("")}</g>` : "";
}

function fitSize(font: GlyphFont, text: string, size: number, min: number, maxWidth: number, trackingEm: number) {
  let next = size;
  while (next > min && measureToken(font, text, next, next * trackingEm, next * 0.2) > maxWidth) next -= 1;
  return next;
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
