import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeDiffBox, restoreDiffBox, scrollDiffTo } from "../../../test-support/diff-box";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { expectSameNode } from "../../../test-support/node-identity";
import { all, bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen } from "../../../test-support/workspace-harness";
import { clearAllDiffNotes } from "../../lib/diff-notes";
import { DIFF_BATCH_LINES } from "./diff";
import { setSplitChosen } from "./diff-layout";
import { clearWorkspacePendingReveal, loadGitDiff, refreshWorkspace } from "./index";

/**
 * Moving through a diff: from hunk to hunk with the info bar's arrows, along
 * the lines with the keyboard, past a fold, and through a long patch that is
 * drawn a stretch at a time. And the patches that are not the usual shape: a
 * file in conflict, lines that look like headers, a new file with nothing in it.
 */

let patch = "";
let revision = "1".repeat(64);
let changes: Array<{ path: string; index: string; worktree: string }>;

const live = () => ({
  isConnected: () => true,
  workspaceOpen: async () => ({
    name: "pairfob", root: "/work/pairfob",
    features: { files: true, git_status: true, git_diff: true, git_branches: false },
    git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
  }),
  workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
  gitStatus: async () => ({
    branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
    changes: changes.map((change) => ({ ...change, original_path: null })),
  }),
  gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
    path, layer, patch, additions: 1, deletions: 1, binary: false, truncated: false, revision,
  }),
});

const hunk = (at: number, lines: number, mark = "+") =>
  `@@ -${at},0 +${at},${lines} @@\n${Array.from({ length: lines }, (_, index) => `${mark}line ${at + index}`).join("\n")}\n`;

async function open(width = 390, prompts = false): Promise<HTMLElement> {
  await bootWorkspaceScreen(live(), { width, capabilities: { prompt_agent: prompts } });
  await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
  await settle();
  // A diff with no lines has no box of them; a test of one never asks for it.
  return document.querySelector<HTMLElement>(".workspace-diff")!;
}

const nav = () => {
  const [up, down] = all<HTMLButtonElement>(".workspace-hunk-nav button");
  return { up, down, where: () => one(".workspace-hunk-where").textContent };
};

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  revision = "1".repeat(64);
  changes = [{ path: "src/app.ts", index: " ", worktree: "M" }, { path: "src/b.ts", index: " ", worktree: "M" }];
});

afterEach(async () => {
  await teardownWorkspaceScreen();
  restoreDiffBox();
});

