import { cutCrossings, finishRidge, joinRidges, polishPath, relaxCurvature, resamplePath, ridgeFromPoints, trimSeparation } from "./geometry";
import { printCore, ridgePitch } from "./lettering";
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

function dilateAxis(bin: Uint8Array, w: number, h: number, r: number, horizontal: boolean) {
  const out = new Uint8Array(w * h);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let o = 0; o < outer; o++) {
    const at = (i: number) => (horizontal ? bin[o * w + i] : bin[i * w + o]);
    const set = (i: number, v: number) => {
      if (horizontal) out[o * w + i] = v;
      else out[i * w + o] = v;
    };
    let run = 0;
    for (let i = 0; i < inner; i++) {
      if (at(i)) run = r + 1;
      set(i, run > 0 ? 1 : 0);
      if (run) run--;
    }
    run = 0;
    for (let i = inner - 1; i >= 0; i--) {
      if (at(i)) run = r + 1;
      if (run > 0) set(i, 1);
      if (run) run--;
    }
  }
  return out;
}

function dilateSep(bin: Uint8Array, w: number, h: number, r: number) {
  if (r <= 0) return bin;
  return dilateAxis(dilateAxis(bin, w, h, r, true), w, h, r, false);
}

function erodeSep(bin: Uint8Array, w: number, h: number, r: number) {
  if (r <= 0) return bin;
  const inv = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) inv[i] = bin[i] ? 0 : 1;
  const grown = dilateSep(inv, w, h, r);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = grown[i] ? 0 : 1;
  return out;
}

function countOn(bin: Uint8Array) {
  let n = 0;
  for (let i = 0; i < bin.length; i++) n += bin[i];
  return n;
}

/** Bright paper tone from the top and bottom margins, ignoring ink that reaches an edge. */
function paperTone(gray: Float32Array, w: number, h: number, ridgesAreDark: boolean) {
  const band = Math.max(3, Math.round(h * 0.03));
  const samples: number[] = [];
  const take = (y: number) => {
    for (let x = 0; x < w; x += 2) samples.push(gray[y * w + x]);
  };
  for (let y = 0; y < band; y++) take(y);
  for (let y = Math.max(0, h - band); y < h; y++) take(y);
  if (!samples.length) return ridgesAreDark ? 220 : 30;
  samples.sort((a, b) => a - b);
  const q = ridgesAreDark ? 0.72 : 0.28;
  return samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
}

function smoothEdge(values: Float32Array, radius: number) {
  const median = new Float32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) continue;
    const window: number[] = [];
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length || values[j] < 0) continue;
      window.push(values[j]);
    }
    if (!window.length) continue;
    window.sort((a, b) => a - b);
    median[i] = window[Math.floor(window.length / 2)];
  }
  const blurred = new Float32Array(values.length).fill(-1);
  const rad = Math.max(4, Math.round(radius * 0.65));
  for (let i = 0; i < median.length; i++) {
    if (median[i] < 0) continue;
    let acc = 0;
    let weight = 0;
    for (let k = -rad; k <= rad; k++) {
      const j = i + k;
      if (j < 0 || j >= median.length || median[j] < 0) continue;
      const w = Math.exp(-(k * k) / (2 * rad * rad));
      acc += median[j] * w;
      weight += w;
    }
    blurred[i] = weight ? acc / weight : median[i];
  }
  return blurred;
}

/**
 * The print's own ink outline: narrower at the fingertip, round through the
 * middle. A pale corner outside that outline is left as paper.
 */
function contourMask(component: Uint8Array, w: number, h: number) {
  const left = new Float32Array(h).fill(-1);
  const right = new Float32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    let run = 0;
    let runL = -1;
    let best = 0;
    let bestL = -1;
    let bestR = -1;
    const row = y * w;
    for (let x = 0; x <= w; x++) {
      const on = x < w && component[row + x] === 1;
      if (on) {
        if (runL < 0) runL = x;
        run++;
      } else if (runL >= 0) {
        if (run > best) {
          best = run;
          bestL = runL;
          bestR = x - 1;
        }
        run = 0;
        runL = -1;
      }
    }
    if (best >= 18) {
      left[y] = bestL;
      right[y] = bestR;
    }
  }
  const edgeRadius = Math.max(40, Math.round(Math.min(w, h) * 0.055));
  const smoothL = smoothEdge(left, edgeRadius);
  const smoothR = smoothEdge(right, edgeRadius);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    if (smoothL[y] < 0 || smoothR[y] < smoothL[y]) continue;
    const x0 = Math.max(0, Math.round(smoothL[y]));
    const x1 = Math.min(w - 1, Math.round(smoothR[y]));
    const row = y * w;
    for (let x = x0; x <= x1; x++) out[row + x] = 1;
  }
  return out;
}

/**
 * The whole inked oval, not only the sharpest blocks. Valleys between thin
 * ridges are closed so the silhouette stays one piece, then clipped to the
 * print's own outline so words cannot sit in the blank margin.
 */
function printSilhouette(gray: Float32Array, varied: Uint8Array, w: number, h: number, ridgesAreDark: boolean, delta = 30) {
  const paper = paperTone(gray, w, h, ridgesAreDark);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (ridgesAreDark ? v < paper - delta : v > paper + delta) ink[i] = 1;
  }
  const radius = Math.max(6, Math.round(Math.min(w, h) * 0.007));
  let solid = dilateSep(ink, w, h, radius);
  solid = erodeSep(solid, w, h, Math.max(1, radius - 2));
  solid = fillHoles(solid, w, h);
  solid = largestComponent(solid, w, h);
  solid = contourMask(solid, w, h);
  solid = erodeSep(solid, w, h, 2);
  const variedSolid = Uint8Array.from(solidifyMask(varied, w, h));
  const inkN = countOn(solid);
  if (inkN < w * h * 0.02) solid = variedSolid;
  if (process.env.RIDGE_DEBUG) {
    let minY = h;
    let maxY = 0;
    let minX = w;
    let maxX = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solid[y * w + x]) continue;
        n++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    console.log("silhouette", `${n}px`, `paper ${paper.toFixed(1)}`, `x ${minX}-${maxX}`, `y ${minY}-${maxY}`);
  }
  return solid;
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

