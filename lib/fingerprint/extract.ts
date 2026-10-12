import type { ExtractOptions, Point, RGBA, RidgeSet } from "./types";

const MIN_SPACING = 6;
const MAX_SPACING = 18;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function grayscale(src: RGBA): Float32Array {
  const n = src.width * src.height;
  const g = new Float32Array(n);
  const d = src.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = d[p + 3] / 255;
    const lum = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    g[i] = lum * a + (1 - a);
  }
  return g;
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const win = r * 2 + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      sum -= src[row + clamp(x - r, 0, w - 1)];
      sum += src[row + clamp(x + r + 1, 0, w - 1)];
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / win;
      sum -= tmp[clamp(y - r, 0, h - 1) * w + x];
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x];
    }
  }
  return dst;
}

function sample(src: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = src[y0 * w + x0];
  const i10 = src[y0 * w + x1];
  const i01 = src[y1 * w + x0];
  const i11 = src[y1 * w + x1];
  return i00 * (1 - tx) * (1 - ty) + i10 * tx * (1 - ty) + i01 * (1 - tx) * ty + i11 * tx * ty;
}

function percentile(src: Float32Array, p: number): number {
  const copy = Array.from(src);
  copy.sort((a, b) => a - b);
  const idx = clamp(Math.floor((copy.length - 1) * p), 0, copy.length - 1);
  return copy[idx];
}

function stretch(src: Float32Array): Float32Array {
  const lo = percentile(src, 0.02);
  const hi = percentile(src, 0.98);
  const span = Math.max(0.04, hi - lo);
  const dst = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = clamp((src[i] - lo) / span, 0, 1);
  return dst;
}

function shouldInvert(gray: Float32Array, w: number, h: number): boolean {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  let border = 0;
  let borderN = 0;
  let center = 0;
  let centerN = 0;
  const x0 = Math.floor(w * 0.3);
  const x1 = Math.floor(w * 0.7);
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.floor(h * 0.7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const edge = x < band || y < band || x >= w - band || y >= h - band;
      if (edge) {
        border += v;
        borderN++;
      } else if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        center += v;
        centerN++;
      }
    }
  }
  const b = border / Math.max(1, borderN);
  const c = center / Math.max(1, centerN);
  if (b < 0.42 && c > b + 0.05) return true;
  return false;
}

function orientationField(gray: Float32Array, w: number, h: number, smoothRadius: number) {
  const txx = new Float32Array(gray.length);
  const tyy = new Float32Array(gray.length);
  const txy = new Float32Array(gray.length);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] +
        -2 * gray[i - 1] + 2 * gray[i + 1] +
        -gray[i + w - 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      txx[i] = gx * gx;
      tyy[i] = gy * gy;
      txy[i] = gx * gy;
    }
  }

  const sxx = boxBlur(txx, w, h, smoothRadius);
  const syy = boxBlur(tyy, w, h, smoothRadius);
  const sxy = boxBlur(txy, w, h, smoothRadius);
  const angle = new Float32Array(gray.length);
  const coherence = new Float32Array(gray.length);
  const energy = new Float32Array(gray.length);
  const cos2 = new Float32Array(gray.length);
  const sin2 = new Float32Array(gray.length);

  for (let i = 0; i < gray.length; i++) {
    const diff = sxx[i] - syy[i];
    const grad = 0.5 * Math.atan2(2 * sxy[i], diff);
    const ridge = grad + Math.PI / 2;
    angle[i] = ridge;
    const denom = sxx[i] + syy[i];
    energy[i] = denom;
    coherence[i] = denom > 1e-6 ? Math.sqrt(diff * diff + 4 * sxy[i] * sxy[i]) / denom : 0;
    cos2[i] = Math.cos(2 * ridge);
    sin2[i] = Math.sin(2 * ridge);
  }

  const c2 = boxBlur(cos2, w, h, smoothRadius);
  const s2 = boxBlur(sin2, w, h, smoothRadius);
  for (let i = 0; i < gray.length; i++) {
    angle[i] = 0.5 * Math.atan2(s2[i], c2[i]);
  }

  return { angle, coherence: boxBlur(coherence, w, h, 2), energy };
}

