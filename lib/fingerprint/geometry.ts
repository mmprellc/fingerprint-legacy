import type { Pt, Ridge } from "./types";

export function hypot(dx: number, dy: number) {
  return Math.hypot(dx, dy);
}

export function pathLength(points: Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return n;
}

export function ridgeFromPoints(points: Pt[], closed = false): Ridge | null {
  if (points.length < 2) return null;
  const length = pathLength(points);
  if (length < 8) return null;
  return { points, closed, length };
}

export function smoothPath(points: Pt[], radius = 2): Pt[] {
  if (points.length < radius * 2 + 2) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    let x = 0;
    let y = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(points.length - 1, Math.max(0, i + k));
      const weight = radius + 1 - Math.abs(k);
      x += points[j].x * weight;
      y += points[j].y * weight;
      w += weight;
    }
    out.push({ x: x / w, y: y / w });
  }
  out.push(points[points.length - 1]);
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

export function resamplePath(points: Pt[], spacing: number): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [{ ...points[0] }];
  let prev = points[0];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let curr = points[i];
    let dx = curr.x - prev.x;
    let dy = curr.y - prev.y;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) continue;
    while (carry + dist >= spacing) {
      const t = (spacing - carry) / dist;
      const nx = prev.x + dx * t;
      const ny = prev.y + dy * t;
      out.push({ x: nx, y: ny });
      prev = { x: nx, y: ny };
      dx = curr.x - prev.x;
      dy = curr.y - prev.y;
      dist = Math.hypot(dx, dy);
      carry = 0;
      if (dist < 1e-6) break;
    }
    carry += dist;
    prev = curr;
  }
  const last = points[points.length - 1];
  const end = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > spacing * 0.35) {
    out.push({ ...last });
  } else {
    out[out.length - 1] = { ...last };
  }
  return out;
}

export function rdp(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const bx = points[b].x;
    const by = points[b].y;
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i].x - ax) * abx + (points[i].y - ay) * aby) / ab2));
      const px = ax + abx * t;
      const py = ay + aby * t;
      const d = Math.hypot(points[i].x - px, points[i].y - py);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

export function finishRidge(points: Pt[], closed: boolean, minLength: number): Ridge | null {
  if (points.length < 2) return null;
  if (points.length < 4) {
    const length = pathLength(points);
    if (length < minLength) return null;
    return { points: points.slice(), closed, length };
  }
  let pts = polishPath(points, 8);
  if (closed && pts.length > 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 3) pts = pts.slice(0, -1);
  }
  const length = pathLength(pts);
  if (length < minLength || pts.length < 3) return null;
  return { points: pts, closed, length };
}

/** Resample, then average across a wide window so a ridge cannot keep a scribble. */
export function polishPath(points: Pt[], radius: number): Pt[] {
  if (points.length < 4) return points.map((point) => ({ ...point }));
  let pts = resamplePath(points, 2.05);
  const cap = Math.max(2, Math.floor(pts.length / 5));
  const rad = Math.max(2, Math.min(Math.round(radius), cap, 22));
  if (pts.length < rad * 2 + 2) return pts;
  pts = smoothPath(pts, rad);
  pts = smoothPath(pts, rad);
  pts = smoothPath(pts, Math.max(2, Math.floor(rad * 0.7)));
  return resamplePath(pts, 2.2);
}

/**
 * Flatten any bend tighter than minRadius by pulling it toward its chord.
 * Points above `tight.y` use the larger radius, so the cap of the oval
 * stays a gentle arc while the loop below can still turn.
 */
export function relaxCurvature(
  points: Pt[],
  minRadius: number,
  tight?: { y: number; radius: number },
): Pt[] {
  if (points.length < 5) return points.map((point) => ({ ...point }));
  const pts = points.map((point) => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ds = (ab + bc) / 2;
      if (ds < 0.25) continue;
      const turn = Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y));
      const radius = ds / Math.max(Math.abs(turn), 1e-4);
      const need = tight && b.y < tight.y ? Math.max(minRadius, tight.radius) : minRadius;
      if (radius >= need) continue;
      const pull = Math.min(0.82, (1 - radius / need) * 0.8);
      pts[i] = {
        x: b.x + ((a.x + c.x) / 2 - b.x) * pull,
        y: b.y + ((a.y + c.y) / 2 - b.y) * pull,
      };
    }
  }
  return pts;
}

