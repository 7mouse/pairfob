import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { expectSameNode } from "../../../test-support/node-identity";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { commitTest, mountTestApp, unmountTestApp } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../app/dom-root";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { disposeNoticeLifecycle, visibleNotice } from "../../app/notices-store";
import { clearAllDiffNotes } from "../../lib/diff-notes";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES, OPERATION_INPUT_LIMITS } from "../../lib/operations";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities, setOperationBusy } from "../operations/capabilities-store";
import { composeDraft, setComposeDraft } from "../session/compose-store";
import { selectPane, setAgentChat, setFullTerminal } from "../session/session-store";
import { setPaneComposeLive } from "../settings/preferences-store";
import { LINE_COPIED_MS } from "./file-line-actions";
import { clearWorkspacePendingReveal, enterWorkspace, leaveWorkspace, loadWorkspaceFile, workspaceModel } from "./index";
import { closeWorkspaceInspector, toggleWorkspaceInspector } from "./inspector";

/**
 * One line of an open file: a press picks it and opens the terminal row's own
 * bar over the code, to copy the line, quote it into the message to the agent,
 * or (on a line an uncommitted change shows) write a note on it in its diff.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const revision = "a".repeat(64);
const CONTENT = "one\ntwo\n  three  \nfour\n";
/** The working tree's diff shows lines 1 to 3; line 4 is outside it. */
const PATCH = "@@ -1,3 +1,3 @@\n one\n-TWO\n+two\n   three  \n";
/** The code's box and its lines as a browser would lay them out: 20px a line from 100px down. happy-dom measures nothing. */
const realRect = happy.HTMLElement.prototype.getBoundingClientRect;
function layOut(scrolledBy = 0): void {
  happy.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const rect = (top: number, bottom: number, left = 0, right = 390) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} });
    if (this.classList.contains("workspace-code")) return rect(100, 300);
    const line = Number(this.dataset?.sourceLine);
    if (line) return rect(100 + (line - 1) * 20 - scrolledBy, 120 + (line - 1) * 20 - scrolledBy);
    return rect(0, 0, 0, 0);
  } as never;
}

let copiedText: string[];
let refuseCopy: boolean;
const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

function liveFixture(changed: boolean) {
  return {
    isConnected: () => true,
    paneRead: async () => ({ text: "", hash: "h" }),
    workspaceOpen: async () => ({
      name: "repo", root: "/work/p1",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "repo", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({
      path,
      entries: path === "src" ? [{ name: "app.ts", path: "src/app.ts", kind: "file" as const, size: 20, modified_ms: 1, hidden: false, revision }]
        : [{ name: "src", path: "src", kind: "directory" as const, size: 0, modified_ms: 1, hidden: false }],
      next_cursor: null, truncated: false, revision,
    }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text" as const, size: 20, modified_ms: 1, content: CONTENT, truncated: false, revision,
    }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision,
      changes: changed ? [{ path: "src/app.ts", original_path: null, index: " ", worktree: "M" }] : [],
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: PATCH, additions: 1, deletions: 1, binary: false, truncated: false, revision,
    }),
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

async function boot(width: number, options: { changed?: boolean; prompts?: boolean } = {}): Promise<void> {
  happy.happyDOM.setWindowSize({ width, height: 900 });
  await act(async () => {
    setLang("zh");
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    setAgentChat(false);
    setFullTerminal(false);
    setOperationBusy(false);
    setComposeDraft("");
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: options.prompts ?? true }, []);
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "pairfob" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/p1", agent: "codex", agent_status: "idle" as const }],
    });
    attachLiveSession(liveFixture(options.changed ?? true) as never);
    mountTestApp();
    commitTest();
  });
}

/** The files screen on the file. */
async function openFileOnScreen(options?: { changed?: boolean; prompts?: boolean }): Promise<void> {
  await boot(390, options);
  await act(async () => { await enterWorkspace("p1", undefined, false, "files"); });
  await settle();
  await act(async () => { await loadWorkspaceFile("src/app.ts"); });
  await settle();
  expect(workspaceModel.view).toBe("file");
}

const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = appRoot().querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};
const lineOf = (number: number) => one(`.workspace-code [data-source-line="${number}"]`);
const bar = () => appRoot().querySelector<HTMLElement>(".workspace-line-bar");
const actions = () => [...(bar()?.querySelectorAll<HTMLButtonElement>(".row-act") ?? [])].map((button) => button.textContent);
const action = (label: string) => [...bar()!.querySelectorAll<HTMLButtonElement>(".row-act")].find((button) => button.textContent === label)!;

