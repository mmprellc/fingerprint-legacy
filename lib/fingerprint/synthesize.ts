import type { Pt, Ridge } from "./types";
import { pathLength, resamplePath, ridgeFromPoints, smoothPath, toPathD } from "./geometry";
import { ridgeWidth } from "./lettering";

export type SynthPrint = {
  width: number;
  height: number;
  rgba: Uint8Array;
  gray: Float32Array;
  ridges: Ridge[];
  period: number;
};

type Singularity = { x: number; y: number };

const WIDTH = 980;
const HEIGHT = 1260;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function blendAngle(from: number, to: number, t: number) {
  const amount = clamp(t, 0, 1);
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

class PointGrid {
  private readonly cell: number;
  private readonly buckets = new Map<string, Pt[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  add(point: Pt) {
    const key = this.key(point.x, point.y);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  nearest(x: number, y: number, ignoreTail = 0, own?: Pt[]) {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = this.buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < best) best = d;
        }
      }
    }
    if (own && own.length > ignoreTail) {
      const stop = own.length - ignoreTail;
      const stride = 2;
      for (let i = 0; i < stop; i += stride) {
        const d = Math.hypot(own[i].x - x, own[i].y - y);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private key(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
}

export function synthesizePrint(kind: "loop" | "whorl" = "loop", _seed = 1): SynthPrint {
  const width = WIDTH;
  const height = HEIGHT;
  const period = kind === "loop" ? 15.5 : 15.2;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const rx = width * 0.4;
  const ry = height * 0.4;

  const cores: Singularity[] =
    kind === "loop"
      ? [{ x: cx - rx * 0.02, y: cy - ry * 0.04 }]
      : [
          { x: cx - period * 0.15, y: cy - period * 2.4 },
          { x: cx + period * 0.15, y: cy + period * 2.1 },
        ];
  const deltas: Singularity[] =
    kind === "loop"
      ? [{ x: cx + rx * 0.46, y: cy + ry * 0.28 }]
      : [
          { x: cx - rx * 0.5, y: cy + ry * 0.36 },
          { x: cx + rx * 0.5, y: cy + ry * 0.36 },
        ];

  const gridN = 4;
  const gw = Math.ceil(width / gridN);
  const gh = Math.ceil(height / gridN);
  const sin2 = new Float32Array(gw * gh);
  const cos2 = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = (gx + 0.5) * gridN;
      const y = (gy + 0.5) * gridN;
      const theta = rawOrientation(x, y, cx, cy, rx, ry, cores, deltas);
      const i = gy * gw + gx;
      sin2[i] = Math.sin(2 * theta);
      cos2[i] = Math.cos(2 * theta);
    }
  }
  const sinB = boxBlur(sin2, gw, gh, 2);
  const cosB = boxBlur(cos2, gw, gh, 2);
  const orientAt = (x: number, y: number) => {
    const gx = clamp(x / gridN - 0.5, 0, gw - 1.001);
    const gy = clamp(y / gridN - 0.5, 0, gh - 1.001);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const sample = (arr: Float32Array, ix: number, iy: number) => arr[iy * gw + ix];
    const s =
      sample(sinB, x0, y0) * (1 - tx) * (1 - ty) +
      sample(sinB, Math.min(gw - 1, x0 + 1), y0) * tx * (1 - ty) +
      sample(sinB, x0, Math.min(gh - 1, y0 + 1)) * (1 - tx) * ty +
      sample(sinB, Math.min(gw - 1, x0 + 1), Math.min(gh - 1, y0 + 1)) * tx * ty;
    const c =
      sample(cosB, x0, y0) * (1 - tx) * (1 - ty) +
      sample(cosB, Math.min(gw - 1, x0 + 1), y0) * tx * (1 - ty) +
      sample(cosB, x0, Math.min(gh - 1, y0 + 1)) * (1 - tx) * ty +
      sample(cosB, Math.min(gw - 1, x0 + 1), Math.min(gh - 1, y0 + 1)) * tx * ty;
    return 0.5 * Math.atan2(s, c);
  };

  const inOval = (x: number, y: number, pad = 0) => {
    const nx = (x - cx) / (rx + pad);
    const ny = (y - cy) / (ry + pad);
    return nx * nx + ny * ny <= 1;
  };

  const dsep = period;
  const dtest = period * 0.72;
  const step = 0.9;
  const committed = new PointGrid(period * 0.45);
  const raw: Pt[][] = [];

  function trace(sx: number, sy: number, sign: number) {
    const pts: Pt[] = [];
    const own = new PointGrid(period * 0.45);
    const lag: Pt[] = [];
    let px = sx;
    let py = sy;
    let theta0 = orientAt(px, py);
    let vx = Math.cos(theta0) * sign;
    let vy = Math.sin(theta0) * sign;
    let closed = false;
    for (let i = 0; i < 4200; i++) {
      if (!inOval(px, py, -period * 0.15)) break;
      const nearOwn = pts.length > Math.round(period * 5) ? own.nearest(px, py) : Infinity;
      const nearOther = i > 6 ? committed.nearest(px, py) : Infinity;
      if (nearOther < dtest) break;
      if (nearOwn < dtest * 0.8) {
        closed = true;
        break;
      }
      const point = { x: px, y: py };
      pts.push(point);
      lag.push(point);
      if (lag.length > 18) own.add(lag.shift()!);
      const theta = orientAt(px, py);
      let dx = Math.cos(theta);
      let dy = Math.sin(theta);
      if (dx * vx + dy * vy < 0) {
        dx = -dx;
        dy = -dy;
      }
      vx = vx * 0.35 + dx * 0.65;
      vy = vy * 0.35 + dy * 0.65;
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      px += vx * step;
      py += vy * step;
    }
    return { pts, closed };
  }

  const queue: Pt[] = [{ x: cx - period * 0.4, y: cy + period * 1.6 }];
  const seeded = new PointGrid(period * 0.5);
  let spins = 0;
  while (queue.length && raw.length < 150 && spins < 4000) {
    spins++;
    const seed = queue.shift()!;
    if (!inOval(seed.x, seed.y, -period * 0.8)) continue;
    if (committed.nearest(seed.x, seed.y) < dsep * 0.86) continue;
    if (seeded.nearest(seed.x, seed.y) < period * 0.35) continue;
    seeded.add(seed);
    const forward = trace(seed.x, seed.y, 1);
    const back = trace(seed.x, seed.y, -1);
    const points = [...back.pts.reverse(), ...forward.pts.slice(1)];
    if (points.length < 28 || pathLength(points) < period * 3.2) continue;
    let smooth = smoothPath(points, 3);
    smooth = smoothPath(smooth, 2);
    smooth = resamplePath(smooth, 2.6);
    const ridge = ridgeFromPoints(smooth, forward.closed && back.pts.length + forward.pts.length > 40);
    if (!ridge) continue;
    raw.push(ridge.points);
    for (const point of ridge.points) committed.add(point);
    for (let i = 6; i < ridge.points.length; i += 8) {
      const a = ridge.points[Math.max(0, i - 2)];
      const b = ridge.points[Math.min(ridge.points.length - 1, i + 2)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      queue.push({ x: ridge.points[i].x + nx * dsep, y: ridge.points[i].y + ny * dsep });
      queue.push({ x: ridge.points[i].x - nx * dsep, y: ridge.points[i].y - ny * dsep });
    }
  }

  // Second pass: any empty patch inside the oval gets its own ridge.
  for (let y = cy - ry; y <= cy + ry && raw.length < 170; y += period * 0.85) {
    for (let x = cx - rx; x <= cx + rx && raw.length < 170; x += period * 0.85) {
      if (!inOval(x, y, -period)) continue;
      if (committed.nearest(x, y) < dsep * 0.92) continue;
      const forward = trace(x, y, 1);
      const back = trace(x, y, -1);
      const points = [...back.pts.reverse(), ...forward.pts.slice(1)];
      if (pathLength(points) < period * 4) continue;
      let smooth = smoothPath(points, 3);
      smooth = resamplePath(smooth, 2.6);
      const ridge = ridgeFromPoints(smooth, false);
      if (!ridge) continue;
      raw.push(ridge.points);
      for (const point of ridge.points) committed.add(point);
    }
  }

  const ridges: Ridge[] = [];
  for (const points of raw) {
    const ridge = ridgeFromPoints(points, false);
    if (ridge && ridge.length > period * 3) ridges.push(ridge);
  }
  ridges.sort((a, b) => b.length - a.length);

  const gray = new Float32Array(width * height);
  gray.fill(244);
  const radius = ridgeWidth(period) / 2;
  for (const ridge of ridges) {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 0.65));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(gray, width, height, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius);
      }
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    const p = i * 4;
    const ink = 1 - g / 244;
    rgba[p] = Math.round(246 * (1 - ink) + 52 * ink);
    rgba[p + 1] = Math.round(241 * (1 - ink) + 56 * ink);
    rgba[p + 2] = Math.round(232 * (1 - ink) + 58 * ink);
    rgba[p + 3] = 255;
    gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }

  return { width, height, rgba, gray, ridges, period };
}

