import { auditLayout, capHeight, legibleScale, type Check } from "./audit";
import { auditFidelity } from "./fidelity";
import { extractFromGray } from "./engine";
import { buildPreviewSvg } from "./preview";
import type { ExtractProfile, ExtractResult, PrintStyle, Pt, Ridge } from "./types";

export type CaptureMetrics = {
  sharpness: number;
  contrast: number;
  borderInk: number;
  fill: number;
};

export type RetakeReason = "blur" | "contrast" | "crop" | "small" | "unmatched";

export type RetakeGuidance = {
  reason: RetakeReason;
  title: string;
  detail: string;
  steps: string[];
};

export type PortraitAttempt = {
  profile: string;
  passed: boolean;
  checks: Check[];
};

export type PortraitResult = {
  accepted: boolean;
  width: number;
  height: number;
  period: number;
  ridges: Ridge[];
  ridgesAreDark: boolean;
  warnings: string[];
  attempts: PortraitAttempt[];
  retake: RetakeGuidance | null;
  metrics: CaptureMetrics;
  textScale: number;
};

type Profile = ExtractProfile & { id: string; flip?: boolean };

const LOCKED: Profile = { id: "locked", inkDelta: 30, spacingLimit: 0.82, spacingHard: 0.62, sepFactor: 1 };
const TIGHTER: Profile = { id: "tighter", inkDelta: 30, spacingLimit: 0.9, spacingHard: 0.72, sepFactor: 1.06 };
const FULLER: Profile = { id: "fuller", inkDelta: 22, spacingLimit: 0.74, spacingHard: 0.54, sepFactor: 0.92 };
const FLIPPED: Profile = { id: "flipped", inkDelta: 30, spacingLimit: 0.82, spacingHard: 0.62, sepFactor: 1, flip: true };

/** The only attempts, in order. The first is the Randy print. Later ones run only if that one fails. */
export const PORTRAIT_PROFILES: Profile[] = [LOCKED, TIGHTER, FULLER, FLIPPED];

const BLUR_FLOOR = 8;
const CONTRAST_FLOOR = 28;
const BORDER_INK_CEILING = 0.12;
const FILL_FLOOR = 0.42;

function retake(reason: RetakeReason, title: string, detail: string, steps: string[]): RetakeGuidance {
  return { reason, title, detail, steps };
}

function guidanceFor(metrics: CaptureMetrics): RetakeGuidance | null {
  if (metrics.borderInk > BORDER_INK_CEILING) {
    return retake(
      "crop",
      "The print is cut off by the edge of the photo.",
      "Part of the fingerprint runs out of the frame, so the silhouette would be missing a side or the tip.",
      [
        "Leave a margin of paper around the whole print.",
        "Keep the fingertip and both sides inside the photo.",
        "Retake with the full print visible.",
      ],
    );
  }
  if (metrics.fill < FILL_FLOOR) {
    return retake(
      "small",
      "The print is too small in the frame.",
      "Move closer so the fingerprint fills most of the photo. The ridges have to be large enough to read.",
      [
        "Move in until the print fills about two thirds of the photo.",
        "Leave a little paper visible around the edges.",
        "Focus on the center of the print, then retake.",
      ],
    );
  }
  if (metrics.contrast < CONTRAST_FLOOR) {
    return retake(
      "contrast",
      "The ink and the paper are too close in tone.",
      "There is not enough contrast to separate the ridges from the background, so the portrait would not match the print.",
      [
        "Use dark ink on a light card, with a clear difference between the two.",
        "Avoid strong shadows and dim indoor light. A window or a lamp beside the card is enough.",
        "Fill most of the frame with the print, then retake.",
      ],
    );
  }
  if (metrics.sharpness < BLUR_FLOOR) {
    return retake(
      "blur",
      "This photo is too soft to read the ridges.",
      "The lines of the print blur together. A portrait made from it would not follow the finger.",
      [
        "Rest the card on a flat surface.",
        "Hold the phone parallel to the print, a few inches away.",
        "Tap the ridges to focus, wait until they look sharp, then take the photo.",
      ],
    );
  }
  return null;
}

