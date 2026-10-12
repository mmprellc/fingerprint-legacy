import { pathLength, pointAtLength } from "./geometry";
import type { Pt } from "./types";

/** Ink thickness as a fraction of the ridge period. Valleys stay open at this width. */
export const RIDGE_WIDTH_RATIO = 0.42;

/** How much of the ink width is drawn as a bridge under and between letters. */
export const UNDERSTROKE = 0.62;

const CAP_RATIO = 0.69;

export function ridgeWidth(period: number) {
  return Math.max(2.4, period * RIDGE_WIDTH_RATIO);
}

export function fontSizeFor(period: number, textScale = 1) {
  return Math.max(6.5, (ridgeWidth(period) / CAP_RATIO) * (textScale || 1));
}

export function wordsOf(lines: string[]) {
  const words = lines.flatMap((line) => line.split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1 || /\d/.test(word)));
  return words.length ? words : ["Always"];
}

/** Names stay whole. Verses are woven between them, in order, and the list repeats. */
export function ridgeWords(names: string[] | undefined, scriptures: string[] | undefined, lines: string[]) {
  const people = (names ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
  const verses = (scriptures ?? []).map((verse) => verse.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!people.length && !verses.length) return wordsOf(lines);
  const verseWords = verses.map((verse) => verse.split(" ").filter(Boolean));
  if (!people.length) return verseWords.flat();
  const tokens: string[] = [];
  let verse = 0;
  people.forEach((name, index) => {
    tokens.push(name);
    if (verseWords.length && index % 2 === 1) {
      tokens.push(...verseWords[verse % verseWords.length]);
      verse += 1;
    }
  });
  if (verseWords.length && people.length === 1) tokens.push(...verseWords[0]);
  return tokens;
}

/** Split a ridge where the text would turn upside down, and point every run so letters stand upright. */
export function uprightRuns(points: Pt[]): Pt[][] {
  if (points.length < 2) return [];
  const limit = (Math.PI * 105) / 180;
  const heading = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const uprightAngle = (angle: number) => Math.abs(angle) <= limit;

  const runs: Pt[][] = [];
  let run: Pt[] = [points[0]];
  let upright = uprightAngle(heading(points[0], points[Math.min(points.length - 1, 3)]));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const next = uprightAngle(heading(a, b));
    if (next !== upright && pathLength(run) > 4) {
      runs.push(upright ? run : run.slice().reverse());
      run = [a];
      upright = next;
    }
    run.push(b);
  }
  if (run.length > 1) runs.push(upright ? run : run.slice().reverse());
  return runs.filter((item) => pathLength(item) > 4);
}

export type PackedRun = { points: Pt[]; text: string };

/**
 * Fill each upright run with whole words. A word that does not fit is left for a later run
 * instead of being cut. The uncovered tail of a ridge is drawn as ink by the caller.
 */
export function packRuns(
  runs: Pt[][],
  words: string[],
  measure: (word: string) => number,
  space: number,
  cursor: { i: number } = { i: 0 },
  ceiling?: number,
): PackedRun[] {
  if (!words.length) return runs.map((points) => ({ points, text: "" }));
  const longest = ceiling ?? runs.reduce((max, points) => Math.max(max, pathLength(points)), 0);
  const packed: PackedRun[] = [];
  for (const points of runs) {
    const length = pathLength(points);
    let used = 2;
    const chosen: string[] = [];
    let guard = 0;
    while (guard++ < words.length + 2) {
      const remain = length - used - 1.5;
      const word = words[cursor.i % words.length];
      const need = (chosen.length ? space : 0) + measure(word);
      if (need <= remain) {
        used += need;
        chosen.push(word);
        cursor.i += 1;
        continue;
      }
      // A token longer than this run waits for a longer one. Drop it only when no run can hold it.
      if (!chosen.length && measure(word) > length - 3 && measure(word) > longest - 3) {
        cursor.i += 1;
        continue;
      }
      break;
    }
    packed.push({ points, text: chosen.join(" ") });
  }
  return packed;
}

