import { beforeEach, describe, expect, test } from "bun:test";
import {
  adoptDiffNoteScope, beginDiffNoteSend, carryDiffNoteTarget, carryDiffNotes, clearAllDiffNotes, composeDiffNotesPrompt, diffHoldsNotes,
  diffNoteCarryKey, diffNoteCounts, diffNoteTarget, diffNotesFor, endDiffNoteSend, openDiffNoteLines, upsertDiffNote,
} from "./diff-notes";
import { setLang } from "./i18n";
import { parseDiffLines, type DiffLine } from "./workspace";

/**
 * Notes waiting to be sent outlive the patch they were written on: a newer
 * patch of the file takes them over, each on the line that still reads as the
 * one it was written on, or marked as drifted where that line is gone.
 */

const session = { id: "a" };
const PATH = "src/app.ts";
const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const scope = (revision: string, paneId = "p1") => ({ session, paneId, revision });

const BEFORE = "@@ -1,4 +1,4 @@\n keep\n-false\n+true\n tail\n end\n";
/** Two lines added above: everything below moves down by two. */
const SHIFTED = "@@ -1,4 +1,6 @@\n+first\n+second\n keep\n-false\n+true\n tail\n end\n";
/** The added line was rewritten. */
const REWRITTEN = "@@ -1,4 +1,4 @@\n keep\n-false\n+maybe\n tail\n end\n";

const lines = (patch: string): DiffLine[] => parseDiffLines(patch);
const lineOf = (patch: string, text: string, kind: DiffLine["kind"]) => lines(patch).find((line) => line.text === text && line.kind === kind)!;

/** A note written on the old patch, on the line reading `text`. */
function write(text: string, kind: DiffLine["kind"], body: string): void {
  adoptDiffNoteScope(scope(OLD));
  expect(upsertDiffNote(diffNoteTarget(PATH, "worktree", lineOf(BEFORE, text, kind))!, body)).not.toBeNull();
}

/** The new patch is read: notes come along, and the diff is theirs. */
function read(patch: string) {
  const carried = carryDiffNotes(scope(NEW), PATH, "worktree", lines(patch));
  adoptDiffNoteScope(scope(NEW));
  return carried;
}

beforeEach(() => {
  setLang("zh");
  clearAllDiffNotes();
});

describe("a note follows its line to the new patch", () => {
  test("the same line at the same number is simply kept, and nothing is reported as moved", () => {
    write("true", "add", "why true");
    expect(read(BEFORE)).toMatchObject({ followed: 1, moved: 0, drifted: 0, orphaned: 0 });
    expect(diffNotesFor(PATH, "worktree").map((note) => [note.side, note.line, note.body, note.drifted])).toEqual([["new", 2, "why true", undefined]]);
  });

  test("lines added above move it down with its line, on either side", () => {
    write("true", "add", "why true");
    write("false", "delete", "why not false");
    write("tail", "context", "keep the tail");
    const carried = read(SHIFTED);
    expect(carried).toMatchObject({ followed: 3, moved: 2, drifted: 0 });
    // Where each one went, by where it stood: what an editor open on one of them follows.
    expect(carried.pins.get(diffNoteCarryKey(OLD, { side: "new", line: 2 }))).toMatchObject({ side: "new", line: 4, snippet: "true" });
    // The deleted line keeps its old-side number; the new side moved by two.
    expect(diffNotesFor(PATH, "worktree").map((note) => [note.side, note.line, note.snippet]).sort())
      .toEqual([["new", 4, "true"], ["new", 5, "tail"], ["old", 2, "false"]]);
  });

  test("without the new patch read, the notes are not on the diff, and with it they are, and can be sent", () => {
    write("true", "add", "why true");
    adoptDiffNoteScope(scope(NEW));
    expect(diffNotesFor(PATH, "worktree")).toHaveLength(0);
    // The list still counts it for the file, whatever patch it was written on.
    expect(diffNoteCounts(session, "p1").get(`worktree:${PATH}`)).toBe(1);
    read(SHIFTED);
    expect(diffNotesFor(PATH, "worktree")).toHaveLength(1);
    expect(composeDiffNotesPrompt(PATH, "worktree").text).toContain("第 4 行");
  });
});

