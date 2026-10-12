import { beforeEach, describe, expect, test } from "bun:test";
import {
  DIFF_NOTE_BODY_LIMIT,
  adoptDiffNoteScope,
  beginDiffNoteSend,
  clearAllDiffNotes,
  clearDiffNotes,
  composeDiffNotesPrompt,
  diffNoteCounts,
  diffNoteForPin,
  diffNotePanes,
  diffNotePlace,
  diffNoteTarget,
  diffNotesAt,
  diffNotesFor,
  forgetPaneDiffNotes,
  placeDiffNotes,
  endDiffNoteSend,
  removeDiffNote,
  removeDiffNotes,
  upsertDiffNote,
  type DiffNote,
} from "./diff-notes";
import { OPERATION_INPUT_LIMITS } from "./operations";
import { parseDiffLines, type DiffLine } from "./workspace";

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";

function lines(): DiffLine[] {
  return parseDiffLines(PATCH);
}

const sessionA = { id: "a" };
const sessionB = { id: "b" };
const revision = "a".repeat(64);

function adopt(session: object = sessionA, paneId = "p1", rev = revision): void {
  adoptDiffNoteScope({ session, paneId, revision: rev });
}

function makeNote(partial: Partial<DiffNote> & Pick<DiffNote, "line" | "side" | "body">): DiffNote {
  return {
    id: `n-${partial.line}-${partial.side}`,
    path: partial.path ?? "src/app.ts",
    layer: partial.layer ?? "worktree",
    snippet: partial.snippet ?? "",
    session: sessionA,
    paneId: "p1",
    revision,
    ...partial,
  } as DiffNote;
}

beforeEach(() => {
  clearAllDiffNotes();
  adopt();
});

describe("line targeting", () => {
  test("pins add and context lines to the new side and delete lines to the old side", () => {
    const [hunk, context, del, add, tail] = lines();
    expect(diffNoteTarget("src/app.ts", "worktree", hunk)).toBeNull();
    expect(diffNoteTarget("src/app.ts", "worktree", context)).toMatchObject({ side: "new", line: 1 });
    expect(diffNoteTarget("src/app.ts", "staged", del)).toMatchObject({ side: "old", line: 2 });
    expect(diffNoteTarget("src/app.ts", "worktree", add)).toMatchObject({ side: "new", line: 2 });
    expect(diffNoteTarget("src/app.ts", "worktree", tail)).toMatchObject({ side: "new", line: 3 });
  });

  test("skips meta lines and lines without a number", () => {
    const meta: DiffLine = { kind: "meta", text: "diff --git a/x b/x", oldLine: null, newLine: null };
    expect(diffNoteTarget("x", "worktree", meta)).toBeNull();
    const unnumbered: DiffLine = { kind: "add", text: "x", oldLine: null, newLine: null };
    expect(diffNoteTarget("x", "worktree", unnumbered)).toBeNull();
  });

  test("captures a bounded quoted snippet", () => {
    const [, , del] = lines();
    const target = diffNoteTarget("src/app.ts", "worktree", del);
    expect(target?.snippet).toBe("false");
    const long: DiffLine = { kind: "add", text: "x".repeat(400), oldLine: null, newLine: 9 };
    expect(diffNoteTarget("x", "worktree", long)?.snippet.length).toBeLessThanOrEqual(121);
  });
});

describe("note store", () => {
  test("upsert adds one note per pin and replaces on the same pin", () => {
    const [, , del] = lines();
    const target = diffNoteTarget("src/app.ts", "worktree", del)!;
    upsertDiffNote(target, "why was this false?");
    upsertDiffNote(target, "rename instead");
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
    expect(diffNoteForPin(target)?.body).toBe("rename instead");
  });

  test("ignores blank bodies and keeps layers separate", () => {
    const [, , , add] = lines();
    const worktreePin = diffNoteTarget("src/app.ts", "worktree", add)!;
    const stagedPin = diffNoteTarget("src/app.ts", "staged", add)!;
    expect(upsertDiffNote(worktreePin, "   ")).toBeNull();
    upsertDiffNote(worktreePin, "worktree note");
    upsertDiffNote(stagedPin, "staged note");
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
    expect(diffNotesFor("src/app.ts", "staged")).toHaveLength(1);
    clearDiffNotes("src/app.ts", "worktree");
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
    expect(diffNotesFor("src/app.ts", "staged")).toHaveLength(1);
  });

  test("removes a note by id", () => {
    const [, , del] = lines();
    const target = diffNoteTarget("src/app.ts", "worktree", del)!;
    const note = upsertDiffNote(target, "drop me")!;
    removeDiffNote(note.id);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
  });

  test("notes stay with the session, pane and revision that created them", () => {
    const [, , del] = lines();
    const target = diffNoteTarget("src/app.ts", "worktree", del)!;
    upsertDiffNote(target, "only for this pane");
    adopt(sessionA, "p2", revision);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
    adopt(sessionB, "p1", revision);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
    adopt(sessionA, "p1", "b".repeat(64));
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
    adopt(sessionA, "p1", revision);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
  });

  test("a send removes only the captured ids, so a later note survives", () => {
    const [, , del, add] = lines();
    const first = upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", del)!, "sent")!;
    beginDiffNoteSend([first.id]);
    const later = upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", add)!, "after send started")!;
    expect(later.id).not.toBe(first.id);
    removeDiffNotes([first]);
    endDiffNoteSend();
    expect(diffNotesFor("src/app.ts", "worktree").map((note) => note.body)).toEqual(["after send started"]);
  });

  test("an in-flight note cannot be edited or removed", () => {
    const [, , del] = lines();
    const target = diffNoteTarget("src/app.ts", "worktree", del)!;
    const note = upsertDiffNote(target, "sending")!;
    beginDiffNoteSend([note.id]);
    expect(upsertDiffNote(target, "edited while sending")?.body).toBe("sending");
    removeDiffNote(note.id);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
    endDiffNoteSend();
  });
});

