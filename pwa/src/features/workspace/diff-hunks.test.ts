import { describe, expect, test } from "bun:test";
import { parseDiffLines, type DiffLine } from "../../lib/workspace";
import { changedWords, diffHunks, splitRows } from "./diff-hunks";

/** A patch as hunks with a place in the file, replaced lines paired, and rows of two sides. */

const lines = (patch: string): DiffLine[] => parseDiffLines(patch).filter((line) => line.kind !== "meta");
const PATCH = [
  "@@ -3,4 +3,5 @@ export function App() {",
  " keep",
  "-const ready = false;",
  "+const ready = true;",
  "+const extra = 1;",
  " tail",
  " end",
  "@@ -40,3 +41,2 @@",
  " before",
  "-gone",
  " after",
  "",
].join("\n");

describe("diffHunks", () => {
  test("each hunk knows the lines it covers, what Git names it, and the unchanged stretch before it", () => {
    const [first, second] = diffHunks(lines(PATCH));
    expect(first).toMatchObject({ index: 0, side: "new", from: 3, to: 7, context: "export function App() {", gap: 2, gapLine: 1, offset: 0 });
    expect(first.lines.map((line) => line.text)).toEqual(["keep", "const ready = false;", "const ready = true;", "const extra = 1;", "tail", "end"]);
    // The first hunk ends at new line 7: 33 unchanged lines until the second starts at 41.
    expect(second).toMatchObject({ index: 1, side: "new", from: 41, to: 42, context: "", gap: 33, gapLine: 8, offset: 6 });
  });

  test("a hunk at the top of the file has nothing before it, and one line stands for a missing count", () => {
    const [top] = diffHunks(lines("@@ -1 +1 @@\n-a\n+b\n"));
    expect(top).toMatchObject({ from: 1, to: 1, gap: 0, gapLine: 1 });
  });

  test("a hunk that only removes is placed by the old file's lines", () => {
    const [only] = diffHunks(lines("@@ -10,2 +9,0 @@ tidy()\n-one\n-two\n"));
    expect(only).toMatchObject({ side: "old", from: 10, to: 11, context: "tidy()", gap: 9 });
    // What follows it starts after the line it sits behind.
    const [, next] = diffHunks(lines("@@ -10,2 +9,0 @@\n-one\n-two\n@@ -20,1 +18,1 @@\n-x\n+y\n"));
    expect(next).toMatchObject({ gap: 8, gapLine: 10 });
  });

  test("a new file is one hunk from its first line", () => {
    const [whole] = diffHunks(lines("@@ -0,0 +1,3 @@\n+a\n+b\n+c\n"));
    expect(whole).toMatchObject({ side: "new", from: 1, to: 3, gap: 0 });
  });

  test("lines keep their identity, and nothing before the first header is listed", () => {
    const parsed = lines(PATCH);
    const hunks = diffHunks(parsed);
    expect(hunks.flatMap((hunk) => hunk.lines)).toEqual(parsed.filter((line) => line.kind !== "hunk"));
    expect(hunks[0].lines[0] === parsed[1]).toBeTrue();
    expect(diffHunks(lines("stray\n@@ -1 +1 @@\n-a\n+b\n"))).toHaveLength(1);
    expect(diffHunks([])).toEqual([]);
  });
});

describe("changedWords", () => {
  test("a removed line and the added line in its place each get the stretch that changed", () => {
    const [hunk] = diffHunks(lines(PATCH));
    const words = changedWords(hunk.lines);
    const [, before, after, extra] = hunk.lines;
    expect(before.text.slice(words.get(before)!.start, words.get(before)!.end)).toBe("false");
    expect(after.text.slice(words.get(after)!.start, words.get(after)!.end)).toBe("true");
    // An addition with no removal beside it is new as a whole: nothing to single out.
    expect(words.has(extra)).toBeFalse();
    expect(words.has(hunk.lines[0])).toBeFalse();
  });

  test("lines are paired in order within one run, and never across unchanged lines", () => {
    const [hunk] = diffHunks(lines("@@ -1,4 +1,4 @@\n-let a = 1;\n-let b = 2;\n+let a = 10;\n+let b = 20;\n keep\n-let c = 3;\n keep\n+let c = 30;\n"));
    const words = changedWords(hunk.lines);
    const marked = hunk.lines.filter((line) => words.has(line)).map((line) => line.text.slice(words.get(line)!.start, words.get(line)!.end));
    expect(marked).toEqual(["1", "2", "10", "20"]);
  });
});

describe("splitRows", () => {
  test("unchanged lines stand on both sides, replacements side by side, and the surplus alone", () => {
    const [hunk] = diffHunks(lines(PATCH));
    const rows = splitRows(hunk.lines).map((row) => [row.left?.text ?? null, row.right?.text ?? null]);
    expect(rows).toEqual([
      ["keep", "keep"],
      ["const ready = false;", "const ready = true;"],
      [null, "const extra = 1;"],
      ["tail", "tail"],
      ["end", "end"],
    ]);
  });

  test("removals with nothing in their place, and additions on their own", () => {
    const [removed] = diffHunks(lines("@@ -1,3 +1,1 @@\n keep\n-one\n-two\n"));
    expect(splitRows(removed.lines).map((row) => [row.left?.kind ?? null, row.right?.kind ?? null]))
      .toEqual([["context", "context"], ["delete", null], ["delete", null]]);
    const [added] = diffHunks(lines("@@ -1,1 +1,3 @@\n keep\n+one\n+two\n"));
    expect(splitRows(added.lines).map((row) => [row.left?.kind ?? null, row.right?.kind ?? null]))
      .toEqual([["context", "context"], [null, "add"], [null, "add"]]);
  });
});