function blurDoubled(cosSrc: Float32Array, sinSrc: Float32Array, cohSrc: Float32Array, bw: number, bh: number, radius: number) {
  const weight = new Float32Array(bw * bh);
  for (let i = 0; i < weight.length; i++) {
    weight[i] = Math.hypot(cosSrc[i], sinSrc[i]) > 1e-5 ? 0.25 + cohSrc[i] : 0;
  }
  const cos = blurWeighted(cosSrc, weight, bw, bh, radius);
  const sin = blurWeighted(sinSrc, weight, bw, bh, radius);
  const coh = new Float32Array(bw * bh);
  for (let i = 0; i < coh.length; i++) coh[i] = Math.min(1, Math.hypot(cos[i], sin[i]));
  return { cos, sin, coh };
}

/** Normalized separable blur. Samples with zero weight do not pull the field. */
function blurWeighted(src: Float32Array, weight: Float32Array, bw: number, bh: number, radius: number) {
  const r = Math.max(1, radius);
  const kernel: number[] = [];
  let sum = 0;
  const sigma = r / 1.45;
  for (let i = -r; i <= r; i++) {
    const g = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(g);
    sum += g;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(bw * bh);
  const tmpW = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let acc = 0;
      let wsum = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= bw) continue;
        const j = y * bw + xx;
        const wgt = weight[j] * kernel[k + r];
        if (wgt <= 0) continue;
        acc += src[j] * wgt;
        wsum += wgt;
      }
      tmp[y * bw + x] = acc;
      tmpW[y * bw + x] = wsum;
    }
  }
  const dst = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let acc = 0;
      let wsum = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= bh) continue;
        const j = yy * bw + x;
        const wgt = kernel[k + r];
        acc += tmp[j] * wgt;
        wsum += tmpW[j] * wgt;
      }
      dst[y * bw + x] = wsum > 1e-8 ? acc / wsum : 0;
    }
  }
  return dst;
}

function blockAngle(c: number, s: number) {
  let ang = 0.5 * Math.atan2(s, c);
  if (ang < 0) ang += Math.PI;
  return ang;
}

function wrapHalfPi(delta: number) {
  let x = delta;
  while (x > Math.PI / 2) x -= Math.PI;
  while (x <= -Math.PI / 2) x += Math.PI;
  return x;
}

/** Loop and whorl centers show up as a half or full turn of the orientation around a small circle. */
function poincareIndex(cos2: Float32Array, sin2: Float32Array, bw: number, bh: number, bx: number, by: number, radius: number) {
  const n = 16;
  let sum = 0;
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const xx = Math.round(bx + Math.cos(t) * radius);
    const yy = Math.round(by + Math.sin(t) * radius);
    if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) return 0;
    const ang = blockAngle(cos2[yy * bw + xx], sin2[yy * bw + xx]);
    if (i > 0) sum += wrapHalfPi(ang - prev);
    prev = ang;
  }
  return sum / Math.PI;
}

