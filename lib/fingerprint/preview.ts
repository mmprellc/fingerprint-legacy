import { escapeXml, pathLength, toPathD } from "./geometry";
import { ellipsePath, estimateWordWidth, fontSizeFor, packRuns, plaqueFor, ridgeWidth, ridgeWords, UNDERSTROKE, uprightRuns } from "./lettering";
import { FONTS, INK_PRESETS, type PrintStyle, type Ridge } from "./types";

export { fontSizeFor };

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
  opts?: { transparent?: boolean; fontFamily?: string; frame?: { width: number; height: number }; understroke?: boolean },
) {
  const preset = presetById(style.preset);
  const font = fontById(style.font);
  const fontSize = fontSizeFor(period, style.textScale || 1);
  const tracking = -fontSize * 0.045;
  const space = fontSize * 0.2;
  const mapped = prints.map(mapPrint);
  let maxX = opts?.frame?.width ?? 1;
  let maxY = opts?.frame?.height ?? 1;
  if (!opts?.frame) {
    for (const print of prints) {
      const rot = ((print.rotation ?? 0) * Math.PI) / 180;
      const scale = print.scale ?? 1;
      const tx = print.tx ?? 0;
      const ty = print.ty ?? 0;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = print.width / 2;
      const cy = print.height / 2;
      for (const corner of [
        { x: 0, y: 0 },
        { x: print.width, y: 0 },
        { x: 0, y: print.height },
        { x: print.width, y: print.height },
      ]) {
        const dx = (corner.x - cx) * scale;
        const dy = (corner.y - cy) * scale;
        maxX = Math.max(maxX, cx + dx * cos - dy * sin + tx);
        maxY = Math.max(maxY, cy + dx * sin + dy * cos + ty);
      }
    }
  }
  const topPad = !opts?.frame && style.title ? 72 : 0;
  const bottomPad = !opts?.frame && (style.footer || style.script) ? 78 : 0;
  const width = Math.ceil(opts?.frame?.width ?? maxX);
  const height = Math.ceil(opts?.frame?.height ?? maxY) + topPad + bottomPad;
  const defs: string[] = [];
  const texts: string[] = [];
  const inkPaths: string[] = [];
  const strokes: string[] = [];
  const understroke = opts?.understroke !== false;
  const bridge = Math.max(0.8, ridgeWidth(period) * UNDERSTROKE);
  const plaques = mapped.map((ridges) => plaqueFor(ridges, style, period));
  let index = 0;
  for (let printIndex = 0; printIndex < mapped.length; printIndex++) {
    const ridges = mapped[printIndex];
    const plaque = plaques[printIndex];
    const words = ridgeWords(style.names, style.scriptures, ridges[0]?.lines ?? []);
    const measure = (word: string) => estimateWordWidth(word, fontSize, Math.max(font.charRatio, 0.62), tracking);
    const cursor = { i: 0 };
    const prepared = ridges.map((ridge) => uprightRuns(ridge.points));
    const ceiling = prepared.reduce((max, runs) => Math.max(max, ...runs.map((points) => pathLength(points))), 0);
    prepared.forEach((runs, ridgeIndex) => {
      const ridge = ridges[ridgeIndex];
      const d = toPathD(ridge.points);
      strokes.push(`<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${Math.max(0.8, period * 0.08)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (understroke) {
        inkPaths.push(`<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${bridge.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      const packed = packRuns(runs, words, measure, space, cursor, ceiling);
      for (const run of packed) {
        if (!run.text) continue;
        const id = `r${index++}`;
        defs.push(`<path id="${id}" d="${toPathD(run.points)}"/>`);
        const dy = (fontSize * 0.31).toFixed(2);
        texts.push(
          `<text class="ridge" font-size="${fontSize.toFixed(2)}" letter-spacing="${tracking.toFixed(2)}" fill="${preset.ink}" font-family="${escapeXml(opts?.fontFamily || font.family)}"><textPath href="#${id}" dy="${dy}">${escapeXml(run.text)}</textPath></text>`,
        );
      }
    });
  }
  const holes = plaques.filter((plaque): plaque is NonNullable<typeof plaque> => Boolean(plaque));
  const clip = holes.length
    ? `<clipPath id="ridgekeep"><path fill-rule="evenodd" d="M -40 -40 H ${width + 40} V ${height + 40} H -40 Z ${holes.map((plaque) => ellipsePath(plaque.cx, plaque.cy, plaque.rx, plaque.ry)).join(" ")}"/></clipPath>`
    : "";
  const plaquesSvg = holes.map((plaque) => {
    const paper = `<path d="${ellipsePath(plaque.cx, plaque.cy, plaque.rx, plaque.ry)}" fill="${opts?.transparent ? preset.paper : preset.paper}"/>`;
    const labels = plaque.lines.map((line, lineIndex) => {
      const family = line.emphasis ? (opts?.fontFamily || font.family) : "Cormorant Garamond, Georgia, serif";
      const kind = line.emphasis ? "plaque-name" : "plaque-detail";
      return `<text class="${kind}" x="${plaque.cx.toFixed(1)}" y="${plaque.baselines[lineIndex].toFixed(1)}" text-anchor="middle" font-size="${line.fontSize.toFixed(1)}" font-family="${escapeXml(family)}" fill="${preset.ink}">${escapeXml(line.text)}</text>`;
    }).join("");
    return paper + labels;
  }).join("");
  const footerText = style.footer || style.script || "";
  const title = style.title
    ? `<text class="piece-title" x="${(width / 2).toFixed(1)}" y="46" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="28" letter-spacing="3.5" fill="${preset.ink}">${escapeXml(style.title.toUpperCase())}</text>`
    : "";
  const footer = footerText
    ? `<text class="${style.footer ? "piece-footer" : "piece-script"}" x="${(width / 2).toFixed(1)}" y="${height - 28}" text-anchor="middle" font-family="${style.footer ? "Cormorant Garamond, Georgia, serif" : "Great Vibes, cursive"}" font-size="${style.footer ? 26 : 34}" fill="${preset.ink}">${escapeXml(footerText)}</text>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${opts?.transparent ? "none" : preset.paper}"/><defs>${defs.join("")}${clip}</defs>${title}<g transform="translate(0 ${topPad})"><g clip-path="${holes.length ? "url(#ridgekeep)" : "none"}"><g class="ridge-ink">${inkPaths.join("")}</g><g class="ridge-strokes" style="display:none">${strokes.join("")}</g>${texts.join("")}</g>${plaquesSvg}</g>${footer}</svg>`;
  return { svg, width, height, fontSize, strokes: strokes.join("") };
}
