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
  if (points.length < 4) return null;
  let pts = smoothPath(points, 2);
  pts = smoothPath(pts, 2);
  pts = resamplePath(pts, 2.4);
  pts = rdp(pts, 0.65);
  if (closed && pts.length > 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 3) pts = pts.slice(0, -1);
  }
  const length = pathLength(pts);
  if (length < minLength || pts.length < 3) return null;
  return { points: pts, closed, length };
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

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
