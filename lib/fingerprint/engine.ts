import { finishRidge } from "./geometry";
import type { ExtractDebug, ExtractOptions, ExtractResult, Pt, Ridge } from "./types";

const TARGET_PERIOD = 12;
const MAX_SIDE = 1400;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function sample(src: Float32Array, w: number, h: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return 0;
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * w + x0;
  const a = src[i];
  const b = src[i + 1];
  const c = src[i + w];
  const d = src[i + w + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function resizeBilinear(src: Float32Array, sw: number, sh: number, dw: number, dh: number) {
  const dst = new Float32Array(dw * dh);
  const sx = (sw - 1) / Math.max(1, dw - 1);
  const sy = (sh - 1) / Math.max(1, dh - 1);
  for (let y = 0; y < dh; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      dst[y * dw + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return dst;
}

function blurSeparable(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const r = Math.max(1, radius);
  const kernel: number[] = [];
  let sum = 0;
  const sigma = r / 1.6;
  for (let i = -r; i <= r; i++) {
    const g = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(g);
    sum += g;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = clamp(x + k, 0, w - 1);
        acc += src[y * w + xx] * kernel[k + r];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clamp(y + k, 0, h - 1);
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      dst[y * w + x] = acc;
    }
  }
  return dst;
}

function detectDarkRidges(gray: Float32Array, w: number, h: number) {
  const b = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  let border = 0;
  let bn = 0;
  let center = 0;
  let cn = 0;
  const x0 = Math.round(w * 0.3);
  const x1 = Math.round(w * 0.7);
  const y0 = Math.round(h * 0.3);
  const y1 = Math.round(h * 0.7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const onBorder = x < b || y < b || x >= w - b || y >= h - b;
      if (onBorder) {
        border += v;
        bn++;
      }
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        center += v;
        cn++;
      }
    }
  }
  const bm = border / Math.max(1, bn);
  const cm = center / Math.max(1, cn);
  if (cm < bm - 8) return true;
  if (cm > bm + 8) return false;
  let mean = 0;
  for (let i = 0; i < gray.length; i++) mean += gray[i];
  mean /= gray.length;
  return mean > 115;
}

function varianceMask(gray: Float32Array, w: number, h: number) {
  const block = 16;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const vars = new Float32Array(bw * bh);
  let maxV = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      const y1 = Math.min(h, (by + 1) * block);
      const x1 = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < y1; y++) {
        for (let x = bx * block; x < x1; x++) {
          const v = gray[y * w + x];
          sum += v;
          sum2 += v * v;
          n++;
        }
      }
      const mean = sum / n;
      const variance = Math.max(0, sum2 / n - mean * mean);
      vars[by * bw + bx] = variance;
      if (variance > maxV) maxV = variance;
    }
  }
  const thresh = Math.max(40, maxV * 0.12);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (vars[Math.floor(y / block) * bw + Math.floor(x / block)] > thresh) mask[y * w + x] = 1;
    }
  }
  return dilate(mask, w, h, 2);
}

