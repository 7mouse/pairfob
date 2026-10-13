import { legibleInk, MIN_TEXT_CONTRAST, TERM_BACKGROUND, TERM_INK, UNREADABLE_CONTRAST } from "./ansi-contrast";

export interface SpanStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface StyledSpan {
  text: string;
  style: SpanStyle;
}

export interface StyledLine {
  text: string;
  spans: StyledSpan[];
}

const SYSTEM = [
  "#000000", "#c45a38", "#7ea58c", "#c4923a",
  "#6b8cae", "#b57a9e", "#6aa0a8", "#d6d0c2",
  "#6a6a6a", "#e07a55", "#9fc3ab", "#e0b35c",
  "#8fb0d0", "#d49cbe", "#8ec4cc", "#f3ead7",
];

const CUBE = [0, 95, 135, 175, 215, 255];

export function xterm256(index: number): string {
  const n = Math.max(0, Math.min(255, index | 0));
  if (n < 16) return SYSTEM[n];
  if (n >= 232) {
    const value = 8 + (n - 232) * 10;
    return `rgb(${value}, ${value}, ${value})`;
  }
  const cube = n - 16;
  const r = CUBE[Math.floor(cube / 36)];
  const g = CUBE[Math.floor((cube % 36) / 6)];
  const b = CUBE[cube % 6];
  return `rgb(${r}, ${g}, ${b})`;
}

function applySgr(params: number[], style: SpanStyle): SpanStyle {
  const next: SpanStyle = { ...style };
  if (params.length === 0) params = [0];
  for (let i = 0; i < params.length; i++) {
    const code = params[i];
    if (code === 0) {
      next.fg = undefined;
      next.bg = undefined;
      next.bold = undefined;
      next.dim = undefined;
      next.italic = undefined;
      next.underline = undefined;
      next.inverse = undefined;
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) {
      next.bold = undefined;
      next.dim = undefined;
    } else if (code === 23) next.italic = undefined;
    else if (code === 24) next.underline = undefined;
    else if (code === 27) next.inverse = undefined;
    else if (code === 39) next.fg = undefined;
    else if (code === 49) next.bg = undefined;
    else if (code >= 30 && code <= 37) next.fg = SYSTEM[code - 30];
    else if (code >= 90 && code <= 97) next.fg = SYSTEM[code - 90 + 8];
    else if (code >= 40 && code <= 47) next.bg = SYSTEM[code - 40];
    else if (code >= 100 && code <= 107) next.bg = SYSTEM[code - 100 + 8];
    else if ((code === 38 || code === 48) && i + 1 < params.length) {
      const mode = params[i + 1];
      if (mode === 5 && i + 2 < params.length) {
        const color = xterm256(params[i + 2]);
        if (code === 38) next.fg = color;
        else next.bg = color;
        i += 2;
      } else if (mode === 2 && i + 4 < params.length) {
        const color = `rgb(${params[i + 2] & 255}, ${params[i + 3] & 255}, ${params[i + 4] & 255})`;
        if (code === 38) next.fg = color;
        else next.bg = color;
        i += 4;
      } else i += 1;
    }
  }
  return next;
}

function pushSpan(spans: StyledSpan[], text: string, style: SpanStyle): void {
  if (!text) return;
  const last = spans[spans.length - 1];
  const same = last
    && last.style.fg === style.fg
    && last.style.bg === style.bg
    && last.style.bold === style.bold
    && last.style.dim === style.dim
    && last.style.italic === style.italic
    && last.style.underline === style.underline
    && last.style.inverse === style.inverse;
  if (same) last.text += text;
  else spans.push({ text, style: { ...style } });
}

function flushLine(lines: StyledLine[], spans: StyledSpan[]): StyledSpan[] {
  const text = spans.map((span) => span.text).join("");
  lines.push({ text, spans });
  return [];
}

/** Parse CSI/SGR into text-node spans. Never produces HTML. */
export function parseAnsi(raw: string): StyledLine[] {
  const source = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: StyledLine[] = [];
  let spans: StyledSpan[] = [];
  let style: SpanStyle = {};
  let buffer = "";
  const flush = () => {
    pushSpan(spans, buffer, style);
    buffer = "";
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\n") {
      flush();
      spans = flushLine(lines, spans);
      continue;
    }
    if (char === "\x1b") {
      const next = source[i + 1];
      if (next === "[") {
        flush();
        const end = source.slice(i + 2).search(/[A-Za-z]/);
        if (end < 0) break;
        const final = source[i + 2 + end];
        const body = source.slice(i + 2, i + 2 + end);
        i += 2 + end;
        if (final === "m") {
          const params = body === "" ? [0] : body.split(";").map((part) => Number(part) || 0);
          style = applySgr(params, style);
        }
        continue;
      }
      if (next === "]") {
        const bel = source.indexOf("\x07", i);
        const st = source.indexOf("\x1b\\", i);
        const stop = [bel, st].filter((index) => index >= 0).sort((a, b) => a - b)[0];
        if (stop === undefined) break;
        i = stop + (stop === st ? 1 : 0);
        continue;
      }
      continue;
    }
    buffer += char;
  }
  flush();
  if (spans.length || lines.length === 0) flushLine(lines, spans);
  return lines;
}

