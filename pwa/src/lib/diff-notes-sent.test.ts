import { beforeEach, describe, expect, test } from "bun:test";
import { adoptDiffNoteScope, clearAllDiffNotes, composeAllDiffNotesPrompt, diffNotePlace, diffNotesAt, upsertDiffNote, type DiffNote } from "./diff-notes";
import {
  SENT_ANSWER_GRACE_MS, SENT_NOTE_LIMIT, SENT_SETTLE_MS, forgetPaneSentDiffNotes, forgetSentDiffNotes, noteSentAgentState,
  recordSentDiffNotes, sentDiffNoteAt, sentDiffNotePanes, sentDiffNotesFor, sentDiffNotesWaiting, sentNoteState,
} from "./diff-notes-sent";
import { setLang } from "./i18n";

/** Notes after they were sent: a record under their lines, and how far the agent is with them. */

const session = {};
const place = (paneId = "p1", herd: string | null = null, root = "/repo") => ({ session, herd, paneId, root });
const note = (path: string, line: number, body: string, layer: "worktree" | "staged" = "worktree", at = place()): DiffNote => ({
  id: `${layer}:${path}:${line}`, ...at, revision: "r1", path, layer, side: "new", line, snippet: `line ${line}`, body,
});

beforeEach(() => {
  clearAllDiffNotes();
  setLang("zh");
});

describe("the record of what was sent", () => {
  test("a sent note is found on its line while the line is still what it was written on", () => {
    recordSentDiffNotes([note("a.ts", 3, "why")], 100);
    const pin = { path: "a.ts", layer: "worktree" as const, side: "new" as const, line: 3 };
    expect(sentDiffNoteAt(place(), { ...pin, snippet: "line 3" })?.body).toBe("why");
    // The line changed: the note is not shown on words it was not written about.
    expect(sentDiffNoteAt(place(), { ...pin, snippet: "something else" })).toBeUndefined();
    expect(sentDiffNoteAt({ ...place(), session: {} }, { ...pin, snippet: "line 3" })).toBeUndefined();
    expect(sentDiffNoteAt(place("p2"), { ...pin, snippet: "line 3" })).toBeUndefined();
    expect(sentDiffNoteAt(null, { ...pin, snippet: "line 3" })).toBeUndefined();
  });

  test("a record is its place's: not another Herdr session's pane of the same id, not another root's", () => {
    recordSentDiffNotes([note("a.ts", 3, "why")], 100);
    expect(sentDiffNotesFor(place("p1", "work"), "a.ts", "worktree")).toEqual([]);
    expect(sentDiffNotesFor(place("p1", null, "/elsewhere"), "a.ts", "worktree")).toEqual([]);
    expect(sentDiffNotesFor(place(), "a.ts", "worktree")).toHaveLength(1);
    // Another Herdr session's agent, in a pane of the same id, says nothing about it.
    expect(noteSentAgentState(session, "work", "p1", true, 100).moved).toBeFalse();
    expect(sentNoteState(sentDiffNotesFor(place(), "a.ts", "worktree"))).toBe("sent");
  });

  test("a file's notes sent again are the record of that file: the receipt counts one send", () => {
    recordSentDiffNotes([note("a.ts", 3, "first"), note("a.ts", 9, "other"), note("b.ts", 1, "elsewhere")], 100);
    recordSentDiffNotes([note("a.ts", 5, "second")], 200);
    expect(sentDiffNotesFor(place(), "a.ts", "worktree").map((sent) => sent.body)).toEqual(["second"]);
    // Other files, and the file's other layer, keep theirs.
    expect(sentDiffNotesFor(place(), "b.ts", "worktree")).toHaveLength(1);
    recordSentDiffNotes([note("a.ts", 2, "staged", "staged")], 300);
    expect(sentDiffNotesFor(place(), "a.ts", "worktree")).toHaveLength(1);
    forgetSentDiffNotes(place(), "a.ts", "worktree");
    expect(sentDiffNotesFor(place(), "a.ts", "worktree")).toEqual([]);
    expect(sentDiffNotesFor(place(), "a.ts", "staged")).toHaveLength(1);
    expect(sentDiffNotesFor(place(), "b.ts", "worktree")).toHaveLength(1);
  });

  test("a note is answered once its agent was seen working and works no longer", () => {
    recordSentDiffNotes([note("a.ts", 3, "why")], 100);
    const state = () => sentNoteState(sentDiffNotesFor(place(), "a.ts", "worktree"));
    const settled = 100 + SENT_SETTLE_MS;
    expect(state()).toBe("sent");
    // An agent never seen at work has not been seen answering either.
    expect(noteSentAgentState(session, null, "p1", false, settled).moved).toBeFalse();
    expect(state()).toBe("sent");
    expect(noteSentAgentState(session, null, "p1", true, settled).moved).toBeTrue();
    expect(state()).toBe("working");
    expect(noteSentAgentState(session, null, "p1", true, settled).moved).toBeFalse();
    expect(sentDiffNotesWaiting(session, null, settled)).toBeTrue();
    expect(noteSentAgentState(session, null, "p1", false, settled).moved).toBeTrue();
    expect(state()).toBe("answered");
    // Another pane's agent says nothing about this one's notes.
    recordSentDiffNotes([note("b.ts", 5, "later")], 300);
    expect(noteSentAgentState(session, null, "p2", true, 300).moved).toBeFalse();
    expect(sentNoteState(sentDiffNotesFor(place(), "b.ts", "worktree"))).toBe("sent");
  });

  test("one file's notes are as far as the least advanced of them", () => {
    const all = [{ state: "answered" }, { state: "working" }, { state: "sent" }] as Parameters<typeof sentNoteState>[0];
    expect(sentNoteState(all)).toBe("sent");
    expect(sentNoteState(all.slice(0, 2))).toBe("working");
    expect(sentNoteState(all.slice(0, 1))).toBe("answered");
    expect(sentNoteState([])).toBeNull();
  });

  test("idle heard right after the send is from before it, and is not an answer", () => {
    recordSentDiffNotes([note("a.ts", 3, "why")], 1000);
    const state = () => sentNoteState(sentDiffNotesFor(place(), "a.ts", "worktree"));
    // The send shows the agent at work at once; the computer's next word may still say idle.
    expect(noteSentAgentState(session, null, "p1", true, 1001).moved).toBeTrue();
    expect(noteSentAgentState(session, null, "p1", false, 1500)).toEqual({ moved: false, held: true });
    expect(state()).toBe("working");
    // It is still waiting, so whoever watches looks again.
    expect(sentDiffNotesWaiting(session, null, 1500)).toBeTrue();
    expect(noteSentAgentState(session, null, "p1", false, 1000 + SENT_SETTLE_MS)).toEqual({ moved: true, held: false });
    expect(state()).toBe("answered");
  });

  test("an agent seen at work again right after it looked done was not done; later turns are about something else", () => {
    recordSentDiffNotes([note("a.ts", 3, "why")], 0);
    const state = () => sentNoteState(sentDiffNotesFor(place(), "a.ts", "worktree"));
    noteSentAgentState(session, null, "p1", true, 10);
    noteSentAgentState(session, null, "p1", false, 10_000);
    expect(state()).toBe("answered");
    expect(sentDiffNotesWaiting(session, null, 10_000)).toBeTrue();
    expect(noteSentAgentState(session, null, "p1", true, 12_000).moved).toBeTrue();
    expect(state()).toBe("working");
    noteSentAgentState(session, null, "p1", false, 60_000);
    expect(state()).toBe("answered");
    // Well after the answer the agent works on something else: the answer stands, and nothing is watched any more.
    const later = 60_000 + SENT_ANSWER_GRACE_MS + 1;
    expect(sentDiffNotesWaiting(session, null, later)).toBeFalse();
    expect(noteSentAgentState(session, null, "p1", true, later).moved).toBeFalse();
    expect(state()).toBe("answered");
  });

  test("the record is bounded and the oldest go first", () => {
    recordSentDiffNotes([note("old.ts", 1, "oldest")], 50);
    recordSentDiffNotes(Array.from({ length: SENT_NOTE_LIMIT }, (_, index) => note("a.ts", index + 1, "n")), 100);
    expect(sentDiffNotesFor(place(), "a.ts", "worktree")).toHaveLength(SENT_NOTE_LIMIT);
    expect(sentDiffNotesFor(place(), "old.ts", "worktree")).toEqual([]);
  });

  test("a pane that is gone takes its record with it", () => {
    recordSentDiffNotes([note("a.ts", 3, "why"), note("a.ts", 4, "other pane", "worktree", place("p2")),
      note("a.ts", 5, "other session", "worktree", place("p1", "work"))], 100);
    expect(sentDiffNotePanes(session, null).sort()).toEqual(["p1", "p2"]);
    forgetPaneSentDiffNotes(session, null, "p1");
    expect(sentDiffNotePanes(session, null)).toEqual(["p2"]);
    expect(sentDiffNotesFor(place("p1", "work"), "a.ts", "worktree")).toHaveLength(1);
  });
});