export function estimateWordWidth(word: string, fontSize: number, charRatio: number, tracking: number) {
  if (!word) return 0;
  let width = 0;
  let letters = 0;
  for (const ch of word) {
    if (ch === " ") {
      width += fontSize * 0.22;
      continue;
    }
    width += fontSize * charRatio + tracking;
    letters += 1;
  }
  if (letters > 1) width -= tracking;
  return Math.max(fontSize * 0.4, width);
}

export type PlaqueLine = { text: string; fontSize: number; emphasis: boolean };

export type Plaque = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  lines: PlaqueLine[];
  baselines: number[];
};

/** A paper plaque in the core so the dedications stay readable without moving the surrounding ridges. */
export function plaqueFor(ridges: { points: Pt[] }[], style: { centerName?: string; centerDetail?: string; secondaryName?: string; secondaryDetail?: string }, period: number): Plaque | null {
  const lines: PlaqueLine[] = [];
  const primary = style.centerName?.trim();
  const primaryDetail = style.centerDetail?.trim();
  const secondary = style.secondaryName?.trim();
  const secondaryDetail = style.secondaryDetail?.trim();
  if (primary) lines.push({ text: primary, fontSize: period * 2.55, emphasis: true });
  if (primaryDetail) lines.push({ text: primaryDetail, fontSize: period * 1.35, emphasis: false });
  if (secondary) lines.push({ text: secondary, fontSize: period * 1.9, emphasis: true });
  if (secondaryDetail) lines.push({ text: secondaryDetail, fontSize: period * 1.15, emphasis: false });
  if (!lines.length) return null;

  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const ridge of ridges) {
    for (const point of ridge.points) {
      cx += point.x;
      cy += point.y;
      count += 1;
    }
  }
  if (!count) return null;
  cx /= count;
  cy /= count;

  const charRatio = 0.72;
  let maxW = 0;
  let block = 0;
  lines.forEach((line, index) => {
    maxW = Math.max(maxW, estimateWordWidth(line.text, line.fontSize, charRatio, 0));
    block += line.fontSize * 1.05;
    if (index === 1 && lines.length > 2) block += period * 0.85;
    else if (index < lines.length - 1) block += period * 0.28;
  });
  const rx = maxW / 2 + period * 1.15;
  const ry = block / 2 + period * 0.95;
  const baselines: number[] = [];
  let y = cy - block / 2;
  lines.forEach((line, index) => {
    baselines.push(y + line.fontSize * 0.78);
    y += line.fontSize * 1.05;
    if (index === 1 && lines.length > 2) y += period * 0.85;
    else if (index < lines.length - 1) y += period * 0.28;
  });
  return { cx, cy, rx, ry, lines, baselines };
}

export function inPlaque(x: number, y: number, plaque: Plaque, pad = 0) {
  const nx = (x - plaque.cx) / (plaque.rx + pad);
  const ny = (y - plaque.cy) / (plaque.ry + pad);
  return nx * nx + ny * ny < 1;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return `M ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} Z`;
}

export type PlacedGlyph = { text: string; distance: number; advance: number };

/** Distances along a run for each glyph, using exact advances. Stays inside the path. */
export function placeGlyphs(
  text: string,
  length: number,
  advanceOf: (ch: string) => number,
  space: number,
  tracking: number,
) {
  const placed: PlacedGlyph[] = [];
  let dist = 1.2;
  const tokens = text.split(" ");
  for (let t = 0; t < tokens.length; t++) {
    if (t > 0) dist += space;
    for (const ch of tokens[t]) {
      const advance = Math.max(0.4, advanceOf(ch) + tracking);
      if (dist + advance > length - 0.6) return placed;
      placed.push({ text: ch, distance: dist + advance / 2, advance });
      dist += advance;
    }
  }
  return placed;
}

export function poseAt(points: Pt[], distance: number) {
  return pointAtLength(points, distance);
}
