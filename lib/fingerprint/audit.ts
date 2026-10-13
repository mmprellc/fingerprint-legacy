import { loadRidgeFace, ridgeCaseReport } from "./glyphs";
import { CAP_RATIO, edgeTypeScale, fontSizeFor, MIN_BODY_WORDS, ridgePitch, RIDGE_DIVIDER, roleScale, type RidgeRole } from "./lettering";
import { fontById } from "./preview";
import type { PrintStyle, Pt } from "./types";

export type Check = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

const CAP_FLOOR = 6.5;

function countOf(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function phrase(name: string | undefined, detail: string | undefined) {
  return [name, detail]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/** Cap height in working pixels. The floor is the same one the lettering uses. */
export function capHeight(period: number, textScale = 1) {
  return Math.max(CAP_FLOOR, period * CAP_RATIO) * (textScale || 1);
}

/**
 * Checks the rendered word portrait: no drawn strokes, dedications once and
 * whole, every listed name present, and type large enough to read.
 */
export function auditLayout(svg: string, style: PrintStyle, period: number): Check[] {
  const checks: Check[] = [];
  const stroked = /stroke\s*=/.test(svg);
  checks.push({
    id: "no-strokes",
    label: "No stroke lines",
    passed: !stroked,
    detail: stroked ? "A drawn stroke is still in the portrait." : "The ridges are text only.",
  });

  const cap = capHeight(period, style.textScale || 1);
  checks.push({
    id: "legible",
    label: "Legible text size",
    passed: cap >= CAP_FLOOR - 0.05,
    detail: `Cap height is ${cap.toFixed(1)}px at this ridge spacing.`,
  });

  const dedications: { id: string; label: string; text: string }[] = [
    { id: "dedication-core", label: "Core dedication", text: phrase(style.centerName, style.centerDetail) },
    { id: "dedication-secondary", label: "Secondary dedication", text: phrase(style.secondaryName, style.secondaryDetail) },
  ];
  for (const item of dedications) {
    if (!item.text) continue;
    const count = countOf(svg, item.text);
    checks.push({
      id: item.id,
      label: item.label,
      passed: count === 1,
      detail: count === 1 ? `${item.text} sits together once.` : `${item.text} appears ${count} times.`,
    });
  }

  const scriptures = (style.scriptures ?? []).map((verse) => verse.replace(/\s+/g, " ").trim()).filter(Boolean);
  const names = (style.names ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (scriptures.length) {
    const verdict = versesInOrder(bodyRunTexts(svg), scriptures, names);
    checks.push({
      id: "verses",
      label: "Whole verses",
      passed: verdict.ok,
      detail: verdict.detail,
    });
  }

  if (names.length) {
    const missing: string[] = [];
    const seen = new Map<string, number>();
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
    for (const [name, needed] of seen) {
      const found = countOf(svg, name);
      if (found < needed) missing.push(name);
    }
    checks.push({
      id: "names",
      label: "Every name",
      passed: missing.length === 0,
      detail: missing.length ? `Missing ${missing.slice(0, 4).join(", ")}.` : `All ${seen.size} names are on the ridges.`,
    });
    const spread = nameSpread(bodyRunTexts(svg), names);
    checks.push(spread);
  }
  checks.push(uniformSize(svg));
  checks.push(sourceCase(svg, style));
  checks.push(letterCase(style, period));
  checks.push(noFillers(svg));
  const body = bodyRuns(svg);
  checks.push(minSegment(body.map((run) => run.text), scriptures));
  if (scriptures.length) checks.push(verseContinuity(body, scriptures, names, period));
  return checks;
}

const ROLES: RidgeRole[] = ["body", "core", "secondary"];

/** Every ridge, including the dedications, is set at the same size. */
function uniformSize(svg: string): Check {
  const sizes: number[] = [];
  const re = /<text\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    if (!/\bridge\b/.test(match[1])) continue;
    const size = match[1].match(/\bfont-size="([\d.]+)"/);
    if (!size) {
      return { id: "uniform-size", label: "One type size", passed: false, detail: "A ridge is missing its font size." };
    }
    sizes.push(Number(size[1]));
  }
  const drifted = ROLES.some((role) => roleScale(role) !== 1) || edgeTypeScale(0) !== 1 || edgeTypeScale(1) !== 1;
  if (drifted) {
    return {
      id: "uniform-size",
      label: "One type size",
      passed: false,
      detail: "Ridge type is still scaled by role or by position on the print.",
    };
  }
  if (!sizes.length) {
    return { id: "uniform-size", label: "One type size", passed: true, detail: "No ridge text to size." };
  }
  const first = sizes[0];
  const off = sizes.find((size) => Math.abs(size - first) > 0.02);
  if (off !== undefined) {
    return {
      id: "uniform-size",
      label: "One type size",
      passed: false,
      detail: `Ridge text uses ${first.toFixed(2)}px and ${off.toFixed(2)}px.`,
    };
  }
  return {
    id: "uniform-size",
    label: "One type size",
    passed: true,
    detail: `Every ridge is ${first.toFixed(2)}px.`,
  };
}

function addTokens(exact: Set<string>, folded: Map<string, Set<string>>, text: string) {
  for (const word of text.split(/\s+/)) {
    if (!word || word === RIDGE_DIVIDER) continue;
    exact.add(word);
    const key = word.toLocaleLowerCase();
    const forms = folded.get(key);
    if (forms) forms.add(word);
    else folded.set(key, new Set([word]));
  }
}

/**
 * Ridge words must be the source text, including case. A word that only matches
 * after ignoring case is a capitalization change, not a different word.
 */
function sourceCase(svg: string, style: PrintStyle): Check {
  const exact = new Set<string>();
  const folded = new Map<string, Set<string>>();
  for (const verse of style.scriptures ?? []) addTokens(exact, folded, verse);
  for (const name of style.names ?? []) addTokens(exact, folded, name);
  addTokens(exact, folded, phrase(style.centerName, style.centerDetail));
  addTokens(exact, folded, phrase(style.secondaryName, style.secondaryDetail));

  for (const word of ridgeWords(svg)) {
    if (word === RIDGE_DIVIDER || exact.has(word)) continue;
    const forms = folded.get(word.toLocaleLowerCase());
    if (forms && forms.size) {
      const written = [...forms].map((form) => `“${form}”`).join(" or ");
      return {
        id: "source-case",
        label: "Source capitalization",
        passed: false,
        detail: `“${word}” should be ${written}, as written in the source.`,
      };
    }
    return {
      id: "source-case",
      label: "Source capitalization",
      passed: false,
      detail: `“${word}” is not in the source text.`,
    };
  }
  return {
    id: "source-case",
    label: "Source capitalization",
    passed: true,
    detail: "Ridge words keep the capitalization of the source.",
  };
}

function ridgeWords(svg: string) {
  return ridgeRunTexts(svg).flatMap((text) => text.split(/\s+/).filter(Boolean));
}

function ridgeRunTexts(svg: string) {
  const texts: string[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    if (!/\bridge\b/.test(match[1])) continue;
    const path = match[2].match(/<textPath\b[^>]*>([\s\S]*?)<\/textPath>/);
    const raw = decodeXml(path ? path[1] : match[2]).replace(/\s+/g, " ").trim();
    if (raw) texts.push(raw);
  }
  return texts;
}

/** Short ridges stay blank. A dot, or a ridge of only dots, is filler. */
function noFillers(svg: string): Check {
  const runs = ridgeRunTexts(svg);
  const dotted = runs.filter((text) => text.split(/\s+/).some((word) => word === RIDGE_DIVIDER));
  if (dotted.length) {
    return {
      id: "no-fillers",
      label: "No filler fragments",
      passed: false,
      detail: `${dotted.length} ridges are filled with a divider instead of a name or a verse.`,
    };
  }
  return {
    id: "no-fillers",
    label: "No filler fragments",
    passed: true,
    detail: "Short ridges are left blank. Nothing is filled with dots.",
  };
}

function letterCase(style: PrintStyle, period: number): Check {
  const face = loadRidgeFace(fontById(style.font).file);
  const report = ridgeCaseReport(face, fontSizeFor(period, style.textScale || 1, fontById(style.font).capEm));
  return {
    id: "letter-case",
    label: "Distinct lowercase",
    passed: report.ok,
    detail: report.detail,
  };
}

function decodeXml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

type BodyRun = { text: string; start: Pt | null; end: Pt | null };

function pathEnds(d: string): { start: Pt; end: Pt } | null {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 4) return null;
  const values = nums.map(Number);
  return {
    start: { x: values[0], y: values[1] },
    end: { x: values[values.length - 2], y: values[values.length - 1] },
  };
}

function bodyRuns(svg: string): BodyRun[] {
  const paths = new Map<string, string>();
  const pathRe = /<path\b([^>]*)\/?>/g;
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = pathRe.exec(svg))) {
    const id = pathMatch[1].match(/\bid="([^"]+)"/);
    const d = pathMatch[1].match(/\bd="([^"]+)"/);
    if (id && d) paths.set(id[1], d[1]);
  }
  const runs: BodyRun[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    if (!/\bridge-body\b/.test(match[1])) continue;
    const path = match[2].match(/<textPath\b([^>]*)>([\s\S]*?)<\/textPath>/);
    const raw = decodeXml(path ? path[2] : match[2]).replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const href = path?.[1].match(/\bhref="#([^"]+)"/);
    const ends = href ? pathEnds(paths.get(href[1]) ?? "") : null;
    runs.push({ text: raw, start: ends?.start ?? null, end: ends?.end ?? null });
  }
  return runs;
}