export function measureCapture(gray: Float32Array, w: number, h: number): CaptureMetrics {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = 0; y < h; y += 2) {
    const row = y * w;
    for (let x = 0; x < w; x += 2) {
      const tone = gray[row + x];
      hist[Math.max(0, Math.min(255, tone < 0 ? 0 : tone > 255 ? 255 : Math.round(tone)))]++;
      n++;
    }
  }
  const percentile = (q: number) => {
    const target = n * q;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  };
  const p50 = percentile(0.5);
  // Thin ridges can be under 10% of the frame, so the dark tail is the ink.
  const darkTarget = n * 0.08;
  let darkAcc = 0;
  let darkSum = 0;
  for (let tone = 0; tone < 256 && darkAcc < darkTarget; tone++) {
    const take = Math.min(hist[tone], darkTarget - darkAcc);
    darkSum += tone * take;
    darkAcc += take;
  }
  const contrast = percentile(0.9) - darkSum / Math.max(1, darkAcc);

  let lapSum = 0;
  let lapSum2 = 0;
  let lapN = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      lapSum += lap;
      lapSum2 += lap * lap;
      lapN++;
    }
  }
  const mean = lapSum / Math.max(1, lapN);
  const sharpness = lapSum2 / Math.max(1, lapN) - mean * mean;

  const inkCut = p50 - 12;
  const band = 4;
  let border = 0;
  let borderOn = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let ink = 0;
  for (let y = 0; y < h; y += 2) {
    const row = y * w;
    for (let x = 0; x < w; x += 2) {
      const onBorder = x < band || y < band || x >= w - band || y >= h - band;
      const dark = gray[row + x] < inkCut;
      if (onBorder) {
        border++;
        if (dark) borderOn++;
      }
      if (!dark) continue;
      ink++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const fill = ink ? Math.max((maxX - minX) / w, (maxY - minY) / h) : 0;
  return { sharpness, contrast, borderInk: border ? borderOn / border : 0, fill };
}

class PointGrid {
  private readonly cell: number;
  private readonly buckets = new Map<string, Pt[]>();

  constructor(cell: number) {
    this.cell = Math.max(2, cell);
  }

  add(point: Pt) {
    const key = `${Math.floor(point.x / this.cell)},${Math.floor(point.y / this.cell)}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  nearest(x: number, y: number, skipId = -2, ids?: Map<Pt, number>) {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    let best = 1e9;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const bucket = this.buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          if (ids && ids.get(point) === skipId) continue;
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

function auditGeometry(result: ExtractResult): Check[] {
  const mask = result.mask;
  const { width: w, height: h, period, ridges } = result;
  if (!mask || ridges.length < 8 || period < 4) {
    return [
      { id: "inside-mask", label: "Text inside the silhouette", passed: false, detail: "The silhouette was not usable." },
      { id: "spacing", label: "Collision-free spacing", passed: false, detail: "Not enough ridges to measure spacing." },
    ];
  }

  const cell = Math.max(4, period * 0.45);
  const grid = new PointGrid(cell);
  const ids = new Map<Pt, number>();
  ridges.forEach((ridge, id) => {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let s = 0; s <= steps; s += 2) {
        const t = s / steps;
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        ids.set(point, id);
        grid.add(point);
      }
    }
  });

  let samples = 0;
  let outside = 0;
  for (const ridge of ridges) {
    for (let i = 0; i < ridge.points.length; i += 3) {
      const x = Math.round(ridge.points[i].x);
      const y = Math.round(ridge.points[i].y);
      samples++;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) near = true;
        }
      }
      if (!near) outside++;
    }
  }
  const outsideFrac = outside / Math.max(1, samples);
  const inside = outsideFrac <= 0.02;

  const gaps: number[] = [];
  let close = 0;
  let seen = 0;
  ridges.forEach((ridge, id) => {
    for (let i = 0; i < ridge.points.length; i += 4) {
      const point = ridge.points[i];
      const d = grid.nearest(point.x, point.y, id, ids);
      if (d > 1e8) continue;
      seen++;
      gaps.push(d);
      if (d < period * 0.72) close++;
    }
  });
  gaps.sort((a, b) => a - b);
  const spacingP50 = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
  const closeFrac = seen ? close / seen : 1;
  const spaced = closeFrac <= 0.3 && spacingP50 >= period * 0.75 && spacingP50 <= period * 1.45;

  return [
    { id: "inside-mask", label: "Text inside the silhouette", passed: inside, detail: inside ? "The words stay inside the ink." : `${Math.round(outsideFrac * 100)}% of the text sits outside the ink.` },
    {
      id: "spacing",
      label: "Collision-free spacing",
      passed: spaced,
      detail: `Typical gap ${spacingP50.toFixed(1)}px, ${Math.round(closeFrac * 100)}% of samples too close.`,
    },
  ];
}

function attemptScore(checks: Check[]) {
  return checks.reduce((sum, check) => sum + (check.passed ? 1 : 0), 0);
}

function unmatched(checks: Check[]): RetakeGuidance {
  const names = checks.find((check) => check.id === "names" && !check.passed);
  const geometryIds = new Set(["coverage", "shape", "flow", "likeness", "inside-mask", "spacing"]);
  const geometryOk = checks.filter((check) => geometryIds.has(check.id)).every((check) => check.passed);
  if (names && geometryOk) {
    return retake(
      "unmatched",
      "Not every name fits on this print.",
      names.detail,
      [
        "Photograph the whole print, large and sharp, so the ridges have room.",
        "Keep each name on its own line, spelled the way it should appear.",
        "If the list is longer than the print can hold, shorten it and try again.",
      ],
    );
  }
  const failed = checks.filter((check) => !check.passed).map((check) => check.label.toLowerCase());
  return retake(
    "unmatched",
    "We could not match this print closely enough.",
    failed.length ? `Still short on ${failed.join(", ")} after the locked attempts.` : "The ridges did not settle into a clean portrait.",
    [
      "Retake with the full print in frame, in even light, and in focus.",
      "If the ink is smudged, roll a fresh print and photograph that.",
      "A plain light background behind the card makes the silhouette clear.",
    ],
  );
}

/**
 * One deterministic portrait. The Randy profile runs first. Later profiles
 * run only when a quality check fails. A photo that is too poor to read
 * stops before any portrait is made.
 */
export function producePortrait(
  gray: Float32Array,
  width: number,
  height: number,
  style: PrintStyle,
  options: { ridges?: "auto" | "dark" | "light" } = {},
): PortraitResult {
  const metrics = measureCapture(gray, width, height);
  const early = guidanceFor(metrics);
  const empty: PortraitResult = {
    accepted: false,
    width,
    height,
    period: 0,
    ridges: [],
    ridgesAreDark: true,
    warnings: [],
    attempts: [],
    retake: early,
    metrics,
    textScale: style.textScale || 1,
  };
  if (early) return empty;

  const tone = options.ridges ?? "auto";
  const attempts: PortraitAttempt[] = [];
  let lastDark: boolean | undefined;
  let best: { score: number; extracted: ExtractResult; checks: Check[]; scale: number } | null = null;

  for (const profile of PORTRAIT_PROFILES) {
    const ridges = profile.flip
      ? lastDark === undefined
        ? tone === "light"
          ? "dark"
          : "light"
        : lastDark
          ? "light"
          : "dark"
      : tone;
    const extracted = extractFromGray(gray, width, height, {
      ridges,
      profile,
      keepMask: true,
    });
    lastDark = extracted.ridgesAreDark;
    const scale = legibleScale(extracted.period, style.textScale || 1);
    const styled = Math.abs(scale - (style.textScale || 1)) < 0.001 ? style : { ...style, textScale: scale };
    const svg = buildPreviewSvg(
      [{ ridges: extracted.ridges, width: extracted.width, height: extracted.height, lines: [] }],
      styled,
      extracted.period,
    ).svg;
    const checks = [...auditFidelity(extracted, styled), ...auditGeometry(extracted), ...auditLayout(svg, styled, extracted.period)];
    const passed = checks.every((check) => check.passed);
    attempts.push({ profile: profile.id, passed, checks });
    const score = attemptScore(checks);
    if (!best || score > best.score) best = { score, extracted, checks, scale };
    if (passed) {
      return {
        accepted: true,
        width: extracted.width,
        height: extracted.height,
        period: extracted.period,
        ridges: extracted.ridges,
        ridgesAreDark: extracted.ridgesAreDark,
        warnings: extracted.warnings,
        attempts,
        retake: null,
        metrics,
        textScale: scale,
      };
    }
  }

  const failed = best?.checks ?? [];
  return {
    accepted: false,
    width: best?.extracted.width ?? width,
    height: best?.extracted.height ?? height,
    period: best?.extracted.period ?? 0,
    ridges: [],
    ridgesAreDark: best?.extracted.ridgesAreDark ?? true,
    warnings: best?.extracted.warnings ?? [],
    attempts,
    retake: unmatched(failed),
    metrics,
    textScale: best?.scale ?? (style.textScale || 1),
  };
}

export function portraitSummary(result: PortraitResult) {
  const cap = result.period ? capHeight(result.period, result.textScale) : 0;
  return {
    accepted: result.accepted,
    profile: result.attempts.find((attempt) => attempt.passed)?.profile ?? result.attempts.at(-1)?.profile ?? "",
    attempts: result.attempts.map((attempt) => attempt.profile),
    cap,
    metrics: result.metrics,
    retake: result.retake?.reason ?? "",
  };
}
