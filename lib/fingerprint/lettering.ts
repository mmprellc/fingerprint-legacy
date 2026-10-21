import { countCrossings, pathLength, pointAtLength, slicePath } from "./geometry";
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

/** Body tracking, in ems. A scale below the default tightens it so a short ridge can hold a whole name line. */
export function bodyTrackingEm(textScale = 1) {
  return (textScale || 1) < 0.98 ? 0.08 : 0.04;
}

/** Space between body words, in ems. Kept in step with the tracking above. */
export function bodyWordGapEm(textScale = 1) {
  return (textScale || 1) < 0.98 ? 0.12 : 0.16;
}

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

/** One centered dot between names. It is not a filler, and it never appears inside a verse or a story. */
export const RIDGE_DIVIDER = "·";

export type RidgeToken = { text: string; name: boolean };

/** Names take the dot. Every other pair of words keeps a single word space, at the same gap. */
export function joinRidgeTokens(parts: RidgeToken[], divider = RIDGE_DIVIDER) {
  let text = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) text += parts[i - 1].name && parts[i].name ? (divider ? ` ${divider} ` : " ") : " ";
    text += parts[i].text;
  }
  return text;
}

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
  once = false,
  progress?: BodyProgress,
  caps?: Map<string, number>,
  divider = RIDGE_DIVIDER,
  hold?: Set<string>,
): PackedRun[] {
  const packed: PackedRun[] = [];
  const gapFor = (runIndex: number) => (typeof space === "number" ? space : space(runIndex));
  const versesAt = verses.map(verseWords).filter((words) => words.length);
  const carried = progress && progress.slotCount.length === names.length ? progress : null;
  let verseAt = carried ? carried.verseAt : verseCursor.i;
  let verseWord = carried ? carried.verseWord : 0;
  let namesSinceVerse = carried ? carried.namesSinceVerse : 0;
  let owed = carried ? carried.owed : versesAt.length ? versesAt.length - (verseAt % versesAt.length) : 0;
  const slotCount = carried ? carried.slotCount : names.map(() => 0);

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
    const count = text.split(/\s+/).filter((word) => word && word !== RIDGE_DIVIDER).length;
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
    const namesDone = !names.length || slotCount.every((count) => count >= 1);
    const versesDone = !versesAt.length || (owed <= 0 && verseWord === 0);
    if (once && namesDone && versesDone) {
      packed.push({ points, text: "" });
      continue;
    }
    const length = pathLength(points);
    const gap = gapFor(runIndex);
    let used = 2;
    const parts: RidgeToken[] = [];
    const leadOf = (name: boolean, previous: RidgeToken | undefined) => {
      if (!previous) return 0;
      if (previous.name && name) return divider ? gap + measure(divider, runIndex) + gap : gap;
      return gap;
    };
    const place = (token: string, name = false) => {
      const need = leadOf(name, parts[parts.length - 1]) + measure(token, runIndex);
      if (need > length - used - 1.5) return false;
      parts.push({ text: token, name });
      used += need;
      return true;
    };
    const tokensFit = (tokens: RidgeToken[]) => {
      let trial = used;
      const shadow = parts.slice();
      for (const token of tokens) {
        const need = leadOf(token.name, shadow[shadow.length - 1]) + measure(token.text, runIndex);
        if (need > length - trial - 1.5) return false;
        trial += need;
        shadow.push(token);
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

    const capOf = (idx: number) => caps?.get(names[idx]) ?? Number.POSITIVE_INFINITY;
    const heldBack = (idx: number) => Boolean(hold?.has(names[idx]) && slotCount[idx] >= 1);
    const fillNames = () => {
      if (!names.length) return;
      let guard = 0;
      const room = Math.ceil(length / 8) + names.length + 4;
      while (guard++ < room) {
        if (once && slotCount.every((count) => count >= 1)) break;
        const floor = Math.min(...slotCount);
        const next = nameCursor.i % names.length;
        if (slotCount[next] > floor || slotCount[next] >= capOf(next) || heldBack(next)) {
          nameCursor.i += 1;
          continue;
        }
        if (cannotFitFrom(names[next], runIndex)) {
          nameCursor.i += 1;
          if (nameCursor.i > names.length * (runs.length + 2)) break;
          continue;
        }
        const take = (idx: number) => {
          if (slotCount[idx] >= capOf(idx) || heldBack(idx)) return false;
          if (!tokensFit([{ text: names[idx], name: true }])) return false;
          place(names[idx], true);
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
        if (!acceptable(joinRidgeTokens(parts, divider))) restore(mid);
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
          if (!acceptable(joinRidgeTokens(parts, divider))) restore(mid);
        }
      } else {
        fillNames();
      }
    } else {
      fillNames();
    }

    const text = joinRidgeTokens(parts, divider);
    if (!acceptable(text)) {
      restore(saved);
      // Eight words will not fit. One complete short verse still may, and that exemption is already the rule.
      const verse = versesAt.length ? versesAt[verseAt % versesAt.length] : null;
      if (verse && verse.length < MIN_BODY_WORDS && verseWord === 0 && legalTake(runIndex, verse, 0) === verse.length) {
        if (placeVerseWords(verse, verse.length) && acceptable(joinRidgeTokens(parts, divider))) {
          packed.push({ points, text: joinRidgeTokens(parts, divider) });
          continue;
        }
        restore(saved);
      }
      packed.push({ points, text: "" });
      continue;
    }
    packed.push({ points, text });
  }
  verseCursor.i = verseAt;
  if (progress) {
    progress.verseAt = verseAt;
    progress.verseWord = verseWord;
    progress.owed = owed;
    progress.slotCount = slotCount;
    progress.namesSinceVerse = namesSinceVerse;
  }
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

export type PackedRun = { points: Pt[]; text: string; line?: boolean };

/** Shared across chain groups so names and verses are listed once before the stories. */
export type BodyProgress = {
  verseAt: number;
  verseWord: number;
  owed: number;
  slotCount: number[];
  namesSinceVerse: number;
};

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

export type RidgeRole = "core" | "secondary" | "body" | "line";

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

/** Lines for the core plaque, in reading order. */
export function plaqueLinesOf(style: PrintStyle) {
  const listed = (style.plaqueLines ?? []).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (listed.length) return listed;
  return [style.centerName, style.centerDetail, style.secondaryName, style.secondaryDetail, style.marriage, style.marriageDate]
    .map((line) => (line ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
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

function sentenceWords(paragraph: string) {
  const sentences = paragraph.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.length ? sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean)) : [paragraph.split(/\s+/).filter(Boolean)];
}

/**
 * Lay words across ridges, filling each ridge up to the last word that fits.
 * A ridge stays at least eight words. The final few words of a story stay
 * together when splitting them would leave a short tail.
 */
function flowWords(
  slots: Pt[][],
  texts: string[],
  start: number,
  words: string[],
  measure: (word: string) => number,
  gap: number,
) {
  const wordsOn = (slotIndex: number) => (texts[slotIndex] ? texts[slotIndex].split(/\s+/).filter(Boolean) : []);
  const fitCount = (slotIndex: number, pending: string[]) => {
    if (slotIndex < 0 || slotIndex >= slots.length) return 0;
    const prior = wordsOn(slotIndex);
    const length = pathLength(slots[slotIndex]);
    let used = 2;
    prior.forEach((word, index) => {
      used += (index ? gap : 0) + measure(word);
    });
    let count = 0;
    for (const word of pending) {
      const need = (prior.length + count ? gap : 0) + measure(word);
      if (used + need > length - 1.5) break;
      used += need;
      count += 1;
    }
    return count;
  };
  const snapshot = texts.slice();
  let slot = start;
  let at = 0;
  let last = -1;
  while (at < words.length && slot < slots.length) {
    const pending = words.slice(at);
    const prior = wordsOn(slot);
    const fit = fitCount(slot, pending);
    const minNew = prior.length >= MIN_BODY_WORDS ? 1 : MIN_BODY_WORDS;
    if (fit < minNew) {
      slot += 1;
      continue;
    }
    let take = Math.min(fit, pending.length);
    const after = pending.length - take;
    if (after > 0 && after < MIN_BODY_WORDS) {
      const shrunk = pending.length - MIN_BODY_WORDS;
      if (shrunk >= 1 && shrunk <= fit && prior.length + shrunk >= MIN_BODY_WORDS) take = shrunk;
      else if (!prior.length) {
        slot += 1;
        continue;
      }
    }
    texts[slot] = prior.concat(pending.slice(0, take)).join(" ");
    at += take;
    last = slot;
    slot += 1;
  }
  if (at < words.length && words.length - at < MIN_BODY_WORDS) {
    const rest = words.slice(at);
    for (let i = last >= 0 ? last : start; i >= start; i--) {
      if (!texts[i]) continue;
      if (fitCount(i, rest) < rest.length) continue;
      texts[i] = wordsOn(i).concat(rest).join(" ");
      at = words.length;
      last = i;
      break;
    }
  }
  if (at < words.length) {
    for (let i = 0; i < texts.length; i++) texts[i] = snapshot[i];
    return { slot: start, placed: 0 };
  }
  let resume = last + 1;
  if (last >= 0 && fitCount(last, Array(MIN_BODY_WORDS).fill("faith")) >= MIN_BODY_WORDS) resume = last;
  return { slot: resume, placed: at };
}

function storyWordsFlat(story: string) {
  return sentenceWords(story).flatMap((sentence) => sentence);
}

/** A short paragraph is repeated until a ridge can hold it as a legal line. */
function repeatWords(words: string[], min: number) {
  const out: string[] = [];
  let guard = 0;
  while (out.length < min && words.length && guard++ < min) out.push(...words);
  return out;
}

function expandedParagraph(story: string) {
  const words = storyWordsFlat(story);
  if (!words.length || words.length >= MIN_BODY_WORDS) return story;
  const copies = Math.ceil(MIN_BODY_WORDS / words.length);
  return Array(copies).fill(story.replace(/\s+/g, " ").trim()).join(" ");
}

function sentenceWordEnds(story: string) {
  const sentences = sentenceWords(story).filter((sentence) => sentence.length);
  const ends: number[] = [];
  let count = 0;
  for (const sentence of sentences) {
    count += sentence.length;
    ends.push(count);
  }
  return ends;
}

/**
 * Lay each story across the ridges that follow the names and verses.
 * A paragraph is used whole. Words continue from one ridge to the next, and a
 * ridge is filled up to the last word that fits. A paragraph that cannot finish
 * is left off.
 */
export function fillStories(
  packed: PackedRun[],
  stories: string[],
  measure: (word: string, runIndex: number) => number,
  gap: number,
  cursor = { next: 0 },
) {
  let lastText = -1;
  packed.forEach((run, index) => {
    if (run.text) lastText = index;
  });
  const open = packed.map((run, index) => ({ run, index })).filter((item) => item.index > lastText && !item.run.text);
  const points = open.map((item) => item.run.points);
  const texts = points.map(() => "");
  const width = (word: string) => measure(word, 0);
  let slot = 0;
  while (cursor.next < stories.length && slot < points.length) {
    const laid = flowWords(points, texts, slot, storyWordsFlat(stories[cursor.next]), width, gap);
    if (!laid.placed) break;
    slot = laid.slot;
    cursor.next += 1;
  }
  open.forEach((item, index) => {
    if (texts[index]) item.run.text = texts[index];
  });
}

/**
 * After the six stories have been set once, repeat them in order on the ridges
 * that are still empty. A paragraph stays whole. The last one may stop after a
 * complete sentence when the ridges run out, and it never stops mid-word.
 */
function cycleStories(
  slots: Pt[][],
  stories: string[],
  measure: (word: string) => number,
  gap: number,
  repeat = true,
) {
  const texts = slots.map(() => "");
  if (!stories.length || !slots.length) return { texts, whole: 0 };
  let slot = 0;
  let storyIndex = 0;
  let guard = 0;
  while (slot < slots.length && guard++ < slots.length * 8 + stories.length) {
    if (!repeat && storyIndex >= stories.length) break;
    const story = stories[storyIndex % stories.length];
    const raw = storyWordsFlat(story);
    // A paragraph under eight words cannot start a ridge. Repeat it until it can,
    // then keep cycling. A long story keeps the original path, including the
    // final sentence ending, so a full family story is unchanged.
    if (raw.length > 0 && raw.length < MIN_BODY_WORDS) {
      const whole = flowWords(slots, texts, slot, repeatWords(raw, MIN_BODY_WORDS), measure, gap);
      if (whole.placed) {
        slot = whole.slot;
        storyIndex += 1;
        continue;
      }
      const expanded = expandedParagraph(story);
      const snapshot = texts.slice();
      const expandedWords = storyWordsFlat(expanded);
      let bestTexts: string[] | null = null;
      let bestSlot = slot;
      for (const end of sentenceWordEnds(expanded)) {
        if (end < MIN_BODY_WORDS) continue;
        for (let i = 0; i < texts.length; i++) texts[i] = snapshot[i];
        const partial = flowWords(slots, texts, slot, expandedWords.slice(0, end), measure, gap);
        if (!partial.placed) continue;
        bestTexts = texts.slice();
        bestSlot = partial.slot;
      }
      if (bestTexts) {
        for (let i = 0; i < texts.length; i++) texts[i] = bestTexts[i];
        slot = bestSlot;
        storyIndex += 1;
        continue;
      }
      for (let i = 0; i < texts.length; i++) texts[i] = snapshot[i];
      let rescued = false;
      for (let attempt = 1; attempt < stories.length; attempt++) {
        const other = stories[(storyIndex + attempt) % stories.length];
        const otherRaw = storyWordsFlat(other);
        const payload = otherRaw.length >= MIN_BODY_WORDS ? otherRaw : repeatWords(otherRaw, MIN_BODY_WORDS);
        const laid = flowWords(slots, texts, slot, payload, measure, gap);
        if (!laid.placed) continue;
        slot = laid.slot;
        storyIndex += attempt + 1;
        rescued = true;
        break;
      }
      if (rescued) continue;
      break;
    }
    const whole = flowWords(slots, texts, slot, raw, measure, gap);
    if (whole.placed) {
      slot = whole.slot;
      storyIndex += 1;
      continue;
    }
    const snapshot = texts.slice();
    const words = raw;
    let bestTexts: string[] | null = null;
    let bestSlot = slot;
    for (const end of sentenceWordEnds(story)) {
      for (let i = 0; i < texts.length; i++) texts[i] = snapshot[i];
      const partial = flowWords(slots, texts, slot, words.slice(0, end), measure, gap);
      if (!partial.placed) break;
      bestTexts = texts.slice();
      bestSlot = partial.slot;
    }
    if (!bestTexts) break;
    for (let i = 0; i < texts.length; i++) texts[i] = bestTexts[i];
    slot = bestSlot;
    break;
  }
  return { texts, whole: storyIndex };
}

function nameWordCount(text: string) {
  return text.split(/\s+/).filter((word) => word && word !== RIDGE_DIVIDER).length;
}

/**
 * Put the names that have not been set yet onto one ridge, repeating the list
 * only far enough to reach eight words. A line that cannot reach eight words is left blank.
 */
function commitNameLine(
  names: string[],
  needed: number[],
  measure: (word: string) => number,
  gap: number,
  length: number,
  caps: Map<string, number>,
  counts: number[],
  mark = RIDGE_DIVIDER,
) {
  const divider = mark ? measure(mark) : 0;
  let used = 2;
  const parts: RidgeToken[] = [];
  const local = counts.slice();
  const still = new Set(needed.filter((index) => (local[index] ?? 0) < 1));
  let cursor = 0;
  let guard = 0;
  const can = (idx: number) => {
    const cap = caps.get(names[idx]) ?? Number.POSITIVE_INFINITY;
    if ((local[idx] ?? 0) >= cap) return false;
    const lead = parts.length ? (mark ? gap + divider + gap : gap) : 0;
    return used + lead + measure(names[idx]) <= length - 1.5;
  };
  const put = (idx: number) => {
    const lead = parts.length ? (mark ? gap + divider + gap : gap) : 0;
    parts.push({ text: names[idx], name: true });
    used += lead + measure(names[idx]);
    local[idx] = (local[idx] ?? 0) + 1;
    still.delete(idx);
    cursor = idx + 1;
  };
  while (guard++ < names.length * 10 + 8) {
    const words = nameWordCount(joinRidgeTokens(parts));
    if (!still.size && words >= MIN_BODY_WORDS) break;
    let picked = -1;
    for (const idx of still) {
      if (!can(idx)) continue;
      picked = idx;
      break;
    }
    if (picked < 0 && words < MIN_BODY_WORDS) {
      for (let dist = 0; dist < names.length; dist++) {
        const idx = (cursor + dist) % names.length;
        if (!can(idx)) continue;
        picked = idx;
        break;
      }
    }
    if (picked < 0) break;
    put(picked);
  }
  const text = joinRidgeTokens(parts, mark);
  if (nameWordCount(text) < MIN_BODY_WORDS) return null;
  if (!needed.some((index) => (local[index] ?? 0) > (counts[index] ?? 0))) return null;
  return { text, counts: local };
}

/** After stories, leftover ridges take another even pass of the names. */
function fillEmptyWithNames(
  texts: string[],
  slots: { points: Pt[] }[],
  names: string[],
  measure: (word: string) => number,
  gap: number,
  caps: Map<string, number>,
  countsIn: number[],
  mark = RIDGE_DIVIDER,
  hold?: Set<string>,
) {
  if (!names.length) return;
  const counts = names.map((_, index) => countsIn[index] ?? 0);
  let cursor = 0;
  const divider = mark ? measure(mark) : 0;
  for (let slot = 0; slot < texts.length; slot++) {
    if (texts[slot]) continue;
    const length = pathLength(slots[slot].points);
    let used = 2;
    const parts: RidgeToken[] = [];
    const local = counts.slice();
    let localCursor = cursor;
    let guard = 0;
    while (guard++ < names.length * 8 + 12) {
      let picked = -1;
      let bestCount = Infinity;
      for (let dist = 0; dist < names.length; dist++) {
        const idx = (localCursor + dist) % names.length;
        const cap = caps.get(names[idx]) ?? Number.POSITIVE_INFINITY;
        if ((local[idx] ?? 0) >= cap) continue;
        if (hold?.has(names[idx]) && (local[idx] ?? 0) >= 1) continue;
        const lead = parts.length ? (mark ? gap + divider + gap : gap) : 0;
        if (used + lead + measure(names[idx]) > length - 1.5) continue;
        if ((local[idx] ?? 0) < bestCount) {
          picked = idx;
          bestCount = local[idx] ?? 0;
        }
      }
      if (picked < 0) break;
      const lead = parts.length ? (mark ? gap + divider + gap : gap) : 0;
      parts.push({ text: names[picked], name: true });
      used += lead + measure(names[picked]);
      local[picked] = (local[picked] ?? 0) + 1;
      localCursor = picked + 1;
    }
    const text = joinRidgeTokens(parts, mark);
    if (nameWordCount(text) < MIN_BODY_WORDS) continue;
    texts[slot] = text;
    local.forEach((count, index) => {
      counts[index] = count;
    });
    cursor = localCursor;
  }
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
  const plaque = plaqueFor(ridges, style, period);
  const clearance = plaque ? plaqueClearance(period, style.textScale || 1) : 0;
  const corePhrase = [cleanLine(style.centerName), cleanLine(style.centerDetail)].filter(Boolean).join(" ");
  const secondaryPhrase = [cleanLine(style.secondaryName), cleanLine(style.secondaryDetail)].filter(Boolean).join(" ");
  // The plaque keeps the six lines. The same dedications also run, bold, on the loops just outside it.
  if (corePhrase) pairs.push({ role: "core", phrase: corePhrase });
  if (secondaryPhrase) pairs.push({ role: "secondary", phrase: secondaryPhrase });

  const origin = printCore(ridges, period);
  const ellipseRadius = (point: Pt) => {
    if (!plaque) return medianDistance([point], origin);
    return Math.hypot((point.x - plaque.cx) / plaque.rx, (point.y - plaque.cy) / plaque.ry);
  };
  const pieceDistance = (points: Pt[]) => {
    if (!plaque) return medianDistance(points, origin);
    const radii: number[] = [];
    for (let i = 0; i < points.length; i += 3) radii.push(ellipseRadius(points[i]));
    if (!radii.length) return Infinity;
    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)];
  };
  const candidates: { index: number; run: number; points: Pt[]; distance: number; length: number }[] = [];
  ridges.forEach((ridge, index) => {
    uprightRuns(ridge.points).forEach((run, runIndex) => {
      const pieces = plaque ? outsidePlaque(run, plaque, clearance) : [run];
      for (const piece of pieces) {
        const length = pathLength(piece);
        if (length < period * 4) continue;
        candidates.push({ index, run: runIndex, points: piece, distance: pieceDistance(piece), length });
      }
    });
  });
  candidates.sort((a, b) => a.distance - b.distance || b.length - a.length);

  const hosting = new Map<number, { role: RidgeRole; line: string; run: number; points: Pt[] }[]>();
  const usedPieces = new Set<Pt[]>();
  let minDistance = -1;
  const ringStep = plaque ? 0.28 : period * 0.35;

  for (const pair of pairs) {
    const need = measure(pair.phrase, pair.role) + 2.6;
    let host: (typeof candidates)[number] | null = null;
    for (const item of candidates) {
      if (usedPieces.has(item.points)) continue;
      if (item.length < need) continue;
      if (minDistance >= 0 && item.distance < minDistance + ringStep) continue;
      host = item;
      break;
    }
    if (!host) continue;
    usedPieces.add(host.points);
    minDistance = host.distance;
    const marks = hosting.get(host.index) ?? [];
    marks.push({ role: pair.role, line: pair.phrase, run: host.run, points: host.points });
    hosting.set(host.index, marks);
  }

  const plans: PlannedRun[][] = ridges.map(() => []);
  const slots: { ridge: number; points: Pt[] }[] = [];
  const samePiece = (a: Pt[], b: Pt[]) => {
    if (a.length < 2 || b.length < 2) return false;
    const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) < 0.75;
    return near(a[0], b[0]) && near(a[a.length - 1], b[b.length - 1]) && Math.abs(pathLength(a) - pathLength(b)) < 1.5;
  };
  const keep = (index: number, points: Pt[]) => {
    const pieces = plaque ? outsidePlaque(points, plaque, clearance) : [points];
    for (const piece of pieces) {
      if (pathLength(piece) > period * 0.8) slots.push({ ridge: index, points: piece });
    }
  };
  ridges.forEach((ridge, index) => {
    const runs = uprightRuns(ridge.points);
    const marks = hosting.get(index) ?? [];
    runs.forEach((run, runIndex) => {
      const owned = marks.filter((mark) => mark.run === runIndex);
      if (!owned.length) {
        keep(index, run);
        return;
      }
      const pieces = plaque ? outsidePlaque(run, plaque, clearance) : [run];
      for (const piece of pieces) {
        const mark = owned.find((item) => samePiece(item.points, piece));
        if (!mark) {
          keep(index, piece);
          continue;
        }
        const slice = centerSlice(piece, measure(mark.line, mark.role));
        if (!slice) {
          plans[index].push({ points: piece, text: mark.line, role: mark.role, order: mark.role === "core" ? -2 : -1 });
          continue;
        }
        plans[index].push({ points: slice.points, text: mark.line, role: mark.role, order: mark.role === "core" ? -2 : -1 });
        if (pathLength(slice.head) > period * 0.8) keep(index, slice.head);
        if (pathLength(slice.tail) > period * 0.8) keep(index, slice.tail);
      }
    });
  });

  const source = bodySources(style.names, style.scriptures, lines);
  let welded = weldPaths(slots, Math.max(period * 1.5, ridgePitch(period) * 0.85));
  if (plaque) {
    welded = welded.flatMap((slot) => outsidePlaque(slot.points, plaque, clearance).map((points) => ({ points, ridge: slot.ridge })));
  }
  const chained = chainPaths(welded, origin);
  const probe = ["Lord", "bless", "you", "and", "keep", "you", "and", "give"];
  const minLen = probe.reduce((sum, word, index) => sum + (index ? gap : 0) + measure(word, "body"), 0) + 6;
  // A complete verse shorter than eight words is already legal. Let it onto a run that can hold it.
  const shortVerse = source.verses
    .map((verse) => verse.split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0 && words.length < MIN_BODY_WORDS);
  const verseFloor = shortVerse.reduce((min, words) => {
    const width = words.reduce((sum, word, index) => sum + (index ? gap : 0) + measure(word, "body"), 0) + 8;
    return Math.min(min, width);
  }, minLen);
  const neighborLimit = Math.max(36, ridgePitch(period) * 3.2);
  const readable = chained.filter((slot) => pathLength(slot.points) >= verseFloor);
  // Only the real pile-ups are cut. Ridges that already clear the 0.8-pitch floor stay whole.
  const tangle = ridgePitch(period) * 0.55;
  const separated: LoosePath[] = [];
  const separatedSamples: Pt[] = [];
  for (const slot of readable) {
    for (const piece of trimAgainst(slot.points, separatedSamples, tangle, verseFloor)) {
      if (crossesKept(piece, separated.map((item) => item.points))) continue;
      separated.push({ points: piece, ridge: slot.ridge });
      separatedSamples.push(...interiorSamples(piece));
    }
  }
  // The loop sits tighter than the outer print. Ease those centerlines apart
  // without deleting a ridge, so the ink they covered stays within reach.
  if (plaque) spreadCore(separated, plaque, period);
  const remnants = chained.filter((slot) => {
    const length = pathLength(slot.points);
    return length >= period * 1.2 && length < verseFloor;
  });
  const groups: LoosePath[][] = [];
  let group: LoosePath[] = [];
  for (const item of separated) {
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
  const nameDivider = style.nameGap === "space" ? "" : RIDGE_DIVIDER;
  const heldNames = new Set((style.nameHold ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean));
  const nameCaps = new Map<string, number>();
  for (const item of style.nameMax ?? []) {
    const name = item.name.replace(/\s+/g, " ").trim();
    if (name) nameCaps.set(name, item.max);
  }
  const stories = (style.stories ?? []).map((story) => story.replace(/\s+/g, " ").trim()).filter(Boolean);
  const progress: BodyProgress | undefined = stories.length
    ? { verseAt: 0, verseWord: 0, owed: source.verses.length, slotCount: source.names.map(() => 0), namesSinceVerse: 0 }
    : undefined;
  let order = 0;
  const placed: { ridge: number; points: Pt[]; text: string }[] = [];
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
      stories.length > 0,
      progress,
      nameCaps,
      nameDivider,
      heldNames,
    );
    packed.forEach((run, index) => {
      placed.push({ ridge: bodySlots[index].ridge, points: run.points, text: run.text });
    });
  }
  const measureBody = (word: string) => measure(word, "body");
  if (progress && source.names.length) {
    let needed = source.names.map((_, index) => index).filter((index) => (progress.slotCount[index] ?? 0) < 1);
    if (needed.length) {
      const empty = placed
        .filter((run) => !run.text)
        .slice()
        .sort((a, b) => pathLength(b.points) - pathLength(a.points));
      for (const run of empty) {
        if (!needed.length) break;
        const line = commitNameLine(source.names, needed, measureBody, gap, pathLength(run.points), nameCaps, progress.slotCount, nameDivider);
        if (!line) continue;
        run.text = line.text;
        progress.slotCount = line.counts;
        needed = needed.filter((index) => (line.counts[index] ?? 0) < 1);
      }
    }
  }
  const kept: Pt[][] = [];
  const keptSamples: Pt[] = [];
  const remember = (points: Pt[]) => {
    kept.push(points);
    keptSamples.push(...interiorSamples(points));
  };
  const usedLength = (text: string) => {
    const words = text.split(/\s+/).filter(Boolean);
    let used = 2;
    words.forEach((word, index) => {
      used += (index ? gap : 0) + measureBody(word);
    });
    return used;
  };
  type StorySlot = { ridge: number; points: Pt[]; placedIndex: number; tail: boolean };
  const storySlots: StorySlot[] = [];
  if (stories.length) {
    placed.forEach((run, index) => {
      if (run.text) return;
      storySlots.push({ ridge: run.ridge, points: run.points, placedIndex: index, tail: false });
    });
    placed.forEach((run, index) => {
      if (!run.text) return;
      const length = pathLength(run.points);
      const used = usedLength(run.text);
      if (used > length - period * 3) return;
      const tail = slicePath(run.points, Math.min(length, used + 2), length);
      if (pathLength(tail) < period * 3) return;
      storySlots.push({ ridge: run.ridge, points: tail, placedIndex: index, tail: true });
    });
  }
  const repeatStories = style.filler !== "names" && style.filler !== "lines";
  const storyCycle = stories.length
    ? cycleStories(storySlots.map((slot) => slot.points), stories, measureBody, gap, repeatStories)
    : { texts: [], whole: 0 };
  const shortStory = stories.some((story) => {
    const count = storyWordsFlat(story).length;
    return count > 0 && count < MIN_BODY_WORDS;
  });
  if (source.names.length && (style.filler === "names" || shortStory || storyCycle.whole < stories.length)) {
    fillEmptyWithNames(
      storyCycle.texts,
      storySlots,
      source.names,
      measureBody,
      gap,
      nameCaps,
      progress?.slotCount ?? source.names.map(() => 0),
      nameDivider,
      heldNames,
    );
  }
  const storiesDone = storyCycle.whole >= stories.length;
  const storyFill = storyCycle.texts;
  const shortened = new Map<number, Pt[]>();
  const filledEmpty = new Set<number>();
  const cyclePlans: { ridge: number; points: Pt[]; text: string }[] = [];
  storySlots.forEach((slot, index) => {
    const text = storyFill[index] ?? "";
    if (!text) return;
    if (slot.tail) {
      const run = placed[slot.placedIndex];
      const length = pathLength(run.points);
      const used = usedLength(run.text);
      const fitted = slicePath(run.points, 0, Math.min(length, used));
      if (fitted.length > 1) shortened.set(slot.placedIndex, fitted);
    } else {
      filledEmpty.add(slot.placedIndex);
    }
    cyclePlans.push({ ridge: slot.ridge, points: slot.points, text });
  });
  const tails: { ridge: number; points: Pt[] }[] = [];
  placed.forEach((run, index) => {
    if (!run.text) return;
    const length = pathLength(run.points);
    const used = usedLength(run.text);
    const points = shortened.get(index) ?? run.points;
    const head = used >= length * 0.82 ? points : slicePath(run.points, 0, Math.min(length, used));
    plans[run.ridge].push({ points, text: run.text, role: "body", order: order++ });
    remember(head.length > 1 ? head : points);
    if (shortened.has(index)) return;
    if (storiesDone && used <= length - period * 3) {
      const tail = slicePath(run.points, Math.min(length, used + 2), length);
      if (pathLength(tail) >= period * 2.4) tails.push({ ridge: run.ridge, points: tail });
      return;
    }
    if (!storiesDone && plaque && used < length - period * 2.4) {
      const tail = slicePath(run.points, Math.min(length, used + 2), length);
      if (pathLength(tail) >= period * 2.4) tails.push({ ridge: run.ridge, points: tail });
    }
  });
  for (const extra of cyclePlans) {
    const length = pathLength(extra.points);
    const used = usedLength(extra.text);
    const head = used >= length * 0.82 ? extra.points : slicePath(extra.points, 0, Math.min(length, used));
    plans[extra.ridge].push({ points: extra.points, text: extra.text, role: "body", order: order++ });
    remember(head.length > 1 ? head : extra.points);
  }
  const rims = rimWeights(ridges);
  const farFromPlaque = (points: Pt[]) => {
    if (!plaque) return true;
    // No drawn line in the inner field. The band around the plaque stays text or paper.
    return points.every((point) => {
      const nx = (point.x - plaque.cx) / plaque.rx;
      const ny = (point.y - plaque.cy) / plaque.ry;
      return nx * nx + ny * ny > 9;
    });
  };
  const textReady = storiesDone || shortStory || style.filler === "lines" || style.filler === "names";
  if (textReady || (stories.length === 0 && plaque)) {
    const leftovers = [
      ...(textReady
        ? [
            ...placed.flatMap((run, index) => (!run.text && !filledEmpty.has(index) ? [{ ridge: run.ridge, points: run.points }] : [])),
            ...tails.map((tail) => ({ ridge: tail.ridge, points: tail.points })),
          ]
        : tails.map((tail) => ({ ridge: tail.ridge, points: tail.points }))),
      ...remnants.map((slot) => ({ ridge: slot.ridge, points: slot.points })),
    ].sort((a, b) => pathLength(b.points) - pathLength(a.points));
    const lineGap = tangle;
    const lineKeep = period * 2.4;
    for (const slot of leftovers) {
      // A drawn line is only for an outer ridge the words could not fill, and never beside the plaque.
      if (textReady && ((rims[slot.ridge] ?? 0) < 0.62 || !farFromPlaque(slot.points))) continue;
      for (const piece of trimAgainst(slot.points, keptSamples, lineGap, lineKeep)) {
        for (const part of trimAgainst(piece, keptSamples, lineGap, lineKeep)) {
          if (crossesKept(part, kept) || !farFromPlaque(part)) continue;
          plans[slot.ridge].push({ points: part, text: "", role: "line", order: order++ });
          remember(part);
        }
      }
    }
  }
  return plans;
}