describe("one prompt for the notes of several files", () => {
  test("a section for each file and layer, files by path and the staged layer first", () => {
    const text = composeAllDiffNotesPrompt([
      note("src/b.ts", 2, "about b"), note("src/a.ts", 7, "worktree a"), note("src/a.ts", 4, "staged a", "staged"),
    ]).text;
    const order = ["staged a", "worktree a", "about b"].map((body) => text.indexOf(body));
    expect(order.every((at) => at >= 0)).toBeTrue();
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(text.match(/src\/a\.ts/g)?.length).toBe(2);
    expect(text).toContain("> line 7");
  });

  test("counts every note, and refuses rather than clips what does not fit", () => {
    const many = Array.from({ length: 40 }, (_, index) => note(`f${index}.ts`, 1, "x".repeat(1900)));
    const composed = composeAllDiffNotesPrompt(many);
    expect(composed.count).toBe(40);
    expect(composed.truncated).toBeTrue();
  });

  test("every pending note of a place is gathered, whatever revision it was written on", () => {
    adoptDiffNoteScope({ session, paneId: "p1", revision: "r1" });
    upsertDiffNote({ path: "a.ts", layer: "worktree", side: "new", line: 1, snippet: "x" }, "one");
    adoptDiffNoteScope({ session, paneId: "p1", revision: "r2" });
    upsertDiffNote({ path: "b.ts", layer: "worktree", side: "new", line: 1, snippet: "y" }, "two");
    expect(diffNotesAt(diffNotePlace(session, "p1")).map((pending) => pending.body)).toEqual(["one", "two"]);
    expect(diffNotesAt(diffNotePlace(session, "p2"))).toEqual([]);
    expect(diffNotesAt(diffNotePlace(null, "p1"))).toEqual([]);
  });
});