describe("a note whose line is gone", () => {
  test("stays at the same number when that line still exists, marked, with the line as it was", () => {
    write("true", "add", "why true");
    expect(read(REWRITTEN)).toMatchObject({ followed: 0, moved: 0, drifted: 1 });
    const [note] = diffNotesFor(PATH, "worktree");
    expect([note.side, note.line, note.drifted, note.snippet]).toEqual(["new", 2, true, "true"]);
  });

  test("the prompt says the quoted line is the earlier one", () => {
    write("true", "add", "why true");
    read(REWRITTEN);
    const prompt = composeDiffNotesPrompt(PATH, "worktree").text;
    expect(prompt).toContain("之后文件有改动");
    expect(prompt).toContain("> true");
    expect(prompt).toContain("why true");
  });

  test("saved again on the line as it is now, it is an ordinary note", () => {
    write("true", "add", "why true");
    read(REWRITTEN);
    upsertDiffNote(diffNoteTarget(PATH, "worktree", lineOf(REWRITTEN, "maybe", "add"))!, "why maybe");
    const [note] = diffNotesFor(PATH, "worktree");
    expect([note.body, note.snippet, note.drifted]).toEqual(["why maybe", "maybe", undefined]);
    expect(composeDiffNotesPrompt(PATH, "worktree").text).not.toContain("之后文件有改动");
  });

  test("goes to the nearest line of its side when its number is gone too", () => {
    write("end", "context", "about the end");
    // The file now ends earlier: there is no line 4 on the new side.
    const carried = read("@@ -1,4 +1,2 @@\n keep\n-false\n-tail\n-end\n+true\n");
    expect(carried.drifted).toBe(1);
    const [note] = diffNotesFor(PATH, "worktree");
    expect([note.side, note.line, note.drifted, note.snippet]).toEqual(["new", 2, true, "end"]);
  });
});

describe("what is left alone", () => {
  test("notes of another pane, another Herdr session or another root are not touched", () => {
    write("true", "add", "why true");
    const none = { followed: 0, moved: 0, drifted: 0, orphaned: 0 };
    expect(carryDiffNotes({ ...scope(NEW), herd: "work" }, PATH, "worktree", lines(SHIFTED))).toMatchObject(none);
    expect(carryDiffNotes({ ...scope(NEW), root: "/other/repo" }, PATH, "worktree", lines(SHIFTED))).toMatchObject(none);
    adoptDiffNoteScope(scope(OLD));
    expect(diffNotesFor(PATH, "worktree").map((note) => note.line)).toEqual([2]);
  });

  test("notes of another pane, another file or the other layer are not touched", () => {
    write("true", "add", "why true");
    const none = { followed: 0, moved: 0, drifted: 0, orphaned: 0 };
    expect(carryDiffNotes(scope(NEW, "p2"), PATH, "worktree", lines(SHIFTED))).toMatchObject(none);
    expect(carryDiffNotes(scope(NEW), "src/other.ts", "worktree", lines(SHIFTED))).toMatchObject(none);
    expect(carryDiffNotes(scope(NEW), PATH, "staged", lines(SHIFTED))).toMatchObject(none);
    adoptDiffNoteScope(scope(OLD));
    expect(diffNotesFor(PATH, "worktree").map((note) => note.line)).toEqual([2]);
  });

  test("a note being sent stays with the patch it is sent for", () => {
    write("true", "add", "why true");
    const [note] = diffNotesFor(PATH, "worktree");
    beginDiffNoteSend([note.id]);
    expect(read(SHIFTED)).toMatchObject({ followed: 0, moved: 0, drifted: 0, orphaned: 0 });
    endDiffNoteSend();
    expect(note.revision).toBe(OLD);
  });

  test("two notes never end on one line", () => {
    write("true", "add", "first");
    write("tail", "context", "second");
    // Only one new-side line is left for both.
    const carried = read("@@ -1,4 +1,1 @@\n-keep\n-false\n-tail\n-end\n+only\n");
    expect(carried.followed).toBe(0);
    const pins = diffNotesFor(PATH, "worktree").map((item) => `${item.side}:${item.line}`);
    expect(new Set(pins).size).toBe(pins.length);
    expect(pins).toHaveLength(2);
  });
});