export function toPathD(points: Pt[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 1) return d;
  if (points.length === 2) {
    return `${d} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/** The portion of a path between two distances, including the cut endpoints. */
export function slicePath(points: Pt[], start: number, end: number): Pt[] {
  if (points.length < 2) return [];
  const length = pathLength(points);
  const a = Math.max(0, Math.min(length, start));
  const b = Math.max(a, Math.min(length, end));
  if (b - a < 1) return [];
  const out: Pt[] = [];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (seg < 1e-6) continue;
    const segEnd = walked + seg;
    if (segEnd >= a && walked <= b) {
      const t0 = Math.max(0, (a - walked) / seg);
      const t1 = Math.min(1, (b - walked) / seg);
      const s = { x: p0.x + (p1.x - p0.x) * t0, y: p0.y + (p1.y - p0.y) * t0 };
      const e = { x: p0.x + (p1.x - p0.x) * t1, y: p0.y + (p1.y - p0.y) * t1 };
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - s.x, last.y - s.y) > 0.15) out.push(s);
      if (Math.hypot(s.x - e.x, s.y - e.y) > 0.15) out.push(e);
    }
    walked = segEnd;
    if (walked > b) break;
  }
  return out.length > 1 ? out : [];
}

export function pointAtLength(points: Pt[], distance: number): { x: number; y: number; angle: number } {
  if (points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y, angle: 0 };
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (remaining <= len) {
      const t = remaining / len;
      return { x: a.x + dx * t, y: a.y + dy * t, angle: Math.atan2(dy, dx) };
    }
    remaining -= len;
  }
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export function transformPoints(points: Pt[], m: { tx: number; ty: number; rotation: number; scale: number; cx: number; cy: number }): Pt[] {
  const c = Math.cos(m.rotation);
  const s = Math.sin(m.rotation);
  return points.map((p) => {
    const x = (p.x - m.cx) * m.scale;
    const y = (p.y - m.cy) * m.scale;
    return { x: m.cx + x * c - y * s + m.tx, y: m.cy + x * s + y * c + m.ty };
  });
}

/** Join ridge endings that face each other across a short gap, so a broken skeleton becomes one continuous path. */
export function joinRidges(ridges: Ridge[], period: number): Ridge[] {
  const maxGap = Math.max(18, period * 6);
  type Item = { points: Pt[]; closed: boolean };
  const items: Item[] = ridges
    .filter((ridge) => ridge.points.length > 1)
    .map((ridge) => ({ points: ridge.points.slice(), closed: ridge.closed }));

  const outward = (points: Pt[], end: 0 | 1) => {
    if (end === 0) {
      const a = points[0];
      const b = points[Math.min(points.length - 1, 4)];
      return norm(a.x - b.x, a.y - b.y);
    }
    const a = points[points.length - 1];
    const b = points[Math.max(0, points.length - 5)];
    return norm(a.x - b.x, a.y - b.y);
  };
  const tip = (points: Pt[], end: 0 | 1) => (end === 0 ? points[0] : points[points.length - 1]);

  let guard = 0;
  while (guard++ < items.length + 4) {
    let bestI = -1;
    let bestJ = -1;
    let bestEndI: 0 | 1 = 0;
    let bestEndJ: 0 | 1 = 0;
    let bestD = maxGap;
    for (let i = 0; i < items.length; i++) {
      if (items[i].closed) continue;
      for (const endI of [0, 1] as const) {
        const a = tip(items[i].points, endI);
        const dir = outward(items[i].points, endI);
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].closed) continue;
          for (const endJ of [0, 1] as const) {
            const b = tip(items[j].points, endJ);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1.5 || dist >= bestD) continue;
            const ux = dx / dist;
            const uy = dy / dist;
            if (dir.x * ux + dir.y * uy < 0.72) continue;
            const dirJ = outward(items[j].points, endJ);
            if (dirJ.x * ux + dirJ.y * uy > -0.4) continue;
            bestD = dist;
            bestI = i;
            bestJ = j;
            bestEndI = endI;
            bestEndJ = endJ;
          }
        }
      }
    }
    if (bestI < 0) break;
    const left = bestEndI === 1 ? items[bestI].points : items[bestI].points.slice().reverse();
    const right = bestEndJ === 0 ? items[bestJ].points : items[bestJ].points.slice().reverse();
    items[bestI] = { points: left.concat(right.slice(1)), closed: false };
    items.splice(bestJ, 1);
  }

  const out: Ridge[] = [];
  for (const item of items) {
    const ridge = finishRidge(item.points, item.closed, Math.max(8, period * 1.3));
    if (ridge) out.push(ridge);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

function norm(x: number, y: number) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type SegmentHit = { a: number; ai: number; b: number; bi: number };

function properCrossing(a: Pt, b: Pt, c: Pt, d: Pt) {
  const orient = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

function ridgeSegments(ridges: { points: Pt[]; closed?: boolean }[]) {
  const cell = 14;
  const buckets = new Map<string, { id: number; i: number; a: Pt; b: Pt }[]>();
  const put = (a: Pt, b: Pt, id: number, i: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
    const seen = new Set<string>();
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const key = `${Math.floor((a.x + (b.x - a.x) * t) / cell)},${Math.floor((a.y + (b.y - a.y) * t) / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = buckets.get(key);
      const hit = { id, i, a, b };
      if (bucket) bucket.push(hit);
      else buckets.set(key, [hit]);
    }
  };
  ridges.forEach((ridge, id) => {
    const pts = ridge.points;
    for (let i = 1; i < pts.length; i++) put(pts[i - 1], pts[i], id, i - 1);
    if (ridge.closed && pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 6) {
      put(pts[pts.length - 1], pts[0], id, pts.length - 1);
    }
  });
  return { cell, buckets };
}

/** Proper intersections of ridge polylines. Shared endpoints are not crossings. */
export function crossingPairs(ridges: { points: Pt[]; closed?: boolean }[]): SegmentHit[] {
  const { buckets } = ridgeSegments(ridges);
  const hits: SegmentHit[] = [];
  const seen = new Set<string>();
  for (const [key, bucket] of buckets) {
    const [cx, cy] = key.split(",").map(Number);
    const near: { id: number; i: number; a: Pt; b: Pt }[] = [];
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const extra = buckets.get(`${cx + dx},${cy + dy}`);
        if (extra) near.push(...extra);
      }
    }
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i];
      for (let j = 0; j < near.length; j++) {
        const q = near[j];
        if (p.id > q.id || (p.id === q.id && p.i >= q.i)) continue;
        if (p.id === q.id && q.i - p.i <= 2) continue;
        const pair = `${p.id}:${p.i}-${q.id}:${q.i}`;
        if (seen.has(pair)) continue;
        if (!properCrossing(p.a, p.b, q.a, q.b)) continue;
        seen.add(pair);
        hits.push({ a: p.id, ai: p.i, b: q.id, bi: q.i });
      }
    }
  }
  return hits;
}