/** How far a ridge centerline stays outside the plaque, so the letters clear the opening. */
export function plaqueClearance(period: number, textScale = 1) {
  const body = fontSizeFor(period, textScale);
  return Math.max(period * 1.6, body * 1.85);
}

/** Width of a leftover ridge. It matches the stem of the body type, and it is never a heavy stroke. */
export function fallbackWidth(period: number, textScale = 1) {
  const body = fontSizeFor(period, textScale);
  return Math.max(0.9, body * 0.085);
}

function interiorSamples(points: Pt[]) {
  const length = pathLength(points);
  const inset = 0;
  const step = 2;
  const samples: Pt[] = [];
  let walked = 0;
  let next = length <= inset * 2 + 2 ? length / 2 : inset;
  const stop = length <= inset * 2 + 2 ? length / 2 : length - inset;
  for (let i = 1; i < points.length && next <= stop + 0.01; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (next <= walked + seg && next <= stop + 0.01) {
      const t = seg > 0 ? (next - walked) / seg : 0;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      next += step;
      if (length <= inset * 2 + 2) return samples;
    }
    walked += seg;
  }
  if (!samples.length && points.length) samples.push(points[Math.floor(points.length / 2)]);
  return samples;
}

function sampleGrid(samples: Pt[], cell: number) {
  const buckets = new Map<string, Pt[]>();
  for (const point of samples) {
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  return buckets;
}

function nearSamples(buckets: Map<string, Pt[]>, point: Pt, cell: number, minSep: number) {
  const gx = Math.floor(point.x / cell);
  const gy = Math.floor(point.y / cell);
  const window = Math.ceil(minSep / cell);
  const limit = minSep * minSep;
  for (let dy = -window; dy <= window; dy++) {
    for (let dx = -window; dx <= window; dx++) {
      const bucket = buckets.get(`${gx + dx},${gy + dy}`);
      if (!bucket) continue;
      for (const other of bucket) {
        const ddx = other.x - point.x;
        const ddy = other.y - point.y;
        if (ddx * ddx + ddy * ddy < limit) return true;
      }
    }
  }
  return false;
}

/**
 * The ridges around the plaque sit closer together than the outer print.
 * Nudge those centerlines apart, up to a short distance, so the gap matches
 * the outer field. The nudge stays inside the coverage reach, and a ridge is
 * never deleted to buy the space.
 */
function spreadCore(slots: LoosePath[], plaque: Plaque, period: number) {
  if (slots.length < 4) return;
  // Lettering must not move the extracted ridges. Those stay the curvature source.
  for (const slot of slots) slot.points = slot.points.map((point) => ({ x: point.x, y: point.y }));
  const band = 3.3;
  const pitch = ridgePitch(period);
  const radiusOf = (point: Pt) => {
    const nx = (point.x - plaque.cx) / plaque.rx;
    const ny = (point.y - plaque.cy) / plaque.ry;
    return Math.hypot(nx, ny);
  };
  const outward = (point: Pt) => {
    const gx = (point.x - plaque.cx) / (plaque.rx * plaque.rx);
    const gy = (point.y - plaque.cy) / (plaque.ry * plaque.ry);
    const glen = Math.hypot(gx, gy) || 1;
    return { x: gx / glen, y: gy / glen };
  };
  const far = slots.filter((slot) => {
    const radii: number[] = [];
    for (let i = 0; i < slot.points.length; i += 4) radii.push(radiusOf(slot.points[i]));
    if (!radii.length) return false;
    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)] >= 4;
  });
  const outer = medianNearestGap(far.length ? far : slots, pitch * 0.72, pitch * 1.22);
  const target = Math.max(pitch, Math.min(outer || pitch, pitch * 1.18));
  const maxShift = Math.min(pitch * 0.95, 12.5);
  const home = slots.map((slot) => slot.points.map((point) => ({ x: point.x, y: point.y })));
  const cell = 8;
  for (let iter = 0; iter < 8; iter++) {
    const buckets = new Map<string, { x: number; y: number; id: number }[]>();
    slots.forEach((slot, id) => {
      for (let i = 0; i < slot.points.length; i += 3) {
        const point = slot.points[i];
        const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
        const bucket = buckets.get(key);
        const sample = { x: point.x, y: point.y, id };
        if (bucket) bucket.push(sample);
        else buckets.set(key, [sample]);
      }
    });
    slots.forEach((slot, id) => {
      const raw = slot.points.map(() => 0);
      for (let i = 0; i < slot.points.length; i++) {
        const point = slot.points[i];
        if (radiusOf(point) >= band) continue;
        const gx = Math.floor(point.x / cell);
        const gy = Math.floor(point.y / cell);
        let best = Infinity;
        let ox = point.x;
        let oy = point.y;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const bucket = buckets.get(`${gx + dx},${gy + dy}`);
            if (!bucket) continue;
            for (const other of bucket) {
              if (other.id === id) continue;
              const d = Math.hypot(other.x - point.x, other.y - point.y);
              if (d > 0.5 && d < best) {
                best = d;
                ox = other.x;
                oy = other.y;
              }
            }
          }
        }
        if (best >= target || best === Infinity) continue;
        const awayX = (point.x - ox) / best;
        const awayY = (point.y - oy) / best;
        const normal = outward(point);
        const push = Math.min((target - best) * 0.5, 1.6);
        const radius = radiusOf(point);
        const edge = band - 0.85;
        const fade = radius <= edge ? 1 : radius >= band ? 0 : (band - radius) / (band - edge);
        const taper = fade * fade * (3 - 2 * fade);
        raw[i] = (awayX * normal.x + awayY * normal.y) * push * taper;
      }
      const smooth = raw.slice();
      for (let pass = 0; pass < 6; pass++) {
        const next = smooth.slice();
        for (let i = 1; i < smooth.length - 1; i++) {
          next[i] = smooth[i - 1] * 0.25 + smooth[i] * 0.5 + smooth[i + 1] * 0.25;
        }
        for (let i = 0; i < next.length; i++) smooth[i] = next[i];
      }
      for (let i = 0; i < slot.points.length; i++) {
        if (Math.abs(smooth[i]) < 0.01) continue;
        const point = slot.points[i];
        const normal = outward(point);
        let x = point.x + normal.x * smooth[i];
        let y = point.y + normal.y * smooth[i];
        if (radiusOf({ x, y }) < 1.04) continue;
        const origin = home[id][i];
        const shifted = Math.hypot(x - origin.x, y - origin.y);
        if (shifted > maxShift) {
          const scale = maxShift / shifted;
          x = origin.x + (x - origin.x) * scale;
          y = origin.y + (y - origin.y) * scale;
        }
        point.x = x;
        point.y = y;
      }
    });
  }
}

