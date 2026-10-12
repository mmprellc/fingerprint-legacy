import type { Point, RGBA } from "./types";

export type PrintKind = "loop" | "whorl" | "arch";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function wrapPi(d: number) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Blend two undirected orientations (period π) without a seam. */
function blendAngle(a: number, b: number, t: number) {
  const u = clamp(t, 0, 1);
  const x = Math.cos(2 * a) * (1 - u) + Math.cos(2 * b) * u;
  const y = Math.sin(2 * a) * (1 - u) + Math.sin(2 * b) * u;
  return 0.5 * Math.atan2(y, x);
}

function smoothstep(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Continuous ridge direction for each print class.
 * 0 means a horizontal ridge. The fields are smooth on purpose:
 * a photograph's orientation estimate can follow them.
 */
export function fieldAngle(kind: PrintKind, x: number, y: number, w: number, h: number): number {
  const cx = w * 0.5;
  const cy = h * 0.48;
  const dx = x - cx;
  const dy = y - cy;

  if (kind === "whorl") {
    const circular = Math.atan2(dy, dx) + Math.PI / 2;
    const rx = dx / (w * 0.2);
    const ry = dy / (h * 0.26);
    const r = Math.hypot(rx, ry);
    return blendAngle(circular, 0.08, smoothstep((r - 0.25) / 1.15));
  }

  if (kind === "arch") {
    const nx = dx / (w * 0.3);
    const ny = (y - h * 0.58) / (h * 0.34);
    const tent = Math.exp(-nx * nx * 0.85) * clamp(0.55 - ny, 0, 1.2);
    return nx * tent * 0.95;
  }

  // Loop: a core above a delta, opening to the right, settling to horizontal ridges.
  const core = Math.atan2(dy - h * 0.01, dx + w * 0.02);
  const delta = Math.atan2(dy - h * 0.16, dx + w * 0.01);
  const loop = 0.5 * Math.atan2(Math.sin(core - delta), Math.cos(core - delta));
  const r = Math.hypot(dx / (w * 0.3), (dy - h * 0.02) / (h * 0.34));
  return blendAngle(loop, 0.04, smoothstep((r - 0.15) / 1.05));
}

function inPrint(x: number, y: number, w: number, h: number) {
  const nx = (x - w * 0.5) / (w * 0.33);
  const ny = (y - h * 0.49) / (h * 0.39);
  return nx * nx + ny * ny <= 1;
}

function traceField(kind: PrintKind, w: number, h: number, spacing: number): Point[][] {
  const occupied = new Uint8Array(w * h);
  const radius = spacing * 0.47;
  const r2 = radius * radius;
  const mark = (x: number, y: number) => {
    const x0 = Math.max(0, Math.floor(x - radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const x1 = Math.min(w - 1, Math.ceil(x + radius));
    const y1 = Math.min(h - 1, Math.ceil(y + radius));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const ddx = xx - x;
        const ddy = yy - y;
        if (ddx * ddx + ddy * ddy <= r2) occupied[yy * w + xx] = 1;
      }
    }
  };

  const paths: Point[][] = [];
  const grid = Math.max(3, Math.round(spacing * 0.75));
  const step = 1.5;

  const walk = (sx: number, sy: number, sign: number, avoid: Point[]) => {
    const pts: Point[] = [];
    let x = sx;
    let y = sy;
    let dir = fieldAngle(kind, x, y, w, h);
    if (sign < 0) dir += Math.PI;
    const limit = (spacing * 0.55) ** 2;
    for (let n = 0; n < (w + h) * 1.3; n++) {
      const a = fieldAngle(kind, x, y, w, h);
      const cand = Math.abs(wrapPi(a - dir)) <= Math.abs(wrapPi(a + Math.PI - dir)) ? a : a + Math.PI;
      if (Math.abs(wrapPi(cand - dir)) > 1.15) break;
      dir += wrapPi(cand - dir) * 0.75;
      x += Math.cos(dir) * step;
      y += Math.sin(dir) * step;
      if (!inPrint(x, y, w, h)) break;
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) break;
      if (n * step > spacing && occupied[yi * w + xi]) break;
      let hit = false;
      for (let i = 0; i < pts.length - spacing * 2; i += 3) {
        const dx = pts[i].x - x;
        const dy = pts[i].y - y;
        if (dx * dx + dy * dy < limit) {
          hit = true;
          break;
        }
      }
      if (!hit && n * step > spacing * 1.25) {
        for (let i = 0; i < avoid.length; i += 3) {
          const dx = avoid[i].x - x;
          const dy = avoid[i].y - y;
          if (dx * dx + dy * dy < limit) {
            hit = true;
            break;
          }
        }
      }
      if (hit) break;
      pts.push({ x, y });
    }
    return pts;
  };

  const cx = w / 2;
  const cy = h / 2;
  const seeds: Point[] = [];
  for (let y = grid; y < h - grid; y += grid) {
    for (let x = grid; x < w - grid; x += grid) {
      if (inPrint(x, y, w, h)) seeds.push({ x, y });
    }
  }
  seeds.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));

  for (const seed of seeds) {
    if (occupied[Math.round(seed.y) * w + Math.round(seed.x)]) continue;
    const fore = walk(seed.x, seed.y, 1, []);
    const back = walk(seed.x, seed.y, -1, fore);
    const path = [...back.reverse(), { ...seed }, ...fore];
    if (path.length > spacing * 2.5) {
      for (let i = 0; i < path.length; i += 2) mark(path[i].x, path[i].y);
      paths.push(path);
    }
  }
  return paths;
}