function smoothstep01(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerpOri(a: number, b: number, t: number) {
  const c = (1 - t) * Math.cos(2 * a) + t * Math.cos(2 * b);
  const s = (1 - t) * Math.sin(2 * a) + t * Math.sin(2 * b);
  return blockAngle(c, s);
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
  // A light pass first, so the loop core can still be found before the heavy blur.
  const light = blurDoubled(cos2, sin2, coh, bw, bh, 2);
  const scos = light.cos;
  const ssin = light.sin;
  const scoh = light.coh;
  // Carry a reliable direction into smudged blocks so ridges can cross them.
  const inside = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      let on = 0;
      const y1 = Math.min(h, (by + 1) * block);
      const x1 = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < y1; y += 2) {
        for (let x = bx * block; x < x1; x += 2) {
          n++;
          if (mask[y * w + x]) on++;
        }
      }
      inside[by * bw + bx] = on > n * 0.28 ? 1 : 0;
    }
  }
  const reliable = new Uint8Array(bw * bh);
  for (let i = 0; i < inside.length; i++) {
    reliable[i] = inside[i] && scoh[i] > 0.36 && Math.hypot(scos[i], ssin[i]) > 1e-4 ? 1 : 0;
  }
  let curC = scos;
  let curS = ssin;
  for (let iter = 0; iter < 18; iter++) {
    const nextC = curC.slice();
    const nextS = curS.slice();
    let filled = 0;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const bi = by * bw + bx;
        if (!inside[bi] || reliable[bi]) continue;
        let c = 0;
        let s = 0;
        let wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = bx + dx;
            const yy = by + dy;
            if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
            const j = yy * bw + xx;
            if (!inside[j]) continue;
            const mag = Math.hypot(curC[j], curS[j]);
            if (mag < 1e-5) continue;
            const weight = (reliable[j] ? 4 : 1) / (1 + dx * dx + dy * dy);
            c += (curC[j] / mag) * weight;
            s += (curS[j] / mag) * weight;
            wsum += weight;
          }
        }
        if (wsum > 0) {
          nextC[bi] = c / wsum;
          nextS[bi] = s / wsum;
          filled++;
        }
      }
    }
    curC = nextC;
    curS = nextS;
    if (!filled) break;
  }
  const core = findLoopCore(curC, curS, inside, bw, bh);
  const capFlat = capHorizontal(curC, curS, inside, core.bx, core.by, bw);
  if (process.env.RIDGE_DEBUG) console.log("core", core.found, core.kind, "flat", capFlat.toFixed(2), "by", core.by.toFixed(0));
  const heavy = blurDoubled(curC, curS, scoh, bw, bh, 4);
  const heavyAgain = blurDoubled(heavy.cos, heavy.sin, heavy.coh, bw, bh, 3);
  const blendedC = new Float32Array(bw * bh);
  const blendedS = new Float32Array(bw * bh);
  for (let i = 0; i < blendedC.length; i++) {
    const bx = i % bw;
    const by = Math.floor(i / bw);
    const dist = Math.hypot(bx - core.bx, by - core.by);
    // Keep the loop itself. Everywhere else, use the large-radius field.
    const useHeavy = smoothstep01((dist - 2.4) / 3.2);
    blendedC[i] = curC[i] * (1 - useHeavy) + heavyAgain.cos[i] * useHeavy;
    blendedS[i] = curS[i] * (1 - useHeavy) + heavyAgain.sin[i] * useHeavy;
  }
  curC = blendedC;
  curS = blendedS;
  const orient = new Float32Array(w * h);
  const coherence = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = clamp(x / block - 0.5, 0, bw - 1.001);
      const gy = clamp(y / block - 0.5, 0, bh - 1.001);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const y1 = Math.min(bh - 1, y0 + 1);
      const i00 = y0 * bw + x0;
      const i10 = y0 * bw + x1;
      const i01 = y1 * bw + x0;
      const i11 = y1 * bw + x1;
      const c =
        curC[i00] * (1 - tx) * (1 - ty) +
        curC[i10] * tx * (1 - ty) +
        curC[i01] * (1 - tx) * ty +
        curC[i11] * tx * ty;
      const s =
        curS[i00] * (1 - tx) * (1 - ty) +
        curS[i10] * tx * (1 - ty) +
        curS[i01] * (1 - tx) * ty +
        curS[i11] * tx * ty;
      let ang = 0.5 * Math.atan2(s, c);
      if (ang < 0) ang += Math.PI;
      orient[y * w + x] = ang;
      coherence[y * w + x] =
        scoh[i00] * (1 - tx) * (1 - ty) +
        scoh[i10] * tx * (1 - ty) +
        scoh[i01] * (1 - tx) * ty +
        scoh[i11] * tx * ty;
    }
  }
  const coreX = (core.bx + 0.5) * block;
  const coreY = (core.by + 0.5) * block;
  const arcCap = core.found && (core.kind === "loop" || capFlat >= 0.62);
  if (arcCap) nestArcsAboveCore(orient, mask, w, h, coreX, coreY);
  return { orient, coherence, coreX, coreY: core.found ? coreY : maskCoreY(mask, w, h), arcCap };
}

function findLoopCore(cos2: Float32Array, sin2: Float32Array, inside: Uint8Array, bw: number, bh: number) {
  let top = bh;
  let bottom = 0;
  let left = bw;
  let right = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!inside[y * bw + x]) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const spanY = Math.max(1, bottom - top);
  const spanX = Math.max(1, right - left);
  // The fingertip curls into a false core. Keep the search on the loop, not the outline.
  const minY = top + Math.max(4, spanY * 0.14);
  const maxY = top + spanY * 0.62;
  const minX = left + spanX * 0.2;
  const maxX = right - spanX * 0.2;
  let best = -Infinity;
  let bx = (left + right) / 2;
  let by = top + spanY * 0.4;
  let found = false;
  let kind: "loop" | "whorl" = "loop";
  let bestLoop = -Infinity;
  let loopBy = -1;
  for (let y = Math.ceil(minY); y <= maxY; y++) {
    for (let x = Math.ceil(minX); x <= maxX; x++) {
      if (y < 3 || x < 3 || y >= bh - 3 || x >= bw - 3) continue;
      if (!inside[y * bw + x]) continue;
      const index = Math.abs(poincareIndex(cos2, sin2, bw, bh, x, y, 3));
      const loop = Math.abs(index - 0.5);
      const whorl = Math.abs(index - 1);
      const miss = Math.min(loop, whorl);
      if (whorl >= loop && miss <= 0.2 && index >= 0.28 && (1 - miss) - ((y - top) / spanY) * 0.2 > bestLoop) {
        bestLoop = (1 - miss) - ((y - top) / spanY) * 0.2;
        loopBy = y;
      }
      if (miss > 0.2 || index < 0.28) continue;
      // Prefer the upper singularity (the loop) over a delta lower on the finger.
      const score = (1 - miss) + (index > 0.75 ? 0.05 : 0.25) - ((y - top) / spanY) * 0.35;
      if (score > best) {
        best = score;
        bx = x;
        by = y;
        found = true;
        kind = whorl < loop ? "whorl" : "loop";
      }
    }
  }
  if (process.env.RIDGE_DEBUG) console.log("loopBy", loopBy, "bestLoop", bestLoop.toFixed(2));
  return { bx, by, found, kind };
}

/** Share of the cap, above the core and away from the sides, that already runs near horizontal. */
function capHorizontal(cos2: Float32Array, sin2: Float32Array, inside: Uint8Array, bx: number, by: number, bw: number) {
  let top = Infinity;
  let bottom = 0;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    const y = Math.floor(i / bw);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  let n = 0;
  let flat = 0;
  const y0 = Number.isFinite(top) ? top : 0;
  const y1 = y0 + Math.max(4, Math.round((bottom - y0) * 0.34));
  void bx;
  void by;
  const x0 = Math.max(0, Math.floor(bw * 0.28));
  const x1 = Math.min(bw - 1, Math.ceil(bw * 0.72));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside[y * bw + x]) continue;
      const ang = blockAngle(cos2[y * bw + x], sin2[y * bw + x]);
      const tilt = Math.min(ang, Math.PI - ang);
      n++;
      if (tilt < 0.42) flat++;
    }
  }
  return n >= 8 ? flat / n : 0;
}

