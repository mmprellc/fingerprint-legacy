import { DEFAULT_FONT, DEFAULT_PRESET, type PrintStyle } from "./types";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function list(value: unknown, maxItems: number, maxLen: number) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/[ \t]+/g, " ").trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** The style fields the studio, the portrait route, and checkout all keep. */
export function readPrintStyle(value: Partial<PrintStyle> | null | undefined): PrintStyle {
  const style = value ?? {};
  const names = list(style.names, 80, 80);
  const scriptures = list(style.scriptures, 12, 500);
  const stories = list(style.stories, 12, 4000);
  const plaqueLines = list(style.plaqueLines, 12, 80);
  return {
    font: style.font === "baskerville" ? "baskerville" : DEFAULT_FONT,
    preset: text(style.preset, 40) || DEFAULT_PRESET,
    textScale: typeof style.textScale === "number" && Number.isFinite(style.textScale) ? Math.min(1.4, Math.max(0.7, style.textScale)) : 1,
    title: text(style.title, 120),
    script: text(style.script, 120),
    ...(text(style.footer, 160) ? { footer: text(style.footer, 160) } : {}),
    ...(text(style.headerName, 80) ? { headerName: text(style.headerName, 80) } : {}),
    ...(text(style.headerDates, 80) ? { headerDates: text(style.headerDates, 80) } : {}),
    ...(text(style.signature, 80) ? { signature: text(style.signature, 80) } : {}),
    ...(style.plaque ? { plaque: true } : {}),
    ...(plaqueLines.length ? { plaqueLines } : {}),
    ...(text(style.centerName, 80) ? { centerName: text(style.centerName, 80) } : {}),
    ...(text(style.centerDetail, 80) ? { centerDetail: text(style.centerDetail, 80) } : {}),
    ...(text(style.secondaryName, 80) ? { secondaryName: text(style.secondaryName, 80) } : {}),
    ...(text(style.secondaryDetail, 80) ? { secondaryDetail: text(style.secondaryDetail, 80) } : {}),
    ...(text(style.marriage, 80) ? { marriage: text(style.marriage, 80) } : {}),
    ...(text(style.marriageDate, 40) ? { marriageDate: text(style.marriageDate, 40) } : {}),
    ...(names.length ? { names } : {}),
    ...(scriptures.length ? { scriptures } : {}),
    ...(stories.length ? { stories } : {}),
  };
}
