import { pathLength, pointAtLength, slicePath } from "./geometry";
import type { PrintStyle, Pt } from "./types";

/** Ink thickness as a fraction of the ridge period. Valleys stay open at this width. */
export const RIDGE_WIDTH_RATIO = 0.42;

/**
 * No separate ink bridge. The glyphs are the ridge; a heavy stroke under them
 * turns the names into specks on a line.
 */
export const UNDERSTROKE = 0;

/** Cormorant Garamond Regular cap height, the default ridge face, as a fraction of the em. */
const CAP_EM = 0.625;

/**
 * Cap top through the descender for that face, as a fraction of the em.
 * H sits at 0.625 and y reaches −0.281.
 */
const LINE_EM = 0.906;

/** Cap height as a fraction of the print's own ridge spacing. */
export const CAP_RATIO = 0.5;

/** Centerline pitch of the reconstructed field, in line-heights of the ridge type. */
export const PITCH_LINES = 1.4;

/** A body line shorter than this is a fragment and is left off the print. */
export const MIN_BODY_WORDS = 8;

export function ridgeWidth(period: number) {
  return Math.max(2.4, period * RIDGE_WIDTH_RATIO);
}

export function fontSizeFor(period: number, textScale = 1, capEm = CAP_EM) {
  const cap = Math.max(6.5, period * CAP_RATIO);
  return (cap / (capEm || CAP_EM)) * (textScale || 1);
}

/** Height of one line of ridge type, from cap top through the descender. */
export function lineHeightFor(period: number, textScale = 1, capEm = CAP_EM) {
  return fontSizeFor(period, textScale, capEm) * LINE_EM;
}

/** Even centerline spacing: 1.4 times the type's line height. */
export function ridgePitch(period: number, textScale = 1, capEm = CAP_EM) {
  return lineHeightFor(period, textScale, capEm) * PITCH_LINES;
}

/**
 * Seed spacing in units of the print period. Traces settle a little closer than
 * the seed, so the seed is opened until the field lands on the pitch.
 */
export function pitchSep(period = 12) {
  return (ridgePitch(period) / Math.max(period, 1)) * 1.12;
}

export function wordsOf(lines: string[]) {
  const words = lines.flatMap((line) => line.split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1 || /\d/.test(word)));
  return words.length ? words : ["Always"];
}

/** Sits between names, and between a name and a verse. It never appears inside a verse. */
export const RIDGE_DIVIDER = "·";

function verseWords(verse: string) {
  return verse.split(/\s+/).filter(Boolean);
}

/**
 * Names stay whole. Each scripture is one phrase, from the opening quote through
 * the reference, and continues on the next paths in this same order. Those paths
 * are already the neighboring ridges. A name never lands in the middle of a verse.
 * A body line shorter than eight words is left blank, unless it is one complete
 * short verse. Nothing is filled with dots.
 */
