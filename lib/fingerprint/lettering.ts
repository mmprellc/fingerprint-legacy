import { pathLength, pointAtLength, slicePath } from "./geometry";
import type { PrintStyle, Pt } from "./types";

/** Ink thickness as a fraction of the ridge period. Valleys stay open at this width. */
export const RIDGE_WIDTH_RATIO = 0.42;

/**
 * No separate ink bridge. The glyphs are the ridge; a heavy stroke under them
 * turns the names into specks on a line.
 */
export const UNDERSTROKE = 0;

/** Libre Baskerville Bold cap height, as a fraction of the em. */
const CAP_EM = 0.77;

export function ridgeWidth(period: number) {
  return Math.max(2.4, period * RIDGE_WIDTH_RATIO);
}

export function fontSizeFor(period: number, textScale = 1) {
  // Cap height stays inside 60–70% of the measured ridge spacing so neighboring
  // lines of type cannot meet.
  const cap = Math.max(6.5, period * 0.64);
  return (cap / CAP_EM) * (textScale || 1);
}

export function wordsOf(lines: string[]) {
  const words = lines.flatMap((line) => line.split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1 || /\d/.test(word)));
  return words.length ? words : ["Always"];
}

/**
 * One name leads a ridge when it fits, then scripture fills the rest.
 * Names stay whole and cycle in order, so a later name is not buried behind a verse.
 * Verses repeat, in order, wherever a ridge still has room.
 */
export function packBodyRuns(
  runs: Pt[][],
  names: string[],
  verses: string[],
  measure: (word: string, runIndex: number) => number,
  space: number | ((runIndex: number) => number),
  nameCursor: { i: number },
  verseCursor: { i: number },
  ceiling: number,
): PackedRun[] {
  const packed: PackedRun[] = [];
  const gapFor = (runIndex: number) => (typeof space === "number" ? space : space(runIndex));
  const cannotFit = (word: string) => {
    let best = 0;
    runs.forEach((points, index) => {
      best = Math.max(best, pathLength(points) - measure(word, index));
    });
    return best < 3 && best < ceiling;
  };
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const points = runs[runIndex];
    const length = pathLength(points);
    const gap = gapFor(runIndex);
    let used = 2;
    const chosen: string[] = [];
    const place = (word: string) => {
      const need = (chosen.length ? gap : 0) + measure(word, runIndex);
      if (need > length - used - 1.5) return false;
      chosen.push(word);
      used += need;
      return true;
    };
    if (names.length) {
      const name = names[nameCursor.i % names.length];
      if (cannotFit(name)) nameCursor.i += 1;
      else if (place(name)) nameCursor.i += 1;
    }
    const filler = verses.length ? verses : names;
    const cursor = verses.length ? verseCursor : nameCursor;
    if (filler.length) {
      let guard = 0;
      while (guard++ < filler.length + 2) {
        const word = filler[cursor.i % filler.length];
        if (!place(word)) break;
        cursor.i += 1;
      }
    }
    packed.push({ points, text: chosen.join(" ") });
  }
  return packed;
}

export function bodySources(names: string[] | undefined, scriptures: string[] | undefined, lines: string[]) {
  const people = (names ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
  const verses = (scriptures ?? []).flatMap((verse) => verse.replace(/\s+/g, " ").trim().split(" ").filter(Boolean));
  if (!people.length && !verses.length) return { names: [] as string[], verses: wordsOf(lines) };
  return { names: people, verses };
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

export type RidgeRole = "core" | "secondary" | "body";

function medianDistance(points: Pt[], origin: Pt) {
  if (!points.length) return Infinity;
  const dists = points.map((point) => Math.hypot(point.x - origin.x, point.y - origin.y));
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)];
}