function bodyRunTexts(svg: string) {
  return bodyRuns(svg).map((run) => run.text);
}

/** A body line must carry a real run of words. A complete short verse may stand alone. */
function minSegment(runs: string[], scriptures: string[]): Check {
  const wholes = new Set(scriptures.map((verse) => verse.replace(/\s+/g, " ").trim()));
  const short = runs.filter((text) => {
    const words = wordsOfText(text);
    if (!words.length || words.length >= MIN_BODY_WORDS) return false;
    return !wholes.has(text);
  });
  if (short.length) {
    const sample = short[0].length > 48 ? `${short[0].slice(0, 48)}…` : short[0];
    return {
      id: "min-segment",
      label: "Minimum line length",
      passed: false,
      detail: `“${sample}” is shorter than ${MIN_BODY_WORDS} words.`,
    };
  }
  return {
    id: "min-segment",
    label: "Minimum line length",
    passed: true,
    detail: `Every body line is at least ${MIN_BODY_WORDS} words, or one complete short verse.`,
  };
}

function endGap(a: BodyRun, b: BodyRun) {
  if (!a.start || !a.end || !b.start || !b.end) return 0;
  return Math.min(
    Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y),
    Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y),
    Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y),
    Math.hypot(a.start.x - b.end.x, a.start.y - b.end.y),
  );
}