function dilate(bin: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (bin[yy * w + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erode(bin: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let dy = -r; dy <= r && on; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !bin[yy * w + xx]) {
            on = 0;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function localNormalize(gray: Float32Array, mask: Uint8Array, w: number, h: number) {
  const block = 28;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const means = new Float32Array(bw * bh);
  const stds = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      const y1 = Math.min(h, (by + 1) * block);
      const x1 = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < y1; y++) {
        for (let x = bx * block; x < x1; x++) {
          if (!mask[y * w + x]) continue;
          const v = gray[y * w + x];
          sum += v;
          sum2 += v * v;
          n++;
        }
      }
      if (n < 8) {
        means[by * bw + bx] = 128;
        stds[by * bw + bx] = 24;
      } else {
        const mean = sum / n;
        means[by * bw + bx] = mean;
        stds[by * bw + bx] = Math.sqrt(Math.max(4, sum2 / n - mean * mean));
      }
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const bx = Math.floor(x / block);
      const by = Math.floor(y / block);
      const mean = means[by * bw + bx];
      const std = stds[by * bw + bx];
      out[i] = (gray[i] - mean) / std;
    }
  }
  return out;
}

function orientationField(src: Float32Array, mask: Uint8Array, w: number, h: number) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      gx[i] =
        -src[i - w - 1] + src[i - w + 1] +
        -2 * src[i - 1] + 2 * src[i + 1] +
        -src[i + w - 1] + src[i + w + 1];
      gy[i] =
        -src[i - w - 1] - 2 * src[i - w] - src[i - w + 1] +
        src[i + w - 1] + 2 * src[i + w] + src[i + w + 1];
    }
  }
  const block = 10;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const cos2 = new Float32Array(bw * bh);
  const sin2 = new Float32Array(bw * bh);
  const coh = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sc = 0;
      let ss = 0;
      let sw = 0;
      const y1 = Math.min(h - 1, (by + 1) * block);
      const x1 = Math.min(w - 1, (bx + 1) * block);
      for (let y = by * block; y < y1; y++) {
        for (let x = bx * block; x < x1; x++) {
          const i = y * w + x;
          const weight = gx[i] * gx[i] + gy[i] * gy[i];
          if (weight < 1e-6) continue;
          // Gradient angle from the structure tensor, then +90° for the ridge.
          const grad = 0.5 * Math.atan2(2 * gx[i] * gy[i], gx[i] * gx[i] - gy[i] * gy[i]);
          const ridge = grad + Math.PI / 2;
          sc += weight * Math.cos(2 * ridge);
          ss += weight * Math.sin(2 * ridge);
          sw += weight;
        }
      }
      const bi = by * bw + bx;
      if (sw > 0) {
        cos2[bi] = sc / sw;
        sin2[bi] = ss / sw;
        coh[bi] = Math.hypot(sc, ss) / sw;
      }
    }
  }
  // Smooth the doubled-angle field.
  const scos = new Float32Array(bw * bh);
  const ssin = new Float32Array(bw * bh);
  const scoh = new Float32Array(bw * bh);
  const rad = 2;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let c = 0;
      let s = 0;
      let hsum = 0;
      let wsum = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = bx + dx;
          const yy = by + dy;
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
          const weight = Math.exp(-(dx * dx + dy * dy) / 3.2) * (0.15 + coh[yy * bw + xx]);
          c += cos2[yy * bw + xx] * weight;
          s += sin2[yy * bw + xx] * weight;
          hsum += coh[yy * bw + xx] * weight;
          wsum += weight;
        }
      }
      scos[by * bw + bx] = c;
      ssin[by * bw + bx] = s;
      scoh[by * bw + bx] = wsum ? hsum / wsum : 0;
    }
  }
  const orient = new Float32Array(w * h);
  const coherence = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bx = clamp(Math.floor(x / block), 0, bw - 1);
      const by = clamp(Math.floor(y / block), 0, bh - 1);
      const bi = by * bw + bx;
      let ang = 0.5 * Math.atan2(ssin[bi], scos[bi]);
      if (ang < 0) ang += Math.PI;
      orient[y * w + x] = ang;
      coherence[y * w + x] = scoh[bi];
    }
  }
  return { orient, coherence };
}

