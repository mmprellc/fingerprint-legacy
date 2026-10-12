import { escapeXml, pathLength, toPathD } from "./geometry";
import { bodySources, classifyRidges, dedicationWords, estimateWordWidth, fontSizeFor, packBodyRuns, packRuns, ridgeWidth, roleScale, UNDERSTROKE, uprightRuns, type RidgeRole } from "./lettering";
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
  const understroke = opts?.understroke !== false && UNDERSTROKE > 0.02;
  const bridge = ridgeWidth(period) * UNDERSTROKE;
  let index = 0;
  for (let printIndex = 0; printIndex < mapped.length; printIndex++) {
    const ridges = mapped[printIndex];
    const roles = classifyRidges(ridges, period);
    const body = bodySources(style.names, style.scriptures, ridges[0]?.lines ?? []);
    const coreWords = dedicationWords(style, "core");
    const secondaryWords = dedicationWords(style, "secondary");
    const cursors: Record<"core" | "secondary", { i: number }> = { core: { i: 0 }, secondary: { i: 0 } };
    const nameCursor = { i: 0 };
    const verseCursor = { i: 0 };
    const prepared = ridges.map((ridge) => uprightRuns(ridge.points));
    const ceilings: Record<RidgeRole, number> = { core: 0, secondary: 0, body: 0 };
    prepared.forEach((runs, ridgeIndex) => {
      const role = roles[ridgeIndex] ?? "body";
      for (const run of runs) ceilings[role] = Math.max(ceilings[role], pathLength(run));
    });
    prepared.forEach((runs, ridgeIndex) => {
      const ridge = ridges[ridgeIndex];
      const role = roles[ridgeIndex] ?? "body";
      const band: RidgeRole = role === "core" && coreWords.length ? "core" : role === "secondary" && secondaryWords.length ? "secondary" : "body";
      const size = fontSize * roleScale(band);
      const d = toPathD(ridge.points);
      strokes.push(`<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${Math.max(0.8, period * 0.08)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (understroke) {
        inkPaths.push(`<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${bridge.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      const measure = (word: string) => estimateWordWidth(word, size, Math.max(font.charRatio, 0.62), -size * 0.045);
      const packed = band === "body"
        ? packBodyRuns(runs, body.names, body.verses, measure, size * 0.16, nameCursor, verseCursor, ceilings.body)
        : packRuns(runs, band === "core" ? coreWords : secondaryWords, measure, size * 0.16, cursors[band], ceilings[band]);
      const weight = band === "core" ? size * 0.045 : band === "secondary" ? size * 0.032 : 0;
      for (const run of packed) {
        if (!run.text) continue;
        const id = `r${index++}`;
        defs.push(`<path id="${id}" d="${toPathD(run.points)}"/>`);
        const dy = (size * 0.38).toFixed(2);
        const stroke = weight > 0.2 ? ` stroke="${preset.ink}" stroke-width="${weight.toFixed(2)}" paint-order="stroke fill" stroke-linejoin="round"` : "";
        texts.push(
          `<text class="ridge ridge-${band}" font-size="${size.toFixed(2)}" letter-spacing="${(-size * 0.045).toFixed(2)}" fill="${preset.ink}" font-family="${escapeXml(opts?.fontFamily || font.family)}"${stroke}><textPath href="#${id}" dy="${dy}">${escapeXml(run.text)}</textPath></text>`,
        );
      }
    });
  }
  const footerText = style.footer || style.script || "";
  const title = style.title
    ? `<text class="piece-title" x="${(width / 2).toFixed(1)}" y="46" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="28" letter-spacing="3.5" fill="${preset.ink}">${escapeXml(style.title.toUpperCase())}</text>`
    : "";
  const footer = footerText
    ? `<text class="${style.footer ? "piece-footer" : "piece-script"}" x="${(width / 2).toFixed(1)}" y="${height - 28}" text-anchor="middle" font-family="${style.footer ? "Cormorant Garamond, Georgia, serif" : "Great Vibes, cursive"}" font-size="${style.footer ? 26 : 34}" fill="${preset.ink}">${escapeXml(footerText)}</text>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${opts?.transparent ? "none" : preset.paper}"/><defs>${defs.join("")}</defs>${title}<g transform="translate(0 ${topPad})"><g class="ridge-ink">${inkPaths.join("")}</g><g class="ridge-strokes" style="display:none">${strokes.join("")}</g>${texts.join("")}</g>${footer}</svg>`;
  return { svg, width, height, fontSize, strokes: strokes.join("") };
}
