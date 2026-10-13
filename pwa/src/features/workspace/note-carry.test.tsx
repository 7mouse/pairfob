import { act } from "react";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import {
  all, bootWorkspaceScreen, one, press, setAgentStatus, settle, teardownWorkspaceScreen, type,
} from "../../../test-support/workspace-harness";
import { visibleNotice } from "../../app/notices-store";
import { clearAllDiffNotes, diffNoteCounts, diffNoteScope, diffNoteSendOpen, diffNotesFor } from "../../lib/diff-notes";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { ProtocolError } from "../../lib/protocol/errors";
import { WORKSPACE_CACHE_TTL_MS } from "../../lib/workspace-cache";
import { liveSession } from "../computers/catalog-store";
import { retireHerdView } from "../connection/retirement";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities, operationBusy } from "../operations/capabilities-store";
import { selectPane } from "../session/session-store";
import { enterWorkspace, leaveWorkspace, loadGitDiff, refreshWorkspace } from "./index";
import { clearOpenNotes } from "./note-drafts";

/** What stands under a line to be read and pressed. A piece folding shut on its way out is still on the page, and is not that. */
const UNDER = ".diff-note-fold:not(.is-shut)";

/** The line a note's form or card stands under: what comes before everything the note keeps there. */
const lineOver = (piece: Element | null | undefined): Element | null => {
  let before = piece?.closest(".diff-note-fold")?.previousElementSibling ?? null;
  while (before?.matches(".diff-note-fold")) before = before.previousElementSibling;
  return before;
};

/**
 * Notes outlive the reading of the diff they were written on, and a send
 * outlives the view it was pressed in: what the reader wrote goes along to the
 * file as it reads now, stays with the Herdr session and pane it was written
 * for, and is sent once.
 */

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";
/** Two lines added above: everything below moves down by two. */
const SHIFTED = "@@ -1,3 +1,5 @@\n+first\n+second\n keep\n-false\n+true\n tail\n";
/** The added line was rewritten. */
const REWRITTEN = "@@ -1,3 +1,3 @@\n keep\n-false\n+maybe\n tail\n";

type Fixture = ReturnType<typeof liveFixture>;
let prompts: Array<{ pane: string; text: string }>;

function liveFixture() {
  const patches: Record<string, { patch: string; revision: string }> = {};
  const fixture = {
    herd: null as string | null,
    herdSession: () => fixture.herd,
    /** The file reads differently from now on. */
    change(path: string, patch: string): void {
      patches[path] = { patch, revision: `${Object.keys(patches).length + 2}`.repeat(64).slice(0, 64) };
    },
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: ["src/app.ts", "src/b.ts", "src/c.ts"].map((path) => ({ path, original_path: null, index: " ", worktree: "M" })),
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, additions: 1, deletions: 1, binary: false, truncated: false,
      patch: patches[path]?.patch ?? PATCH, revision: patches[path]?.revision ?? "1".repeat(64),
    }),
    promptAgent: async (input: { pane_id: string; text: string }): Promise<unknown> => {
      prompts.push({ pane: input.pane_id, text: input.text });
      return { operation_id: `op-${prompts.length}` };
    },
  };
  return fixture;
}

async function boot(live: Fixture = liveFixture()): Promise<Fixture> {
  await bootWorkspaceScreen(live, { capabilities: { prompt_agent: true } });
  return live;
}

async function openDiff(path: string): Promise<void> {
  await act(async () => { await loadGitDiff(path, "worktree"); });
  await settle();
}

/** Time passes: what was read a moment ago is read again when asked for (the read cache keeps an answer for a few seconds). */
function later(): void {
  setSystemTime(new Date(Date.now() + WORKSPACE_CACHE_TTL_MS + 1));
}

/** Read the open diff again, past the read cache. */
async function reread(): Promise<void> {
  await act(async () => { await refreshWorkspace(); });
  await settle();
}