function maskCoreY(mask: Uint8Array, w: number, h: number) {
  let top = h;
  let bottom = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (bottom <= top) return h * 0.55;
  return top + (bottom - top) * 0.58;
}

/**
 * Above the loop, replace the noisy print direction with nested shallow arcs.
 * Image y grows downward, so a positive slope on the right side bows each row
 * down toward the oval's edge.
 */
function nestArcsAboveCore(orient: Float32Array, mask: Uint8Array, w: number, h: number, coreX: number, coreYIn: number, strength = 0.98) {
  let top = h;
  let bottom = 0;
  const left = new Float32Array(h).fill(-1);
  const right = new Float32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (left[y] < 0) left[y] = x;
      right[y] = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (bottom <= top) return;
  const coreY = coreYIn > 0 ? coreYIn : top + (bottom - top) * 0.58;
  const span = Math.max(12, coreY - top);
  for (let y = 0; y < h; y++) {
    if (left[y] < 0 || y >= coreY) continue;
    const u = clamp((coreY - y) / span, 0, 1);
    const fade = smoothstep01((u - 0.08) / 0.2);
    if (fade < 0.03) continue;
    const half = Math.max(8, (right[y] - left[y]) / 2);
    const cx = (left[y] + right[y]) / 2 * 0.7 + coreX * 0.3;
    const row = y * w;
    for (let x = Math.round(left[y]); x <= right[y]; x++) {
      if (!mask[row + x]) continue;
      const nx = clamp((x - cx) / half, -1.2, 1.2);
      const slope = nx * 0.42;
      let target = Math.atan(slope);
      if (target < 0) target += Math.PI;
      orient[row + x] = lerpOri(orient[row + x], target, Math.min(1, fade * strength));
    }
  }
}

function estimatePeriod(
  src: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  coherence: Float32Array,
  w: number,
  h: number,
) {
  const gaps: number[] = [];
  const step = 22;
  for (let y = 30; y < h - 30; y += step) {
    for (let x = 30; x < w - 30; x += step) {
      const i = y * w + x;
      if (!mask[i] || coherence[i] < 0.32) continue;
      const theta = orient[i];
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      let prev = -999;
      let rising = false;
      let last = sample(src, w, h, x - nx * 40, y - ny * 40);
      for (let k = -39; k <= 40; k++) {
        const v = sample(src, w, h, x + nx * k, y + ny * k);
        if (v > last) rising = true;
        if (rising && v < last && last > 0.12) {
          const peak = k - 1;
          if (prev > -100) {
            const gap = peak - prev;
            if (gap >= 5 && gap <= 22) gaps.push(gap);
          }
          prev = peak;
          rising = false;
        }
        last = v;
      }
    }
  }
  if (gaps.length < 8) return TARGET_PERIOD;
  gaps.sort((a, b) => a - b);
  // A thick ridge can register twice. Drop gaps below the lower quartile when they are half the median.
  const mid = gaps[Math.floor(gaps.length * 0.5)];
  const kept = gaps.filter((gap) => gap >= mid * 0.62);
  const use = kept.length >= 8 ? kept : gaps;
  return use[Math.floor(use.length / 2)];
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
  const radius = 11;
  const size = radius * 2 + 1;
  const freq = 1 / period;
  const sigmaAlong = 6.4;
  const sigmaAcross = 3.2;
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

function median3(src: Float32Array, w: number, h: number) {
  const dst = new Float32Array(w * h);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dst[y * w + x] = src[y * w + x];
        continue;
      }
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) win[n++] = src[(y + dy) * w + (x + dx)];
      }
      for (let i = 1; i < 9; i++) {
        const v = win[i];
        let j = i;
        while (j > 0 && win[j - 1] > v) {
          win[j] = win[j - 1];
          j--;
        }
        win[j] = v;
      }
      dst[y * w + x] = win[4];
    }
  }
  return dst;
}