export function countCrossings(ridges: { points: Pt[]; closed?: boolean }[]) {
  return crossingPairs(ridges).length;
}

function splitDropping(points: Pt[], drop: Set<number>): Pt[][] {
  if (!drop.size || points.length < 2) return [points.slice()];
  const parts: Pt[][] = [];
  let cur: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    if (drop.has(i)) {
      if (cur.length > 1) parts.push(cur);
      cur = [points[i + 1]];
    } else {
      cur.push(points[i + 1]);
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

/** Cut the shorter polyline at every intersection until nothing crosses. */
export function cutCrossings(ridges: Ridge[], minLength: number): Ridge[] {
  let current = ridges;
  for (let pass = 0; pass < 6; pass++) {
    const hits = crossingPairs(current);
    if (!hits.length) return current;
    const cuts = new Map<number, Set<number>>();
    const mark = (id: number, index: number) => {
      const set = cuts.get(id) ?? new Set<number>();
      set.add(index);
      cuts.set(id, set);
    };
    for (const hit of hits) {
      if (hit.a === hit.b) {
        mark(hit.a, hit.ai);
        mark(hit.b, hit.bi);
        continue;
      }
      const shorter = current[hit.a].length <= current[hit.b].length ? hit.a : hit.b;
      mark(shorter, shorter === hit.a ? hit.ai : hit.bi);
    }
    const next: Ridge[] = [];
    current.forEach((ridge, id) => {
      const drop = cuts.get(id);
      if (!drop) {
        next.push(ridge);
        return;
      }
      for (const points of splitDropping(ridge.points, drop)) {
        const piece = ridgeFromPoints(points, false);
        if (piece && piece.length >= minLength) next.push(piece);
      }
    });
    current = next;
  }
  return current;
}

/** Drop every sample that sits within minSep of a longer ridge, and keep the remaining runs. */
export function trimSeparation(ridges: Ridge[], minSep: number, minLength: number): Ridge[] {
  const sorted = ridges.slice().sort((a, b) => b.length - a.length);
  const cell = Math.max(4, minSep * 0.45);
  const window = Math.ceil(minSep / cell) + 1;
  const buckets = new Map<string, Pt[]>();
  const add = (point: Pt) => {
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  };
  const nearest = (x: number, y: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    let best = Infinity;
    for (let dy = -window; dy <= window; dy++) {
      for (let dx = -window; dx <= window; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  const kept: Ridge[] = [];
  for (const ridge of sorted) {
    const pts = resamplePath(ridge.points, 2);
    let run: Pt[] = [];
    const flush = () => {
      const piece = run.length > 1 ? ridgeFromPoints(run, false) : null;
      if (piece && piece.length >= minLength) {
        kept.push(piece);
        for (const point of run) add(point);
      }
      run = [];
    };
    for (const point of pts) {
      if (nearest(point.x, point.y) < minSep) flush();
      else run.push(point);
    }
    flush();
  }
  return kept;
}

/** Turning radii along every ridge. A small radius is a tight scribble. */
export function curvatureReport(ridges: { points: Pt[] }[]) {
  const values: number[] = [];
  for (const ridge of ridges) {
    const pts = ridge.points;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ds = (ab + bc) / 2;
      if (ds < 0.35) continue;
      const turn = Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y));
      values.push(Math.abs(turn) / ds);
    }
  }
  if (!values.length) return { worstRadius: Infinity, p95Radius: Infinity };
  values.sort((a, b) => a - b);
  const worst = values[values.length - 1];
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
  return {
    worstRadius: worst > 1e-8 ? 1 / worst : Infinity,
    p95Radius: p95 > 1e-8 ? 1 / p95 : Infinity,
  };
}