/** A finger's press: the engine says so on the press and on the click it makes. */
async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }) as unknown as Event);
    target.dispatchEvent(new happy.PointerEvent("click", { bubbles: true, cancelable: true, pointerType: "touch" }) as unknown as Event);
  });
  await settle();
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  seedRestorer.capture();
  copiedText = [];
  refuseCopy = false;
  layOut();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => { if (refuseCopy) throw new Error("denied"); copiedText.push(text); } },
  });
});

afterEach(async () => {
  unmountTestApp();
  await act(async () => {
    closeWorkspaceInspector();
    if (currentScreen() === "workspace") leaveWorkspace();
    clearWorkspacePendingReveal();
    clearAllDiffNotes();
    closeTestDialogs();
    disposeNoticeLifecycle();
    setComposeDraft("");
    attachLiveSession(null);
    setScreen("home");
    seedRestorer.restore();
    await Promise.resolve();
  });
  if (realClipboard) Object.defineProperty(globalThis.navigator, "clipboard", realClipboard);
  happy.HTMLElement.prototype.getBoundingClientRect = realRect;
  appRoot().replaceChildren();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

describe("picking a line", () => {
  test("a press on a line marks it and opens its bar; the same line again, or a press elsewhere, puts it away", async () => {
    await openFileOnScreen();
    expect(bar()).toBeNull();
    await press(lineOf(2));
    expect(lineOf(2).classList.contains("is-picked")).toBeTrue();
    expect(bar()?.getAttribute("role")).toBe("toolbar");
    expect(bar()?.getAttribute("aria-label")).toBe("第 2 行的操作");
    // The terminal row's own bar, floating over the code: no line is moved by it.
    expect(bar()?.classList.contains("row-bubble")).toBeTrue();
    expect(bar()?.parentElement === one(".workspace-code-stage")).toBeTrue();

    await press(lineOf(2));
    expect(bar()).toBeNull();
    expect(lineOf(2).classList.contains("is-picked")).toBeFalse();

    await press(lineOf(1));
    await press(lineOf(3));
    // One line at a time.
    expect(appRoot().querySelectorAll(".workspace-code-line.is-picked")).toHaveLength(1);
    expect(lineOf(3).classList.contains("is-picked")).toBeTrue();
    await press(one(".workspace-chrome .workspace-refresh"));
    expect(bar()).toBeNull();
  });

  test("the bar stands over the line, under it at the top of the code, and leaves with a line scrolled out of sight", async () => {
    await openFileOnScreen();
    await press(lineOf(3));
    // Above line 3 (140px down), with the gap between them.
    expect(bar()?.dataset.side).toBe("above");
    expect(bar()?.style.top).toBe("134px");
    await press(lineOf(1));
    // No room above the first line of the box: under it.
    expect(bar()?.dataset.side).toBe("below");
    expect(bar()?.style.top).toBe("126px");
    expect("offscreen" in bar()!.dataset).toBeFalse();

    layOut(60);
    await act(async () => { one(".workspace-code").dispatchEvent(new window.Event("scroll")); });
    expect("offscreen" in bar()!.dataset).toBeTrue();
    layOut(0);
    await act(async () => { one(".workspace-code").dispatchEvent(new window.Event("scroll")); });
    expect("offscreen" in bar()!.dataset).toBeFalse();
  });

  test("Escape puts the bar away and closes nothing under it", async () => {
    await openFileOnScreen();
    await press(lineOf(1));
    const event = new happy.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event;
    await act(async () => { document.body.dispatchEvent(event); });
    await settle();
    expect(event.defaultPrevented).toBeTrue();
    expect(bar()).toBeNull();
    expect(workspaceModel.view).toBe("file");
    // The next Escape is the screen's again.
    await act(async () => { document.body.dispatchEvent(new happy.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
    await settle();
    expect(workspaceModel.view).toBe("browser");
  });

  test("text the reader is selecting picks nothing", async () => {
    await openFileOnScreen();
    const realSelection = document.getSelection;
    document.getSelection = (() => ({ isCollapsed: false, anchorNode: lineOf(2).firstChild })) as unknown as typeof document.getSelection;
    try {
      await press(lineOf(2));
      expect(bar()).toBeNull();
    } finally {
      document.getSelection = realSelection;
    }
  });
});

describe("copy", () => {
  test("the line goes to the clipboard as it is written, the bar says so and then closes", async () => {
    await openFileOnScreen();
    await press(lineOf(3));
    await press(action("复制"));
    expect(copiedText).toEqual(["  three  "]);
    expect(actions()[0]).toBe("已复制");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, LINE_COPIED_MS + 30)); });
    expect(bar()).toBeNull();
  });

  test("a refusal closes the bar under its reason", async () => {
    await openFileOnScreen();
    refuseCopy = true;
    await press(lineOf(1));
    await press(action("复制"));
    expect(bar()).toBeNull();
    expect(visibleNotice()?.text).toBe("浏览器没有允许复制。");
  });
});

describe("quote", () => {
  test("from the files screen the reference and the line wait in the session's message, and the reader is told", async () => {
    await openFileOnScreen();
    await press(lineOf(3));
    await press(action("引用"));
    expect(bar()).toBeNull();
    expect(visibleNotice()?.text).toBe("已引用 src/app.ts:3，回到会话后在输入框里。");

    await act(async () => { leaveWorkspace(); commitTest(); });
    await settle();
    expect(currentScreen()).toBe("pane");
    expect(composeDraft()).toBe("src/app.ts:3\n> three\n");
  });

  test("it is added after what was already waiting to be sent, on lines of its own", async () => {
    await boot(390);
    await act(async () => { setComposeDraft("please look at"); commitTest(); });
    await act(async () => { await enterWorkspace("p1", undefined, false, "files"); });
    await settle();
    await act(async () => { await loadWorkspaceFile("src/app.ts"); });
    await settle();
    await press(lineOf(1));
    await press(action("引用"));
    await press(lineOf(4));
    await press(action("引用"));
    await act(async () => { leaveWorkspace(); commitTest(); });
    await settle();
    expect(composeDraft()).toBe("please look at\nsrc/app.ts:1\n> one\nsrc/app.ts:4\n> four\n");
  });

  test("a session in live input gets the reference alone, on one line: its field types what it holds into the program", async () => {
    await boot(390);
    await act(async () => { setPaneComposeLive("p1", true); setComposeDraft("see"); commitTest(); });
    await act(async () => { await enterWorkspace("p1", undefined, false, "files"); });
    await settle();
    await act(async () => { await loadWorkspaceFile("src/app.ts"); });
    await settle();
    await press(lineOf(1));
    await press(action("选择"));
    await press(lineOf(3));
    await press(action("引用"));
    // No quotation: "> two" typed into a shell is a redirection.
    expect(visibleNotice()?.text).toBe("已引用 src/app.ts:1-3。会话在实时输入下，只带了位置，没有带代码。");
    await act(async () => { leaveWorkspace(); commitTest(); });
    await settle();
    expect(composeDraft()).toBe("see src/app.ts:1-3 ");
    expect(composeDraft()).not.toContain("\n");
    await act(async () => { setPaneComposeLive("p1", false); });
  });

  test("a message with no room left refuses the quotation whole, and says so", async () => {
    await boot(390);
    const waiting = "x".repeat(OPERATION_INPUT_LIMITS.prompt - 4);
    await act(async () => { setComposeDraft(waiting); commitTest(); });
    await act(async () => { await enterWorkspace("p1", undefined, false, "files"); });
    await settle();
    await act(async () => { await loadWorkspaceFile("src/app.ts"); });
    await settle();
    await press(lineOf(3));
    await press(action("引用"));
    expect(visibleNotice()?.tone).toBe("error");
    expect(visibleNotice()?.text).toBe("输入框已放不下这段引用，没有加进去。");
    await act(async () => { leaveWorkspace(); commitTest(); });
    await settle();
    expect(composeDraft()).toBe(waiting);
  });

  test("beside the session it goes straight into the message field", async () => {
    await boot(1440);
    await act(async () => { toggleWorkspaceInspector(); });
    await settle();
    await act(async () => { await loadWorkspaceFile("src/app.ts"); });
    await settle();
    await press(one(`aside.inspector .workspace-code [data-source-line="2"]`));
    await press(action("引用"));
    expect(bar()).toBeNull();
    expect(composeDraft()).toBe("src/app.ts:2\n> two\n");
    // The field shows it: no banner repeats it.
    expect(visibleNotice()).toBeNull();
  });
});

describe("a note, on a line its changes show", () => {
  test("the bar offers it there, and it opens the diff with the form under that line", async () => {
    await openFileOnScreen();
    await press(lineOf(2));
    // A finger's bar: Select is how it reaches a second line.
    expect(actions()).toEqual(["复制", "引用", "批注", "选择"]);
    await press(action("批注"));
    await settle();
    expect(workspaceModel.view).toBe("diff");
    expect(workspaceModel.diffLayer).toBe("worktree");
    const form = one<HTMLFormElement>(".workspace-shell form.diff-note-inline");
    expect(form.getAttribute("aria-label")).toBe("给第 2 行写批注");
    expect(form.previousElementSibling?.classList.contains("diff-add")).toBeTrue();
    expectSameNode(document.activeElement, form.querySelector("textarea"));
  });

  test("a line outside the diff, an unchanged file, or a daemon that takes no prompts: copy and quote only", async () => {
    await openFileOnScreen();
    await press(lineOf(4));
    expect(actions()).toEqual(["复制", "引用", "选择"]);

    unmountTestApp();
    await openFileOnScreen({ changed: false });
    await press(lineOf(2));
    expect(actions()).toEqual(["复制", "引用", "选择"]);

    unmountTestApp();
    await openFileOnScreen({ prompts: false });
    await press(lineOf(2));
    expect(actions()).toEqual(["复制", "引用", "选择"]);
  });
});

describe("a run of lines", () => {
  const picked = () => [...appRoot().querySelectorAll<HTMLElement>(".workspace-code-line.is-picked")].map((line) => Number(line.dataset.sourceLine));

  test("under a finger the bar's Select makes the next tap the run's other end, either way round", async () => {
    await openFileOnScreen();
    await press(lineOf(3));
    await press(action("选择"));
    expect(action("完成").getAttribute("aria-pressed")).toBe("true");
    await press(lineOf(1));
    expect(picked()).toEqual([1, 2, 3]);
    expect(bar()?.getAttribute("aria-label")).toBe("第 1-3 行的操作");
    // A note is pinned on one line: a run is copied or quoted.
    expect(actions()).toEqual(["复制", "引用", "完成"]);
    await press(lineOf(2));
    expect(picked()).toEqual([2, 3]);
    await press(action("复制"));
    // Copied as the file has them, indentation and all.
    expect(copiedText).toEqual(["two\n  three  "]);
  });

  test("Done ends the growing: the next tap picks its own line again", async () => {
    await openFileOnScreen();
    await press(lineOf(1));
    await press(action("选择"));
    await press(lineOf(2));
    await press(action("完成"));
    expect(picked()).toEqual([1, 2]);
    await press(lineOf(4));
    expect(picked()).toEqual([4]);
  });

  test("with a mouse, Shift and a second press reach from the first line to that one; its bar has no Select", async () => {
    await openFileOnScreen();
    const mouse = async (target: HTMLElement, shiftKey = false) => {
      await act(async () => {
        target.dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }) as unknown as Event);
        target.dispatchEvent(new happy.MouseEvent("click", { bubbles: true, shiftKey }) as unknown as Event);
      });
      await settle();
    };
    // The click itself carries no pointer type here, as in engines that make it a plain mouse event: the press said it.
    await mouse(lineOf(1));
    expect(bar()?.dataset.anchor).toBe("pointer");
    expect(actions()).toEqual(["复制", "引用", "批注"]);
    await mouse(lineOf(3), true);
    expect(picked()).toEqual([1, 2, 3]);
    expect(actions()).toEqual(["复制", "引用"]);
    await press(action("引用"));
    expect(visibleNotice()?.text).toContain("src/app.ts:1-3");
  });

  test("the keyboard: the arrows pick a line, Shift and the arrows a run, and ⌘⇧L quotes it", async () => {
    await openFileOnScreen();
    const code = one<HTMLElement>(".workspace-code");
    expect(code.tabIndex).toBe(0);
    const key = async (name: string, init: KeyboardEventInit = {}) => {
      await act(async () => {
        code.dispatchEvent(new happy.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }) as unknown as Event);
      });
      await settle();
    };
    await act(async () => { code.focus(); });
    await key("ArrowDown");
    expect(picked()).toEqual([1]);
    await key("ArrowDown");
    expect(picked()).toEqual([2]);
    await key("ArrowDown", { shiftKey: true });
    await key("ArrowDown", { shiftKey: true });
    expect(picked()).toEqual([2, 3, 4]);
    await key("ArrowUp", { shiftKey: true });
    expect(picked()).toEqual([2, 3]);
    // The keyboard's bar is the plain one: no Select, the arrows are it.
    expect(actions()).toEqual(["复制", "引用"]);
    await key("l", { metaKey: true, shiftKey: true });
    expect(bar()).toBeNull();
    expect(visibleNotice()?.text).toContain("src/app.ts:2-3");
  });
});
