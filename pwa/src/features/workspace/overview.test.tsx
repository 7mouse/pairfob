import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { all, bootWorkspaceScreen, one, press, settle, teardownWorkspaceScreen } from "../../../test-support/workspace-harness";
import { clearAllDiffNotes } from "../../lib/diff-notes";
import { loadWorkspaceFile, closeWorkspaceDetail, workspaceModel } from "./index";

/**
 * The detail pane beside the list with nothing open: the repository's name and
 * root, the places worth going to as entries, one main action and one way to
 * search, and key hints for a reader with a keyboard.
 */

let changes: Array<{ path: string; index: string; worktree: string }>;
let branches: boolean;
let searches: boolean;

function liveFixture() {
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: branches },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text", content: "a\nb\n", size: 4, modified_ms: 1, truncated: false, revision: "f".repeat(64),
    }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: "origin/main", ahead: 2, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: changes.map((change) => ({ ...change, original_path: null, stat: { worktree: { additions: 5, deletions: 2 } } })),
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, binary: false, truncated: false, revision: "1".repeat(64),
    }),
    gitBranches: async () => ({ items: [], truncated: false, revision: "b".repeat(64) }),
    ...(searches ? { workspaceSearch: async () => ({ query: "", items: [], truncated: false }) } : {}),
  };
}

const entries = () => all(".workspace-overview-entry").map((entry) => entry.querySelector(".workspace-overview-name")?.textContent);
const boot = (width = 1024) => bootWorkspaceScreen(liveFixture(), { width, capabilities: { search_files: searches } });

beforeEach(async () => {
  await resetBoardTestDOM();
  clearAllDiffNotes();
  changes = [{ path: "src/app.ts", index: " ", worktree: "M" }, { path: "src/b.ts", index: " ", worktree: "M" }];
  branches = true;
  searches = false;
});
afterEach(teardownWorkspaceScreen);

describe("the pane beside the list, with nothing open", () => {
  test("names the repository and offers the review to go on with and the branch", async () => {
    await boot();
    expect(one(".workspace-overview-title").textContent).toBe("pairfob");
    expect(one(".workspace-overview-root").textContent).toBe("/work/pairfob");
    expect(entries()).toEqual(["待审更改", "分支与 Worktree"]);
    // Counted in diffs, as the header and the list count them.
    expect(all(".workspace-overview-meta")[0].textContent).toBe("+10−4已看 0/2");
    expect(all(".workspace-overview-meta")[1].textContent).toBe("main↑2");
    expect(one(".workspace-overview-actions .btn-primary").textContent).toBe("从第一个更改开始");
  });

  test("the review entry and the main action both open the first diff not yet seen", async () => {
    await boot();
    await press(one(".workspace-overview-actions .btn-primary"));
    expect(workspaceModel.view).toBe("diff");
    expect(workspaceModel.detailPath).toBe("src/app.ts");
    // Happy-dom measures nothing, so the diff counts as read to its end: the review goes on from the next one.
    await act(async () => { closeWorkspaceDetail(); });
    await settle();
    expect(one(".workspace-overview-actions .btn-primary").textContent).toBe("从第一个未看开始");
    await press(all<HTMLButtonElement>("button.workspace-overview-entry")[0]);
    expect(workspaceModel.detailPath).toBe("src/b.ts");
  });

  test("everything seen: the entry says so and leads to the list, and there is no main action", async () => {
    changes = [{ path: "src/app.ts", index: " ", worktree: "M" }];
    await boot();
    await press(one(".workspace-overview-actions .btn-primary"));
    await act(async () => { closeWorkspaceDetail(); });
    await settle();
    expect(entries()[0]).toBe("更改已全部看过");
    expect(document.querySelector(".workspace-overview-actions")).toBeNull();
  });

  test("a clean working tree is said, not offered", async () => {
    changes = [];
    await boot();
    expect(entries()[0]).toBe("没有待审更改");
    expect(all(".workspace-overview-entry")[0].tagName).toBe("DIV");
  });

  test("the file the reader had open last is an entry of its own", async () => {
    await boot();
    await act(async () => { await loadWorkspaceFile("src/lib/util.ts"); });
    await settle();
    await act(async () => { closeWorkspaceDetail(); });
    await settle();
    expect(entries()).toEqual(["待审更改", "最近打开", "分支与 Worktree"]);
    expect(all(".workspace-overview-meta")[1].textContent).toBe("src/lib/util.ts");
    await press(all<HTMLButtonElement>("button.workspace-overview-entry")[1]);
    expect(workspaceModel.view).toBe("file");
    expect(workspaceModel.detailPath).toBe("src/lib/util.ts");
  });

  test("the branch entry opens the branch sheet where the daemon lists branches, and only says the branch where it does not", async () => {
    await boot();
    await press(all<HTMLButtonElement>("button.workspace-overview-entry").at(-1)!);
    await settle();
    expect(document.querySelector("dialog.workspace-branch-sheet")).toBeTruthy();
    await teardownWorkspaceScreen();
    branches = false;
    await boot();
    expect(all(".workspace-overview-entry").at(-1)!.tagName).toBe("DIV");
  });

  test("search is offered where the computer can search; a keyboard gets the key hints", async () => {
    await boot();
    expect(document.querySelector(".workspace-overview-search")).toBeNull();
    await teardownWorkspaceScreen();
    searches = true;
    await boot();
    expect(one(".workspace-overview-search").textContent).toContain("搜索文件");
    // The test window has a mouse, which comes with a keyboard (`hardwareKeyboard`).
    expect(one(".workspace-overview-keys").textContent).toContain("返回会话");
  });
});
