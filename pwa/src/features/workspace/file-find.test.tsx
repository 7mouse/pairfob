import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { expectSameNode } from "../../../test-support/node-identity";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { all, bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen, type } from "../../../test-support/workspace-harness";
import { findLines } from "./file-find";
import { loadWorkspaceFile, refreshWorkspace, workspaceModel } from "./index";

/** Find in the open file: the lines that hold what was typed, stepped through from a row under the info bar. */

const CONTENT = "const alpha = 1;\nlet beta = alpha + 1;\n\nexport { Alpha };\nconst gamma = 3;\n";
let truncated = false;
let changed = false;
/** What the file reads as; a test changes it to say the file was written again. */
let content = CONTENT;
/** Lines brought into view, as the browser would be asked; happy-dom scrolls nothing. */
let shown: number[] = [];
const realScroll = Object.getOwnPropertyDescriptor(happy.HTMLElement.prototype, "scrollIntoView");

function liveFixture() {
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text", content, size: content.length, modified_ms: 1, truncated, revision: "f".repeat(64),
    }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: changed ? [{ path: "src/app.ts", original_path: null, index: " ", worktree: "M" }] : [],
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, binary: false, truncated: false, revision: "1".repeat(64),
    }),
  };
}

async function openFile(width = 390, path = "src/app.ts"): Promise<void> {
  await bootWorkspaceScreen(liveFixture(), { width, tab: "files" });
  await act(async () => { await loadWorkspaceFile(path); });
  await settle();
}

const found = () => all(".workspace-code-line.is-found").map((line) => Number(line.dataset.sourceLine));
const current = () => all(".workspace-code-line.is-found-current").map((line) => Number(line.dataset.sourceLine));
const field = () => one<HTMLInputElement>(".workspace-find-field");