const lineOf = (text: string): HTMLElement => {
  const found = all(".workspace-diff-line").find((line) => line.textContent?.includes(text));
  if (!found) throw new Error(`no diff line reads ${text}`);
  return found;
};
const form = () => document.querySelector<HTMLFormElement>(`${UNDER} form.diff-note-inline`);
const field = () => one<HTMLTextAreaElement>(`${UNDER} form.diff-note-inline textarea`);
const bar = () => one(".workspace-notes-bar:not(.is-leaving)");
const noBar = () => document.querySelector(".workspace-notes-bar:not(.is-leaving)") === null;

async function addNote(on: string, body: string): Promise<void> {
  await press(lineOf(on));
  await type(field(), body);
  await press(one(`${UNDER} .diff-note-inline-save`));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearAllDiffNotes();
  clearOpenNotes();
  prompts = [];
});
afterEach(async () => {
  setSystemTime();
  await teardownWorkspaceScreen();
  clearAllDiffNotes();
  clearOpenNotes();
});

describe("a note still being written, when its file is read again at another revision", () => {
  test("goes along to the line it was opened on, with the words typed so far", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await press(lineOf("true"));
    await type(field(), "half written");
    live.change("src/app.ts", SHIFTED);
    await reread();
    // The editor is under the same line, two numbers further down, and nothing was lost.
    expect(lineOver(form()) === lineOf("true")).toBeTrue();
    expect(form()?.getAttribute("aria-label")).toBe("给第 4 行写批注");
    expect(field().value).toBe("half written");
    await press(one(`${UNDER} .diff-note-inline-save`));
    expect(diffNotesFor("src/app.ts", "worktree").map((note) => [note.line, note.body, note.revision === diffNoteScope()?.revision]))
      .toEqual([[4, "half written", true]]);
  });

  test("set aside as a card, it waits under its line on the new revision too", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await press(lineOf("true"));
    await type(field(), "left for later");
    await act(async () => { field().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await settle();
    expect(one(`${UNDER} .workspace-diff-note.is-draft`).textContent).toContain("left for later");
    live.change("src/app.ts", SHIFTED);
    await reread();
    const card = one(`${UNDER} .workspace-diff-note.is-draft`);
    expect(card.textContent).toContain("left for later");
    expect(lineOver(card) === lineOf("true")).toBeTrue();
  });

  test("moves to the nearest line when its own was rewritten, and the reader is told to check", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await press(lineOf("true"));
    await type(field(), "about true");
    live.change("src/app.ts", REWRITTEN);
    await reread();
    expect(lineOver(form()) === lineOf("maybe")).toBeTrue();
    expect(field().value).toBe("about true");
    expect(visibleNotice()?.text).toBe("文件已更新，1 条批注所在的行有改动，请核对。");
  });

  test("a saved note left on a line that changed is confirmed by saving it as it stands", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "why true");
    live.change("src/app.ts", REWRITTEN);
    await reread();
    expect(one(`${UNDER} .workspace-diff-note .diff-note-drift`).textContent).toContain("true");
    await press(one(`${UNDER} .workspace-diff-note .diff-note-action`));
    // Nothing was retyped, and there is still something to save: the note on the line as it reads now.
    const save = one<HTMLButtonElement>(`${UNDER} .diff-note-inline-save`);
    expect(field().value).toBe("why true");
    expect(save.disabled).toBeFalse();
    await press(save);
    expect(document.querySelector(`${UNDER} .workspace-diff-note .diff-note-drift`)).toBeNull();
    expect(diffNotesFor("src/app.ts", "worktree").map((note) => [note.body, note.snippet, note.drifted])).toEqual([["why true", "maybe", undefined]]);
  });

  test("an editor open on a saved note follows that note", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "saved");
    await press(one(`${UNDER} .workspace-diff-note .diff-note-action`));
    await type(field(), "saved, then edited");
    live.change("src/app.ts", SHIFTED);
    await reread();
    expect(form()?.getAttribute("aria-label")).toBe("编辑第 4 行的批注");
    expect(field().value).toBe("saved, then edited");
    await press(one(`${UNDER} .diff-note-inline-save`));
    expect(diffNotesFor("src/app.ts", "worktree").map((note) => [note.line, note.body])).toEqual([[4, "saved, then edited"]]);
  });
});