/**
 * Glyphs that are drawn shapes and not text: box drawing and blocks, and the
 * Powerline separators. A separator is the colour of the bar it closes and a
 * frame is the colour its program gave it; neither is something to read, so
 * neither is moved for contrast. xterm leaves the same ones alone.
 */
function drawnShape(codePoint: number): boolean {
  return (codePoint >= 0x2500 && codePoint <= 0x259f) || (codePoint >= 0xe0a4 && codePoint <= 0xe0d6);
}

function onlyShapes(text: string): boolean {
  let shapes = false;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (drawnShape(codePoint)) shapes = true;
    else if (char !== " " && char !== "\u00a0") return false;
  }
  return shapes;
}

/** The foreground a style asks for once inverse is applied, before anything is done for contrast. */
export function spanInk(style: SpanStyle): string | undefined {
  return style.inverse ? style.bg || "#141414" : style.fg;
}

/**
 * The CSS of one styled run. With its `text`, a run that is nothing but drawn
 * shapes keeps the colour it was given.
 */
export function spanCss(style: SpanStyle, text?: string): {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  opacity?: string;
} {
  let fg = style.fg;
  let bg = style.bg;
  if (style.inverse) {
    const swap = fg;
    fg = bg || "#141414";
    bg = swap || "#e6e6e6";
  }
  if (text === undefined || !onlyShapes(text)) {
    // Text that cannot be read on its background here is moved to where it can (ansi-contrast.ts).
    const ink = fg ?? TERM_INK;
    // Dim text is meant to be faint: it is only held to half the floor, as xterm holds it.
    const legible = style.dim
      ? legibleInk(ink, bg ?? TERM_BACKGROUND, MIN_TEXT_CONTRAST / 2)
      : legibleInk(ink, bg ?? TERM_BACKGROUND, MIN_TEXT_CONTRAST, UNREADABLE_CONTRAST);
    if (legible !== ink) fg = legible;
  }
  return {
    ...(fg ? { color: fg } : {}),
    ...(bg ? { backgroundColor: bg } : {}),
    ...(style.bold ? { fontWeight: "700" } : {}),
    ...(style.italic ? { fontStyle: "italic" } : {}),
    ...(style.underline ? { textDecoration: "underline" } : {}),
    ...(style.dim ? { opacity: "0.7" } : {}),
  };
}

/**
 * SGR background that should fill the rest of a terminal row: the one its last
 * painted cell carries. A row that ends on the default background stops there,
 * however it was coloured before: a prompt's last segment closes with a
 * separator on the default background, and must not paint the row to its end.
 */
export function lineFillBackground(spans: StyledSpan[]): string | undefined {
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].text) return spanCss(spans[i].style).backgroundColor;
  }
  return undefined;
}

/**
 * The class of a cell in a row that is filled. The fill is the row's own
 * background, and shows through every cell that has none. A cell the program
 * left on the default background is one of those, and has to be painted with
 * the default background to stay what it was: text before a bar that runs to
 * the edge is not on the bar.
 */
export function plainCellClass(css: { backgroundColor?: string }, fill: string | undefined): string | undefined {
  return fill && !css.backgroundColor ? "cell-plain" : undefined;
}

const TRAILING_PAD = /[\s\u00a0]+$/u;

/** Drop default-bg padding the computer used to fill its column count. Keep cells that carry a TUI background. */
export function trimPaintLine(line: StyledLine): StyledLine {
  const spans: StyledSpan[] = [];
  for (const span of line.spans) {
    if (span.text) spans.push(span);
  }
  while (spans.length) {
    const last = spans[spans.length - 1]!;
    if (spanCss(last.style).backgroundColor) break;
    const text = last.text.replace(TRAILING_PAD, "");
    if (text === last.text) break;
    spans.pop();
    if (text) spans.push({ text, style: last.style });
  }
  return { text: spans.map((span) => span.text).join(""), spans };
}

/**
 * Phone paint: keep leading indent and interior blanks, but do not let the
 * computer's full-width padding or trailing empty viewport rows occupy the
 * screen.
 */
export function paintLines(lines: StyledLine[]): StyledLine[] {
  const trimmed = lines.map(trimPaintLine);
  let end = trimmed.length;
  while (end > 1 && !trimmed[end - 1]?.text) end -= 1;
  return trimmed.slice(0, end);
}