/** Median distance from each sample to the nearest other path. Same-path points do not count. */
function medianNearestGap(slots: { points: Pt[] }[], minGap = 0.5, maxGap = 80) {
  const cell = 8;
  const points: { x: number; y: number; id: number }[] = [];
  slots.forEach((slot, id) => {
    for (let i = 0; i < slot.points.length; i += 4) points.push({ x: slot.points[i].x, y: slot.points[i].y, id });
  });
  if (points.length < 8) return 0;
  const buckets = new Map<string, { x: number; y: number; id: number }[]>();
  for (const point of points) {
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(point);
    else buckets.set(key, [point]);
  }
  const gaps: number[] = [];
  for (const point of points) {
    const gx = Math.floor(point.x / cell);
    const gy = Math.floor(point.y / cell);
    let best = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.id === point.id) continue;
          const d = Math.hypot(other.x - point.x, other.y - point.y);
          if (d > minGap && d < best) best = d;
        }
      }
    }
    if (best <= maxGap) gaps.push(best);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Drop the parts of a path that come inside the 0.8-pitch floor of a path already kept. */
function trimAgainst(points: Pt[], samples: Pt[], minSep: number, minKeep: number) {
  if (pathLength(points) < minKeep) return [];
  if (!samples.length) return [points];
  const cell = Math.max(4, minSep * 0.5);
  const grid = sampleGrid(samples, cell);
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (pathLength(run) >= minKeep) runs.push(run);
    run = [];
  };
  for (const point of points) {
    if (nearSamples(grid, point, cell, minSep)) flush();
    else run.push(point);
  }
  flush();
  return runs;
}