describe("a file left with no line to hold its notes", () => {
  test("keeps what was written: the bar says so and offers to send or discard it", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "why true");
    await press(lineOf("tail"));
    await type(field(), "half written about the tail");
    // The change was committed: the diff is empty now.
    live.change("src/app.ts", "");
    await reread();
    expect(form()).toBeNull();
    expect(visibleNotice()?.text).toBe("这份 Diff 里已没有 2 条批注所在的行，它们仍可发送或丢弃。");
    expect(bar().textContent).toContain("2 条批注待发送");
    expect(bar().textContent).toContain("这些批注所在的行已不在这份 Diff 里");
    await press(one(".workspace-notes-send"));
    await settle();
    expect(prompts).toHaveLength(1);
    // Both go, the half-written one as the note it was becoming, each saying the file moved on.
    expect(prompts[0].text).toContain("why true");
    expect(prompts[0].text).toContain("half written about the tail");
    expect(prompts[0].text.match(/之后文件有改动/g)).toHaveLength(2);
  });

  test("Discard lets go of them, and only of this file's", async () => {
    const live = await boot();
    await openDiff("src/b.ts");
    await addNote("true", "about b");
    await openDiff("src/app.ts");
    await addNote("true", "why true");
    live.change("src/app.ts", "");
    await reread();
    await press(one(".workspace-notes-discard"));
    expect(visibleNotice()?.text).toBe("已丢弃 1 条批注");
    expect([...diffNoteCounts(liveSession(), "p1").keys()]).toEqual(["worktree:src/b.ts"]);
    expect(prompts).toEqual([]);
  });

  test("a diff that holds its notes offers no Discard", async () => {
    await boot();
    await openDiff("src/app.ts");
    await addNote("true", "why true");
    expect(document.querySelector(".workspace-notes-discard")).toBeNull();
    expect(bar().textContent).toContain("只发送本文件未暂存层的批注");
  });
});