describe("from hunk to hunk", () => {
  test("down reaches a hunk the long patch has not drawn yet, and draws it", async () => {
    patch = hunk(1, DIFF_BATCH_LINES + 50) + hunk(900, 3);
    fakeDiffBox({ height: 400 });
    const scroller = await open();
    expect(all(".workspace-diff-group")).toHaveLength(1);
    expect(nav().where()).toBe("1/2 段");
    expect(nav().down.disabled).toBeFalse();
    await press(nav().down);
    expect(all(".workspace-diff-group")).toHaveLength(2);
    expect(nav().where()).toBe("2/2 段");
    expect([nav().up.disabled, nav().down.disabled]).toEqual([false, true]);
    // Its own unchanged stretch is the first thing under the top of the box.
    expect(one('.workspace-diff-group[data-group="1"]').getBoundingClientRect().top).toBeLessThanOrEqual(scroller.clientHeight);
  });

  test("short hunks at the end are each a step, though none can come to the top", async () => {
    patch = hunk(1, 30) + hunk(100, 2) + hunk(200, 2);
    fakeDiffBox({ height: 400 });
    const scroller = await open();
    await press(nav().down);
    expect(nav().where()).toBe("2/3 段");
    await press(nav().down);
    expect(nav().where()).toBe("3/3 段");
    expect(nav().down.disabled).toBeTrue();
    // Said once per step, for a reader who does not see the count.
    expect(one(".workspace-hunk-nav .sr-only").textContent).toBe("第 3 段，共 3 段");
    // Up goes back one hunk at a time, and the reader scrolling on their own is read from the box again.
    await press(nav().up);
    expect(nav().where()).toBe("2/3 段");
    await act(async () => { scrollDiffTo(scroller, 0); });
    expect(nav().where()).toBe("1/3 段");
    expect(nav().up.disabled).toBeTrue();
  });

  test("up goes to the start of the hunk being read before the one above", async () => {
    patch = hunk(1, 60) + hunk(100, 60);
    fakeDiffBox({ height: 300 });
    const scroller = await open();
    await press(nav().down);
    const second = scroller.scrollTop;
    await act(async () => { scrollDiffTo(scroller, second + 200); });
    await press(nav().up);
    expect(scroller.scrollTop).toBe(second);
    await press(nav().up);
    expect(scroller.scrollTop).toBe(0);
  });

  test("the arrows follow a fold: what is drawn changed, and the count is read again", async () => {
    patch = hunk(1, 30) + hunk(100, 30);
    fakeDiffBox({ height: 300 });
    await open();
    await press(nav().down);
    expect(nav().where()).toBe("2/2 段");
    for (const head of all(".workspace-hunk-toggle")) await press(head);
    // Both folded, the whole diff fits: the box is at its top again.
    expect(one(".workspace-diff").scrollTop).toBe(0);
    expect(nav().where()).toBe("1/2 段");
    await press(nav().down);
    expect(nav().where()).toBe("2/2 段");
    expect(nav().down.disabled).toBeTrue();
  });

  test("Tab into the diff arrives at the hunk stepped to", async () => {
    patch = hunk(1, 30) + hunk(100, 30);
    fakeDiffBox({ height: 300 });
    await open();
    await press(nav().down);
    const stops = all(".workspace-diff .diff-stop").filter((stop) => stop.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].closest(".workspace-diff-group")?.getAttribute("data-group")).toBe("1");
  });
});

describe("a fold", () => {
  test("folding from the head stuck over the middle of its hunk brings the reader to it, not past it", async () => {
    patch = hunk(1, 200) + hunk(900, 100) + hunk(1900, 100);
    fakeDiffBox({ height: 400 });
    const scroller = await open();
    await act(async () => { scrollDiffTo(scroller, 3000); });
    await press(all(".workspace-hunk-toggle")[0]);
    expect(scroller.scrollTop).toBe(0);
    expect(all(".workspace-diff-group")[0].classList.contains("is-folded")).toBeTrue();
  });

  test("the folded head says how much it holds, and the unchanged stretch reads as two things", async () => {
    patch = hunk(5, 6) + hunk(40, 2);
    await open();
    const head = all(".workspace-hunk-toggle")[0];
    await press(head);
    expect(head.getAttribute("aria-label")).toBe("第 5–10 行 · 6 行");
    expect(one(".workspace-gap-open").getAttribute("aria-label")).toBe("未改动 4 行 · 在文件中查看");
  });

  test("does not outlive the patch it was made on", async () => {
    patch = hunk(1, 4) + hunk(40, 4);
    await open();
    await press(all(".workspace-hunk-toggle")[1]);
    expect(all(".workspace-diff-group.is-folded")).toHaveLength(1);
    // The agent changed the file: a hunk now stands where the folded one stood, unread.
    patch = hunk(1, 4) + hunk(20, 2) + hunk(40, 4);
    revision = "2".repeat(64);
    await act(async () => { await refreshWorkspace(); });
    await settle();
    expect(all(".workspace-diff-group")).toHaveLength(3);
    expect(all(".workspace-diff-group.is-folded")).toHaveLength(0);
  });
});