function crossesKept(points: Pt[], kept: Pt[][]) {
  return kept.length > 0 && countCrossings([{ points }, ...kept.map((item) => ({ points: item }))]) > 0;
}


/**
 * A rounded opening on the core, about a fifth of the print width.
 * The names and dates are one bold size, 1.6 times the ridge type, with an even margin.
 */
export function plaqueFor(ridges: { points: Pt[] }[], style: PrintStyle, period: number): Plaque | null {
  if (!style.plaque) return null;
  const raw = plaqueLinesOf(style);
  if (!raw.length || !ridges.length) return null;
  const body = fontSizeFor(period, style.textScale || 1);
  const size = body * 1.6;
  const lines: PlaqueLine[] = raw.map((text) => ({ text, fontSize: size, emphasis: true }));
  const core = printCore(ridges, period);
  const charRatio = 0.68;
  const lead = 1.22;
  let maxW = 0;
  let block = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, estimateWordWidth(line.text, line.fontSize, charRatio, 0));
    block += line.fontSize * lead;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ridge of ridges) {
    for (const point of ridge.points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
    }
  }
  const printW = Math.max(period * 8, maxX - minX);
  const margin = Math.max(size * 0.42, period * 0.75);
  const textRx = maxW / 2 + margin;
  const minRx = (printW * 0.18) / 2;
  const maxRx = (printW * 0.22) / 2;
  let rx = Math.min(maxRx, Math.max(minRx, (printW * 0.2) / 2));
  if (textRx > rx) rx = textRx;
  const side = rx - maxW / 2;
  const ry = block / 2 + side;
  const baselines: number[] = [];
  let y = core.y - block / 2;
  lines.forEach((line) => {
    baselines.push(y + line.fontSize * 0.8);
    y += line.fontSize * lead;
  });
  return { cx: core.x, cy: core.y, rx, ry, lines, baselines };
}