describe("compose prompt", () => {
  test("batches every note into one prompt with path, layer, lines, snippets and bodies", () => {
    const [, context, del, add] = lines();
    upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", del)!, "why was this false?");
    upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", add)!, "rename to isReady");
    upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", context)!, "fine as is");
    const composed = composeDiffNotesPrompt("src/app.ts", "worktree");
    expect(composed.truncated).toBe(false);
    expect(composed.count).toBe(3);
    expect(composed.text).toContain("src/app.ts");
    expect(composed.text).toContain("第 1 行（新）");
    expect(composed.text).toContain("第 2 行（旧）");
    expect(composed.text).toContain("第 2 行（新）");
    expect(composed.text).toContain("> false");
    expect(composed.text).toContain("> true");
    expect(composed.text).toContain("why was this false?");
    expect(composed.text).toContain("rename to isReady");
    // Line-number order, old side before new on the same line.
    expect(composed.text.indexOf("第 2 行（旧）")).toBeLessThan(composed.text.indexOf("第 2 行（新）"));
  });

  test("labels the staged layer distinctly", () => {
    const composed = composeDiffNotesPrompt("a.ts", "staged", [makeNote({ line: 4, side: "new", body: "note", layer: "staged" })]);
    expect(composed.text).toContain("已暂存");
  });

  test("refuses to silently clip an oversize batch", () => {
    const huge = makeNote({ line: 1, side: "new", body: "字".repeat(OPERATION_INPUT_LIMITS.prompt) });
    const composed = composeDiffNotesPrompt("big.ts", "worktree", [huge]);
    expect(composed.truncated).toBe(true);
    expect(new TextEncoder().encode(composed.text).length).toBeLessThanOrEqual(OPERATION_INPUT_LIMITS.prompt);
  });

  test("caps stored bodies so one comment cannot blow the budget alone", () => {
    const [, , del] = lines();
    const note = upsertDiffNote(diffNoteTarget("src/app.ts", "worktree", del)!, "a".repeat(DIFF_NOTE_BODY_LIMIT * 4))!;
    expect(note.body.length).toBe(DIFF_NOTE_BODY_LIMIT);
  });
});

describe("the place a note belongs to", () => {
  // One connection, as the app has it: it says which Herdr session it is on.
  const connection = { herd: null as string | null, herdSession() { return this.herd; } };
  const [, , , added] = lines();
  const target = diffNoteTarget("src/app.ts", "worktree", added)!;
  const write = (herd: string | null, paneId: string, root: string, body: string) => {
    adoptDiffNoteScope({ session: connection, herd, paneId, root, revision });
    return upsertDiffNote(target, body)!;
  };

  test("pane ids repeat across Herdr sessions: a note is only met on the one it was written on", () => {
    connection.herd = null;
    write(null, "p1", "/repo", "on the default session");
    // The same connection moves to another Herdr session, whose first pane is p1 too.
    connection.herd = "work";
    adoptDiffNoteScope({ session: connection, herd: "work", paneId: "p1", root: "/repo", revision });
    expect(diffNotesFor("src/app.ts", "worktree")).toEqual([]);
    expect(diffNoteCounts(connection, "p1").size).toBe(0);
    expect(diffNotesAt(diffNotePlace(connection, "p1"))).toEqual([]);
    write("work", "p1", "/repo", "on the work session");
    expect(diffNotesAt(diffNotePlace(connection, "p1")).map((note) => note.body)).toEqual(["on the work session"]);
    connection.herd = null;
    placeDiffNotes({ session: connection, herd: null, paneId: "p1", root: "/repo" });
    expect(diffNotesAt(diffNotePlace(connection, "p1")).map((note) => note.body)).toEqual(["on the default session"]);
  });

  test("a pane that moved to another repository does not bring the old one's notes along", () => {
    connection.herd = null;
    write(null, "p1", "/repo", "about this repository");
    // The pane's files are read at another root now.
    placeDiffNotes({ session: connection, herd: null, paneId: "p1", root: "/elsewhere" });
    expect(diffNoteCounts(connection, "p1").size).toBe(0);
    adoptDiffNoteScope({ session: connection, herd: null, paneId: "p1", root: "/elsewhere", revision });
    expect(diffNotesFor("src/app.ts", "worktree")).toEqual([]);
    // They are still its notes when it comes back.
    placeDiffNotes({ session: connection, herd: null, paneId: "p1", root: "/repo" });
    expect(diffNoteCounts(connection, "p1").get("worktree:src/app.ts")).toBe(1);
  });

  test("a pane that is gone takes its notes with it, on its own Herdr session only", () => {
    connection.herd = null;
    write(null, "p1", "/repo", "closed with its pane");
    write(null, "p2", "/repo", "another pane");
    write("work", "p1", "/repo", "same id, another session");
    expect(diffNotePanes(connection, null).sort()).toEqual(["p1", "p2"]);
    forgetPaneDiffNotes(connection, null, "p1");
    expect(diffNotePanes(connection, null)).toEqual(["p2"]);
    expect(diffNotePanes(connection, "work")).toEqual(["p1"]);
  });

  test("nothing is counted without a session or a pane", () => {
    expect(diffNotePlace(null, "p1")).toBeNull();
    expect(diffNotePlace(connection, "")).toBeNull();
    expect(diffNotesAt(null)).toEqual([]);
  });
});