/** Walk the enhanced ridge centers so a noisy photo becomes long lines instead of a broken skeleton. */
function followRidges(
  enhanced: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  coherence: Float32Array,
  w: number,
  h: number,
  period: number,
) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < enhanced.length; i++) {
    if (!mask[i]) continue;
    sum += enhanced[i];
    sum2 += enhanced[i] * enhanced[i];
    n++;
  }
  const mean = sum / Math.max(1, n);
  const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
  const high = mean + 0.2 * std;
  const low = mean - 0.08 * std;
  const visited = new Uint8Array(w * h);
  const stride = Math.max(4, Math.round(period * 0.8));
  const minLength = Math.max(18, period * 2.6);
  const maxWeak = Math.max(6, Math.round(period * 1.7));
  const claim = Math.max(2.2, period * 0.34);
  const paths: Pt[][] = [];
  const stops = { border: 0, visited: 0, weak: 0, limit: 0, mask: 0, value: 0, coherence: 0 };

  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return null;
    return { i: yi * w + xi, x: xi, y: yi };
  };

  function localMax(x: number, y: number) {
    const cell = at(x, y);
    if (!cell || !mask[cell.i] || enhanced[cell.i] < high || visited[cell.i]) return false;
    const theta = orient[cell.i];
    const nx = -Math.sin(theta);
    const ny = Math.cos(theta);
    const center = enhanced[cell.i];
    const left = sample(enhanced, w, h, x + nx * 1.4, y + ny * 1.4);
    const right = sample(enhanced, w, h, x - nx * 1.4, y - ny * 1.4);
    return center >= left && center >= right;
  }

  function claimPath(points: Pt[]) {
    const r = Math.ceil(claim);
    for (const point of points) {
      const x0 = Math.round(point.x);
      const y0 = Math.round(point.y);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > claim * claim) continue;
          const xx = x0 + dx;
          const yy = y0 + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          visited[yy * w + xx] = 1;
        }
      }
    }
  }

  function walk(x0: number, y0: number, sign: number) {
    const origin = at(x0, y0);
    if (!origin) return [] as Pt[];
    let theta = orient[origin.i];
    let dirx = Math.cos(theta) * sign;
    let diry = Math.sin(theta) * sign;
    let x = x0;
    let y = y0;
    const points: Pt[] = [{ x, y }];
    let weak = 0;
    let lastStrong = 1;
    const limit = Math.round((w + h) * 1.4);
    for (let step = 0; step < limit; step++) {
      const here = at(x, y);
      if (!here) break;
      theta = orient[here.i];
      let fx = Math.cos(theta);
      let fy = Math.sin(theta);
      if (fx * dirx + fy * diry < 0) {
        fx = -fx;
        fy = -fy;
      }
      dirx = dirx * 0.42 + fx * 0.58;
      diry = diry * 0.42 + fy * 0.58;
      const dl = Math.hypot(dirx, diry) || 1;
      dirx /= dl;
      diry /= dl;
      let px = x + dirx * 0.92;
      let py = y + diry * 0.92;
      const nx = -diry;
      const ny = dirx;
      const centerV = sample(enhanced, w, h, px, py);
      let bestV = centerV;
      let bestOff = 0;
      const reach = period * 0.4;
      if (centerV >= low) {
        for (let off = -reach; off <= reach; off += 0.55) {
          const v = sample(enhanced, w, h, px + nx * off, py + ny * off);
          if (v > bestV + 0.015) {
            bestV = v;
            bestOff = off;
          }
        }
      }
      px += nx * bestOff;
      py += ny * bestOff;
      const next = at(px, py);
      if (!next) {
        if (process.env.RIDGE_DEBUG) stops.border++;
        break;
      }
      if (step > 8 && visited[next.i]) {
        if (process.env.RIDGE_DEBUG) stops.visited++;
        break;
      }
      const onMask = mask[next.i] === 1;
      const strong = onMask && bestV >= low && coherence[next.i] > 0.08;
      if (!strong) {
        weak++;
        if (weak > maxWeak) {
          if (process.env.RIDGE_DEBUG) {
            stops.weak++;
            if (!onMask) stops.mask++;
            else if (bestV < low) stops.value++;
            else stops.coherence++;
          }
          break;
        }
      } else {
        weak = 0;
        lastStrong = points.length + 1;
      }
      points.push({ x: px, y: py });
      x = px;
      y = py;
    }
    if (process.env.RIDGE_DEBUG) stops.limit++;
    return points.slice(0, lastStrong);
  }

  for (let y = stride; y < h - stride; y += stride) {
    for (let x = stride; x < w - stride; x += stride) {
      if (!localMax(x, y)) continue;
      const back = walk(x, y, -1);
      const fore = walk(x, y, 1);
      const points = back.reverse().concat(fore.slice(1));
      let length = 0;
      for (let i = 1; i < points.length; i++) {
        length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      if (length < minLength || points.length < 6) continue;
      claimPath(points);
      paths.push(points);
    }
  }

  if (process.env.RIDGE_DEBUG) console.log("ridge stops", stops, "paths", paths.length);
  const ridges: Ridge[] = [];
  for (const points of paths) {
    const closed = Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < period * 0.7
      && pathLengthOf(points) > period * 8;
    const ridge = finishRidge(points, closed, minLength);
    if (ridge) ridges.push(ridge);
  }
  return ridges;
}

function pathLengthOf(points: Pt[]) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

function fillHoles(bin: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qe = 0;
  const push = (i: number) => {
    if (i < 0 || i >= bin.length || seen[i] || bin[i]) return;
    seen[i] = 1;
    q[qe++] = i;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  let qs = 0;
  while (qs < qe) {
    const i = q[qs++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < bin.length) push(i + w);
  }
  const out = bin.slice();
  for (let i = 0; i < out.length; i++) {
    if (!out[i] && !seen[i]) out[i] = 1;
  }
  return out;
}

function largestComponent(bin: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let best: Uint8Array | null = null;
  let bestN = 0;
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue;
    let qs = 0;
    let qe = 0;
    q[qe++] = start;
    seen[start] = 1;
    const cells: number[] = [];
    while (qs < qe) {
      const i = q[qs++];
      cells.push(i);
      const x = i % w;
      if (x > 0 && bin[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        q[qe++] = i - 1;
      }
      if (x + 1 < w && bin[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        q[qe++] = i + 1;
      }
      if (i >= w && bin[i - w] && !seen[i - w]) {
        seen[i - w] = 1;
        q[qe++] = i - w;
      }
      if (i + w < bin.length && bin[i + w] && !seen[i + w]) {
        seen[i + w] = 1;
        q[qe++] = i + w;
      }
    }
    if (cells.length > bestN) {
      bestN = cells.length;
      const mask = new Uint8Array(w * h);
      for (const i of cells) mask[i] = 1;
      best = mask;
    }
  }
  return best ?? new Uint8Array(bin);
}

/** Close small gaps, fill the interior, and keep the print silhouette. */
function solidifyMask(mask: Uint8Array, w: number, h: number) {
  let solid: Uint8Array = dilate(mask, w, h, 4);
  solid = erode(solid, w, h, 3);
  solid = fillHoles(solid, w, h);
  solid = largestComponent(solid, w, h);
  solid = erode(solid, w, h, 2);
  return solid;
}

class SepGrid {
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

  nearest(x: number, y: number, own?: Pt[], ignoreTail = 0) {
    return this.nearestPoint(x, y, own, ignoreTail)?.d ?? Infinity;
  }

  nearestPoint(x: number, y: number, own?: Pt[], ignoreTail = 0) {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    let best = Infinity;
    let at: Pt | null = null;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const bucket = this.buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < best) {
            best = d;
            at = point;
          }
        }
      }
    }
    if (own && own.length > ignoreTail) {
      const stop = own.length - ignoreTail;
      for (let i = 0; i < stop; i += 2) {
        const d = Math.hypot(own[i].x - x, own[i].y - y);
        if (d < best) {
          best = d;
          at = own[i];
        }
      }
    }
    return at ? { d: best, x: at.x, y: at.y } : null;
  }
}