/**
 * Each verse stays whole, and the ridges that carry it are neighbors.
 * A phrase that jumps across the oval fails even if the words are in order.
 */
function verseContinuity(runs: BodyRun[], scriptures: string[], names: string[], period: number): Check {
  const order = versesInOrder(
    runs.map((run) => run.text),
    scriptures,
    names,
  );
  if (!order.ok) return { id: "verse-continuity", label: "Verse continuity", passed: false, detail: order.detail };

  const verses = scriptures.map((verse) => verse.split(/\s+/).filter(Boolean));
  const words: { word: string; run: number }[] = [];
  runs.forEach((run, runIndex) => {
    for (const word of wordsOfText(run.text)) words.push({ word, run: runIndex });
  });
  const matchesAt = (index: number, seq: string[]) => {
    if (index + seq.length > words.length) return false;
    return seq.every((word, offset) => words[index + offset].word === word);
  };
  const nameSeqs = names
    .map((name) => name.split(/\s+/).filter(Boolean))
    .filter((seq) => seq.length)
    .sort((a, b) => b.length - a.length);
  const limit = Math.max(ridgePitch(period) * 3.3, 36);
  let index = 0;
  let verseAt = 0;
  while (index < words.length && verseAt < verses.length * 8) {
    const expected = verses[verseAt % verses.length];
    if (matchesAt(index, expected)) {
      const first = words[index].run;
      const last = words[index + expected.length - 1].run;
      for (let runIndex = first; runIndex < last; runIndex++) {
        const gap = endGap(runs[runIndex], runs[runIndex + 1]);
        if (gap > limit) {
          return {
            id: "verse-continuity",
            label: "Verse continuity",
            passed: false,
            detail: `A verse jumps ${Math.round(gap)}px between ridges instead of continuing on the next line.`,
          };
        }
      }
      verseAt += 1;
      index += expected.length;
      continue;
    }
    const name = nameSeqs.find((seq) => matchesAt(index, seq));
    if (name) {
      index += name.length;
      continue;
    }
    break;
  }
  return {
    id: "verse-continuity",
    label: "Verse continuity",
    passed: true,
    detail: "Each verse continues along neighboring ridges.",
  };
}