function estimatePeriod(
  src: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  coherence: Float32Array,
  w: number,
  h: number,
) {
  const lags: number[] = [];
  const step = 36;
  for (let y = 24; y < h - 24; y += step) {
    for (let x = 24; x < w - 24; x += step) {
      const i = y * w + x;
      if (!mask[i] || coherence[i] < 0.45) continue;
      const theta = orient[i];
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      const vals: number[] = [];
      for (let k = -22; k <= 22; k++) vals.push(sample(src, w, h, x + nx * k, y + ny * k));
      let bestLag = 10;
      let best = -Infinity;
      for (let lag = 6; lag <= 18; lag++) {
        let c = 0;
        const n = vals.length - lag;
        for (let k = 0; k < n; k++) c += vals[k] * vals[k + lag];
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      lags.push(bestLag);
    }
  }
  if (lags.length < 4) return TARGET_PERIOD;
  lags.sort((a, b) => a - b);
  return lags[Math.floor(lags.length / 2)];
}

function gabor(
  src: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  period: number,
) {
  const nOri = 16;
  const radius = 7;
  const size = radius * 2 + 1;
  const freq = 1 / period;
  const sigmaAlong = 4.2;
  const sigmaAcross = 3.4;
  const kernels: Float32Array[] = [];
  for (let bin = 0; bin < nOri; bin++) {
    const ridge = (bin * Math.PI) / nOri;
    const tx = Math.cos(ridge);
    const ty = Math.sin(ridge);
    const nx = -ty;
    const ny = tx;
    const kernel = new Float32Array(size * size);
    let mean = 0;
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const along = x * tx + y * ty;
        const across = x * nx + y * ny;
        const gauss = Math.exp(
          -0.5 * ((along * along) / (sigmaAlong * sigmaAlong) + (across * across) / (sigmaAcross * sigmaAcross)),
        );
        const value = gauss * Math.cos(2 * Math.PI * freq * across);
        kernel[(y + radius) * size + (x + radius)] = value;
        mean += value;
      }
    }
    mean /= kernel.length;
    let pos = 0;
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] -= mean;
      if (kernel[i] > 0) pos += kernel[i];
    }
    const norm = pos || 1;
    for (let i = 0; i < kernel.length; i++) kernel[i] /= norm;
    kernels.push(kernel);
  }

  const out = new Float32Array(w * h);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let ang = orient[i];
      if (ang < 0) ang += Math.PI;
      let bin = Math.round((ang / Math.PI) * nOri) % nOri;
      if (bin < 0) bin += nOri;
      const kernel = kernels[bin];
      let acc = 0;
      let ki = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const row = (y + ky) * w + (x - radius);
        for (let kx = 0; kx < size; kx++) acc += src[row + kx] * kernel[ki++];
      }
      out[i] = acc;
    }
  }
  return out;
}

function nonMaxima(enhanced: Float32Array, orient: Float32Array, mask: Uint8Array, w: number, h: number, strong: number) {
  const peaks = new Float32Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const v = enhanced[i];
      if (v < strong * 0.35) continue;
      const theta = orient[i];
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      const p1 = sample(enhanced, w, h, x + nx, y + ny);
      const p2 = sample(enhanced, w, h, x - nx, y - ny);
      if (v >= p1 && v >= p2) peaks[i] = v;
    }
  }
  return peaks;
}

function meanAt(src: Float32Array, bin: Uint8Array, w: number, h: number, want: number) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === want) {
      s += src[i];
      n++;
    }
  }
  return n ? s / n : 0;
}

function stats(src: Float32Array, mask: Uint8Array) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    if (!mask[i]) continue;
    sum += src[i];
    sum2 += src[i] * src[i];
    n++;
  }
  const mean = sum / Math.max(1, n);
  const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
  return { mean, std, n };
}

function hysteresis(peaks: Float32Array, mask: Uint8Array, w: number, h: number, high: number, low: number) {
  const strong = new Uint8Array(w * h);
  const weak = new Uint8Array(w * h);
  for (let i = 0; i < peaks.length; i++) {
    if (!mask[i] || peaks[i] <= 0) continue;
    if (peaks[i] >= high) strong[i] = 1;
    else if (peaks[i] >= low) weak[i] = 1;
  }
  const out = strong.slice();
  const stack: number[] = [];
  for (let i = 0; i < strong.length; i++) if (strong[i]) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (weak[j] && !out[j]) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

function neighborCoords(x: number, y: number, w: number, h: number, bin: Uint8Array) {
  const out: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (bin[yy * w + xx]) out.push([xx, yy]);
    }
  }
  return out;
}

function degreeOf(bin: Uint8Array, w: number, h: number) {
  const deg = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!bin[y * w + x]) continue;
      deg[y * w + x] = neighborCoords(x, y, w, h, bin).length;
    }
  }
  return deg;
}