/**
 * Draw one continuous ridge per measured spacing by following the orientation
 * field, and pull each step onto the enhanced ridge when the ink is clear.
 */
function streamlineRidges(
  enhanced: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  period: number,
  sepFactor = 1,
  coreY = h * 0.5,
  arcCap = false,
) {
  const st = stats(enhanced, mask);
  const snapFloor = st.mean - 0.02 * st.std;
  const dsep = period * sepFactor;
  const pitch = ridgePitch(period);
  // Stop a step before a line enters the forbidden band around a neighbor.
  // The band is inside the seed pitch, so a legal neighbor does not cut the trace.
  const dtest = Math.min(dsep * 0.74, pitch * 0.8);
  const step = 0.85;
  const committed = new SepGrid(period * 0.42);
  const angAt = (x: number, y: number) => {
    const xi = clamp(Math.round(x), 0, w - 1);
    const yi = clamp(Math.round(y), 0, h - 1);
    return orient[yi * w + xi];
  };
  const inside = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 2 || yi < 2 || xi >= w - 2 || yi >= h - 2) return false;
    return mask[yi * w + xi] === 1;
  };
  const snapSeed = (x: number, y: number, dirx: number, diry: number) => {
    const nx = -diry;
    const ny = dirx;
    let best = 0;
    let bestV = -Infinity;
    const reach = Math.min(period * 0.16, 2.4);
    for (let off = -reach; off <= reach; off += 0.4) {
      const px = x + nx * off;
      const py = y + ny * off;
      if (committed.nearest(px, py) < dsep * 0.82) continue;
      const v = sample(enhanced, w, h, px, py);
      if (v > bestV) {
        bestV = v;
        best = off;
      }
    }
    if (bestV < snapFloor) return { x, y };
    return { x: x + nx * best, y: y + ny * best };
  };

  function trace(sx: number, sy: number, sign: number) {
    const pts: Pt[] = [];
    const own = new SepGrid(period * 0.42);
    const lag: Pt[] = [];
    let px = sx;
    let py = sy;
    const theta0 = angAt(px, py);
    let vx = Math.cos(theta0) * sign;
    let vy = Math.sin(theta0) * sign;
    let closed = false;
    const limit = Math.round((w + h) * 2.4);
    for (let i = 0; i < limit; i++) {
      if (!inside(px, py)) break;
      const nearOwn = pts.length > Math.round(period * 6) ? own.nearest(px, py) : Infinity;
      const nearOther = i > 5 ? committed.nearest(px, py) : Infinity;
      if (nearOther < dtest) break;
      if (nearOwn < dtest * 0.82) {
        closed = true;
        break;
      }
      const point = { x: px, y: py };
      pts.push(point);
      lag.push(point);
      if (lag.length > 16) own.add(lag.shift()!);
      const theta = angAt(px, py);
      let dx = Math.cos(theta);
      let dy = Math.sin(theta);
      if (dx * vx + dy * vy < 0) {
        dx = -dx;
        dy = -dy;
      }
      const blend = arcCap && py < coreY ? 0.22 : 0.36;
      let nvx = vx * (1 - blend) + dx * blend;
      let nvy = vy * (1 - blend) + dy * blend;
      const nlen = Math.hypot(nvx, nvy) || 1;
      nvx /= nlen;
      nvy /= nlen;
      const minRadius = arcCap && py < coreY ? Math.max(24, pitch * 2.4) : Math.max(12, pitch * 1.05);
      const maxTurn = step / minRadius;
      const turn = clamp(Math.atan2(vx * nvy - vy * nvx, vx * nvx + vy * nvy), -maxTurn, maxTurn);
      const ct = Math.cos(turn);
      const stn = Math.sin(turn);
      const ox = vx;
      const oy = vy;
      vx = ox * ct - oy * stn;
      vy = ox * stn + oy * ct;
      px += vx * step;
      py += vy * step;
    }
    return { pts, closed };
  }

  const stride = Math.max(4, Math.round(period * 0.85));
  const cap = 720;
  let bestX = w * 0.5;
  let bestY = h * 0.5;
  let bestV = -Infinity;
  for (let y = stride; y < h - stride; y += stride) {
    for (let x = stride; x < w - stride; x += stride) {
      if (!inside(x, y)) continue;
      const v = enhanced[Math.round(y) * w + Math.round(x)];
      if (v > bestV) {
        bestV = v;
        bestX = x;
        bestY = y;
      }
    }
  }
  const queue: Pt[] = [{ x: bestX, y: bestY }];
  const seeded = new SepGrid(period * 0.4);
  const raw: { points: Pt[]; closed: boolean }[] = [];
  const queueCap = 460;
  let spins = 0;
  let rejected = 0;
  let accepted = 0;
  let tooShort = 0;

  const accept = (points: Pt[], closed: boolean, minFactor: number) => {
    if (points.length < 12 || pathLengthOf(points) < period * minFactor) {
      tooShort++;
      return;
    }
    accepted++;
    let smooth = polishPath(points, Math.max(8, Math.round(pitch * 1.2)));
    smooth = relaxCurvature(smooth, Math.max(12, pitch * 1.05), arcCap ? { y: coreY, radius: Math.max(28, pitch * 2.6) } : undefined);
    smooth = resamplePath(smooth, 2.15);
    raw.push({ points: smooth, closed });
    for (let i = 0; i < smooth.length; i += 2) committed.add(smooth[i]);
    const hop = Math.max(6, Math.round(period * 0.65));
    for (let i = hop; i < smooth.length - 2; i += hop) {
      const a = smooth[Math.max(0, i - 3)];
      const b = smooth[Math.min(smooth.length - 1, i + 3)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      queue.push({ x: smooth[i].x + nx * dsep, y: smooth[i].y + ny * dsep });
      queue.push({ x: smooth[i].x - nx * dsep, y: smooth[i].y - ny * dsep });
    }
  };

  while (queue.length && raw.length < queueCap && spins < 12000) {
    spins++;
    const seed = queue.shift()!;
    if (!inside(seed.x, seed.y)) continue;
    if (committed.nearest(seed.x, seed.y) < dsep * 0.9) {
      rejected++;
      continue;
    }
    if (seeded.nearest(seed.x, seed.y) < period * 0.28) continue;
    const theta = angAt(seed.x, seed.y);
    let pulled = snapSeed(seed.x, seed.y, Math.cos(theta), Math.sin(theta));
    if (!inside(pulled.x, pulled.y) || committed.nearest(pulled.x, pulled.y) < dsep * 0.86) pulled = seed;
    if (committed.nearest(pulled.x, pulled.y) < dsep * 0.86) continue;
    seeded.add(pulled);
    const forward = trace(pulled.x, pulled.y, 1);
    const back = trace(pulled.x, pulled.y, -1);
    accept([...back.pts.reverse(), ...forward.pts.slice(1)], forward.closed || back.closed, 1.6);
  }

  for (let y = stride; y < h - stride && raw.length < cap; y += dsep * 0.7) {
    for (let x = stride; x < w - stride && raw.length < cap; x += dsep * 0.7) {
      if (!inside(x, y)) continue;
      if (committed.nearest(x, y) < dsep * 0.92) continue;
      const theta = angAt(x, y);
      let pulled = snapSeed(x, y, Math.cos(theta), Math.sin(theta));
      if (!inside(pulled.x, pulled.y) || committed.nearest(pulled.x, pulled.y) < dsep * 0.88) pulled = { x, y };
      if (committed.nearest(pulled.x, pulled.y) < dsep * 0.88) continue;
      const forward = trace(pulled.x, pulled.y, 1);
      const back = trace(pulled.x, pulled.y, -1);
      accept([...back.pts.reverse(), ...forward.pts.slice(1)], false, 1.8);
    }
  }

  const ridges: Ridge[] = [];
  for (const item of raw) {
    const ridge = finishRidge(item.points, item.closed, Math.max(10, period * 1.35));
    if (ridge) ridges.push(ridge);
  }
  ridges.sort((a, b) => b.length - a.length);
  if (process.env.RIDGE_DEBUG) {
    const mean = ridges.reduce((sum, ridge) => sum + ridge.length, 0) / Math.max(1, ridges.length);
    console.log("streamlines", ridges.length, "mean", mean.toFixed(0), "period", period.toFixed(2), "accepted", accepted, "short", tooShort, "rejected", rejected, "spins", spins);
  }
  return ridges;
}

