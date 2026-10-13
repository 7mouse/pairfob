import { describe, expect, test } from "bun:test";
import { cellRuns, iconFace, iconScanner, powerlineShape } from "./term-glyphs";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("iconFace", () => {
  test("names the face that draws an icon and leaves ordinary text alone", () => {
    expect(iconFace(0xe0a0)).toBe("bmp");
    expect(iconFace(0xf07b)).toBe("bmp");
    expect(iconFace(0xf533)).toBe("bmp");
    expect(iconFace(0x23fb)).toBe("bmp");
    expect(iconFace(0x2b58)).toBe("bmp");
    expect(iconFace(0xf0001)).toBe("mdi");
    expect(iconFace(0xf1af0)).toBe("mdi");
    for (const plain of [0x41, 0x4e2d, 0x2500, 0x23fa, 0x23bf, 0x273b, 0x25cf, 0x1f680]) expect(iconFace(plain)).toBeNull();
  });

  test("a private use code point neither file holds is not an icon", () => {
    // The Apple logo, the gaps between icon sets, and what lies past the last one.
    for (const absent of [0xf8ff, 0xe00b, 0xe0a4, 0xe100, 0xe959, 0xf386, 0xf534, 0xf0000, 0xf1af1, 0x100000]) {
      expect(iconFace(absent)).toBeNull();
    }
  });
});

describe("powerlineShape", () => {
  test("covers the sixteen separators and nothing beside them", () => {
    expect(powerlineShape(0xe0b0)).toBe("b0");
    expect(powerlineShape(0xe0ba)).toBe("ba");
    expect(powerlineShape(0xe0bf)).toBe("bf");
    expect(powerlineShape(0xe0af)).toBeNull();
    expect(powerlineShape(0xe0c0)).toBeNull();
    // The branch mark is a glyph like any other icon.
    expect(powerlineShape(0xe0a0)).toBeNull();
  });
});

describe("cellRuns", () => {
  test("text without an icon is not cut up", () => {
    expect(cellRuns("")).toBeNull();
    expect(cellRuns("⏺ Update(a.ts) 中文 🚀 │ ─")).toBeNull();
    // A private use code point no face holds stays in the text.
    expect(cellRuns("a\uf8ffb")).toBeNull();
  });

  test("each icon stands alone and the text around it is kept whole", () => {
    expect(cellRuns(" \uf07b src  \ue628 main.ts")).toEqual([
      { kind: "text", text: " " },
      { kind: "icon", text: "\uf07b", face: "bmp" },
      { kind: "text", text: " src  " },
      { kind: "icon", text: "\ue628", face: "bmp" },
      { kind: "text", text: " main.ts" },
    ]);
    expect(cellRuns("\uf07b\uf115")).toEqual([{ kind: "icon", text: "\uf07b", face: "bmp" }, { kind: "icon", text: "\uf115", face: "bmp" }]);
  });

  test("an icon outside the basic plane is one run, not two halves", () => {
    expect(cellRuns("a\u{f0219}b")).toEqual([
      { kind: "text", text: "a" },
      { kind: "icon", text: "\u{f0219}", face: "mdi" },
      { kind: "text", text: "b" },
    ]);
  });

  test("a separator carries its shape", () => {
    expect(cellRuns(" ~/proj \ue0b0")).toEqual([
      { kind: "text", text: " ~/proj " },
      { kind: "shape", text: "\ue0b0", shape: "b0" },
    ]);
  });

  test("the runs are the text, in order", () => {
    const text = "\ue0b6 \ue0a0 main \ue0b0\ue0b1 x\u{f0219}\u23fb y";
    expect(cellRuns(text)!.map((run) => run.text).join("")).toBe(text);
  });
});

describe("iconScanner", () => {
  test("reports each face once, when its first icon goes by", () => {
    const scan = iconScanner();
    expect(scan(utf8("\x1b[2J\x1b[Hplain text, 中文, ⏺ and 🚀"))).toEqual([]);
    expect(scan(utf8("\x1b[32m\uf07b\x1b[0m src"))).toEqual(["bmp"]);
    expect(scan(utf8("\ue0a0 again"))).toEqual([]);
    expect(scan(utf8("\u{f0219} then \uf07b"))).toEqual(["mdi"]);
    expect(scan(utf8("\u{f0219}\uf07b"))).toEqual([]);
  });

  test("finds both faces in one chunk", () => {
    expect(iconScanner()(utf8("\u{f0219} \ue0b0"))).toEqual(["mdi", "bmp"]);
  });

  test("an icon cut by the end of a chunk is finished by the next", () => {
    for (const icon of ["\uf07b", "\ue0a0", "\u23fb", "\u{f0219}"]) {
      const bytes = utf8(icon);
      for (let cut = 1; cut < bytes.length; cut++) {
        const scan = iconScanner();
        expect(scan(bytes.slice(0, cut))).toEqual([]);
        expect(scan(bytes.slice(cut))).toHaveLength(1);
      }
    }
  });

  test("a sequence that is cut short does not swallow what follows", () => {
    const scan = iconScanner();
    // A lone lead byte, then a whole icon.
    expect(scan(new Uint8Array([0xee, ...utf8("\uf07b")]))).toEqual(["bmp"]);
    const other = iconScanner();
    expect(other(new Uint8Array([0xf3, 0xb0, 0x41, ...utf8("\u{f0219}")]))).toEqual(["mdi"]);
  });

  test("private use bytes no face holds are not reported", () => {
    expect(iconScanner()(utf8("\uf8ff \ue100 \u{100000}"))).toEqual([]);
  });
});
