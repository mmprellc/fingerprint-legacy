import type { Font, Glyph, PathCommand } from "opentype.js";
import type { ArtworkOptions, ArtworkResult, Point, PrintInput, RidgeSet } from "./types";
import { extractRidges } from "./extract";

type Placed = {
  paths: Point[][];
  phrases: string[];
  ink: string;
  spacing: number;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function bounds(paths: Point[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function fitPaths(paths: Point[][], frame: { x: number; y: number; width: number; height: number }, rotation = 0): Point[][] {
  const box = bounds(paths);
  const scale = Math.min(frame.width / box.width, frame.height / box.height);
  const cx = box.minX + box.width / 2;
  const cy = box.minY + box.height / 2;
  const destX = frame.x + frame.width / 2;
  const destY = frame.y + frame.height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return paths.map((path) =>
    path.map((p) => {
      const x = (p.x - cx) * scale;
      const y = (p.y - cy) * scale;
      return {
        x: destX + x * cos - y * sin,
        y: destY + x * sin + y * cos,
      };
    }),
  );
}

function placeOne(
  print: { ridges: RidgeSet; phrases: string[]; rotation?: number },
  frame: { x: number; y: number; width: number; height: number },
  rotation: number,
): Placed {
  const box = bounds(print.ridges.paths);
  const scale = Math.min(frame.width / box.width, frame.height / box.height);
  return {
    paths: fitPaths(print.ridges.paths, frame, rotation),
    phrases: print.phrases,
    ink: "",
    spacing: print.ridges.spacing * scale,
  };
}

function placePrints(prints: { ridges: RidgeSet; phrases: string[]; rotation?: number }[], artW: number, artH: number, caption: boolean): Placed[] {
  const bottom = caption ? artH * 0.08 : 0;
  if (prints.length < 2) {
    const frame = {
      x: artW * 0.08,
      y: artH * 0.07,
      width: artW * 0.84,
      height: artH * 0.84 - bottom,
    };
    return [placeOne(prints[0], frame, prints[0].rotation ?? 0)];
  }

  const frames = [
    { x: artW * 0.04, y: artH * 0.08, width: artW * 0.62, height: artH * 0.74 - bottom },
    { x: artW * 0.34, y: artH * 0.12, width: artW * 0.62, height: artH * 0.74 - bottom },
  ];
  return prints.slice(0, 2).map((print, index) =>
    placeOne(print, frames[index], print.rotation ?? (index === 0 ? -0.07 : 0.09)),
  );
}

function inscription(phrases: string[]): string {
  const clean = phrases
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => p.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
  if (!clean.length) return "";
  return clean.join("  ·  ");
}

function pointAlong(cum: number[], points: Point[], distance: number): { x: number; y: number; angle: number } {
  const total = cum[cum.length - 1];
  const d = clamp(distance, 0, total);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const span = Math.max(1e-4, cum[lo + 1] - cum[lo]);
  const t = (d - cum[lo]) / span;
  const a = points[lo];
  const b = points[Math.min(points.length - 1, lo + 1)];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle };
}

function cumulative(points: Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return cum;
}

function transformCommand(cmd: PathCommand, map: (x: number, y: number) => [number, number]): string {
  const pair = (x: number, y: number) => {
    const [nx, ny] = map(x, y);
    return `${nx.toFixed(2)} ${ny.toFixed(2)}`;
  };
  switch (cmd.type) {
    case "M":
      return `M${pair(cmd.x, cmd.y)}`;
    case "L":
      return `L${pair(cmd.x, cmd.y)}`;
    case "Q":
      return `Q${pair(cmd.x1, cmd.y1)} ${pair(cmd.x, cmd.y)}`;
    case "C":
      return `C${pair(cmd.x1, cmd.y1)} ${pair(cmd.x2, cmd.y2)} ${pair(cmd.x, cmd.y)}`;
    case "Z":
      return "Z";
    default:
      return "";
  }
}

function layoutRidge(
  font: Font,
  points: Point[],
  text: string,
  fontSize: number,
  trackingEm: number,
): { d: string; glyphs: number } {
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  if (total < fontSize * 2.2 || !text) return { d: "", glyphs: 0 };

  const scale = fontSize / font.unitsPerEm;
  const tracking = trackingEm * fontSize;
  const unitWidth = measure(font, text, fontSize, tracking);
  if (unitWidth < 1) return { d: "", glyphs: 0 };
  const repeats = Math.max(1, Math.ceil((total + unitWidth) / unitWidth));
  const sequence = Array.from({ length: repeats }, () => text).join(" ");

  let dist = fontSize * 0.15;
  let prev: Glyph | null = null;
  const parts: string[] = [];
  let glyphs = 0;

  for (const ch of sequence) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.name === ".notdef") {
      dist += fontSize * 0.28;
      prev = null;
      continue;
    }
    const kern = prev ? font.getKerningValue(prev, glyph) * scale : 0;
    const advance = (glyph.advanceWidth || font.unitsPerEm * 0.35) * scale + tracking + kern;
    if (dist + advance > total - fontSize * 0.1) break;
    const pose = pointAlong(cum, points, dist + Math.max(0, advance - tracking) / 2);
    const path = glyph.getPath(0, 0, fontSize);
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const ox = -(advance - tracking) / 2;
    const oy = fontSize * 0.31;
    const chunk = path.commands
      .map((cmd) =>
        transformCommand(cmd, (x, y) => {
          const x0 = x + ox;
          const y0 = y + oy;
          return [pose.x + x0 * cos - y0 * sin, pose.y + x0 * sin + y0 * cos];
        }),
      )
      .join("");
    if (chunk) {
      parts.push(chunk);
      glyphs++;
    }
    dist += advance;
    prev = glyph;
  }

  return { d: parts.join(""), glyphs };
}

