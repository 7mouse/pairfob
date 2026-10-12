import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { expectSameNode } from "../../../test-support/node-identity";
import { all, bootWorkspaceScreen, key, one, press, teardownWorkspaceScreen } from "../../../test-support/workspace-harness";
import { workspaceLive, type FixtureChange } from "../../../test-support/workspace-live-fixture";
import { workspaceModel } from "./index";

/** A file changed in the index and again on disk: one row of the list, two diffs. */

let changes: FixtureChange[];

beforeEach(async () => {
  await resetBoardTestDOM();
  changes = [{ path: "src/app.ts", index: "M", worktree: "M" }, { path: "README.md", index: "A", worktree: " " }];
});
afterEach(teardownWorkspaceScreen);

describe("a file changed in both layers", () => {
  test("is one row under the working tree, with its staged diff as a tag that opens that diff", async () => {
    await bootWorkspaceScreen(workspaceLive({ changes: () => changes }));
    // A group counts the files under it: the row and its tag are one file.
    expect(all(".workspace-change-group-title").map((title) => title.textContent)).toEqual(["已暂存1", "未暂存1"]);
    expect(all(".workspace-change").map((row) => row.dataset.change)).toEqual(["staged:README.md", "worktree:src/app.ts"]);
    const tag = one<HTMLButtonElement>(".workspace-change-pair .workspace-change-layer");
    expect(tag.dataset.change).toBe("staged:src/app.ts");
    expect(tag.getAttribute("aria-label")).toBe("src/app.ts · 已暂存 · 修改 · 未看");
    await press(tag);
    expect(workspaceModel.view).toBe("diff");
    expect(workspaceModel.diffLayer).toBe("staged");
    // Both are still diffs of their own: three to see, walked in the list's order, which is the
    // order they stand in and Tab reaches them: the row's own diff, then its tag.
    expect(one(".workspace-step-where").textContent).toBe("3 / 3");
    await press(one("[aria-label='上一个改动文件']"));
    expect([workspaceModel.detailPath, workspaceModel.diffLayer]).toEqual(["src/app.ts", "worktree"]);
    expect(one(".workspace-step-where").textContent).toBe("2 / 3");
    await press(one("[aria-label='上一个改动文件']"));
    expect([workspaceModel.detailPath, workspaceModel.diffLayer]).toEqual(["README.md", "staged"]);
    await press(one("[aria-label='下一个改动文件']"));
    await press(one("[aria-label='下一个改动文件']"));
    expect([workspaceModel.detailPath, workspaceModel.diffLayer]).toEqual(["src/app.ts", "staged"]);
  });

  test("the keyboard reaches the two in that same order: the row, then its tag", async () => {
    await bootWorkspaceScreen(workspaceLive({ changes: () => changes }));
    const stops = all<HTMLElement>(".workspace-change, .workspace-change-layer").map((stop) => stop.dataset.change);
    expect(stops).toEqual(["staged:README.md", "worktree:src/app.ts", "staged:src/app.ts"]);
    // ↓ from the row lands on its tag before the next row: no diff is passed over.
    const row = one<HTMLButtonElement>(`[data-change="worktree:src/app.ts"]`);
    await act(async () => { row.focus(); });
    await key("ArrowDown", {}, row);
    expectSameNode(document.activeElement, one(`[data-change="staged:src/app.ts"]`));
  });
});
