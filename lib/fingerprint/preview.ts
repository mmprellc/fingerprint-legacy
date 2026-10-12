import { escapeXml, toPathD } from "./geometry";
import { FONTS, INK_PRESETS, type PrintStyle, type Ridge } from "./types";

export type PreviewPrint = {
  ridges: Ridge[];
  width: number;
  height: number;
  lines: string[];
  tx?: number;
  ty?: number;
  rotation?: number;
  scale?: number;
};

export function corpusOf(lines: string[]) {
  const cleaned = lines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!cleaned.length) return "";
  return `${cleaned.join(" · ")} · `;
}

export function fontSizeFor(period: number, textScale: number) {
  return Math.max(5.5, period * 0.58 * (textScale || 1));
}

export function presetById(id: string) {
  return INK_PRESETS.find((preset) => preset.id === id) ?? INK_PRESETS[0];
}

export function fontById(id: string) {
  return FONTS.find((font) => font.id === id) ?? FONTS[0];
}

export function assignText(ridges: Ridge[], lines: string[], fontSize: number, charRatio: number) {
  const stream = corpusOf(lines);
  if (!stream) return ridges.map(() => "");
  const charW = Math.max(2.2, fontSize * charRatio);
  let cursor = 0;
  return ridges.map((ridge) => {
    const count = Math.floor((ridge.length * 0.94) / charW);
    if (count < 2) return "";
    let text = "";
    for (let i = 0; i < count; i++) {
      text += stream[cursor % stream.length];
      cursor++;
    }
    return text.trim();
  });
}

export function mapPrint(print: PreviewPrint) {
  const cx = print.width / 2;
  const cy = print.height / 2;
  const rot = ((print.rotation ?? 0) * Math.PI) / 180;
  const scale = print.scale ?? 1;
  const tx = print.tx ?? 0;
  const ty = print.ty ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return print.ridges.map((ridge) => {
    const points = ridge.points.map((point) => {
      const dx = (point.x - cx) * scale;
      const dy = (point.y - cy) * scale;
      return {
        x: cx + dx * cos - dy * sin + tx,
        y: cy + dx * sin + dy * cos + ty,
      };
    });
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return { points, length, closed: ridge.closed, lines: print.lines };
  });
}

export function buildPreviewSvg(
  prints: PreviewPrint[],
  style: PrintStyle,
  period: number,
  opts?: { transparent?: boolean; fontFamily?: string; frame?: { width: number; height: number } },
) {
  const preset = presetById(style.preset);
  const font = fontById(style.font);
  const fontSize = fontSizeFor(period, style.textScale || 1);
  const mapped = prints.map(mapPrint);
  let maxX = opts?.frame?.width ?? 1;
  let maxY = opts?.frame?.height ?? 1;
  if (!opts?.frame) {
    for (const ridges of mapped) {
      for (const ridge of ridges) {
        for (const point of ridge.points) {
          if (point.x > maxX) maxX = point.x;
          if (point.y > maxY) maxY = point.y;
        }
      }
    }
  }
  const pad = opts?.frame ? 0 : 24;
  const extra = !opts?.frame && (style.title || style.script) ? 96 : 0;
  const width = Math.ceil((opts?.frame?.width ?? maxX + pad) );
  const height = Math.ceil((opts?.frame?.height ?? maxY + pad) + extra);
  const defs: string[] = [];
  const texts: string[] = [];
  const strokes: string[] = [];
  let index = 0;
  for (const ridges of mapped) {
    const lines = ridges[0]?.lines ?? [];
    const assigned = assignText(
      ridges.map((ridge) => ({ points: ridge.points, length: ridge.length, closed: ridge.closed })),
      lines,
      fontSize,
      font.charRatio,
    );
    ridges.forEach((ridge, ridgeIndex) => {
      const id = `r${index++}`;
      const d = toPathD(ridge.points);
      defs.push(`<path id="${id}" d="${d}"/>`);
      strokes.push(`<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${Math.max(0.8, period * 0.08)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      const text = assigned[ridgeIndex];
      if (!text) return;
      texts.push(
        `<text font-size="${fontSize.toFixed(2)}" fill="${preset.ink}" font-family="${escapeXml(opts?.fontFamily || font.family)}"><textPath href="#${id}">${escapeXml(text)}</textPath></text>`,
      );
    });
  }
  const title = style.title
    ? `<text x="${(width / 2).toFixed(1)}" y="${height - (style.script ? 58 : 28)}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="26" letter-spacing="4" fill="${preset.ink}">${escapeXml(style.title.toUpperCase())}</text>`
    : "";
  const script = style.script
    ? `<text x="${(width / 2).toFixed(1)}" y="${height - 22}" text-anchor="middle" font-family="Great Vibes, cursive" font-size="34" fill="${preset.ink}">${escapeXml(style.script)}</text>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${opts?.transparent ? "none" : preset.paper}"/><defs>${defs.join("")}</defs><g class="ridge-strokes" style="display:none">${strokes.join("")}</g>${texts.join("")}${title}${script}</svg>`;
  return { svg, width, height, fontSize, strokes: strokes.join("") };
}