export function packBodyRuns(
  runs: Pt[][],
  names: string[],
  verses: string[],
  measure: (word: string, runIndex: number) => number,
  space: number | ((runIndex: number) => number),
  nameCursor: { i: number },
  verseCursor: { i: number },
  _ceiling: number,
): PackedRun[] {
  const packed: PackedRun[] = [];
  const gapFor = (runIndex: number) => (typeof space === "number" ? space : space(runIndex));
  const versesAt = verses.map(verseWords).filter((words) => words.length);
  let verseAt = verseCursor.i;
  let verseWord = 0;
  let namesSinceVerse = 0;
  let owed = versesAt.length ? versesAt.length - (verseAt % versesAt.length) : 0;
  const slotCount = names.map(() => 0);

  const cannotFitFrom = (token: string, from: number) => {
    for (let index = from; index < runs.length; index++) {
      // Same margin place() uses on an empty run (2px lead + 1.5px tail).
      if (measure(token, index) <= pathLength(runs[index]) - 3.5) return false;
    }
    return true;
  };

  const namesRemainFrom = (from: number) =>
    names.some((name, index) => slotCount[index] === 0 && !cannotFitFrom(name, from));

  const takeCount = (runIndex: number, words: string[], from: number) => {
    const length = pathLength(runs[runIndex]);
    const gap = gapFor(runIndex);
    let used = 2;
    let count = 0;
    let wi = from;
    while (wi < words.length) {
      const need = (count ? gap : 0) + measure(words[wi], runIndex);
      if (need > length - used - 1.5) break;
      used += need;
      count += 1;
      wi += 1;
    }
    return count;
  };

  // How many words this run may take so every piece of the verse, including the tail, stays at least MIN_BODY_WORDS.
  const legalTake = (runIndex: number, words: string[], from: number) => {
    const remain = words.length - from;
    if (remain <= 0) return 0;
    const fit = takeCount(runIndex, words, from);
    if (words.length < MIN_BODY_WORDS) return fit >= remain ? remain : 0;
    if (fit >= remain) return remain >= MIN_BODY_WORDS ? remain : 0;
    let take = fit;
    if (remain - take < MIN_BODY_WORDS) take = remain - MIN_BODY_WORDS;
    if (take < MIN_BODY_WORDS || take > fit) return 0;
    return take;
  };

  // The whole verse laid on consecutive runs, each piece at least MIN_BODY_WORDS words.
  const versePlan = (start: number, words: string[]) => {
    if (start >= runs.length) return null;
    if (words.length < MIN_BODY_WORDS) return legalTake(start, words, 0) === words.length ? [words.length] : null;
    const counts: number[] = [];
    let wi = 0;
    let runIndex = start;
    while (wi < words.length) {
      if (runIndex >= runs.length) return null;
      const take = legalTake(runIndex, words, wi);
      if (!take) return null;
      counts.push(take);
      wi += take;
      runIndex += 1;
    }
    return counts;
  };

  const wholeVerse = new Set(versesAt.map((words) => words.join(" ")));
  const acceptable = (text: string) => {
    const count = text.split(/\s+/).filter(Boolean).length;
    if (count >= MIN_BODY_WORDS) return true;
    return count > 0 && wholeVerse.has(text);
  };

  // One full cycle has to land. Extra cycles fill the remaining ridges, with names between verses.
  const sampleGap = gapFor(0);
  const widthOf = (words: string[]) => words.reduce((sum, word, index) => sum + (index ? sampleGap : 0) + measure(word, 0), 0);
  const totalLen = runs.reduce((sum, run) => sum + pathLength(run), 0);
  const cycleLen = versesAt.reduce((sum, words) => sum + widthOf(words) + sampleGap, 0);
  const nameUnit = names.length
    ? names.reduce((sum, name) => sum + measure(name, 0) + sampleGap, 0) / names.length
    : 1;
  const allNamesLen = names.reduce((sum, name) => sum + measure(name, 0) + sampleGap, 0);
  const safeCycle = Math.max(cycleLen, 1);
  const cyclesThatFit = versesAt.length ? Math.max(1, Math.floor(totalLen / safeCycle)) : 1;
  const cyclesThatLeaveNames = versesAt.length ? Math.max(1, Math.floor(Math.max(0, totalLen - allNamesLen) / safeCycle) || 1) : 1;
  const targetCycles = Math.max(1, Math.min(cyclesThatFit, cyclesThatLeaveNames));
  const gapCount = Math.max(1, targetCycles * Math.max(versesAt.length, 1));
  const nameBudget = Math.max(0, totalLen - targetCycles * cycleLen);
  const namesPerGap = names.length ? Math.max(1, Math.round(nameBudget / gapCount / Math.max(nameUnit, 1))) : 0;

  // True when `count` whole verses still fit on consecutive runs from `from` onward.
  const laterHolds = (from: number, count: number) => {
    if (count <= 0) return true;
    let runIndex = from;
    for (let n = 0; n < count; n++) {
      const words = versesAt[(verseAt + n) % versesAt.length];
      const plan = versePlan(runIndex, words);
      if (!plan) return false;
      runIndex += plan.length;
    }
    return true;
  };

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const points = runs[runIndex];
    const length = pathLength(points);
    const gap = gapFor(runIndex);
    let used = 2;
    const parts: string[] = [];
    const place = (token: string) => {
      const need = (parts.length ? gap : 0) + measure(token, runIndex);
      if (need > length - used - 1.5) return false;
      parts.push(token);
      used += need;
      return true;
    };
    const tokensFit = (tokens: string[]) => {
      let trial = used;
      let count = parts.length;
      for (const token of tokens) {
        const need = (count ? gap : 0) + measure(token, runIndex);
        if (need > length - trial - 1.5) return false;
        trial += need;
        count += 1;
      }
      return true;
    };
    const snap = () => ({
      verseAt,
      verseWord,
      owed,
      namesSinceVerse,
      cursor: nameCursor.i,
      slots: slotCount.slice(),
    });
    const restore = (saved: ReturnType<typeof snap>) => {
      verseAt = saved.verseAt;
      verseWord = saved.verseWord;
      owed = saved.owed;
      namesSinceVerse = saved.namesSinceVerse;
      nameCursor.i = saved.cursor;
      saved.slots.forEach((count, index) => {
        slotCount[index] = count;
      });
      parts.splice(0, parts.length);
      used = 2;
    };

    const placeVerseWords = (words: string[], count: number) => {
      for (let i = 0; i < count; i++) {
        if (!place(words[verseWord])) return false;
        verseWord += 1;
      }
      if (verseWord >= words.length) {
        verseWord = 0;
        verseAt += 1;
        owed = Math.max(0, owed - 1);
        namesSinceVerse = 0;
      }
      return true;
    };

    const fillNames = () => {
      if (!names.length) return;
      let guard = 0;
      const room = Math.ceil(length / 8) + names.length + 4;
      while (guard++ < room) {
        const floor = Math.min(...slotCount);
        const next = nameCursor.i % names.length;
        if (slotCount[next] > floor) {
          nameCursor.i += 1;
          continue;
        }
        if (cannotFitFrom(names[next], runIndex)) {
          nameCursor.i += 1;
          if (nameCursor.i > names.length * (runs.length + 2)) break;
          continue;
        }
        const take = (idx: number) => {
          if (!tokensFit([names[idx]])) return false;
          place(names[idx]);
          slotCount[idx] += 1;
          namesSinceVerse += 1;
          if (idx === nameCursor.i % names.length) nameCursor.i += 1;
          return true;
        };
        if (take(next)) continue;
        let filled = false;
        for (let dist = 1; dist < names.length; dist++) {
          const idx = (next + dist) % names.length;
          if (slotCount[idx] !== floor) continue;
          if (take(idx)) {
            filled = true;
            break;
          }
        }
        if (!filled) break;
      }
    };

    const saved = snap();
    const words = versesAt.length ? versesAt[verseAt % versesAt.length] : null;

    if (words && verseWord > 0) {
      const take = legalTake(runIndex, words, verseWord);
      if (!take || !placeVerseWords(words, take)) {
        restore(saved);
        packed.push({ points, text: "" });
        continue;
      }
      if (verseWord === 0) {
        const mid = snap();
        fillNames();
        if (!acceptable(parts.join(" "))) restore(mid);
      }
    } else if (words) {
      const plan = versePlan(runIndex, words);
      const namesRemain = namesRemainFrom(runIndex);
      const mustStart = Boolean(plan && owed > 0 && !laterHolds(runIndex + 1, owed));
      const wantVerse = Boolean(plan && (mustStart || names.length === 0 || (namesSinceVerse >= namesPerGap && !namesRemain)));
      if (wantVerse && plan) {
        placeVerseWords(words, plan[0]);
        if (verseWord === 0) {
          const mid = snap();
          fillNames();
          if (!acceptable(parts.join(" "))) restore(mid);
        }
      } else {
        fillNames();
      }
    } else {
      fillNames();
    }

    const text = parts.join(" ");
    if (!acceptable(text)) {
      restore(saved);
      packed.push({ points, text: "" });
      continue;
    }
    packed.push({ points, text });
  }
  verseCursor.i = verseAt;
  return packed;
}