function paint(gray: Float32Array, w: number, h: number, x: number, y: number, radius: number) {
  const r = Math.ceil(radius + 1);
  const x0 = Math.max(0, Math.floor(x - r));
  const y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(w - 1, Math.ceil(x + r));
  const y1 = Math.min(h - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
      const coverage = clamp(radius + 0.55 - d, 0, 1);
      if (coverage <= 0) continue;
      const i = yy * w + xx;
      gray[i] *= 1 - coverage * 0.94;
    }
  }
}

/** Ground-truth ridges used to draw the sample photograph. */
export function syntheticRidges(kind: PrintKind, width: number, height: number, spacing?: number): Point[][] {
  const gap = spacing ?? Math.round(Math.min(width, height) / 44);
  return traceField(kind, width, height, gap);
}

/** A paper photograph of a synthetic inked print, used as the studio sample. */
export function renderSyntheticPrint(kind: PrintKind, width = 640, height = 800): RGBA {
  const gray = new Float32Array(width * height);
  gray.fill(1);
  const spacing = Math.round(Math.min(width, height) / 44);
  const paths = traceField(kind, width, height, spacing);
  const ridge = Math.max(1.2, spacing * 0.38);
  for (const path of paths) {
    for (const point of path) paint(gray, width, height, point.x, point.y, ridge);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - width * 0.5) / (width * 0.33);
      const ny = (y - height * 0.49) / (height * 0.39);
      const oval = nx * nx + ny * ny;
      const edge = clamp((1.04 - oval) / 0.09, 0, 1);
      const n =
        (Math.sin(x * 0.41 + y * 0.17) + Math.sin(x * 0.13 - y * 0.19) + Math.sin((x + y) * 0.07)) / 3;
      const paper = 0.93 + n * 0.02;
      let v = gray[y * width + x] * edge + paper * (1 - edge);
      v = clamp(v * (0.98 + n * 0.015), 0, 1);
      const ink = Math.round(v * 255);
      const p = (y * width + x) * 4;
      data[p] = ink;
      data[p + 1] = Math.round(ink * 0.985);
      data[p + 2] = Math.round(ink * 0.95);
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

export function rgbaToPngBuffer(image: RGBA): Promise<Buffer> {
  return import("sharp").then(({ default: sharp }) =>
    sharp(Buffer.from(image.data), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png()
      .toBuffer(),
  );
}
