/**
 * A floor under the contrast of terminal text.
 *
 * A program picks its colours for the terminal it runs in, and this is another
 * one: other palette, darker background, a smaller screen. Black on the
 * default background, bold black on a coloured bar and blue on blue all come
 * out close to unreadable. Such text is moved to a contrast that reads, darker
 * if it was the darker of the two and lighter otherwise, so a dark label on a
 * coloured bar stays a dark label.
 *
 * The complete terminal gets the floor from xterm (`minimumContrastRatio`),
 * which moves anything under it. The guided view's palette is muted on
 * purpose, and white on one of its bars sits just under the floor while
 * reading well, so here only text that cannot be read is moved: what a person
 * can read stays as the theme drew it. Dim text is held to half, there and here.
 */

/** WCAG's minimum for large text and interface parts: enough to read, not enough to repaint a theme. */
export const MIN_TEXT_CONTRAST = 3;

/** Under this the guided view counts text as unreadable and moves it to the floor. */
export const UNREADABLE_CONTRAST = 2;

/** `--term-bg` and `--term-ink` (tokens.scss): what a cell with no colour of its own is drawn in. */
export const TERM_BACKGROUND = "#0b0e13";
export const TERM_INK = "#dfe5ee";

type Rgb = readonly [number, number, number];

function parse(color: string): Rgb | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16), Number.parseInt(hex[3], 16)];
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratioOf(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Contrast ratio of two colours, 1 to 21; 1 when either cannot be read. */
export function contrast(a: string, b: string): number {
  const first = parse(a);
  const second = parse(b);
  return first && second ? ratioOf(luminance(first), luminance(second)) : 1;
}

/** A tenth of the way to black or to white at a time, until the floor is met or there is nowhere left to go. */
function step(ink: Rgb, ground: number, floor: number, lighter: boolean): Rgb {
  let [r, g, b] = ink;
  const end = lighter ? 255 : 0;
  while (ratioOf(luminance([r, g, b]), ground) < floor && (r !== end || g !== end || b !== end)) {
    if (lighter) {
      r = Math.min(255, r + Math.ceil((255 - r) * 0.1));
      g = Math.min(255, g + Math.ceil((255 - g) * 0.1));
      b = Math.min(255, b + Math.ceil((255 - b) * 0.1));
    } else {
      r -= Math.max(0, Math.ceil(r * 0.1));
      g -= Math.max(0, Math.ceil(g * 0.1));
      b -= Math.max(0, Math.ceil(b * 0.1));
    }
  }
  return [r, g, b];
}

const settled = new Map<string, string>();

/**
 * The ink to draw on a ground: the ink itself unless its contrast is under
 * `unreadable`, then the nearest colour that reaches `floor`. A colour that
 * cannot be parsed is left alone.
 */
export function legibleInk(ink: string, ground: string, floor = MIN_TEXT_CONTRAST, unreadable = floor): string {
  const key = `${ink}|${ground}|${floor}|${unreadable}`;
  const known = settled.get(key);
  if (known !== undefined) return known;
  const from = parse(ink);
  const on = parse(ground);
  let result = ink;
  if (from && on) {
    const groundLight = luminance(on);
    const inkLight = luminance(from);
    if (ratioOf(inkLight, groundLight) < unreadable) {
      // Keep its side of the background if that side has room; otherwise whichever side reads better.
      const lighter = inkLight >= groundLight;
      const kept = step(from, groundLight, floor, lighter);
      let best = kept;
      if (ratioOf(luminance(kept), groundLight) < floor) {
        const crossed = step(from, groundLight, floor, !lighter);
        if (ratioOf(luminance(crossed), groundLight) > ratioOf(luminance(kept), groundLight)) best = crossed;
      }
      result = `rgb(${best[0]}, ${best[1]}, ${best[2]})`;
    }
  }
  if (settled.size > 4096) settled.clear();
  settled.set(key, result);
  return result;
}