describe("a line that reads the same in several places", () => {
  // Two functions end in the same brace; the note is on the second one's.
  const TWO = "@@ -1,6 +1,6 @@\n function a() {\n   return 1;\n }\n function b() {\n-  return 2;\n+  return 3;\n }\n";
  /** Three lines added on top: the first brace now has the number the second one had. */
  const TWO_SHIFTED = "@@ -1,6 +1,9 @@\n+// one\n+// two\n+// three\n function a() {\n   return 1;\n }\n function b() {\n-  return 2;\n+  return 3;\n }\n";
  const closing = () => lines(TWO).filter((line) => line.text === "}")[1];

  test("is told apart by the lines around it, so the note stays on its own brace", () => {
    adoptDiffNoteScope(scope(OLD));
    // The diff on screen says what stands around the line a note is written on.
    openDiffNoteLines(scope(OLD), PATH, "worktree", lines(TWO));
    const note = upsertDiffNote(diffNoteTarget(PATH, "worktree", closing())!, "close b")!;
    expect([note.line, note.around]).toEqual([6, ["return 3;", ""]]);
    expect(read(TWO_SHIFTED)).toMatchObject({ followed: 1, moved: 1, drifted: 0 });
    expect(diffNotesFor(PATH, "worktree").map((item) => [item.line, item.drifted])).toEqual([[9, undefined]]);
    expect(composeDiffNotesPrompt(PATH, "worktree").text).toContain("第 9 行");
  });

  test("and when nothing tells them apart, the nearest is taken and the reader is asked to check", () => {
    adoptDiffNoteScope(scope(OLD));
    // Written without its surroundings known: the two braces are the same line to it.
    upsertDiffNote(diffNoteTarget(PATH, "worktree", closing())!, "close b");
    expect(read(TWO_SHIFTED)).toMatchObject({ followed: 0, moved: 0, drifted: 1 });
    const [note] = diffNotesFor(PATH, "worktree");
    expect([note.line, note.drifted, note.snippet]).toEqual([6, true, "}"]);
    expect(composeDiffNotesPrompt(PATH, "worktree").text).toContain("之后文件有改动");
  });

  test("a line that is the only one of its kind needs no surroundings", () => {
    adoptDiffNoteScope(scope(OLD));
    openDiffNoteLines(scope(OLD), PATH, "worktree", lines(TWO));
    upsertDiffNote(diffNoteTarget(PATH, "worktree", lineOf(TWO, "  return 3;", "add"))!, "why three");
    // Its neighbours were rewritten; the line itself still reads the same.
    expect(read("@@ -1,6 +1,6 @@\n function a() {\n   return 1;\n }\n function renamed() {\n-  return 2;\n+  return 3;\n };\n"))
      .toMatchObject({ followed: 1, moved: 0, drifted: 0 });
  });
});

describe("a file left with no line to hold its notes", () => {
  test("keeps them where they were, marked, on the new revision: they are still counted and can be sent", () => {
    write("true", "add", "why true");
    // The change was committed: the patch is empty.
    const carried = read("");
    expect(carried).toMatchObject({ followed: 0, moved: 0, drifted: 0, orphaned: 1 });
    const [note] = diffNotesFor(PATH, "worktree");
    expect([note.side, note.line, note.drifted, note.snippet, note.revision]).toEqual(["new", 2, true, "true", NEW]);
    expect(diffNoteCounts(session, "p1").get(`worktree:${PATH}`)).toBe(1);
    const prompt = composeDiffNotesPrompt(PATH, "worktree").text;
    expect(prompt).toContain("之后文件有改动");
    expect(prompt).toContain("> true");
  });

  test("the diff on screen says whether it has a line for them", () => {
    write("true", "add", "why true");
    carryDiffNotes(scope(NEW), PATH, "worktree", []);
    openDiffNoteLines(scope(NEW), PATH, "worktree", []);
    adoptDiffNoteScope(scope(NEW));
    expect(diffHoldsNotes(PATH, "worktree")).toBeFalse();
    // Another file's lines say nothing about this one, and lines nobody named are not known to be missing.
    expect(diffHoldsNotes("src/other.ts", "worktree")).toBeTrue();
    openDiffNoteLines(scope(NEW), PATH, "worktree", lines(BEFORE));
    expect(diffHoldsNotes(PATH, "worktree")).toBeTrue();
  });

  test("when the lines come back the notes are pinned on them again", () => {
    write("true", "add", "why true");
    read("");
    const again = "c".repeat(64);
    expect(carryDiffNotes(scope(again), PATH, "worktree", lines(SHIFTED))).toMatchObject({ followed: 1, moved: 1, orphaned: 0 });
    adoptDiffNoteScope(scope(again));
    expect(diffNotesFor(PATH, "worktree").map((note) => [note.line, note.drifted])).toEqual([[4, undefined]]);
  });
});

describe("a note that is only being written yet", () => {
  test("is found on the newer patch the way a saved one is, among the lines no saved note stands on", () => {
    adoptDiffNoteScope(scope(NEW));
    const target = diffNoteTarget(PATH, "worktree", lineOf(BEFORE, "true", "add"))!;
    expect(carryDiffNoteTarget(scope(NEW), target, lines(SHIFTED))).toMatchObject({ found: true, target: { side: "new", line: 4, snippet: "true" } });
    expect(carryDiffNoteTarget(scope(NEW), target, lines(REWRITTEN))).toMatchObject({ found: false, target: { side: "new", line: 2, snippet: "maybe" } });
    expect(carryDiffNoteTarget(scope(NEW), target, [])).toBeNull();
    // A saved note already stands on its line: the editor goes to the nearest free one.
    upsertDiffNote(diffNoteTarget(PATH, "worktree", lineOf(SHIFTED, "true", "add"))!, "taken");
    expect(carryDiffNoteTarget(scope(NEW), target, lines(SHIFTED))).toMatchObject({ found: false });
  });
});
