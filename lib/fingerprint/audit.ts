import { fontSizeFor } from "./lettering";
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

  const names = (style.names ?? []).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
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
  }
  return checks;
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
