import { pathLength, slicePath } from "./geometry";
import { edgeTypeScale, estimateWordWidth, fontSizeFor, planPortrait, rimWeights, roleScale } from "./lettering";
import { fontById } from "./preview";
import type { Check } from "./audit";
import type { ExtractResult, PrintStyle, Pt } from "./types";

/**
 * A silhouette pixel counts as covered when a line of text passes within this
 * many ridge-periods. That is wide enough for a normal valley and the rim,
 * and far too narrow to hide an empty half of the oval.
 */
const COVER_REACH = 1.25;
const COVER_MIN = 0.95;
const IOU_MIN = 0.9;
const FLOW_MIN = 0.72;
const LIKENESS_MIN = 0.4;

type Aimed = Pt & { angle: number };

class AimedGrid {
  private readonly cell: number;
  private readonly buckets = new Map<string, Aimed[]>();

  constructor(cell: number) {
    this.cell = Math.max(3, cell);
  }

  add(point: Aimed) {
    const key = `${Math.floor(point.x / this.cell)},${Math.floor(point.y / this.cell)}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  nearest(x: number, y: number, reach: number): Aimed | null {
    const window = Math.ceil(reach / this.cell) + 1;
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    let best: Aimed | null = null;
    let bestD = reach;
    for (let dy = -window; dy <= window; dy++) {
      for (let dx = -window; dx <= window; dx++) {
        const bucket = this.buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < bestD) {
            bestD = d;
            best = point;
          }
        }
      }
    }
    return best;
  }
}

function wordWidth(word: string, size: number, charRatio: number, tracking: number) {
  return estimateWordWidth(word, size, charRatio, tracking);
}

/** The part of a run the glyphs actually occupy. A trimmed dedication is kept whole. */
function inkSpan(points: Pt[], text: string, measure: (word: string) => number, gap: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || points.length < 2) return [] as Pt[];
  let used = 2;
  words.forEach((word, index) => {
    used += (index ? gap : 0) + measure(word);
  });
  const length = pathLength(points);
  if (used >= length * 0.82) return points;
  return slicePath(points, 0, Math.min(length, used));
}

function textSpans(result: ExtractResult, style: PrintStyle) {
  const ridges = result.ridges;
  const period = result.period;
  const font = fontById(style.font);
  const ratio = Math.max(font.charRatio, 0.62);
  const fontSize = fontSizeFor(period, style.textScale || 1);
  const rims = rimWeights(ridges);
  const bodyScale = rims.map((rim) => edgeTypeScale(rim));
  const planned = planPortrait(
    ridges,
    style,
    [],
    period,
    (word, role) => {
      const size = fontSize * roleScale(role);
      const tracking = role === "body" ? 0.04 : 0.045;
      return wordWidth(word, size, ratio, -size * tracking);
    },
    fontSize * roleScale("body") * 0.16,
    bodyScale,
  );
  const spans: Pt[][] = [];
  planned.forEach((runs, ridgeIndex) => {
    const scale = bodyScale[ridgeIndex] ?? 1;
    for (const run of runs) {
      if (!run.text) continue;
      const roleSize = fontSize * roleScale(run.role) * (run.role === "body" ? scale : 1);
      const tracking = run.role === "body" ? 0.04 : 0.045;
      const gap = fontSize * roleScale("body") * 0.16 * (run.role === "body" ? scale : 1);
      const span = inkSpan(run.points, run.text, (word) => wordWidth(word, roleSize, ratio, -roleSize * tracking), gap);
      if (span.length > 1) spans.push(span);
    }
  });
  return spans;
}

function indexText(spans: Pt[][], cell: number) {
  const grid = new AimedGrid(cell);
  for (const span of spans) {
    for (let i = 1; i < span.length; i++) {
      const a = span[i - 1];
      const b = span[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        grid.add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle });
      }
    }
  }
  return grid;
}

function paintNear(spans: Pt[][], w: number, h: number, radius: number) {
  const near = new Uint8Array(w * h);
  const r = Math.max(1, radius);
  const r2 = r * r;
  const stamp = (x: number, y: number) => {
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx + dy * dy <= r2) near[yy * w + xx] = 1;
      }
    }
  };
  for (const span of spans) {
    for (let i = 1; i < span.length; i++) {
      const a = span[i - 1];
      const b = span[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  }
  return near;
}

function paintInk(spans: Pt[][], w: number, h: number, radius: number) {
  const ink = new Float32Array(w * h);
  const r = Math.max(1, radius);
  const r2 = r * r;
  const stamp = (x: number, y: number) => {
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx + dy * dy <= r2) ink[yy * w + xx] = 1;
      }
    }
  };
  for (const span of spans) {
    for (let i = 1; i < span.length; i++) {
      const a = span[i - 1];
      const b = span[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  }
  return ink;
}

function angleAgree(a: number, b: number) {
  const delta = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(Math.cos(delta));
}

export type FidelityScore = {
  coverage: number;
  iou: number;
  flow: number;
  likeness: number;
};

export function scoreFidelity(result: ExtractResult, style: PrintStyle): FidelityScore | null {
  const mask = result.mask;
  const gray = result.gray;
  const orient = result.orient;
  const coherence = result.coherence;
  const { width: w, height: h, period } = result;
  if (!mask || !gray || !orient || !coherence || period < 4 || result.ridges.length < 8) return null;

  const spans = textSpans(result, style);
  const reach = period * COVER_REACH;
  const near = paintNear(spans, w, h, reach);
  // Spill uses the text itself, not the coverage halo, so a print that fills
  // its oval is not punished for the reach used to test empty regions.
  const body = paintNear(spans, w, h, Math.max(2, period * 0.42));
  let ink = 0;
  let hit = 0;
  let spill = 0;
  const step = 3;
  for (let y = 0; y < h; y += step) {
    const row = y * w;
    for (let x = 0; x < w; x += step) {
      const inside = mask[row + x] === 1;
      if (inside) {
        ink++;
        if (near[row + x]) hit++;
      } else if (body[row + x]) spill++;
    }
  }
  const coverage = hit / Math.max(1, ink);
  const iou = hit / Math.max(1, ink + spill);

  const grid = indexText(spans, Math.max(4, period * 0.45));
  let flowSum = 0;
  let flowN = 0;
  for (let y = 0; y < h; y += 4) {
    const row = y * w;
    for (let x = 0; x < w; x += 4) {
      const i = row + x;
      if (!mask[i] || coherence[i] < 0.28) continue;
      flowN++;
      const nearest = grid.nearest(x, y, reach);
      if (!nearest) continue;
      flowSum += angleAgree(nearest.angle, orient[i]);
    }
  }
  const flow = flowSum / Math.max(1, flowN);

  const photo = new Float32Array(w * h);
  const dark = result.ridgesAreDark;
  for (let i = 0; i < photo.length; i++) {
    const tone = gray[i];
    photo[i] = dark ? 255 - tone : tone;
  }
  const inkRadius = Math.max(1.4, period * 0.36);
  const drawn = paintInk(spans, w, h, inkRadius);
  // Whole-frame blocks, about two ridge spacings. Paper stays paper on both
  // sides, so the silhouette itself is part of the score. A missing half of
  // the oval disagrees; letter shapes and valley phase do not.
  const cell = Math.max(8, Math.round(period * 2.2));
  const photoMeans: number[] = [];
  const wordMeans: number[] = [];
  for (let y0 = 0; y0 + cell <= h; y0 += cell) {
    for (let x0 = 0; x0 + cell <= w; x0 += cell) {
      let count = 0;
      let photoSum = 0;
      let wordSum = 0;
      for (let y = y0; y < y0 + cell; y += 2) {
        const row = y * w;
        for (let x = x0; x < x0 + cell; x += 2) {
          count++;
          photoSum += photo[row + x];
          wordSum += drawn[row + x];
        }
      }
      if (!count) continue;
      photoMeans.push(photoSum / count);
      wordMeans.push((wordSum / count) * 220);
    }
  }
  let likeness = 0;
  if (photoMeans.length >= 8) {
    let sx = 0;
    let sy = 0;
    let sx2 = 0;
    let sy2 = 0;
    let sxy = 0;
    for (let i = 0; i < photoMeans.length; i++) {
      sx += photoMeans[i];
      sy += wordMeans[i];
      sx2 += photoMeans[i] * photoMeans[i];
      sy2 += wordMeans[i] * wordMeans[i];
      sxy += photoMeans[i] * wordMeans[i];
    }
    const n = photoMeans.length;
    const varX = sx2 - (sx * sx) / n;
    const varY = sy2 - (sy * sy) / n;
    likeness = varX > 1 && varY > 1 ? (sxy - (sx * sy) / n) / Math.sqrt(varX * varY) : 0;
  }

  return { coverage, iou, flow, likeness };
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function auditFidelity(result: ExtractResult, style: PrintStyle): Check[] {
  const score = scoreFidelity(result, style);
  if (!score) {
    return [
      { id: "coverage", label: "Coverage of the silhouette", passed: false, detail: "The print did not yield a silhouette to measure." },
      { id: "shape", label: "Silhouette shape", passed: false, detail: "No ink mask to compare." },
      { id: "flow", label: "Ridge flow", passed: false, detail: "No orientation field to compare." },
      { id: "likeness", label: "Visual likeness", passed: false, detail: "The portrait could not be compared with the photo." },
    ];
  }
  return [
    {
      id: "coverage",
      label: "Coverage of the silhouette",
      passed: score.coverage >= COVER_MIN,
      detail: `${pct(score.coverage)} of the ink silhouette has text within a ridge spacing. Target ${pct(COVER_MIN)}.`,
    },
    {
      id: "shape",
      label: "Silhouette shape",
      passed: score.iou >= IOU_MIN,
      detail: `IoU with the ink mask is ${pct(score.iou)}.`,
    },
    {
      id: "flow",
      label: "Ridge flow",
      passed: score.flow >= FLOW_MIN,
      detail: `Orientation agreement across the print is ${pct(score.flow)}.`,
    },
    {
      id: "likeness",
      label: "Visual likeness",
      passed: score.likeness >= LIKENESS_MIN,
      detail: `Blurred portrait vs photo correlation is ${score.likeness.toFixed(2)}.`,
    },
  ];
}