function buildMask(coherence: Float32Array, energy: Float32Array, w: number, h: number): Uint8Array {
  const energies: number[] = [];
  for (let i = 0; i < energy.length; i += 3) {
    if (coherence[i] > 0.15) energies.push(energy[i]);
  }
  energies.sort((a, b) => a - b);
  const energyCut = energies.length ? energies[Math.floor(energies.length * 0.35)] : 0;

  let mask = new Uint8Array(coherence.length);
  for (let i = 0; i < coherence.length; i++) {
    mask[i] = coherence[i] > 0.28 && energy[i] > energyCut ? 1 : 0;
  }

  mask = new Uint8Array(dilate(mask, w, h, 3));
  mask = new Uint8Array(erode(mask, w, h, 2));
  mask = new Uint8Array(largestComponent(mask, w, h));
  mask = new Uint8Array(erode(mask, w, h, 2));
  mask = new Uint8Array(dilate(mask, w, h, 1));
  return mask;
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dst = new Uint8Array(mask.length);
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const row = yy * w;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (dx * dx + dy * dy <= r2 && mask[row + xx]) {
            on = 1;
            break;
          }
        }
      }
      dst[y * w + x] = on;
    }
  }
  return dst;
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dst = new Uint8Array(mask.length);
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          ok = 0;
          break;
        }
        const row = yy * w;
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w || !mask[row + xx]) {
            ok = 0;
            break;
          }
        }
      }
      dst[y * w + x] = ok;
    }
  }
  return dst;
}

function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(mask.length);
  let bestStart = -1;
  let bestLen = 0;
  const stack: number[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let len = 0;
    const start = i;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      len++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x + 1 < w && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (y + 1 < h && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
    }
  }

  const out = new Uint8Array(mask.length);
  if (bestStart < 0) return out;
  stack.push(bestStart);
  out[bestStart] = 1;
  const painted = new Uint8Array(mask.length);
  painted[bestStart] = 1;
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % w;
    const y = (p - x) / w;
    const tryPush = (n: number) => {
      if (mask[n] && !painted[n]) {
        painted[n] = 1;
        out[n] = 1;
        stack.push(n);
      }
    };
    if (x > 0) tryPush(p - 1);
    if (x + 1 < w) tryPush(p + 1);
    if (y > 0) tryPush(p - w);
    if (y + 1 < h) tryPush(p + w);
  }
  return out;
}

function estimateSpacing(
  gray: Float32Array,
  angle: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
): number {
  const gaps: number[] = [];
  const step = Math.max(8, Math.round(Math.min(w, h) / 28));
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      if (!mask[y * w + x]) continue;
      const a = angle[y * w + x] + Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vals: number[] = [];
      for (let t = -26; t <= 26; t++) vals.push(sample(gray, w, h, x + c * t, y + s * t));
      const mins: number[] = [];
      for (let k = 2; k < vals.length - 2; k++) {
        const v = vals[k];
        if (v <= vals[k - 1] && v <= vals[k + 1] && v < vals[k - 2] && v < vals[k + 2] && v < 0.62) {
          mins.push(k);
        }
      }
      for (let k = 1; k < mins.length; k++) {
        const d = mins[k] - mins[k - 1];
        if (d >= 4 && d <= 22) gaps.push(d);
      }
    }
  }
  if (gaps.length < 8) return clamp(Math.round(Math.min(w, h) / 42), MIN_SPACING, MAX_SPACING);
  gaps.sort((a, b) => a - b);
  return clamp(gaps[Math.floor(gaps.length / 2)], MIN_SPACING, MAX_SPACING);
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function sampleAngle(angle: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = clamp(Math.round(x), 0, w - 1);
  const y0 = clamp(Math.round(y), 0, h - 1);
  return angle[y0 * w + x0];
}