describe("the keyboard along the lines", () => {
  test("the button that draws the last stretch hands the keyboard to the first line it drew", async () => {
    patch = hunk(1, DIFF_BATCH_LINES + 5);
    fakeDiffBox({ height: 400 });
    await open(390, true);
    const more = one<HTMLButtonElement>(".workspace-diff-more");
    await act(async () => { more.focus(); });
    await press(more);
    expect(document.querySelector(".workspace-diff-more")).toBeNull();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains("diff-comment-btn")).toBeTrue();
    expect(active.textContent).toBe(String(DIFF_BATCH_LINES + 1));
    expect(active.tabIndex).toBe(0);
  });

  test("an arrow at either end is the diff's again: it scrolls to what lies past the last stop", async () => {
    patch = hunk(1, 3);
    await open(390, true);
    const stops = all(".workspace-diff .diff-stop, .workspace-diff .diff-comment-btn");
    await act(async () => { stops[0].focus(); });
    expect((await key("ArrowUp", {}, stops[0])).defaultPrevented).toBeFalse();
    expect((await key("ArrowDown", {}, stops[0])).defaultPrevented).toBeTrue();
    expectSameNode(document.activeElement, stops[1]);
    const last = stops[stops.length - 1];
    await act(async () => { last.focus(); });
    expect((await key("j", {}, last)).defaultPrevented).toBeFalse();
  });

  test("with the two sides next to each other, down stays on its side and left and right cross", async () => {
    patch = "@@ -1,3 +1,3 @@\n-old one\n-old two\n+new one\n+new two\n same\n";
    await act(async () => { setSplitChosen(true); });
    await open(1280, true);
    const rows = all(".diff-split-row");
    const stop = (row: number, side: 0 | 1) => rows[row].children[side].querySelector<HTMLElement>(".diff-comment-btn")!;
    await act(async () => { stop(0, 0).focus(); });
    await key("ArrowDown", {}, stop(0, 0));
    expectSameNode(document.activeElement, stop(1, 0));
    await key("ArrowRight", {}, stop(1, 0));
    expectSameNode(document.activeElement, stop(1, 1));
    await key("ArrowUp", {}, stop(1, 1));
    expectSameNode(document.activeElement, stop(0, 1));
    // The unchanged line is one line, pinned on the new side: either side's down arrives there.
    await key("ArrowLeft", {}, stop(0, 1));
    await key("ArrowDown", {}, stop(0, 0));
    await key("ArrowDown", {}, stop(1, 0));
    expectSameNode(document.activeElement, stop(2, 1));
  });
});

describe("the two sides", () => {
  test("a stretch of a long patch is counted in its lines, and the button always draws something", async () => {
    const removed = Array.from({ length: 300 }, (_, index) => `-old ${index}`).join("\n");
    const added = Array.from({ length: 300 }, (_, index) => `+new ${index}`).join("\n");
    patch = `@@ -1,300 +1,300 @@\n${removed}\n${added}\n`;
    fakeDiffBox({ height: 400 });
    await act(async () => { setSplitChosen(true); });
    await open(1280);
    const filled = () => all(".diff-split-row").filter((row) => !row.children[1].classList.contains("is-blank")).length;
    // 400 lines: every removal, and the first hundred of what replaced them.
    expect(all(".diff-split-row")).toHaveLength(300);
    expect(filled()).toBe(100);
    expect(one(".workspace-diff-more").textContent).toBe("再显示 200 行");
    await press(one(".workspace-diff-more"));
    expect(filled()).toBe(300);
    expect(document.querySelector(".workspace-diff-more")).toBeNull();
  });

  test("putting them together or apart keeps the line being read where it was", async () => {
    const removed = Array.from({ length: 30 }, (_, index) => `-old ${index}`).join("\n");
    const added = Array.from({ length: 30 }, (_, index) => `+new ${index}`).join("\n");
    const rest = Array.from({ length: 80 }, (_, index) => ` same ${index}`).join("\n");
    patch = `@@ -1,110 +1,110 @@\n${removed}\n${added}\n${rest}\n`;
    fakeDiffBox({ height: 300 });
    const scroller = await open(1280);
    // Sixty changed lines, then the unchanged ones: the reader is twenty into those.
    await act(async () => { scrollDiffTo(scroller, 30 + 80 * 20); });
    const top = () => all<HTMLElement>("[data-at]").find((number) => number.closest(".workspace-diff-line")!.getBoundingClientRect().top >= 30)!;
    const before = { at: top().dataset.at, offset: top().closest(".workspace-diff-line")!.getBoundingClientRect().top };
    await press(one('.workspace-tool[aria-label="并排对比"]'));
    expect(scroller.classList.contains("is-split")).toBeTrue();
    expect(top().dataset.at).toBe(before.at);
    expect(top().closest(".workspace-diff-line")!.getBoundingClientRect().top).toBe(before.offset);
  });
});