function prepare(gray: Float32Array, w: number, h: number, ridgesAreDark: boolean, inkDelta = 30) {
  const bright = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) bright[i] = ridgesAreDark ? 255 - gray[i] : gray[i];
  const denoised = median3(bright, w, h);
  const soft = blurSeparable(denoised, w, h, 1);
  const varied = varianceMask(soft, w, h);
  const mask = printSilhouette(gray, varied, w, h, ridgesAreDark, inkDelta);
  const field = orientationField(soft, mask, w, h);
  const norm = localNormalize(soft, mask, w, h);
  const period = estimatePeriod(norm, field.orient, mask, field.coherence, w, h);
  return { mask, orient: field.orient, coherence: field.coherence, norm, period, coreY: field.coreY, arcCap: field.arcCap };
}

/**
 * Smooth every ridge, then reject or trim anything that comes within 0.8 of a
 * line-height pitch of a longer ridge. A crossing that still remains is cut.
 */
function settleRidges(ridges: Ridge[], period: number, coreY: number, arcCap = false) {
  const pitch = ridgePitch(period);
  const minSep = pitch * 0.8;
  const minKeep = Math.max(28, period * 2.5);
  const polished: Ridge[] = [];
  for (const ridge of ridges) {
    const ys = ridge.points.map((point) => point.y).sort((a, b) => a - b);
    const midY = ys[Math.floor(ys.length / 2)] ?? coreY;
    const radius = arcCap && midY < coreY ? Math.round(pitch * 2.05) : Math.round(pitch * 1.25);
    let pts = polishPath(ridge.points, radius);
    pts = relaxCurvature(
      pts,
      Math.max(12, pitch * 0.95),
      arcCap ? { y: coreY - pitch * 0.15, radius: Math.max(30, pitch * 3.2) } : undefined,
    );
    pts = resamplePath(pts, 2.2);
    const next = ridgeFromPoints(pts, false);
    if (next && next.length >= minKeep) polished.push(next);
  }
  const separated = trimSeparation(polished, minSep, minKeep);
  const opened = cutCrossings(separated, minKeep);
  const again = trimSeparation(opened, minSep, minKeep);
  const settled = cutCrossings(again, minKeep);
  if (process.env.RIDGE_DEBUG) {
    console.log("settle", ridges.length, "->", settled.length, "sep", minSep.toFixed(2), "coreY", coreY.toFixed(0), "arcs", arcCap);
  }
  settled.sort((a, b) => b.length - a.length);
  return settled;
}