function measure(font: Font, text: string, fontSize: number, tracking: number): number {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  let prev: Glyph | null = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.name === ".notdef") {
      width += fontSize * 0.28;
      prev = null;
      continue;
    }
    const kern = prev ? font.getKerningValue(prev, glyph) * scale : 0;
    width += (glyph.advanceWidth || font.unitsPerEm * 0.35) * scale + tracking + kern;
    prev = glyph;
  }
  return width;
}

function polyline(points: Point[]): string {
  if (!points.length) return "";
  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  return d;
}

function captionPath(font: Font, caption: string, fontSize: number, centerX: number, baseline: number): string {
  const scale = fontSize / font.unitsPerEm;
  const text = caption.replace(/\s+/g, " ").trim();
  let width = 0;
  const glyphs: { glyph: Glyph; advance: number }[] = [];
  let prev: Glyph | null = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.name === ".notdef") continue;
    const kern = prev ? font.getKerningValue(prev, glyph) * scale : 0;
    const advance = (glyph.advanceWidth || 0) * scale + kern;
    glyphs.push({ glyph, advance });
    width += advance;
    prev = glyph;
  }
  let x = centerX - width / 2;
  const parts: string[] = [];
  for (const item of glyphs) {
    const path = item.glyph.getPath(x, baseline, fontSize);
    parts.push(path.toPathData(2));
    x += item.advance;
  }
  return parts.join("");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Build a print-ready SVG. Every ridge is a run of outlined letters,
 * so the file does not depend on the printer having the font installed.
 */
export function renderArtwork(ridges: RidgeSet[], options: ArtworkOptions, font: Font): ArtworkResult {
  const artW = options.artboard.width;
  const artH = options.artboard.height;
  const caption = options.caption?.trim() ?? "";
  const inputs = options.prints.map((print, index) => ({
    ridges: ridges[index],
    phrases: print.phrases,
    rotation: print.rotation,
  }));
  const placed = placePrints(inputs, artW, artH, Boolean(caption));
  const inks = [options.ink, options.ink2 || options.ink];
  const tracking = options.tracking ?? 0.035;

  const groups: string[] = [];
  let glyphCount = 0;
  let ridgeCount = 0;

  placed.forEach((print, index) => {
    const text = inscription(print.phrases);
    const fontSize = clamp(print.spacing * 0.78, 8, artH * 0.028);
    const stroke = Math.max(0.6, fontSize * 0.16);
    const lines: string[] = [];
    const letters: string[] = [];
    for (const path of print.paths) {
      const line = polyline(path);
      if (!line) continue;
      ridgeCount++;
      lines.push(`<path d="${line}"/>`);
      if (!text) continue;
      const laid = layoutRidge(font, path, text, fontSize, tracking);
      if (laid.d) {
        letters.push(`<path d="${laid.d}"/>`);
        glyphCount += laid.glyphs;
      }
    }
    const ink = escapeAttr(inks[Math.min(index, inks.length - 1)]);
    groups.push(
      `<g fill="none" stroke="${ink}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">${lines.join("")}</g>`,
    );
    if (letters.length) groups.push(`<g fill="${ink}">${letters.join("")}</g>`);
  });

  if (caption) {
    const size = Math.max(18, artW * 0.028);
    const d = captionPath(font, caption, size, artW / 2, artH * 0.955);
    if (d) groups.push(`<path fill="${escapeAttr(options.ink)}" d="${d}"/>`);
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${artW}" height="${artH}" viewBox="0 0 ${artW} ${artH}" role="img" aria-label="Fingerprint formed from words">
  <title>Fingerprint Legacy</title>
  <rect width="100%" height="100%" fill="${escapeAttr(options.background)}"/>
  ${groups.join("\n  ")}
</svg>`;

  return {
    svg,
    ridgeCount,
    glyphCount,
    spacing: placed[0]?.spacing ?? 0,
  };
}

export function artworkFromPrints(prints: PrintInput[], options: Omit<ArtworkOptions, "prints">, font: Font): ArtworkResult {
  const ridges = prints.map((print) =>
    extractRidges(print.image, { density: options.density, invert: options.invert }),
  );
  return renderArtwork(ridges, { ...options, prints }, font);
}

/** Hairline-only SVG, useful while tuning the tracer. */
export function renderRidgePreview(ridges: RidgeSet, width: number, height: number, ink = "#1c1916", background = "#f4efe6"): string {
  const frame = { x: width * 0.08, y: height * 0.07, width: width * 0.84, height: height * 0.86 };
  const paths = fitPaths(ridges.paths, frame);
  const stroke = Math.max(1, (ridges.spacing * frame.width) / Math.max(ridges.width, 1) * 0.28);
  const d = paths.map(polyline).filter(Boolean).map((line) => `<path d="${line}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    <g fill="none" stroke="${ink}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${d}</g>
  </svg>`;
}