/** The loop center, taken from the long ridges so a short kink cannot pull it aside. */
export function printCore(ridges: { points: Pt[] }[], period: number): Pt {
  const long = ridges.filter((ridge) => pathLength(ridge.points) >= period * 6);
  const source = long.length >= 4 ? long : ridges;
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const ridge of source) {
    for (const point of ridge.points) {
      cx += point.x;
      cy += point.y;
      n++;
    }
  }
  if (!n) return { x: 0, y: 0 };
  cx /= n;
  cy /= n;
  const scored: { x: number; y: number; score: number }[] = [];
  for (const ridge of source) {
    const pts = ridge.points;
    for (let i = 2; i < pts.length - 2; i += 2) {
      const a = pts[i - 2];
      const b = pts[i];
      const c = pts[i + 2];
      const dist = Math.hypot(b.x - cx, b.y - cy);
      if (dist > period * 7) continue;
      const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
      const ang2 = Math.atan2(c.y - b.y, c.x - b.x);
      const turn = Math.abs(Math.atan2(Math.sin(ang2 - ang1), Math.cos(ang2 - ang1)));
      scored.push({ x: b.x, y: b.y, score: turn / (period * 0.4 + dist) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const take = scored.slice(0, Math.max(10, Math.floor(scored.length * 0.12)));
  if (!take.length) return { x: cx, y: cy };
  let x = 0;
  let y = 0;
  for (const point of take) {
    x += point.x;
    y += point.y;
  }
  return { x: x / take.length, y: y / take.length };
}

/**
 * Innermost ridges carry the center dedication. The next ring carries the
 * secondary dedication. Everything farther out carries the names and verses.
 */
export function classifyRidges(ridges: { points: Pt[] }[], period: number): RidgeRole[] {
  const core = printCore(ridges, period);
  const roles: RidgeRole[] = ridges.map(() => "body");
  const ranked = ridges
    .map((ridge, index) => ({
      index,
      length: pathLength(ridge.points),
      distance: medianDistance(ridge.points, core),
    }))
    .filter((item) => item.length >= period * 6)
    .sort((a, b) => a.distance - b.distance || b.length - a.length);
  const coreCount = Math.min(4, ranked.length);
  const secondaryCount = Math.min(5, Math.max(0, ranked.length - coreCount));
  for (let i = 0; i < coreCount; i++) roles[ranked[i].index] = "core";
  for (let i = 0; i < secondaryCount; i++) roles[ranked[coreCount + i].index] = "secondary";
  return roles;
}

export function dedicationWords(style: PrintStyle, role: "core" | "secondary") {
  const pair = role === "core" ? [style.centerName, style.centerDetail] : [style.secondaryName, style.secondaryDetail];
  return pair.map((line) => (line ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function roleScale(role: RidgeRole) {
  // Dedications sit slightly larger, still inside 70% of the ridge period.
  if (role === "core") return 1.08;
  if (role === "secondary") return 1.05;
  return 1;
}

/**
 * Body type grows toward the outer rim so the silhouette reads darker from
 * across the room. 0.64 × 1.09 stays inside 70% of the ridge period.
 * Density comes from the letters themselves, never from a stroke under them.
 */
export function edgeTypeScale(rim: number) {
  const t = Math.max(0, Math.min(1, rim));
  return 1 + t * 0.09;
}

/** 0 in the interior, 1 on the outer rim, so the oval reads from across the room. */
export function rimWeights(ridges: { points: Pt[] }[]): number[] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ridge of ridges) {
    for (let i = 0; i < ridge.points.length; i += 3) {
      sx += ridge.points[i].x;
      sy += ridge.points[i].y;
      n++;
    }
  }
  if (!n) return ridges.map(() => 0);
  const cx = sx / n;
  const cy = sy / n;
  const bins = 72;
  const rad = new Float32Array(bins);
  for (const ridge of ridges) {
    for (const point of ridge.points) {
      const ang = Math.atan2(point.y - cy, point.x - cx);
      const bin = Math.round(((ang + Math.PI) / (Math.PI * 2)) * bins) % bins;
      const r = Math.hypot(point.x - cx, point.y - cy);
      if (r > rad[bin]) rad[bin] = r;
    }
  }
  return ridges.map((ridge) => {
    const samples: number[] = [];
    for (let i = 0; i < ridge.points.length; i += 2) {
      const point = ridge.points[i];
      const ang = Math.atan2(point.y - cy, point.x - cx);
      const bin = Math.round(((ang + Math.PI) / (Math.PI * 2)) * bins) % bins;
      const limit = Math.max(rad[bin], rad[(bin + 1) % bins], rad[(bin + bins - 1) % bins], 1);
      samples.push(Math.hypot(point.x - cx, point.y - cy) / limit);
    }
    if (!samples.length) return 0;
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    return Math.max(0, Math.min(1, (median - 0.74) / 0.2));
  });
}

export type PlannedRun = { points: Pt[]; text: string; role: RidgeRole };

function cleanLine(text: string | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Keep a phrase in the middle of a run and return the unused ends. */
function centerSlice(points: Pt[], textWidth: number) {
  const length = pathLength(points);
  const sliceLen = textWidth + 2.6;
  if (sliceLen > length - 0.5) return null;
  const start = (length - sliceLen) / 2;
  const end = start + sliceLen;
  const pointsMid = slicePath(points, start, end);
  if (pathLength(pointsMid) < textWidth + 1.4) return null;
  const head = start > 10 ? slicePath(points, 0, Math.max(0, start - 2)) : [];
  const tail = length - end > 10 ? slicePath(points, Math.min(length, end + 2), length) : [];
  return { points: pointsMid, head, tail };
}

/**
 * Each dedication is one phrase on one ridge: the name and date stay together.
 * Names and verses fill every other run, including the unused ends of a dedication ridge.
 */
export function planPortrait(
  ridges: { points: Pt[] }[],
  style: PrintStyle,
  lines: string[],
  period: number,
  measure: (word: string, role: RidgeRole) => number,
  gap: number,
  bodyScale?: number[],
): PlannedRun[][] {
  const pairs: { role: "core" | "secondary"; phrase: string }[] = [];
  const corePhrase = [cleanLine(style.centerName), cleanLine(style.centerDetail)].filter(Boolean).join(" ");
  const secondaryPhrase = [cleanLine(style.secondaryName), cleanLine(style.secondaryDetail)].filter(Boolean).join(" ");
  if (corePhrase) pairs.push({ role: "core", phrase: corePhrase });
  if (secondaryPhrase) pairs.push({ role: "secondary", phrase: secondaryPhrase });

  const origin = printCore(ridges, period);
  const ranked = ridges
    .map((ridge, index) => ({
      index,
      distance: medianDistance(ridge.points, origin),
      length: pathLength(ridge.points),
    }))
    .filter((item) => item.length >= period * 4)
    .sort((a, b) => a.distance - b.distance || b.length - a.length);

  const hosting = new Map<number, { role: RidgeRole; line: string; run: number }[]>();
  const usedRidges = new Set<number>();
  let minDistance = -1;

  for (const pair of pairs) {
    const need = measure(pair.phrase, pair.role) + 2.6;
    let host = -1;
    let runIndex = -1;
    let hostDistance = Infinity;
    for (const item of ranked) {
      if (usedRidges.has(item.index)) continue;
      if (minDistance >= 0 && item.distance < minDistance - period * 0.25) continue;
      const runs = uprightRuns(ridges[item.index].points);
      let best = -1;
      let bestLen = 0;
      runs.forEach((run, index) => {
        const len = pathLength(run);
        if (len >= need && len > bestLen) {
          best = index;
          bestLen = len;
        }
      });
      if (best < 0) continue;
      host = item.index;
      runIndex = best;
      hostDistance = item.distance;
      break;
    }
    if (host < 0) continue;
    usedRidges.add(host);
    minDistance = hostDistance;
    hosting.set(host, [{ role: pair.role, line: pair.phrase, run: runIndex }]);
  }

  const plans: PlannedRun[][] = ridges.map(() => []);
  const slots: { ridge: number; points: Pt[] }[] = [];
  ridges.forEach((ridge, index) => {
    const runs = uprightRuns(ridge.points);
    const marks = hosting.get(index) ?? [];
    const marked = new Set(marks.map((mark) => mark.run));
    for (const mark of marks) {
      const slice = centerSlice(runs[mark.run], measure(mark.line, mark.role));
      if (!slice) {
        slots.push({ ridge: index, points: runs[mark.run] });
        continue;
      }
      plans[index].push({ points: slice.points, text: mark.line, role: mark.role });
      if (pathLength(slice.head) > period * 1.4) slots.push({ ridge: index, points: slice.head });
      if (pathLength(slice.tail) > period * 1.4) slots.push({ ridge: index, points: slice.tail });
    }
    runs.forEach((run, runIndex) => {
      if (!marked.has(runIndex)) slots.push({ ridge: index, points: run });
    });
  });

  const source = bodySources(style.names, style.scriptures, lines);
  const ceiling = slots.reduce((max, slot) => Math.max(max, pathLength(slot.points)), 0);
  const scaleOf = (runIndex: number) => {
    const scale = bodyScale?.[slots[runIndex]?.ridge ?? 0] ?? 1;
    return scale > 0 ? scale : 1;
  };
  const packed = packBodyRuns(
    slots.map((slot) => slot.points),
    source.names,
    source.verses,
    (word, runIndex) => measure(word, "body") * scaleOf(runIndex),
    (runIndex) => gap * scaleOf(runIndex),
    { i: 0 },
    { i: 0 },
    ceiling,
  );
  packed.forEach((run, index) => {
    if (!run.text) return;
    plans[slots[index].ridge].push({ points: run.points, text: run.text, role: "body" });
  });
  return plans;
}

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
