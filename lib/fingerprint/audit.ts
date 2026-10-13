import { loadRidgeFace, ridgeCaseReport } from "./glyphs";
import { edgeTypeScale, fontSizeFor, RIDGE_DIVIDER, roleScale, type RidgeRole } from "./lettering";
import { fontById } from "./preview";
import type { PrintStyle } from "./types";

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
  return Math.max(CAP_FLOOR, period * 0.64) * (textScale || 1);
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

function letterCase(style: PrintStyle, period: number): Check {
  const face = loadRidgeFace(fontById(style.font).file);
  const report = ridgeCaseReport(face, fontSizeFor(period, style.textScale || 1));
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

function bodyRunTexts(svg: string) {
  const texts: string[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    if (!/\bridge-body\b/.test(match[1])) continue;
    const path = match[2].match(/<textPath\b[^>]*>([\s\S]*?)<\/textPath>/);
    const raw = decodeXml(path ? path[1] : match[2]).replace(/\s+/g, " ").trim();
    if (raw) texts.push(raw);
  }
  return texts;
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
  const base = Math.max(CAP_FLOOR, period * 0.64);
  return Math.min(1.15, CAP_FLOOR / base);
}