function smoothPath(points: Point[], radius: number): Point[] {
  if (points.length < 5) return points;
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    let x = 0;
    let y = 0;
    let n = 0;
    const rad = i < 2 || i > points.length - 3 ? 1 : radius;
    for (let k = -rad; k <= rad; k++) {
      const j = clamp(i + k, 0, points.length - 1);
      const weight = rad + 1 - Math.abs(k);
      x += points[j].x * weight;
      y += points[j].y * weight;
      n += weight;
    }
    out.push({ x: x / n, y: y / n });
  }
  return out;
}

function chaikin(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const next: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    next.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
    next.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
  }
  next.push(points[points.length - 1]);
  return next;
}

function resample(points: Point[], spacing: number): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [{ ...points[0] }];
  let prev = points[0];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let target = points[i];
    let dx = target.x - prev.x;
    let dy = target.y - prev.y;
    let seg = Math.hypot(dx, dy);
    if (seg === 0) continue;
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg;
      const nx = prev.x + dx * t;
      const ny = prev.y + dy * t;
      out.push({ x: nx, y: ny });
      prev = { x: nx, y: ny };
      dx = target.x - prev.x;
      dy = target.y - prev.y;
      seg = Math.hypot(dx, dy);
      carry = 0;
    }
    carry += seg;
    prev = target;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.35) out.push({ ...last });
  return out;
}

function pathLength(points: Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}

function mostlyStraightLeftward(points: Point[]): boolean {
  if (points.length < 4) return false;
  let turn = 0;
  let prev = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    turn += Math.abs(angleDiff(a, prev));
    prev = a;
  }
  const dx = points[points.length - 1].x - points[0].x;
  return turn < Math.PI * 0.75 && dx < 0;
}

function traceStreamlines(
  gray: Float32Array,
  angle: Float32Array,
  coherence: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  spacing: number,
): Point[][] {
  const occupied = new Uint8Array(mask.length);
  const radius = Math.max(2, spacing * 0.46);
  const r2 = radius * radius;
  const step = 1.35;
  const minLen = spacing * 7;

  const mark = (x: number, y: number) => {
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(w - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(h - 1, Math.ceil(y + radius));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx + dy * dy <= r2) occupied[yy * w + xx] = 1;
      }
    }
  };

  const blocked = (x: number, y: number) => {
    const xx = clamp(Math.round(x), 0, w - 1);
    const yy = clamp(Math.round(y), 0, h - 1);
    return occupied[yy * w + xx] === 1;
  };

  const inside = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
    return mask[Math.round(y) * w + Math.round(x)] === 1;
  };

  const snap = (x: number, y: number, travel: number) => {
    const normal = travel + Math.PI / 2;
    const c = Math.cos(normal);
    const s = Math.sin(normal);
    const reach = spacing * 0.28;
    let bestT = 0;
    let bestV = sample(gray, w, h, x, y);
    for (let t = -reach; t <= reach; t += 0.5) {
      const v = sample(gray, w, h, x + c * t, y + s * t);
      if (v < bestV) {
        bestV = v;
        bestT = t;
      }
    }
    return { x: x + c * bestT * 0.55, y: y + s * bestT * 0.55 };
  };

  const seeds: Point[] = [];
  const grid = Math.max(3, Math.round(spacing * 0.72));
  const cx = w / 2;
  const cy = h / 2;
  for (let y = grid; y < h - grid; y += grid) {
    for (let x = grid; x < w - grid; x += grid) {
      if (!mask[y * w + x] || coherence[y * w + x] < 0.22) continue;
      seeds.push({ x, y });
    }
  }
  seeds.sort((a, b) => {
    const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
    const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
    return da - db;
  });

    const near = (pts: Point[], x: number, y: number, skipTail: number) => {
      const limit = (spacing * 0.55) ** 2;
      const end = Math.max(0, pts.length - skipTail);
      for (let i = 0; i < end; i += 3) {
        const dx = pts[i].x - x;
        const dy = pts[i].y - y;
        if (dx * dx + dy * dy < limit) return true;
      }
      return false;
    };

    const trace = (sx: number, sy: number, sign: number, avoid: Point[]): Point[] => {
    const pts: Point[] = [];
    let x = sx;
    let y = sy;
    let dir = sampleAngle(angle, w, h, x, y);
    if (sign < 0) dir += Math.PI;
    let outside = 0;
    const maxSteps = Math.round((w + h) * 1.4);
    for (let n = 0; n < maxSteps; n++) {
      const a = sampleAngle(angle, w, h, x, y);
      const d1 = Math.abs(angleDiff(a, dir));
      const d2 = Math.abs(angleDiff(a + Math.PI, dir));
      const chosen = d1 <= d2 ? a : a + Math.PI;
      if (Math.abs(angleDiff(chosen, dir)) > 0.9) break;
      dir = dir + angleDiff(chosen, dir) * 0.65;
      let nx = x + Math.cos(dir) * step;
      let ny = y + Math.sin(dir) * step;
      if (!inside(nx, ny)) {
        outside++;
        if (outside > 3) break;
        x = nx;
        y = ny;
        continue;
      }
      outside = 0;
      if (n * step > spacing && blocked(nx, ny)) break;
      const snapped = snap(nx, ny, dir);
      nx = snapped.x;
      ny = snapped.y;
      if (near(pts, nx, ny, Math.ceil(spacing * 2)) || (n * step > spacing * 1.25 && near(avoid, nx, ny, 0))) break;
      x = nx;
      y = ny;
      pts.push({ x, y });
    }
    return pts;
  };

  const paths: Point[][] = [];
  for (const seed of seeds) {
    const si = Math.round(seed.y) * w + Math.round(seed.x);
    if (occupied[si]) continue;
    if (coherence[si] < 0.22) continue;
    const forward = trace(seed.x, seed.y, 1, []);
    const backward = trace(seed.x, seed.y, -1, forward);
    backward.reverse();
    const merged = [...backward, { x: seed.x, y: seed.y }, ...forward];
    if (merged.length < 8) continue;
    let path = smoothPath(merged, 3);
    path = smoothPath(path, 2);
    path = chaikin(path);
    path = resample(path, 2.4);
    if (pathLength(path) < minLen) continue;
    if (mostlyStraightLeftward(path)) path.reverse();
    for (let i = 0; i < path.length; i += 2) mark(path[i].x, path[i].y);
    paths.push(path);
  }

  return paths;
}