function zhangSuen(bin: Uint8Array, w: number, h: number) {
  const img = bin.slice();
  const kill: number[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard < 80) {
    changed = false;
    guard++;
    for (let pass = 0; pass < 2; pass++) {
      kill.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[(y - 1) * w + x];
          const p3 = img[(y - 1) * w + x + 1];
          const p4 = img[y * w + x + 1];
          const p5 = img[(y + 1) * w + x + 1];
          const p6 = img[(y + 1) * w + x];
          const p7 = img[(y + 1) * w + x - 1];
          const p8 = img[y * w + x - 1];
          const p9 = img[(y - 1) * w + x - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++;
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          kill.push(i);
        }
      }
      if (kill.length) changed = true;
      for (const i of kill) img[i] = 0;
    }
  }
  return img;
}

function pruneSpurs(bin: Uint8Array, w: number, h: number, maxLen: number) {
  const img = bin.slice();
  for (let round = 0; round < 6; round++) {
    const deg = degreeOf(img, w, h);
    const remove: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (deg[y * w + x] !== 1) continue;
        let cx = x;
        let cy = y;
        let px = -1;
        let py = -1;
        const walked: number[] = [];
        let hitJunction = false;
        for (let step = 0; step < maxLen; step++) {
          walked.push(cy * w + cx);
          const nbs = neighborCoords(cx, cy, w, h, img).filter((n) => n[0] !== px || n[1] !== py);
          if (nbs.length === 0) break;
          if (nbs.length > 1 || deg[cy * w + cx] >= 3 && step > 0) {
            hitJunction = true;
            break;
          }
          px = cx;
          py = cy;
          cx = nbs[0][0];
          cy = nbs[0][1];
          if (deg[cy * w + cx] >= 3) {
            hitJunction = true;
            break;
          }
        }
        if (hitJunction && walked.length <= maxLen && walked.length > 0) {
          remove.push(...walked);
        }
      }
    }
    if (!remove.length) break;
    for (const i of remove) img[i] = 0;
  }
  return img;
}

function linkGaps(bin: Uint8Array, orient: Float32Array, w: number, h: number, maxGap: number) {
  const img = bin.slice();
  const deg = degreeOf(img, w, h);
  const ends: [number, number][] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (deg[y * w + x] === 1) ends.push([x, y]);
    }
  }
  const used = new Uint8Array(ends.length);
  for (let i = 0; i < ends.length; i++) {
    if (used[i]) continue;
    const [x, y] = ends[i];
    const nbs = neighborCoords(x, y, w, h, img);
    if (!nbs.length) continue;
    let tx = x - nbs[0][0];
    let ty = y - nbs[0][1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let best = -1;
    let bestD = maxGap;
    for (let j = 0; j < ends.length; j++) {
      if (i === j || used[j]) continue;
      const [x2, y2] = ends[j];
      const dx = x2 - x;
      const dy = y2 - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2 || dist > maxGap || dist >= bestD) continue;
      const ux = dx / dist;
      const uy = dy / dist;
      if (tx * ux + ty * uy < 0.72) continue;
      const n2 = neighborCoords(x2, y2, w, h, img);
      if (!n2.length) continue;
      let t2x = x2 - n2[0][0];
      let t2y = y2 - n2[0][1];
      const t2l = Math.hypot(t2x, t2y) || 1;
      t2x /= t2l;
      t2y /= t2l;
      if (t2x * ux + t2y * uy > -0.45) continue;
      // Don't bridge across a parallel ridge: the gap should agree with orientation.
      const ang = orient[y * w + x];
      const ox = Math.cos(ang);
      const oy = Math.sin(ang);
      if (Math.abs(ox * ux + oy * uy) < 0.65) continue;
      let blocked = false;
      const steps = Math.ceil(dist);
      for (let s = 1; s < steps; s++) {
        const sx = Math.round(x + ux * (dist * s) / steps);
        const sy = Math.round(y + uy * (dist * s) / steps);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        if (img[sy * w + sx] && !(sx === x2 && sy === y2)) {
          // Allow the destination pixel only.
          const nearDest = Math.hypot(sx - x2, sy - y2) < 1.2;
          if (!nearDest) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;
      best = j;
      bestD = dist;
    }
    if (best < 0) continue;
    used[i] = 1;
    used[best] = 1;
    const [x2, y2] = ends[best];
    const steps = Math.ceil(bestD);
    for (let s = 0; s <= steps; s++) {
      const sx = Math.round(x + ((x2 - x) * s) / steps);
      const sy = Math.round(y + ((y2 - y) * s) / steps);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) img[sy * w + sx] = 1;
    }
  }
  return img;
}