beforeEach(async () => {
  await resetBoardTestDOM();
  truncated = false;
  changed = false;
  content = CONTENT;
  shown = [];
  Object.defineProperty(happy.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) { if (this.dataset.sourceLine) shown.push(Number(this.dataset.sourceLine)); },
  });
});
afterEach(async () => {
  await teardownWorkspaceScreen();
  if (realScroll) Object.defineProperty(happy.HTMLElement.prototype, "scrollIntoView", realScroll);
  else delete (happy.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("findLines", () => {
  test("the lines that hold the words, letter case aside; nothing for nothing", () => {
    expect(findLines(CONTENT, "alpha")).toEqual([1, 2, 4]);
    expect(findLines(CONTENT, "CONST ")).toEqual([1, 5]);
    expect(findLines(CONTENT, "")).toEqual([]);
    expect(findLines(CONTENT, "zeta")).toEqual([]);
  });
});

describe("find in the open file", () => {
  test("the info bar's actions are icons that say what they are, and find opens a row with the field ready", async () => {
    await openFile();
    const actions = all<HTMLButtonElement>(".workspace-detail-head .workspace-detail-actions button");
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual(["在文件中查找", "换行", "更多操作"]);
    expect(actions.every((button) => button.title || button.getAttribute("aria-label"))).toBeTrue();
    expect(document.querySelector(".workspace-find")).toBeNull();
    await press(one(".workspace-find-toggle"));
    expect(one(".workspace-find-toggle").getAttribute("aria-pressed")).toBe("true");
    // The reader opened it to type.
    expectSameNode(document.activeElement, field());
  });

  test("typing marks the lines, Enter goes on and Shift+Enter back, round the ends", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    expect(found()).toEqual([1, 2, 4]);
    expect(current()).toEqual([1]);
    expect(one(".workspace-find-count").textContent).toBe("1/3");
    await key("Enter", {}, field());
    await key("Enter", {}, field());
    expect(current()).toEqual([4]);
    expect(one(".workspace-find-count").textContent).toBe("3/3");
    await key("Enter", {}, field());
    expect(current()).toEqual([1]);
    await key("Enter", { shiftKey: true }, field());
    expect(current()).toEqual([4]);
    await press(one("[aria-label='上一处']"));
    expect(current()).toEqual([2]);
  });

  test("no match is said, and the steps are off", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await type(field(), "zeta");
    expect(one(".workspace-find-count").textContent).toBe("无结果");
    expect(found()).toEqual([]);
    expect(one<HTMLButtonElement>("[aria-label='下一处']").disabled).toBeTrue();
  });

  test("Escape in the field closes the row and nothing under it; the marks go with it", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    const escape = await key("Escape", {}, field());
    expect(escape.defaultPrevented).toBeTrue();
    expect(document.querySelector(".workspace-find")).toBeNull();
    expect(found()).toEqual([]);
    expect(workspaceModel.view).toBe("file");
  });

  test("each step brings its line into view, and Enter on the only match brings it back", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    expect(shown.at(-1)).toBe(1);
    await key("Enter", {}, field());
    expect(shown.at(-1)).toBe(2);
    // One match: there is no next one to go to, and the reader who scrolled away still gets it back.
    await type(field(), "gamma");
    expect(current()).toEqual([5]);
    const before = shown.length;
    await key("Enter", {}, field());
    expect(shown.length).toBe(before + 1);
    expect(shown.at(-1)).toBe(5);
    expect(one(".workspace-find-count").textContent).toBe("1/1");
  });

  for (const width of [390, 1024, 1440]) {
    test(`at ${width}px, Escape pressed anywhere in the file closes the find row first and leaves the file open`, async () => {
      await openFile(width);
      await press(one(".workspace-find-toggle"));
      await type(field(), "alpha");
      // From a button of the row, where a mouse leaves focus after a step.
      const next = one<HTMLButtonElement>("[aria-label='下一处']");
      await act(async () => { next.focus(); });
      let escape = await key("Escape", {}, next);
      expect(escape.defaultPrevented).toBeTrue();
      expect(document.querySelector(".workspace-find")).toBeNull();
      expect(workspaceModel.view).toBe("file");
      // The keyboard goes back to the button that opened the row, not to the page.
      expectSameNode(document.activeElement, one(".workspace-find-toggle"));

      // From the source, or from the page itself when the reader got here with a pointer.
      await press(one(".workspace-find-toggle"));
      escape = await key("Escape", {}, one(".workspace-code-stage"));
      expect(document.querySelector(".workspace-find")).toBeNull();
      expect(workspaceModel.view).toBe("file");
      await press(one(".workspace-find-toggle"));
      await act(async () => { (document.activeElement as HTMLElement | null)?.blur(); });
      await key("Escape");
      expect(document.querySelector(".workspace-find")).toBeNull();
      expect(workspaceModel.view).toBe("file");

      // With the row closed the same key closes the file.
      await key("Escape");
      expect(workspaceModel.view).toBe("browser");
    });
  }

  test("closing from the field or from Close hands the keyboard back to the find button", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await key("Escape", {}, field());
    expectSameNode(document.activeElement, one(".workspace-find-toggle"));
    await press(one(".workspace-find-toggle"));
    const close = one<HTMLButtonElement>("[aria-label='关闭查找']");
    await act(async () => { close.focus(); });
    await press(close);
    expectSameNode(document.activeElement, one(".workspace-find-toggle"));
  });

  test("the same file read again with other text starts with the row closed", async () => {
    await openFile();
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    expect(found()).toEqual([1, 2, 4]);
    content = "nothing here now\nalpha once\n";
    await act(async () => { await refreshWorkspace(); });
    await settle();
    expect(document.querySelector(".workspace-find")).toBeNull();
    expect(found()).toEqual([]);
    // Opened again it searches the text that is there now.
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    expect(found()).toEqual([2]);
  });

  test("a page has find while its source is what is shown, and not over its rendering", async () => {
    await openFile(390, "public/report.html");
    const modes = all<HTMLButtonElement>(".workspace-preview-switch button");
    // Its rendering has no lines to find in.
    expect(modes[0].getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".workspace-find-toggle")).toBeNull();
    await press(modes[1]);
    await press(one(".workspace-find-toggle"));
    await type(field(), "alpha");
    expect(found()).toEqual([1, 2, 4]);
    expect(current()).toEqual([1]);
    // Back on the rendering the row is put away with the source it searched.
    await press(all<HTMLButtonElement>(".workspace-preview-switch button")[0]);
    expect(document.querySelector(".workspace-find")).toBeNull();
    expect(document.querySelector(".workspace-find-toggle")).toBeNull();
  });

  test("a file with changes offers them from an icon that carries its Git mark", async () => {
    changed = true;
    await openFile();
    const changes = one(".workspace-view-changes");
    expect(changes.getAttribute("aria-label")).toBe("查看更改");
    expect(changes.querySelector(".workspace-git-mark")?.textContent).toBe("M");
    await press(changes);
    expect(workspaceModel.view).toBe("diff");
  });

  test("a file cut short says so above its text, where it is read first", async () => {
    truncated = true;
    await openFile();
    const notice = one(".workspace-limit.is-lead");
    expect(notice.textContent).toContain("只显示前 128 KiB");
    expect(notice.compareDocumentPosition(one(".workspace-code-stage")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
