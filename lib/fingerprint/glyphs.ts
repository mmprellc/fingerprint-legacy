import path from "node:path";
import opentype from "opentype.js";
import { pathLength } from "./geometry";
import { placeGlyphs, poseAt } from "./lettering";
import type { Pt } from "./types";

export type GlyphFont = opentype.Font;

const fonts = new Map<string, GlyphFont>();

export function loadRidgeFace(file: string) {
  const cached = fonts.get(file);
  if (cached) return cached;
  const face = opentype.loadSync(path.join(process.cwd(), "fonts", file));
  fonts.set(file, face);
  return face;
}

/**
 * One shift for every letter, so the ink from the cap top to the descender
 * sits on the ridge. Centering each glyph on its own box lifts y, g, and o
 * onto the cap line, and the ridges then read as random capitals.
 */
export function baselineShift(font: GlyphFont, fontSize: number) {
  const cap = font.charToGlyph("H").getBoundingBox();
  const descender = font.charToGlyph("y").getBoundingBox();
  const mid = (cap.y2 + descender.y1) / 2;
  return (mid / font.unitsPerEm) * fontSize;
}

export type LaidGlyph = {
  text: string;
  d: string;
  x: number;
  y: number;
  angle: number;
  /** Font baseline, in the glyph's local coordinates, shared by the whole run. */
  baseline: number;
};

export function layoutRun(font: GlyphFont, text: string, points: Pt[], fontSize: number, trackingEm = 0.04, gapEm = 0.16) {
  const tracking = -fontSize * trackingEm;
  const shift = baselineShift(font, fontSize);
  const glyphs = placeGlyphs(
    text,
    pathLength(points),
    (ch) => advanceOf(font, ch, fontSize),
    fontSize * gapEm,
    tracking,
  );
  const placed: LaidGlyph[] = [];
  for (const item of glyphs) {
    const glyph = font.charToGlyph(item.text);
    const pose = poseAt(points, item.distance);
    const d = glyph.getPath(-item.advance / 2, shift, fontSize).toPathData(1);
    if (!d) continue;
    placed.push({
      text: item.text,
      d,
      x: pose.x,
      y: pose.y,
      angle: (pose.angle * 180) / Math.PI,
      baseline: shift,
    });
  }
  return placed;
}

function advanceOf(font: GlyphFont, ch: string, fontSize: number) {
  const glyph = font.charToGlyph(ch);
  return ((glyph.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * fontSize;
}

function firstMove(d: string) {
  const match = d.match(/[Mm]\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*,?\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Baseline implied by the drawn outline, compared with the same glyph on the font baseline. */
function drawnBaseline(font: GlyphFont, glyph: LaidGlyph, fontSize: number) {
  const reference = firstMove(font.charToGlyph(glyph.text).getPath(0, 0, fontSize).toPathData(1));
  const drawn = firstMove(glyph.d);
  if (!reference || !drawn) return null;
  return drawn.y - reference.y;
}

/**
 * The ridge face must keep a real lowercase, and every letter must share the
 * baseline layoutRun draws. A unicase face, or per-glyph box centering, fails.
 */
export function ridgeCaseReport(font: GlyphFont, fontSize: number) {
  const oBox = font.charToGlyph("o").getBoundingBox();
  const capBox = font.charToGlyph("O").getBoundingBox();
  const oHeight = oBox.y2 - oBox.y1;
  const capHeight = capBox.y2 - capBox.y1;
  if (!(capHeight > 0) || oHeight / capHeight > 0.85) {
    return {
      ok: false,
      detail: "This typeface draws lowercase nearly as tall as capitals. Ridge text needs a serif with a clear x-height.",
    };
  }

  const laid = layoutRun(font, "yYoO", [{ x: 0, y: 0 }, { x: Math.max(80, fontSize * 8), y: 0 }], fontSize, 0);
  const baselines = new Map<string, number>();
  for (const glyph of laid) {
    const baseline = drawnBaseline(font, glyph, fontSize);
    if (baseline == null || baselines.has(glyph.text)) continue;
    baselines.set(glyph.text, baseline);
  }
  const missing = ["y", "Y", "o", "O"].filter((ch) => !baselines.has(ch));
  if (missing.length) {
    return { ok: false, detail: `The case sample did not draw ${missing.join(", ")}.` };
  }
  const values = [...baselines.values()];
  const spread = Math.max(...values) - Math.min(...values);
  if (spread > 0.45) {
    return {
      ok: false,
      detail: "Letters are centered on their own boxes, so lowercase sits on the cap line.",
    };
  }
  const scale = fontSize / font.unitsPerEm;
  const inkTop = (ch: string) => (baselines.get(ch) ?? 0) - font.charToGlyph(ch).getBoundingBox().y2 * scale;
  const rise = inkTop("o") - inkTop("O");
  if (rise < fontSize * 0.12) {
    return { ok: false, detail: "Capitals do not rise clearly above lowercase." };
  }
  return {
    ok: true,
    detail: "Lowercase and capitals share one baseline, and capitals stand above the x-height.",
  };
}