describe("patches of another shape", () => {
  test("a file in conflict shows what Git shows: both sides and the markers, read against ours", async () => {
    changes = [{ path: "src/app.ts", index: "U", worktree: "U" }];
    patch = [
      "diff --cc src/app.ts", "index 1,2..0", "--- a/src/app.ts", "+++ b/src/app.ts",
      "@@@ -1,3 -1,3 +1,7 @@@ fn main",
      "  same", "++<<<<<<< HEAD", " +ours", "++=======", "+ theirs", "++>>>>>>> other", "  end", "",
    ].join("\n");
    await open();
    expect(one(".workspace-diff-banner")).toBeTruthy();
    expect(one(".workspace-hunk-title").textContent).toBe("第 1–7 行");
    expect(all(".workspace-diff-line").map((line) => line.querySelector(".diff-line-text")!.textContent))
      .toEqual(["same", "<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> other", "end"]);
    expect(all(".workspace-diff-line.diff-add")).toHaveLength(5);
    expect(document.querySelector(".workspace-empty")).toBeNull();
  });

  test("a changed line that begins like a file header is a line, and the numbers after it are right", async () => {
    patch = "diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1,4 +1,4 @@\n one\n--- a sql comment\n+++j;\n select 1;\n six\n";
    await open();
    const lines = all(".workspace-diff-line").map((line) => `${line.querySelector(".diff-line-number")!.textContent} ${line.querySelector(".diff-line-text")!.textContent}`);
    expect(lines).toEqual(["1 one", "2 -- a sql comment", "2 ++j;", "3 select 1;", "4 six"]);
  });

  test("a last line without a line break says so", async () => {
    patch = "@@ -1 +1 @@\n-last\n\\ No newline at end of file\n+last\n";
    await open();
    const [removed, added] = all(".workspace-diff-line");
    expect(removed.querySelector(".diff-noeol")?.textContent).toBe("文件末尾无换行");
    expect(added.querySelector(".diff-noeol")).toBeNull();
    expect(all(".workspace-diff-line")).toHaveLength(2);
  });

  test("a new file with nothing in it has no lines to show, and says that", async () => {
    patch = "diff --git a/pkg/__init__.py b/pkg/__init__.py\nnew file mode 100644\n--- /dev/null\n+++ b/pkg/__init__.py\n@@ -0,0 +1,0 @@\n";
    await open();
    expect(one(".workspace-empty").textContent).toBe("这个层级没有可显示的文本差异。");
    expect(document.querySelector(".workspace-diff-group")).toBeNull();
    expect(document.querySelector(".workspace-hunk-nav")).toBeNull();
  });
});

// The lines are plain boxes under labelled groups: a table would need cells none of them have.
test("the diff claims no table it does not build", async () => {
  patch = hunk(1, 3) + hunk(40, 2);
  await open();
  expect(document.querySelector('.workspace-diff [role="row"], .workspace-diff[role="table"], .workspace-diff [role="rowgroup"]')).toBeNull();
  expect(all('.workspace-diff-group[role="group"]').map((group) => group.getAttribute("aria-label"))).toEqual(["第 1–3 行", "第 40–41 行"]);
});