describe("notes waiting on other files", () => {
  test("are a press away from any diff: where they are, and all of them in one send", async () => {
    await boot();
    await openDiff("src/app.ts");
    await addNote("true", "about app");
    await openDiff("src/c.ts");
    // Nothing waits on this file, but the bar is the way to what waits elsewhere.
    expect(bar().classList.contains("is-elsewhere")).toBeTrue();
    expect(bar().textContent).toContain("另有 1 个文件的批注未发送");
    expect(document.querySelector(".workspace-notes-send")).toBeNull();
    // The words themselves lead there.
    expect(one(".workspace-notes-where").textContent).toBe("另有 1 个文件的批注未发送查看是哪些文件");
    await press(one(".workspace-notes-where"));
    const rows = all("dialog[open] .menu-row").map((row) => row.textContent);
    expect(rows).toEqual(["app.tssrc · 未暂存 · 1 条批注"]);
    await press(all("dialog[open] .menu-row")[0]);
    await settle();
    expect(one(`${UNDER} .workspace-diff-note .diff-note-body`).textContent).toBe("about app");
    await openDiff("src/c.ts");
    await press(one(".workspace-notes-all"));
    await settle();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].text).toContain("about app");
  });

  test("Send all reads each of them again first: a note goes with the line number its line has today", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "about app");
    await openDiff("src/b.ts");
    await addNote("true", "about b");
    // The agent edits app.ts while the reader is on b.ts and never goes back to it.
    live.change("src/app.ts", SHIFTED);
    later();
    const read: string[] = [];
    const gitDiff = live.gitDiff;
    live.gitDiff = async (pane, path, layer) => { read.push(path); return gitDiff(pane, path, layer); };
    await press(one(".workspace-notes-all"));
    await settle();
    expect(read).toContain("src/app.ts");
    expect(prompts).toHaveLength(1);
    const text = prompts[0].text;
    const app = text.slice(text.indexOf("src/app.ts"), text.indexOf("src/b.ts"));
    expect(app).toContain("第 4 行");
    expect(app).not.toContain("之后文件有改动");
  });

  test("a note whose change is gone is still sent, saying the file moved on", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "about app");
    await openDiff("src/b.ts");
    await addNote("true", "about b");
    live.change("src/app.ts", "");
    later();
    await press(one(".workspace-notes-all"));
    await settle();
    const text = prompts[0].text;
    const app = text.slice(text.indexOf("src/app.ts"), text.indexOf("src/b.ts"));
    expect(app).toContain("about app");
    expect(app).toContain("之后文件有改动");
    expect(text.slice(text.indexOf("src/b.ts"))).not.toContain("之后文件有改动");
  });

  test("a read that fails sends nothing, says why, and leaves every note where it was", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "about app");
    await openDiff("src/b.ts");
    await addNote("true", "about b");
    live.change("src/app.ts", SHIFTED);
    later();
    const gitDiff = live.gitDiff;
    live.gitDiff = async (pane, path, layer) => {
      if (path === "src/app.ts") throw new ProtocolError("timeout", "timed out");
      return gitDiff(pane, path, layer);
    };
    await press(one(".workspace-notes-all"));
    await settle();
    expect(prompts).toEqual([]);
    expect(visibleNotice()?.tone).toBe("error");
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(2);
    expect(one<HTMLButtonElement>(".workspace-notes-send").disabled).toBeFalse();
  });

  test("the other layer of the same file is not another file", async () => {
    const live = await boot();
    live.gitStatus = async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "t".repeat(64),
      changes: [{ path: "src/app.ts", original_path: null, index: "M", worktree: "M" }],
    });
    await reread();
    await act(async () => { await loadGitDiff("src/app.ts", "staged"); });
    await settle();
    await addNote("true", "staged note");
    await openDiff("src/app.ts");
    await addNote("true", "worktree note");
    expect(bar().textContent).toContain("本文件已暂存层也有批注未发送");
    expect(bar().textContent).not.toContain("个文件的批注未发送");
    expect(document.querySelector(".workspace-notes-all")).not.toBeNull();
  });
});

describe("a send", () => {
  test("that lands after the reader left the files is still the end of those notes: nothing is left to send twice", async () => {
    const live = await boot();
    let land!: (value: unknown) => void;
    live.promptAgent = (input) => {
      prompts.push({ pane: input.pane_id, text: input.text });
      return new Promise((resolve) => { land = resolve; });
    };
    await openDiff("src/app.ts");
    await addNote("true", "why true");
    await act(async () => { one(".workspace-notes-send").click(); });
    expect(diffNoteSendOpen()).toBeTrue();
    // Back to the session while the prompt is on its way.
    await act(async () => { leaveWorkspace(); });
    await act(async () => { land({ operation_id: "op-1" }); });
    await settle();
    expect(prompts).toHaveLength(1);
    expect(diffNoteSendOpen()).toBeFalse();
    // Back on the diff: a receipt, no pending note, no Send to press again.
    await act(async () => { await enterWorkspace("p1"); });
    await openDiff("src/app.ts");
    expect(diffNotesFor("src/app.ts", "worktree")).toEqual([]);
    expect(bar().classList.contains("is-sent")).toBeTrue();
    expect(document.querySelector(".workspace-notes-send")).toBeNull();
    expect(one(`${UNDER} .workspace-diff-note.is-sent`).textContent).toContain("why true");
  });

  for (const code of ["timeout", "unknown_outcome", "conflict"] as const) {
    test(`that fails with ${code} is not replayed, and the bar and the notes are the reader's again at once`, async () => {
      const live = await boot();
      live.promptAgent = async (input) => {
        prompts.push({ pane: input.pane_id, text: input.text });
        throw new ProtocolError(code, "the computer did not answer");
      };
      await openDiff("src/app.ts");
      await addNote("true", "why true");
      await press(one(".workspace-notes-send"));
      await settle();
      // One call, no retry; the note is still pending and no record was written.
      expect(prompts).toHaveLength(1);
      expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
      expect(document.querySelector(`${UNDER} .workspace-diff-note.is-sent`)).toBeNull();
      expect(visibleNotice()?.tone).toBe("error");
      // Nothing is left looking busy.
      expect(diffNoteSendOpen()).toBeFalse();
      expect(operationBusy()).toBeFalse();
      const send = one<HTMLButtonElement>(".workspace-notes-send");
      expect(send.disabled).toBeFalse();
      expect(send.getAttribute("aria-busy")).toBeNull();
      expect(send.textContent).toBe("发给 Agent");
      expect(one(`${UNDER} .workspace-diff-note`).classList.contains("is-sending")).toBeFalse();
      expect(all<HTMLButtonElement>(`${UNDER} .workspace-diff-note .diff-note-action`).every((button) => !button.disabled)).toBeTrue();
      // The reader decides: a second press is theirs to make.
      await press(send);
      await settle();
      expect(prompts).toHaveLength(2);
    });
  }
});

