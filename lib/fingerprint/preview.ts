import { escapeXml, toPathD } from "./geometry";
import { bodyTrackingEm, bodyWordGapEm, estimateWordWidth, fallbackWidth, fontSizeFor, plaqueFor, planPortrait, ribbonPath, rimWeights, roleScale } from "./lettering";
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
  opts?: { transparent?: boolean; fontFamily?: string; frame?: { width: number; height: number } },
) {
  const preset = presetById(style.preset);
  const font = fontById(style.font);
  const fontSize = fontSizeFor(period, style.textScale || 1, font.capEm);
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
  const hasHeader = Boolean(style.headerName?.trim() || style.title?.trim());
  const hasSignature = Boolean(style.signature?.trim());
  const topPad = !opts?.frame && hasHeader ? (style.headerName?.trim() ? 96 : 72) : 0;
  const bottomPad = !opts?.frame && (hasSignature || style.footer || style.script) ? 78 : 0;
  const width = Math.ceil(opts?.frame?.width ?? maxX);
  const height = Math.ceil(opts?.frame?.height ?? maxY) + topPad + bottomPad;
  const defs: string[] = [];
  const texts: string[] = [];
  let index = 0;
  for (let printIndex = 0; printIndex < mapped.length; printIndex++) {
    const ridges = mapped[printIndex];
    const rims = rimWeights(ridges);
    const bodySize = fontSize * roleScale("body");
    const planned = planPortrait(
      ridges,
      style,
      ridges[0]?.lines ?? [],
      period,
      (word, role) => {
        const size = fontSize * roleScale(role);
        return estimateWordWidth(word, size, font.charRatio, -size * (role === "body" ? bodyTrackingEm(style.textScale) : 0.045));
      },
      bodySize * bodyWordGapEm(style.textScale),
    );
    const plaque = plaqueFor(ridges, style, period);
    if (plaque) {
      texts.push(
        `<ellipse class="plaque-paper" cx="${plaque.cx.toFixed(2)}" cy="${plaque.cy.toFixed(2)}" rx="${plaque.rx.toFixed(2)}" ry="${plaque.ry.toFixed(2)}" fill="${preset.paper}"/>`,
      );
      plaque.lines.forEach((line, lineIndex) => {
        const weight = line.emphasis ? 700 : 560;
        texts.push(
          `<text class="plaque" x="${plaque.cx.toFixed(2)}" y="${plaque.baselines[lineIndex].toFixed(2)}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="${weight}" font-size="${line.fontSize.toFixed(2)}" fill="#1A1C1E">${escapeXml(line.text)}</text>`,
        );
      });
    }
    const emit: { ridgeIndex: number; run: (typeof planned)[number][number] }[] = [];
    planned.forEach((runs, ridgeIndex) => {
      for (const run of runs) emit.push({ ridgeIndex, run });
    });
    emit.sort((a, b) => a.run.order - b.run.order);
    for (const item of emit) {
      const run = item.run;
      if (run.role === "line") {
        const d = ribbonPath(run.points, fallbackWidth(period, style.textScale || 1));
        if (d) texts.push(`<path class="ridge-fallback" d="${d}" fill="${preset.ink}"/>`);
        continue;
      }
      if (!run.text) continue;
      const rim = rims[item.ridgeIndex] ?? 0;
      const fill = rim > 0.35 ? "#1A1C1E" : preset.ink;
      const size = fontSize * roleScale(run.role);
      const ink = run.role === "body" ? fill : "#1A1C1E";
      const id = `r${index++}`;
      defs.push(`<path id="${id}" d="${toPathD(run.points)}"/>`);
      const dy = (size * 0.38).toFixed(2);
      const tracking = run.role === "body" ? -size * bodyTrackingEm(style.textScale) : -size * 0.045;
      texts.push(
        `<text class="ridge ridge-${run.role}" font-size="${size.toFixed(2)}" letter-spacing="${tracking.toFixed(2)}" fill="${ink}" font-family="${escapeXml(opts?.fontFamily || font.family)}"><textPath href="#${id}" dy="${dy}">${escapeXml(run.text)}</textPath></text>`,
      );
    }
  }
  const headerName = style.headerName?.trim() ?? "";
  const headerDates = style.headerDates?.trim() ?? "";
  const title = headerName
    ? `<text class="piece-header" x="${(width / 2).toFixed(1)}" y="40" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="34" fill="${preset.ink}">${escapeXml(headerName)}</text>${headerDates ? `<text class="piece-header-dates" x="${(width / 2).toFixed(1)}" y="72" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="20" fill="${preset.ink}">${escapeXml(headerDates)}</text>` : ""}`
    : style.title
      ? `<text class="piece-title" x="${(width / 2).toFixed(1)}" y="46" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="28" letter-spacing="3.5" fill="${preset.ink}">${escapeXml(style.title.toUpperCase())}</text>`
      : "";
  const signature = style.signature?.trim()
    ? `<text class="piece-signature" x="${(width - 28).toFixed(1)}" y="${height - 28}" text-anchor="end" font-family="Great Vibes, cursive" font-size="30" fill="${preset.ink}">${escapeXml(style.signature.trim())}</text>`
    : "";
  const footerText = signature ? "" : style.footer || style.script || "";
  const footer = footerText
    ? `<text class="${style.footer ? "piece-footer" : "piece-script"}" x="${(width / 2).toFixed(1)}" y="${height - 28}" text-anchor="middle" font-family="${style.footer ? "Cormorant Garamond, Georgia, serif" : "Great Vibes, cursive"}" font-size="${style.footer ? 26 : 34}" fill="${preset.ink}">${escapeXml(footerText)}</text>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${opts?.transparent ? "none" : preset.paper}"/><defs>${defs.join("")}</defs>${title}<g transform="translate(0 ${topPad})">${texts.join("")}</g>${footer}${signature}</svg>`;
  return { svg, width, height, fontSize, strokes: "" };
}