/**
 * Above a loop, pull the direction field partway toward nested shallow arcs
 * and trace again. The loop and the lower print stay on the smoothed field.
 * A whorl, whose cap is steep, is left alone.
 */
function rebuildCap(
  ridges: Ridge[],
  enhanced: Float32Array,
  orient: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  period: number,
  sepFactor: number,
) {
  const core = printCore(ridges, period);
  const pitch = ridgePitch(period);
  let above = 0;
  let flat = 0;
  for (const ridge of ridges) {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i += 3) {
      const y = (pts[i].y + pts[i - 1].y) / 2;
      if (y > core.y - pitch) continue;
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI;
      const tilt = Math.min(ang, Math.PI - ang);
      above++;
      if (tilt < 0.7) flat++;
    }
  }
  const flatFrac = above ? flat / above : 0;
  if (above < 12 || flatFrac < 0.68 || flatFrac > 0.8) return ridges;
  const field = orient.slice();
  nestArcsAboveCore(field, mask, w, h, core.x, core.y, 0.84);
  const retraced = streamlineRidges(enhanced, field, mask, w, h, period, sepFactor, core.y, true);
  const merged = retraced.length > 6 ? settleRidges(joinRidges(retraced, period), period, core.y, true) : [];
  if (process.env.RIDGE_DEBUG) {
    console.log("cap", "core", core.x.toFixed(0), core.y.toFixed(0), "flat", flatFrac.toFixed(2), "out", merged.length, "was", ridges.length);
  }
  return merged.length >= ridges.length * 0.8 ? merged : ridges;
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

  const inkDelta = options.profile?.inkDelta ?? 30;
  const sepFactor = options.profile?.sepFactor ?? 1;
  let prep = prepare(gray, w, h, ridgesAreDark, inkDelta);
  for (let pass = 0; pass < 2 && options.rescale !== false; pass++) {
    if (prep.period < 6 || prep.period > 22) break;
    if (Math.abs(prep.period - targetPeriod) < 1.25) break;
    let scale = targetPeriod / prep.period;
    let nw = Math.round(w * scale);
    let nh = Math.round(h * scale);
    const side = Math.max(nw, nh);
    if (side > maxSide) {
      const cap = maxSide / side;
      nw = Math.round(nw * cap);
      nh = Math.round(nh * cap);
    }
    if (nw < 64 || nh < 64 || (Math.abs(nw - w) <= 8 && Math.abs(nh - h) <= 8)) break;
    gray = resizeBilinear(gray, w, h, nw, nh);
    w = nw;
    h = nh;
    prep = prepare(gray, w, h, ridgesAreDark, inkDelta);
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

  const traced = streamlineRidges(enhanced, prep.orient, prep.mask, w, h, prep.period, sepFactor, prep.coreY, prep.arcCap);
  let ridges = traced.length > 6 ? settleRidges(joinRidges(traced, prep.period), prep.period, prep.coreY, prep.arcCap) : [];
  if (ridges.length > 8) ridges = rebuildCap(ridges, enhanced, prep.orient, prep.mask, w, h, prep.period, sepFactor);

  let binary = new Uint8Array(w * h);
  let skeleton = binary;
  if (options.debug || ridges.length < 8) {
    const est = stats(peaks, prep.mask);
    const high = Math.max(0.02, est.mean + 0.35 * est.std);
    const low = Math.max(0.008, est.mean * 0.45);
    binary = hysteresis(peaks, prep.mask, w, h, high, low);
    binary = dropSpecks(binary, w, h, Math.round(prep.period * 1.4));
    skeleton = zhangSuen(binary, w, h);
    skeleton = pruneSpurs(skeleton, w, h, Math.round(prep.period * 0.55));
    skeleton = linkGaps(skeleton, prep.orient, w, h, prep.period * 1.2);
    skeleton = pruneSpurs(skeleton, w, h, Math.round(prep.period * 0.4));
    skeleton = dropSpecks(skeleton, w, h, Math.round(prep.period * 1.6));
    if (ridges.length < 8) {
      const fallback = followRidges(enhanced, prep.orient, prep.mask, prep.coherence, w, h, prep.period);
      ridges = settleRidges(
        joinRidges(
          fallback.length > 4 ? fallback : traceSkeleton(skeleton, w, h, Math.max(8, prep.period * 1.15)),
          prep.period,
        ),
        prep.period,
        prep.coreY,
        prep.arcCap,
      );
    }
  }
  if (ridges.length < 8) {
    warnings.push("Few ridge lines were found. Try a closer, sharper photo with the print filling the frame.");
  }

  const debug: ExtractDebug | undefined = options.debug
    ? { normalized: prep.norm, enhanced, binary, skeleton, orient: prep.orient, coherence: prep.coherence }
    : undefined;

  return {
    width: w,
    height: h,
    period: prep.period,
    ridges,
    warnings,
    ridgesAreDark,
    mask: options.keepMask ? prep.mask : undefined,
    gray: options.keepMask ? gray : undefined,
    orient: options.keepMask ? prep.orient : undefined,
    coherence: options.keepMask ? prep.coherence : undefined,
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