function wordsOfText(text: string) {
  return text.split(/\s+/).filter((word) => word && word !== RIDGE_DIVIDER);
}

/**
 * Body text, in ridge order, must contain each scripture as a complete phrase,
 * opening quote through the reference, repeating in the listed order.
 * A name between the words, or a start in the middle of a verse, fails.
 */
function versesInOrder(runs: string[], scriptures: string[], names: string[]) {
  const verses = scriptures.map((verse) => verse.split(/\s+/).filter(Boolean));
  const nameSeqs = names
    .map((name) => name.split(/\s+/).filter(Boolean))
    .filter((words) => words.length)
    .sort((a, b) => b.length - a.length);
  const words = runs.flatMap(wordsOfText);
  if (!words.length) return { ok: false, detail: "No verse text was placed on the ridges." };

  const matchesAt = (index: number, seq: string[]) => {
    if (index + seq.length > words.length) return false;
    return seq.every((word, offset) => words[index + offset] === word);
  };

  let index = 0;
  let verseAt = 0;
  const finished: number[] = [];
  while (index < words.length) {
    const expected = verses[verseAt % verses.length];
    if (matchesAt(index, expected)) {
      finished.push(verseAt % verses.length);
      verseAt += 1;
      index += expected.length;
      continue;
    }
    const name = nameSeqs.find((seq) => matchesAt(index, seq));
    if (name) {
      index += name.length;
      continue;
    }
    if (words[index] === expected[0]) {
      return { ok: false, detail: `“${expected[0]}…” is interrupted before ${expected[expected.length - 1]}.` };
    }
    if (verses.some((verse) => verse.slice(1).includes(words[index]))) {
      return { ok: false, detail: `A verse starts mid-phrase at “${words[index]}”.` };
    }
    return { ok: false, detail: `Unexpected “${words[index]}” between verses.` };
  }
  if (finished.length < verses.length) return { ok: false, detail: "Not every verse appears as a complete phrase." };
  const outOfOrder = finished.findIndex((at, order) => at !== order % verses.length);
  if (outOfOrder >= 0) return { ok: false, detail: "The verses are out of order." };
  return { ok: true, detail: `${finished.length} complete verses, in order.` };
}

/**
 * Each listed name should show up about as often as the others, counting a repeated
 * listing (Jacob twice) as two shares. One extra pass is allowed so a round-robin
 * that has started the next cycle still passes. A short name used as filler does not.
 */
export function nameSpread(runs: string[], listed: string[]): Check {
  const shares = new Map<string, number>();
  for (const name of listed) shares.set(name, (shares.get(name) ?? 0) + 1);
  const blob = runs.join("\n");
  const rates: number[] = [];
  const foundOf = new Map<string, number>();
  for (const [name, times] of shares) {
    const found = countOf(blob, name);
    foundOf.set(name, found);
    rates.push(found / times);
  }
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length === 0 ? 0 : rates.length % 2 === 1 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  const limit = Math.max(median * 1.5, median + 1);
  let worst: { name: string; found: number; rate: number } | null = null;
  for (const [name, times] of shares) {
    const found = foundOf.get(name) ?? 0;
    const rate = found / times;
    if (rate > limit + 1e-6 && (!worst || rate > worst.rate)) worst = { name, found, rate };
  }
  if (worst) {
    const typical = median < 10 ? median.toFixed(1) : Math.round(median).toString();
    return {
      id: "name-balance",
      label: "Names stay even",
      passed: false,
      detail: `${worst.name} appears ${worst.found} times, more than 1.5× the median (${typical} per listing).`,
    };
  }
  return {
    id: "name-balance",
    label: "Names stay even",
    passed: true,
    detail: `No name exceeds 1.5× the median (${median.toFixed(1)} per listing).`,
  };
}

export function layoutPassed(checks: Check[]) {
  return checks.every((check) => check.passed);
}

/** Raised just enough that the cap stays at the legibility floor. */
export function legibleScale(period: number, textScale: number) {
  const scale = textScale || 1;
  if (capHeight(period, scale) >= CAP_FLOOR - 0.05) return scale;
  const base = Math.max(CAP_FLOOR, period * CAP_RATIO);
  return Math.min(1.15, CAP_FLOOR / base);
}
