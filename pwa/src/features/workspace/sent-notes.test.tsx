import { act } from "react";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import {
  all, bootWorkspaceScreen, key, one, press, setAgentStatus, settle, teardownWorkspaceScreen, type,
} from "../../../test-support/workspace-harness";
import { clearAllDiffNotes, diffNoteCounts } from "../../lib/diff-notes";
import { SENT_ANSWER_GRACE_MS, SENT_SETTLE_MS } from "../../lib/diff-notes-sent";
import { liveSession } from "../computers/catalog-store";
import { loadGitDiff, workspaceModel } from "./index";

/**
 * What stays of a note after it is sent: a record under its line and the
 * receipt of its file, both saying how far the agent is; and one Send for the
 * notes of every file.
 */

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";
let prompts: string[];

function liveFixture() {
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: [
        { path: "src/app.ts", original_path: null, index: " ", worktree: "M" },
        { path: "src/b.ts", original_path: null, index: " ", worktree: "M" },
      ],
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: PATCH, additions: 1, deletions: 1, binary: false, truncated: false, revision: `${path.length}`.repeat(64).slice(0, 64),
    }),
    promptAgent: async (input: { pane_id: string; text: string }) => {
      prompts.push(input.text);
      return { operation_id: `op-${prompts.length}` };
    },
  };
}

async function openDiff(path: string): Promise<void> {
  await act(async () => { await loadGitDiff(path, "worktree"); });
  await settle();
}

async function addNote(body: string): Promise<void> {
  await press(one(".diff-add .diff-comment-btn"));
  await type(one<HTMLTextAreaElement>("form.diff-note-inline textarea"), body);
  await press(one(".diff-note-inline-save"));
}

const bar = () => one(".workspace-notes-bar");
const sentCard = () => document.querySelector<HTMLElement>(".workspace-diff-note.is-sent");

beforeEach(async () => {
  await resetBoardTestDOM();
  clearAllDiffNotes();
  prompts = [];
});
afterEach(async () => {
  setSystemTime();
  await teardownWorkspaceScreen();
  clearAllDiffNotes();
});

describe("a note after it is sent", () => {
  test("stays under its line as a record, and the receipt says how far the agent is", async () => {
    await bootWorkspaceScreen(liveFixture(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await addNote("why true");
    await press(one(".workspace-notes-send"));
    await settle();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("why true");
    expect(bar().classList.contains("is-sent")).toBeTrue();
    expect(bar().textContent).toContain("1 条批注已发给 Agent");
    // The record is not a note to edit: no Edit, no Delete, and it does not count as waiting.
    expect(sentCard()?.querySelector("button")).toBeNull();
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(0);
    // A pane just sent to is shown at work at once (`markPaneSubmitted`), and the record follows it.
    expect(sentCard()?.textContent).toBe("why trueAgent 正在处理");
    expect(sentCard()?.classList.contains("is-working")).toBeTrue();
    expect(bar().textContent).toContain("Agent 正在处理");
    // The computer's next word may still be from before the prompt arrived and say idle: that is no answer yet.
    await act(async () => { setAgentStatus("idle"); });
    await settle();
    expect(sentCard()?.textContent).toBe("why trueAgent 正在处理");
    await act(async () => { setAgentStatus("working"); });
    await settle();
    expect(bar().textContent).toContain("Agent 正在处理");
    // Waiting on the reader (a permission, a question) is the middle of the turn, not its end.
    setSystemTime(new Date(Date.now() + SENT_SETTLE_MS));
    await act(async () => { setAgentStatus("blocked"); });
    await settle();
    expect(bar().textContent).toContain("Agent 正在处理");
    await act(async () => { setAgentStatus("idle"); });
    await settle();
    expect(sentCard()?.textContent).toBe("why trueAgent 已回复");
    expect(bar().textContent).toContain("Agent 已回复");
    // Seen at work again right away, it was not done; long after, it is on something else.
    await act(async () => { setAgentStatus("working"); });
    await settle();
    expect(bar().textContent).toContain("Agent 正在处理");
    await act(async () => { setAgentStatus("idle"); });
    await settle();
    setSystemTime(new Date(Date.now() + SENT_ANSWER_GRACE_MS + 1));
    await act(async () => { setAgentStatus("working"); });
    await settle();
    expect(bar().textContent).toContain("Agent 已回复");
  });

  test("the receipt waits for the reader on its diff, and goes with its record when dismissed", async () => {
    await bootWorkspaceScreen(liveFixture(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await addNote("why true");
    await press(one(".workspace-notes-send"));
    await settle();
    // Another file has no receipt of this one's notes.
    await openDiff("src/b.ts");
    expect(document.querySelector(".workspace-notes-bar")).toBeNull();
    expect(sentCard()).toBeNull();
    await openDiff("src/app.ts");
    expect(bar().classList.contains("is-sent")).toBeTrue();
    await press(one(".workspace-notes-dismiss"));
    expect(document.querySelector(".workspace-notes-bar")).toBeNull();
    expect(sentCard()).toBeNull();
  });

  test("the line still takes a new note, which stands in the record's place", async () => {
    await bootWorkspaceScreen(liveFixture(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await addNote("why true");
    await press(one(".workspace-notes-send"));
    await settle();
    await addNote("and another thing");
    expect(sentCard()).toBeNull();
    expect(all(".workspace-diff-note").map((card) => card.querySelector(".diff-note-body")?.textContent)).toEqual(["and another thing"]);
    expect(bar().classList.contains("is-sent")).toBeFalse();
  });
});

describe("notes on several files", () => {
  test("Send all carries them in one prompt, a section a file; Send keeps to the open file", async () => {
    await bootWorkspaceScreen(liveFixture(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await addNote("about app");
    expect(document.querySelector(".workspace-notes-all")).toBeNull();
    await openDiff("src/b.ts");
    await addNote("about b");
    expect(bar().textContent).toContain("另有 1 个文件的批注未发送");
    await press(one(".workspace-notes-all"));
    await settle();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].indexOf("src/app.ts")).toBeLessThan(prompts[0].indexOf("src/b.ts"));
    expect(prompts[0]).toContain("about app");
    expect(prompts[0]).toContain("about b");
    expect(diffNoteCounts(liveSession(), "p1").size).toBe(0);
    expect(bar().textContent).toContain("1 条批注已发给 Agent");
    // The other file has its own receipt.
    await openDiff("src/app.ts");
    expect(bar().classList.contains("is-sent")).toBeTrue();
  });

  test("⌘⇧Enter sends the open file's notes, as its Send button does", async () => {
    await bootWorkspaceScreen(liveFixture(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await addNote("why true");
    const sent = await key("Enter", { metaKey: true, shiftKey: true });
    await settle();
    expect(sent.defaultPrevented).toBeTrue();
    expect(prompts).toHaveLength(1);
    expect(workspaceModel.view).toBe("diff");
  });
});