describe("notes belong to the Herdr session and the pane they were written for", () => {
  /** The same connection moves to another Herdr session, whose first pane is p1 too. */
  async function switchHerd(live: Fixture, name: string | null): Promise<void> {
    await act(async () => {
      leaveWorkspace();
      live.herd = name;
      retireHerdView();
      applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: true }, []);
      setAgentStatus("idle");
      selectPane("p1");
      await enterWorkspace("p1");
    });
    await settle();
  }

  test("another Herdr session's pane of the same id never sees them, and its agent is never sent them", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "for session A");
    await switchHerd(live, "b");
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(0);
    await openDiff("src/app.ts");
    expect(document.querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    await openDiff("src/b.ts");
    expect(noBar()).toBeTrue();
    await addNote("true", "for session B");
    // One file's notes wait here, and nothing else is offered to go with them.
    expect(document.querySelector(".workspace-notes-all")).toBeNull();
    expect(bar().textContent).not.toContain("个文件的批注未发送");
    await press(one(".workspace-notes-send"));
    await settle();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].text).toContain("for session B");
    expect(prompts[0].text).not.toContain("for session A");
    // B's agent going idle says nothing about what A's was never sent.
    await switchHerd(live, null);
    await openDiff("src/app.ts");
    expect(one(`${UNDER} .workspace-diff-note .diff-note-body`).textContent).toBe("for session A");
    expect(bar().textContent).toContain("1 条批注待发送");
  });

  test("a pane that moved to another repository does not bring the old one's notes along", async () => {
    const live = await boot();
    await openDiff("src/app.ts");
    await addNote("true", "about the first repository");
    live.workspaceOpen = async () => ({
      name: "other", root: "/work/other",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "other", branch: "main", head: "1234567890", detached: false },
    });
    await reread();
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(0);
    await openDiff("src/app.ts");
    expect(document.querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    expect(noBar()).toBeTrue();
  });

  test("a pane that closes takes what was written for it with it; the next pane given its id starts clean", async () => {
    await boot();
    await openDiff("src/app.ts");
    await addNote("true", "sent");
    await press(one(".workspace-notes-send"));
    await settle();
    await addNote("tail", "pending");
    await press(lineOf("keep"));
    await type(field(), "half written");
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(1);
    // The list of sessions no longer has the pane.
    await act(async () => {
      replaceAgentsFromSnapshot({
        focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p2" },
        workspaces: [{ workspace_id: "w1", label: "pairfob" }],
        tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
        panes: [{ pane_id: "p2", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/pairfob", agent: "codex", agent_status: "idle" }],
      });
    });
    await settle();
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(0);
    await act(async () => { setAgentStatus("idle"); });
    await settle();
    await openDiff("src/app.ts");
    expect(document.querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    expect(form()).toBeNull();
    expect(noBar()).toBeTrue();
  });
});