export function bodySources(names: string[] | undefined, scriptures: string[] | undefined, lines: string[]) {
  const people = (names ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
  const verses = (scriptures ?? []).map((verse) => verse.replace(/\s+/g, " ").trim()).filter(Boolean);
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

export function roleScale(_role: RidgeRole) {
  // Every ridge uses one size. Dedications are the same size as the names;
  // the renderer darkens their ink instead of enlarging them.
  return 1;
}

/**
 * Ridge text does not grow or shrink toward the rim. A short ridge that cannot
 * hold the next word at this size gets a divider, not a smaller font.
 * The rim still darkens by ink, not by type size.
 */
export function edgeTypeScale(_rim: number) {
  return 1;
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

export type PlannedRun = { points: Pt[]; text: string; role: RidgeRole; order: number };

type LoosePath = { points: Pt[]; ridge: number };

function outwardHeading(points: Pt[], end: 0 | 1) {
  if (end === 0) {
    const a = points[0];
    const b = points[Math.min(points.length - 1, 4)];
    const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / len, y: (a.y - b.y) / len };
  }
  const a = points[points.length - 1];
  const b = points[Math.max(0, points.length - 5)];
  const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  return { x: (a.x - b.x) / len, y: (a.y - b.y) / len };
}

/** Join collinear pieces that face each other across a short gap, so a broken arc becomes one path. */
function weldPaths(items: LoosePath[], maxGap: number): LoosePath[] {
  const paths = items.filter((item) => item.points.length > 1).map((item) => ({ points: item.points.slice(), ridge: item.ridge }));
  const tip = (points: Pt[], end: 0 | 1) => (end === 0 ? points[0] : points[points.length - 1]);
  let guard = 0;
  while (guard++ < paths.length + 4) {
    let bestI = -1;
    let bestJ = -1;
    let bestEndI: 0 | 1 = 0;
    let bestEndJ: 0 | 1 = 0;
    let bestD = maxGap;
    for (let i = 0; i < paths.length; i++) {
      for (const endI of [0, 1] as const) {
        const a = tip(paths[i].points, endI);
        const dir = outwardHeading(paths[i].points, endI);
        for (let j = i + 1; j < paths.length; j++) {
          for (const endJ of [0, 1] as const) {
            const b = tip(paths[j].points, endJ);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1.5 || dist >= bestD) continue;
            const ux = dx / dist;
            const uy = dy / dist;
            if (dir.x * ux + dir.y * uy < 0.82) continue;
            const dirJ = outwardHeading(paths[j].points, endJ);
            if (dirJ.x * ux + dirJ.y * uy > -0.5) continue;
            bestD = dist;
            bestI = i;
            bestJ = j;
            bestEndI = endI;
            bestEndJ = endJ;
          }
        }
      }
    }
    if (bestI < 0) break;
    const longer = pathLength(paths[bestI].points) >= pathLength(paths[bestJ].points) ? bestI : bestJ;
    const left = bestEndI === 1 ? paths[bestI].points : paths[bestI].points.slice().reverse();
    const right = bestEndJ === 0 ? paths[bestJ].points : paths[bestJ].points.slice().reverse();
    paths[bestI] = { points: left.concat(right.slice(1)), ridge: paths[longer].ridge };
    paths.splice(bestJ, 1);
  }
  return paths;
}

/** Reading order: start at the core and step to the neighboring path. */
function chainPaths(items: LoosePath[], origin: Pt): LoosePath[] {
  const pending = items.map((item) => ({ ...item, distance: medianDistance(item.points, origin), used: false }));
  if (!pending.length) return [];
  let current = pending.reduce((best, item) => (item.distance < best.distance ? item : best));
  const ordered: LoosePath[] = [];
  current.used = true;
  ordered.push(current);
  while (ordered.length < pending.length) {
    let best: (typeof pending)[number] | null = null;
    let bestScore = Infinity;
    const ends = [current.points[0], current.points[current.points.length - 1]];
    for (const item of pending) {
      if (item.used) continue;
      const tips = [item.points[0], item.points[item.points.length - 1]];
      let near = Infinity;
      for (const a of ends) {
        for (const b of tips) near = Math.min(near, Math.hypot(a.x - b.x, a.y - b.y));
      }
      const score = near + Math.abs(item.distance - current.distance) * 0.45;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best) break;
    best.used = true;
    ordered.push(best);
    current = best;
  }
  return ordered;
}

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
      plans[index].push({ points: slice.points, text: mark.line, role: mark.role, order: mark.role === "core" ? -2 : -1 });
      if (pathLength(slice.head) > period * 0.8) slots.push({ ridge: index, points: slice.head });
      if (pathLength(slice.tail) > period * 0.8) slots.push({ ridge: index, points: slice.tail });
    }
    runs.forEach((run, runIndex) => {
      if (!marked.has(runIndex)) slots.push({ ridge: index, points: run });
    });
  });

  const source = bodySources(style.names, style.scriptures, lines);
  const welded = weldPaths(slots, Math.max(period * 1.5, ridgePitch(period) * 0.85));
  const chained = chainPaths(welded, origin);
  const probe = ["Lord", "bless", "you", "and", "keep", "you", "and", "give"];
  const minLen = probe.reduce((sum, word, index) => sum + (index ? gap : 0) + measure(word, "body"), 0) + 6;
  const neighborLimit = Math.max(36, ridgePitch(period) * 3.2);
  const readable = chained.filter((slot) => pathLength(slot.points) >= minLen);
  const groups: LoosePath[][] = [];
  let group: LoosePath[] = [];
  for (const item of readable) {
    if (group.length) {
      const prev = group[group.length - 1].points;
      const next = item.points;
      const ends = [prev[0], prev[prev.length - 1]];
      const tips = [next[0], next[next.length - 1]];
      let near = Infinity;
      for (const a of ends) for (const b of tips) near = Math.min(near, Math.hypot(a.x - b.x, a.y - b.y));
      if (near > neighborLimit) {
        groups.push(group);
        group = [];
      }
    }
    group.push(item);
  }
  if (group.length) groups.push(group);
  const nameCursor = { i: 0 };
  const verseCursor = { i: 0 };
  let order = 0;
  for (const bodySlots of groups) {
    if (!bodySlots.length) continue;
    const ceiling = bodySlots.reduce((max, slot) => Math.max(max, pathLength(slot.points)), 0);
    const packed = packBodyRuns(
      bodySlots.map((slot) => slot.points),
      source.names,
      source.verses,
      (word) => measure(word, "body"),
      gap,
      nameCursor,
      verseCursor,
      ceiling,
    );
    packed.forEach((run, index) => {
      if (!run.text) return;
      plans[bodySlots[index].ridge].push({ points: run.points, text: run.text, role: "body", order: order++ });
    });
  }
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