function rawOrientation(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cores: Singularity[],
  deltas: Singularity[],
) {
  let singular = 0;
  for (const core of cores) singular += Math.atan2(y - core.y, x - core.x);
  for (const delta of deltas) singular -= Math.atan2(y - delta.y, x - delta.x);
  singular *= 0.5;
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  const phi = Math.atan2(ny, nx);
  const tangent = Math.atan2(Math.cos(phi) * ry, -Math.sin(phi) * rx);
  const radial = Math.hypot(nx, ny);
  const edge = smoothstep(0.42, 0.9, radial);
  return blendAngle(singular, tangent, edge);
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          acc += src[yy * w + xx];
          n++;
        }
      }
      dst[y * w + x] = acc / n;
    }
  }
  return dst;
}

function stamp(gray: Float32Array, width: number, height: number, x: number, y: number, radius: number) {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(width - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(height - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx - x, yy - y);
      if (d >= radius) continue;
      const edge = d / radius;
      const ink = edge < 0.78 ? 28 : 28 + ((edge - 0.78) / 0.22) * 210;
      const idx = yy * width + xx;
      if (ink < gray[idx]) gray[idx] = ink;
    }
  }
}

export function printInkSvg(print: SynthPrint) {
  const stroke = ridgeWidth(print.period).toFixed(2);
  const paths = print.ridges.map((ridge) => `<path d="${toPathD(ridge.points)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${print.width}" height="${print.height}" viewBox="0 0 ${print.width} ${print.height}"><rect width="100%" height="100%" fill="#F6F1E8"/><g fill="none" stroke="#34383A" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

export function truthLength(ridges: Ridge[]) {
  return ridges.reduce((sum, ridge) => sum + (ridge.length || pathLength(ridge.points)), 0);
}
