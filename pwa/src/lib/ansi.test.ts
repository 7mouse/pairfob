import { describe, expect, test } from "bun:test";
import { lineFillBackground, paintLines, parseAnsi, plainCellClass, spanCss, trimPaintLine, xterm256 } from "./ansi";

describe("parseAnsi", () => {
  test("plain text becomes one span per line", () => {
    const lines = parseAnsi("hello\nworld");
    expect(lines.map((line) => line.text)).toEqual(["hello", "world"]);
    expect(lines[0].spans[0]?.text).toBe("hello");
  });

  test("24-bit SGR is kept on text nodes, never as HTML", () => {
    const raw = "\x1b[0m\x1b[38;2;225;225;225m\x1b[48;2;20;20;20mhello\x1b[0m";
    const [line] = parseAnsi(raw);
    expect(line.text).toBe("hello");
    expect(line.spans[0]?.style.fg).toBe("rgb(225, 225, 225)");
    expect(line.spans[0]?.style.bg).toBe("rgb(20, 20, 20)");
  });

  test("CRLF and trailing CR do not leak into the line", () => {
    const lines = parseAnsi("one\r\ntwo\r\n");
    expect(lines.map((line) => line.text)).toEqual(["one", "two"]);
  });

  test("xterm cube and grayscale map to rgb", () => {
    expect(xterm256(16)).toBe("rgb(0, 0, 0)");
    expect(xterm256(232)).toBe("rgb(8, 8, 8)");
  });

  test("spanCss uses backgroundColor so cell paint does not clobber other background layers", () => {
    const css = spanCss({ fg: "rgb(225, 225, 225)", bg: "rgb(20, 20, 20)" });
    expect(css.color).toBe("rgb(225, 225, 225)");
    expect(css.backgroundColor).toBe("rgb(20, 20, 20)");
    expect(css).not.toHaveProperty("background");
  });

  test("line fill uses the last painted cell background, including inverse", () => {
    const [line] = parseAnsi("\x1b[48;2;20;22;28mplain\x1b[7mrev\x1b[27m rest");
    expect(lineFillBackground(line.spans)).toBe("rgb(20, 22, 28)");
    expect(lineFillBackground([{ text: "x", style: { inverse: true, fg: "#abcabc" } }])).toBe("#abcabc");
    expect(lineFillBackground([{ text: "x", style: {} }])).toBeUndefined();
  });

  test("a row that ends on the default background is not filled with an earlier colour", () => {
    // A Powerline prompt: two coloured segments, then the closing separator on the default background.
    const [prompt] = parseAnsi("\x1b[44;97m ~/proj \x1b[0;34;42m\ue0b0\x1b[30m main \x1b[0;32m\ue0b0\x1b[0m");
    expect(lineFillBackground(trimPaintLine(prompt).spans)).toBeUndefined();
    // A highlighted word in the middle of a sentence.
    const [sentence] = parseAnsi("found \x1b[43mneedle\x1b[0m in the hay");
    expect(lineFillBackground(sentence.spans)).toBeUndefined();
    // A status bar painted to the last column still fills.
    const [bar] = parseAnsi("\x1b[44m NORMAL \x1b[0;44m main.ts      \x1b[0m");
    expect(lineFillBackground(trimPaintLine(bar).spans)).toBe("#6b8cae");
  });
});

describe("plainCellClass", () => {
  test("in a filled row, a cell on the default background is marked to be painted with it", () => {
    // Text, then a bar that runs to the edge of the row.
    const [row] = parseAnsi("label  \x1b[44m status \x1b[0m");
    const fill = lineFillBackground(row.spans);
    expect(fill).toBe("#6b8cae");
    expect(row.spans.map((span) => plainCellClass(spanCss(span.style), fill))).toEqual(["cell-plain", undefined]);
  });

  test("a row that is not filled marks nothing, whatever its cells carry", () => {
    const [row] = parseAnsi("\x1b[44m bar \x1b[0m tail");
    expect(lineFillBackground(row.spans)).toBeUndefined();
    expect(row.spans.map((span) => plainCellClass(spanCss(span.style), undefined))).toEqual([undefined, undefined]);
  });
});

describe("paintLines", () => {
  test("strips the spaces a TUI used to pad the computer window", () => {
    const [line] = parseAnsi("hello world" + " ".repeat(40));
    const painted = trimPaintLine(line);
    expect(painted.text).toBe("hello world");
    expect(painted.spans[0]?.text).toBe("hello world");
  });

  test("keeps trailing cells that carry a TUI background", () => {
    const [padded] = parseAnsi("ok\x1b[44m     \x1b[0m");
    const painted = trimPaintLine(padded);
    expect(painted.text).toBe("ok     ");
    expect(lineFillBackground(painted.spans)).toBe("#6b8cae");
  });

  test("keeps a row that is only a colored bar", () => {
    const [bar] = parseAnsi("\x1b[44m        \x1b[0m");
    const painted = trimPaintLine(bar);
    expect(painted.text).toBe("        ");
    expect(lineFillBackground(painted.spans)).toBe("#6b8cae");
  });

  test("keeps leading indent and drops trailing empty viewport rows", () => {
    const lines = parseAnsi("  ready\n\n\n");
    const painted = paintLines(lines);
    expect(painted.map((line) => line.text)).toEqual(["  ready"]);
  });

  test("does not collapse a blank line between content", () => {
    const painted = paintLines(parseAnsi("top\n\nbottom\n\n"));
    expect(painted.map((line) => line.text)).toEqual(["top", "", "bottom"]);
  });
});