function dropSpecks(bin: Uint8Array, w: number, h: number, minSize: number) {
  const seen = new Uint8Array(w * h);
  const img = bin.slice();
  const stack: number[] = [];
  for (let start = 0; start < img.length; start++) {
    if (!img[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    const comp: number[] = [];
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (img[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (comp.length < minSize) for (const i of comp) img[i] = 0;
  }
  return img;
}

function traceSkeleton(bin: Uint8Array, w: number, h: number, minLength: number): Ridge[] {
  const used = new Set<string>();
  const key = (ax: number, ay: number, bx: number, by: number) => {
    const a = `${ax},${ay}`;
    const b = `${bx},${by}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const deg = degreeOf(bin, w, h);
  const ridges: Ridge[] = [];

  function walk(sx: number, sy: number, nx: number, ny: number): Pt[] {
    const pts: Pt[] = [{ x: sx, y: sy }];
    let px = sx;
    let py = sy;
    let cx = nx;
    let cy = ny;
    used.add(key(px, py, cx, cy));
    let guard = 0;
    while (guard++ < w * h) {
      pts.push({ x: cx, y: cy });
      if (cx === sx && cy === sy && pts.length > 3) break;
      const nbs = neighborCoords(cx, cy, w, h, bin).filter((n) => !(n[0] === px && n[1] === py));
      if (nbs.length !== 1) break;
      const edge = key(cx, cy, nbs[0][0], nbs[0][1]);
      if (used.has(edge)) break;
      used.add(edge);
      px = cx;
      py = cy;
      cx = nbs[0][0];
      cy = nbs[0][1];
    }
    return pts;
  }

  const seeds: [number, number][] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = deg[y * w + x];
      if (d === 1 || d >= 3) seeds.push([x, y]);
    }
  }
  for (const [x, y] of seeds) {
    for (const n of neighborCoords(x, y, w, h, bin)) {
      if (used.has(key(x, y, n[0], n[1]))) continue;
      const pts = walk(x, y, n[0], n[1]);
      const closed = pts.length > 6 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
      const ridge = finishRidge(pts, closed, minLength);
      if (ridge) ridges.push(ridge);
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!bin[y * w + x]) continue;
      for (const n of neighborCoords(x, y, w, h, bin)) {
        if (used.has(key(x, y, n[0], n[1]))) continue;
        const pts = walk(x, y, n[0], n[1]);
        const closed = pts.length > 6 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 2.2;
        const ridge = finishRidge(pts, closed, minLength);
        if (ridge) ridges.push(ridge);
      }
    }
  }
  ridges.sort((a, b) => b.length - a.length);
  return ridges;
}

function prepare(gray: Float32Array, w: number, h: number, ridgesAreDark: boolean) {
  const bright = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) bright[i] = ridgesAreDark ? 255 - gray[i] : gray[i];
  const soft = blurSeparable(bright, w, h, 1);
  let mask = varianceMask(soft, w, h);
  const { orient, coherence } = orientationField(soft, mask, w, h);
  for (let i = 0; i < mask.length; i++) {
    if (coherence[i] < 0.22) mask[i] = 0;
  }
  mask = dilate(mask, w, h, 1);
  const norm = localNormalize(soft, mask, w, h);
  const period = estimatePeriod(norm, orient, mask, coherence, w, h);
  return { mask, orient, coherence, norm, period };
}

export function extractFromGray(grayIn: Float32Array, widthIn: number, heightIn: number, options: ExtractOptions = {}): ExtractResult {
  const warnings: string[] = [];
  const targetPeriod = options.targetPeriod ?? TARGET_PERIOD;
  const maxSide = options.maxSide ?? MAX_SIDE;
  let gray = grayIn;
  let w = widthIn;
  let h = heightIn;

  const long = Math.max(w, h);
  if (long > maxSide) {
    const s = maxSide / long;
    const nw = Math.max(32, Math.round(w * s));
    const nh = Math.max(32, Math.round(h * s));
    gray = resizeBilinear(gray, w, h, nw, nh);
    w = nw;
    h = nh;
  }

  let ridgesAreDark =
    options.ridges === "dark" ? true : options.ridges === "light" ? false : detectDarkRidges(gray, w, h);

  let prep = prepare(gray, w, h, ridgesAreDark);
  if (options.rescale !== false && prep.period >= 6 && prep.period <= 22) {
    let scale = targetPeriod / prep.period;
    let nw = Math.round(w * scale);
    let nh = Math.round(h * scale);
    const side = Math.max(nw, nh);
    if (side > maxSide) {
      const cap = maxSide / side;
      nw = Math.round(nw * cap);
      nh = Math.round(nh * cap);
    }
    if (nw >= 64 && nh >= 64 && (Math.abs(nw - w) > 8 || Math.abs(nh - h) > 8)) {
      gray = resizeBilinear(gray, w, h, nw, nh);
      w = nw;
      h = nh;
      prep = prepare(gray, w, h, ridgesAreDark);
    }
  }

  let enhanced = gabor(prep.norm, prep.orient, prep.mask, w, h, prep.period);
  const st = stats(enhanced, prep.mask);
  let peaks = nonMaxima(enhanced, prep.orient, prep.mask, w, h, st.mean + 0.15 * st.std);

  // If the filter locked onto valleys, the "ridges" will sit on the lighter paper.
  const peakMask = new Uint8Array(w * h);
  let peakCount = 0;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > 0) {
      peakMask[i] = 1;
      peakCount++;
    }
  }
  if (peakCount > 50) {
    const onRidge = meanAt(gray, peakMask, w, h, 1);
    let paperSum = 0;
    let paperN = 0;
    for (let i = 0; i < gray.length; i++) {
      if (prep.mask[i] && !peakMask[i]) {
        paperSum += gray[i];
        paperN++;
      }
    }
    const paper = paperN ? paperSum / paperN : onRidge;
    const landedOnInk = ridgesAreDark ? onRidge < paper : onRidge > paper;
    if (!landedOnInk) {
      for (let i = 0; i < enhanced.length; i++) enhanced[i] = -enhanced[i];
      const st2 = stats(enhanced, prep.mask);
      peaks = nonMaxima(enhanced, prep.orient, prep.mask, w, h, st2.mean + 0.15 * st2.std);
      warnings.push("Adjusted which bands were treated as ridges.");
    }
  }

  const est = stats(peaks, prep.mask);
  const high = Math.max(0.02, est.mean + 0.35 * est.std);
  const low = Math.max(0.008, est.mean * 0.45);
  let binary = hysteresis(peaks, prep.mask, w, h, high, low);
  binary = dropSpecks(binary, w, h, Math.round(prep.period * 1.4));
  let skeleton = zhangSuen(binary, w, h);
  skeleton = pruneSpurs(skeleton, w, h, Math.round(prep.period * 0.55));
  skeleton = linkGaps(skeleton, prep.orient, w, h, prep.period * 0.62);
  skeleton = pruneSpurs(skeleton, w, h, Math.round(prep.period * 0.4));
  skeleton = dropSpecks(skeleton, w, h, Math.round(prep.period * 1.6));

  const minLength = prep.period * 2.2;
  const ridges = traceSkeleton(skeleton, w, h, minLength);
  if (ridges.length < 8) {
    warnings.push("Few ridge lines were found. Try a closer, sharper photo with the print filling the frame.");
  }

  const debug: ExtractDebug | undefined = options.debug
    ? { normalized: prep.norm, enhanced, binary, skeleton }
    : undefined;

  return {
    width: w,
    height: h,
    period: prep.period,
    ridges,
    warnings,
    ridgesAreDark,
    debug,
  };
}

export function rgbaToGray(rgba: Uint8Array, width: number, height: number) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return gray;
}
