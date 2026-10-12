import { describe, expect, test } from "bun:test";
import { changedRanges } from "./diff-words";

/** The stretch of a replaced line that changed, cut at word boundaries. */

const marked = (text: string, range: { start: number; end: number }) => text.slice(range.start, range.end);

describe("changedRanges", () => {
  test("marks the words between what the two lines share at both ends", () => {
    const before = "export const ready = false;";
    const after = "export const ready = true;";
    const ranges = changedRanges(before, after)!;
    expect(marked(before, ranges.before)).toBe("false");
    expect(marked(after, ranges.after)).toBe("true");
  });

  test("an insertion marks nothing on the old line and the new words on the new one", () => {
    const before = "  .render(<App />);";
    const after = "  .render(<App ready />);";
    const ranges = changedRanges(before, after)!;
    expect(marked(before, ranges.before)).toBe("");
    expect(marked(after, ranges.after)).toBe("ready ");
  });

  test("a change at the start or the end reaches the line's edge", () => {
    expect(marked("let total = count;", changedRanges("var total = count;", "let total = count;")!.after)).toBe("let");
    const end = changedRanges("return a + b", "return a + b + c")!;
    expect(marked("return a + b + c", end.after)).toBe(" + c");
  });

  test("a word is never split: `ready` to `readyState` marks the whole word", () => {
    const ranges = changedRanges("if (ready) {", "if (readyState) {")!;
    expect(marked("if (ready) {", ranges.before)).toBe("ready");
    expect(marked("if (readyState) {", ranges.after)).toBe("readyState");
  });

  test("lines that share too little are two different lines, and equal lines have no edit", () => {
    expect(changedRanges("export const ready = false;", "import { createRoot } from \"react-dom/client\";")).toBeNull();
    expect(changedRanges("  a", "  b")).toBeNull();
    expect(changedRanges("same", "same")).toBeNull();
    expect(changedRanges("", "added")).toBeNull();
  });

  test("offsets count characters, not words, with text outside ASCII too", () => {
    const before = "const 标题 = \"旧\";";
    const after = "const 标题 = \"新的\";";
    const ranges = changedRanges(before, after)!;
    expect(marked(before, ranges.before)).toBe("旧");
    expect(marked(after, ranges.after)).toBe("新的");
  });

  test("a mark never splits what is drawn as one glyph", () => {
    // A letter and the accent that combines with it are one word.
    const accent = changedRanges("le cafe ouvre", "le cafe\u0301 ouvre")!;
    expect(marked("le cafe\u0301 ouvre", accent.after)).toBe("cafe\u0301");
    // A family joined by zero-width joiners changes as a whole.
    const before = "team \u{1F468}\u200D\u{1F469}\u200D\u{1F467} here";
    const after = "team \u{1F468}\u200D\u{1F469}\u200D\u{1F466} here";
    const family = changedRanges(before, after)!;
    expect(marked(after, family.after)).toBe("\u{1F468}\u200D\u{1F469}\u200D\u{1F466}");
    expect(marked(before, family.before)).toBe("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
    // A skin tone stays with its hand.
    const hand = changedRanges("ok \u{1F44D}\u{1F3FB} done", "ok \u{1F44D}\u{1F3FD} done")!;
    expect(marked("ok \u{1F44D}\u{1F3FD} done", hand.after)).toBe("\u{1F44D}\u{1F3FD}");
  });

  test("in a script written without spaces one character is the unit", () => {
    const before = "// 发送全部批注给 Agent";
    const after = "// 发送所有批注给 Agent";
    const ranges = changedRanges(before, after)!;
    expect(marked(before, ranges.before)).toBe("全部");
    expect(marked(after, ranges.after)).toBe("所有");
    // Latin next to it is still a word of its own.
    const mixed = changedRanges("标题 title 结束", "标题 heading 结束")!;
    expect(marked("标题 heading 结束", mixed.after)).toBe("heading");
  });

  test("every character of the line belongs to exactly one piece", () => {
    // Offsets stay true through marks, joiners and separators that stand alone.
    const before = "a \u0301\u200D b\u2028c = 1";
    const after = "a \u0301\u200D b\u2028c = 2";
    const ranges = changedRanges(before, after)!;
    expect(marked(after, ranges.after)).toBe("2");
    expect(ranges.after.start).toBe(after.length - 1);
  });
});
