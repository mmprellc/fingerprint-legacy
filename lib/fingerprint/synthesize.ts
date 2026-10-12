import type { Pt, Ridge } from "./types";
import { pathLength, ridgeFromPoints } from "./geometry";

export type SynthPrint = {
  width: number;
  height: number;
  rgba: Uint8Array;
  gray: Float32Array;
  ridges: Ridge[];
  period: number;
};

type Singularity = { x: number; y: number };

function inOval(x: number, y: number, cx: number, cy: number, rx: number, ry: number, pad = 0) {
  const nx = (x - cx) / (rx + pad);
  const ny = (y - cy) / (ry + pad);
  return nx * nx + ny * ny <= 1;
}

function orientation(x: number, y: number, cores: Singularity[], deltas: Singularity[], spin: number) {
  let sum = spin;
  for (const c of cores) sum += Math.atan2(y - c.y, x - c.x);
  for (const d of deltas) sum -= Math.atan2(y - d.y, x - d.x);
  return 0.5 * sum;
}

function tooNearSingularity(x: number, y: number, cores: Singularity[], deltas: Singularity[], r: number) {
  for (const s of [...cores, ...deltas]) {
    if (Math.hypot(x - s.x, y - s.y) < r) return true;
  }
  return false;
}

export function synthesizePrint(kind: "loop" | "whorl" = "loop", seed = 1): SynthPrint {
  const width = 860;
  const height = 1100;
  const period = 11.2;
  const cx = width * 0.48;
  const cy = height * 0.5;
  const rx = width * 0.34;
  const ry = height * 0.36;

  const cores: Singularity[] =
    kind === "loop"
      ? [{ x: cx - 8, y: cy - 36 }]
      : [
          { x: cx - 6, y: cy - 70 },
          { x: cx + 4, y: cy + 10 },
        ];
  const deltas: Singularity[] =
    kind === "loop"
      ? [{ x: cx + 150, y: cy + 150 }]
      : [
          { x: cx - 170, y: cy + 170 },
          { x: cx + 175, y: cy + 165 },
        ];
  const spin = kind === "loop" ? Math.PI * 0.15 : 0;

  const cell = period * 0.48;
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const grid = new Int16Array(gw * gh);
  grid.fill(-1);

  const mark = (x: number, y: number, id: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return;
    grid[gy * gw + gx] = id;
  };
  const occupied = (x: number, y: number, id: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = gx + dx;
        const yy = gy + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const v = grid[yy * gw + xx];
        if (v >= 0 && v !== id) return true;
      }
    }
    return false;
  };

  const step = 1.15;
  function integrate(x: number, y: number, sign: number, id: number) {
    const pts: Pt[] = [];
    let px = x;
    let py = y;
    let pdx = Math.cos(orientation(x, y, cores, deltas, spin)) * sign;
    let pdy = Math.sin(orientation(x, y, cores, deltas, spin)) * sign;
    for (let i = 0; i < 1800; i++) {
      if (!inOval(px, py, cx, cy, rx, ry, -period * 0.2)) break;
      if (tooNearSingularity(px, py, cores, deltas, period * 0.55)) break;
      if (i > 8 && occupied(px, py, id)) break;
      pts.push({ x: px, y: py });
      mark(px, py, id);
      let theta = orientation(px, py, cores, deltas, spin);
      let dx = Math.cos(theta);
      let dy = Math.sin(theta);
      if (dx * pdx + dy * pdy < 0) {
        dx = -dx;
        dy = -dy;
      }
      pdx = dx;
      pdy = dy;
      px += dx * step;
      py += dy * step;
    }
    return pts;
  }

  const queue: Pt[] = [{ x: cx - period * 2, y: cy + period }];
  const raw: Pt[][] = [];
  let id = 0;
  while (queue.length && raw.length < 140) {
    const seedPt = queue.shift()!;
    if (!inOval(seedPt.x, seedPt.y, cx, cy, rx, ry, -period)) continue;
    if (occupied(seedPt.x, seedPt.y, 9999)) continue;
    const my = id++;
    const forward = integrate(seedPt.x, seedPt.y, 1, my);
    const back = integrate(seedPt.x, seedPt.y, -1, my);
    const points = [...back.reverse(), ...forward];
    if (points.length < 36) continue;
    raw.push(points);
    for (let i = 8; i < points.length; i += 14) {
      const a = points[Math.max(0, i - 2)];
      const b = points[Math.min(points.length - 1, i + 2)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      queue.push({ x: points[i].x + nx * period, y: points[i].y + ny * period });
      queue.push({ x: points[i].x - nx * period, y: points[i].y - ny * period });
    }
  }

  // Ridge endings: trim a portion of some ridges so minutiae survive extraction.
  let rng = seed * 9301 + 49297;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const trimmed: Pt[][] = [];
  for (const points of raw) {
    if (points.length > 80 && rand() < 0.22) {
      const cut = Math.floor(points.length * (0.15 + rand() * 0.3));
      const side = rand() < 0.5 ? points.slice(0, points.length - cut) : points.slice(cut);
      if (side.length > 40) trimmed.push(side);
      else trimmed.push(points);
    } else {
      trimmed.push(points);
    }
  }

  // A handful of bifurcations: branch from a ridge toward empty space for a short run,
  // then let it join the field. Drawn as an extra short ridge that shares an endpoint.
  for (let n = 0; n < 10; n++) {
    const host = trimmed[Math.floor(rand() * trimmed.length)];
    if (!host || host.length < 50) continue;
    const at = Math.floor(host.length * (0.3 + rand() * 0.4));
    const origin = host[at];
    const a = host[Math.max(0, at - 2)];
    const b = host[Math.min(host.length - 1, at + 2)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const sign = rand() < 0.5 ? 1 : -1;
    const branch: Pt[] = [{ ...origin }];
    let px = origin.x + nx * sign * 1.2;
    let py = origin.y + ny * sign * 1.2;
    let pdx = nx * sign;
    let pdy = ny * sign;
    for (let i = 0; i < 70; i++) {
      if (!inOval(px, py, cx, cy, rx, ry, -period)) break;
      branch.push({ x: px, y: py });
      let theta = orientation(px, py, cores, deltas, spin);
      let vx = Math.cos(theta);
      let vy = Math.sin(theta);
      if (vx * pdx + vy * pdy < 0) {
        vx = -vx;
        vy = -vy;
      }
      // Bias the first steps away from the parent so the split reads as a bifurcation.
      const blend = i < 10 ? 0.45 : 0;
      vx = vx * (1 - blend) + nx * sign * blend;
      vy = vy * (1 - blend) + ny * sign * blend;
      const vl = Math.hypot(vx, vy) || 1;
      pdx = vx / vl;
      pdy = vy / vl;
      px += pdx * step;
      py += pdy * step;
    }
    if (branch.length > 24) trimmed.push(branch);
  }

  const ridges: Ridge[] = [];
  for (const points of trimmed) {
    const ridge = ridgeFromPoints(points, false);
    if (ridge && ridge.length > period * 3) ridges.push(ridge);
  }

  const gray = new Float32Array(width * height);
  gray.fill(236);
  const ridgeRadius = period * 0.4;
  for (const ridge of ridges) {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 0.7));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const wobble = 0.82 + 0.18 * Math.sin(x * 0.05 + y * 0.03 + seed);
        const rad = ridgeRadius * wobble;
        const r = Math.ceil(rad);
        const x0 = Math.max(0, Math.floor(x - r));
        const x1 = Math.min(width - 1, Math.ceil(x + r));
        const y0 = Math.max(0, Math.floor(y - r));
        const y1 = Math.min(height - 1, Math.ceil(y + r));
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const d = Math.hypot(xx - x, yy - y);
            if (d > rad) continue;
            const edge = d / rad;
            const ink = edge < 0.72 ? 0 : (edge - 0.72) / 0.28;
            const idx = yy * width + xx;
            if (ink < gray[idx] / 255) gray[idx] = ink * 255;
          }
        }
      }
    }
  }

  // Soften, then fade the oval edge and add a little paper grain.
  const blurred = new Float32Array(gray.length);
  const rad = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      let wsum = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const wgt = dx === 0 && dy === 0 ? 4 : 1;
          acc += gray[yy * width + xx] * wgt;
          wsum += wgt;
        }
      }
      blurred[y * width + x] = acc / wsum;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  let noise = seed * 101;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const oval = nx * nx + ny * ny;
      const fade = oval < 0.86 ? 1 : oval > 1.05 ? 0 : 1 - (oval - 0.86) / 0.19;
      noise = (noise * 1664525 + 1013904223) >>> 0;
      const grain = (noise / 4294967296 - 0.5) * 10;
      const paper = 240 + grain * 0.3;
      const ink = blurred[y * width + x];
      const v = paper * (1 - fade) + ink * fade + grain * fade * 0.15;
      const g = Math.max(0, Math.min(255, v));
      const idx = (y * width + x) * 4;
      // Warm the paper slightly toward ivory, keep ridges neutral-dark.
      const warmth = (g / 255) * 8;
      rgba[idx] = Math.min(255, g + warmth);
      rgba[idx + 1] = g;
      rgba[idx + 2] = Math.max(0, g - warmth * 0.4);
      rgba[idx + 3] = 255;
      blurred[y * width + x] = 0.2126 * rgba[idx] + 0.7152 * rgba[idx + 1] + 0.0722 * rgba[idx + 2];
    }
  }

  return { width, height, rgba, gray: blurred, ridges, period };
}

export function truthLength(ridges: Ridge[]) {
  return ridges.reduce((s, r) => s + (r.length || pathLength(r.points)), 0);
}
