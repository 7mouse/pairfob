/**
 * Icon glyphs in terminal text.
 *
 * Prompts, file listings and status lines use Nerd Fonts icons, which sit in
 * the Unicode private use areas: a device only draws them from a face it was
 * given. The two faces beside this file carry them, and these ranges are what
 * those files contain (`term-glyphs.font.test.ts` reads the files).
 *
 * A terminal gives an icon one cell and lets it spill into the next, which is
 * why a program writes a space after it. Cell text that is laid out by the
 * browser has to say so itself, so it is cut into runs here.
 */

export type IconFace = "bmp" | "mdi";

/**
 * Each face has a family of its own (`icon-font.css`). An element that draws
 * an icon names the one family that holds it, so a browser that reads its
 * metrics from the first family in a list fetches that face and no other.
 */
export const ICON_FAMILY: Record<IconFace, string> = { bmp: '"Pairfob Symbols"', mdi: '"Pairfob Symbols MDI"' };

type Range = readonly [first: number, last: number];

/** `symbols-nerd-font-bmp.woff2`: the power symbols, then the private use area in the basic plane. */
export const ICON_RANGES_BMP: readonly Range[] = [
  [0x23fb, 0x23fe],
  [0x2b58, 0x2b58],
  [0xe000, 0xe00a],
  [0xe0a0, 0xe0a3],
  [0xe0b0, 0xe0d7],
  [0xe200, 0xe2a9],
  [0xe300, 0xe3e3],
  [0xe5fa, 0xe6bb],
  [0xe700, 0xe958],
  [0xea60, 0xec84],
  [0xed00, 0xefcf],
  [0xf000, 0xf385],
  [0xf400, 0xf533],
];

/** `symbols-nerd-font-mdi.woff2`: Material Design Icons in plane 15. */
export const ICON_RANGES_MDI: readonly Range[] = [[0xf0001, 0xf1af0]];

/** The face that draws a code point, or null for one that is ordinary text. */
export function iconFace(codePoint: number): IconFace | null {
  if (codePoint < 0x23fb) return null;
  if (codePoint >= 0xf0000) return within(ICON_RANGES_MDI, codePoint) ? "mdi" : null;
  return within(ICON_RANGES_BMP, codePoint) ? "bmp" : null;
}

function within(ranges: readonly Range[], codePoint: number): boolean {
  for (const [first, last] of ranges) {
    if (codePoint < first) return false;
    if (codePoint <= last) return true;
  }
  return false;
}

/**
 * Powerline separators, U+E0B0 to U+E0BF. A glyph is as tall as its font, a
 * row is taller, and a separator that does not reach both edges of its row
 * leaves the two colours it joins apart. These are drawn to the row instead.
 */
export type PowerlineShape =
  | "b0" | "b1" | "b2" | "b3" | "b4" | "b5" | "b6" | "b7"
  | "b8" | "b9" | "ba" | "bb" | "bc" | "bd" | "be" | "bf";

export function powerlineShape(codePoint: number): PowerlineShape | null {
  if (codePoint < 0xe0b0 || codePoint > 0xe0bf) return null;
  return `b${(codePoint - 0xe0b0).toString(16)}` as PowerlineShape;
}

export type CellRun =
  | { kind: "text"; text: string }
  | { kind: "icon"; text: string; face: IconFace }
  | { kind: "shape"; text: string; shape: PowerlineShape };

/** Anything a face might draw; the ranges decide. */
const CANDIDATE = /[\u23fb-\u23fe\u2b58\ue000-\uf8ff\u{f0000}-\u{fffff}]/u;

/**
 * Cell text as runs: ordinary text kept whole, each icon on its own. Null when
 * the text has no icon in it, which is nearly every span of every screen.
 */
export function cellRuns(text: string): CellRun[] | null {
  if (!CANDIDATE.test(text)) return null;
  const runs: CellRun[] = [];
  let plain = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    const face = iconFace(codePoint);
    if (!face) {
      plain += char;
      continue;
    }
    if (plain) runs.push({ kind: "text", text: plain });
    plain = "";
    const shape = powerlineShape(codePoint);
    runs.push(shape ? { kind: "shape", text: char, shape } : { kind: "icon", text: char, face });
  }
  if (plain) {
    if (!runs.length) return null;
    runs.push({ kind: "text", text: plain });
  }
  return runs;
}

/**
 * Which faces a stream of UTF-8 needs. The complete terminal is handed bytes
 * and draws them itself, so nothing else will notice an icon going by. A
 * sequence cut by the end of a chunk is finished by the next one.
 */
export function iconScanner(): (bytes: Uint8Array) => IconFace[] {
  let pending = 0;
  let codePoint = 0;
  const found = new Set<IconFace>();
  return (bytes) => {
    const fresh: IconFace[] = [];
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index]!;
      if (pending) {
        if ((byte & 0xc0) !== 0x80) {
          // Not a continuation: the sequence was cut short, and this byte starts over.
          pending = 0;
          index--;
          continue;
        }
        codePoint = (codePoint << 6) | (byte & 0x3f);
        if (--pending) continue;
        const face = iconFace(codePoint);
        if (face && !found.has(face)) {
          found.add(face);
          fresh.push(face);
        }
        continue;
      }
      // Every icon is three or four bytes long, and the lowest starts with E2.
      if (byte < 0xe2) continue;
      if (byte < 0xf0) {
        pending = 2;
        codePoint = byte & 0x0f;
      } else if (byte < 0xf8) {
        pending = 3;
        codePoint = byte & 0x07;
      }
    }
    return fresh;
  };
}