/**
 * Trace a fingerprint photograph into smooth ridge centerlines.
 * Lines follow the print's orientation field and sit on the dark ridges,
 * so the words later laid on them keep the person's actual pattern.
 */
function downsample(src: RGBA, maxEdge: number): RGBA {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxEdge) return src;
  const width = Math.max(8, Math.round(src.width * (maxEdge / longest)));
  const height = Math.max(8, Math.round(src.height * (maxEdge / longest)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor((y * src.height) / height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor((x * src.width) / width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy += Math.max(1, Math.floor((sy1 - sy0) / 3))) {
        for (let xx = sx0; xx < sx1; xx += Math.max(1, Math.floor((sx1 - sx0) / 3))) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = a / n;
    }
  }
  return { data, width, height };
}

export function extractRidges(src: RGBA, options: ExtractOptions = {}): RidgeSet {
  const sized = downsample(src, options.maxEdge ?? 640);
  const width = sized.width;
  const height = sized.height;
  let gray = grayscale(sized);

  const invert =
    options.invert === "yes" ? true : options.invert === "no" ? false : shouldInvert(gray, width, height);
  if (invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 1 - gray[i];
  }

  const illum = boxBlur(gray, width, height, Math.round(Math.min(width, height) * 0.06));
  const corrected = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    corrected[i] = gray[i] / Math.max(0.08, illum[i]);
  }
  gray = stretch(boxBlur(corrected, width, height, 1));

  const smoothR = clamp(Math.round(Math.min(width, height) / 38), 5, 12);
  const field = orientationField(gray, width, height, smoothR);
  const mask = buildMask(field.coherence, field.energy, width, height);
  let spacing = estimateSpacing(gray, field.angle, mask, width, height);
  const density = clamp(options.density ?? 1, 0.75, 1.45);
  spacing = clamp(spacing / density, MIN_SPACING - 1, MAX_SPACING);

  const paths = traceStreamlines(gray, field.angle, field.coherence, mask, width, height, spacing);
  return { paths, width, height, spacing };
}