/** Pieces of a ridge that stay outside the plaque, so words do not run through the core. */
export function outsidePlaque(points: Pt[], plaque: Plaque, pad = 1.5): Pt[][] {
  const inside = (point: Pt) => inPlaque(point.x, point.y, plaque, pad);
  const edge = (a: Pt, b: Pt) => {
    let lo = 0;
    let hi = 1;
    const aIn = inside(a);
    for (let step = 0; step < 14; step++) {
      const mid = (lo + hi) / 2;
      const point = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
      if (inside(point) === aIn) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const segments: Pt[][] = [];
  let current: Pt[] = [];
  const flush = () => {
    if (current.length > 1 && pathLength(current) > 4) segments.push(current);
    current = [];
  };
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!inside(point)) {
      if (i > 0 && inside(points[i - 1])) current.push(edge(points[i - 1], point));
      current.push(point);
      continue;
    }
    if (current.length && i > 0 && !inside(points[i - 1])) current.push(edge(points[i - 1], point));
    flush();
  }
  flush();
  return segments;
}

/** A text-weight filled ridge, with no stroke, for the runs left after every word is placed. */
export function ribbonPath(points: Pt[], width: number) {
  if (points.length < 2 || width <= 0) return "";
  const cleaned: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= 0.75) cleaned.push(points[i]);
  }
  if (cleaned.length < 2) return "";
  const half = width / 2;
  const tangent = (a: Pt, b: Pt) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  const push = (point: Pt, dir: { x: number; y: number }) => {
    left.push({ x: point.x - dir.y * half, y: point.y + dir.x * half });
    right.push({ x: point.x + dir.y * half, y: point.y - dir.x * half });
  };
  for (let i = 0; i < cleaned.length; i++) {
    const prev = cleaned[Math.max(0, i - 1)];
    const next = cleaned[Math.min(cleaned.length - 1, i + 1)];
    const incoming = tangent(prev, cleaned[i]);
    const outgoing = tangent(cleaned[i], next);
    if (i > 0 && i < cleaned.length - 1 && incoming.x * outgoing.x + incoming.y * outgoing.y < 0.55) {
      push(cleaned[i], incoming);
      push(cleaned[i], outgoing);
      continue;
    }
    const dx = outgoing.x + incoming.x;
    const dy = outgoing.y + incoming.y;
    const len = Math.hypot(dx, dy);
    push(cleaned[i], len > 1e-3 ? { x: dx / len, y: dy / len } : outgoing);
  }
  if (left.length < 2) return "";
  const ring = [...left, ...right.reverse()];
  return `M ${ring.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")} Z`;
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

/**
 * Distances along a run for each glyph, using exact advances.
 * A word that does not fit entirely is left off, so a ridge never ends mid-word.
 */
export function placeGlyphs(
  text: string,
  length: number,
  advanceOf: (ch: string) => number,
  space: number,
  tracking: number,
) {
  const placed: PlacedGlyph[] = [];
  let dist = 1.2;
  const tokens = text.split(" ").filter((token) => token.length > 0);
  for (let t = 0; t < tokens.length; t++) {
    const advances: number[] = [];
    let width = 0;
    for (const ch of tokens[t]) {
      const advance = Math.max(0.4, advanceOf(ch) + tracking);
      advances.push(advance);
      width += advance;
    }
    const lead = t > 0 ? space : 0;
    if (dist + lead + width > length - 0.6) return placed;
    dist += lead;
    for (let i = 0; i < tokens[t].length; i++) {
      const advance = advances[i];
      placed.push({ text: tokens[t][i], distance: dist + advance / 2, advance });
      dist += advance;
    }
  }
  return placed;
}

export function poseAt(points: Pt[], distance: number) {
  return pointAtLength(points, distance);
}
