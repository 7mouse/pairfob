import { expectSameNode } from "../../../test-support/node-identity";
import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { commitTest, mountTestApp, unmountTestApp } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../app/dom-root";
import { disposeNoticeLifecycle } from "../../app/notices-store";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { clearAllDiffNotes, diffNotesFor } from "../../lib/diff-notes";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities, setOperationBusy } from "../operations/capabilities-store";
import { selectPane, setAgentChat, setFullTerminal } from "../session/session-store";
import { clearWorkspacePendingReveal, leaveWorkspace, showWorkspaceTab, workspaceModel } from "./index";
import { closeWorkspaceInspector, toggleWorkspaceInspector } from "./inspector";

/** What stands under a line to be read and pressed. A piece folding shut on its way out is still on the page, and is not that. */
const UNDER = ".diff-note-fold:not(.is-shut)";

/** The line a note's form or card stands under: what comes before everything the note keeps there. */
const lineOver = (piece: Element | null | undefined): Element | null => {
  let before = piece?.closest(".diff-note-fold")?.previousElementSibling ?? null;
  while (before?.matches(".diff-note-fold")) before = before.previousElementSibling;
  return before;
};

/**
 * Where the keyboard is after the reader works in the inspector. The page
 * forwards keys to the session whenever focus is not held by the column, so
 * each of these ends by asking where `document.activeElement` is.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const revision = "a".repeat(64);
const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";
/** Every prompt sent to the pane's agent, in order. */
const prompts: string[] = [];

function liveFixture() {
  return {
    isConnected: () => true,
    paneRead: async () => ({ text: "", hash: "h" }),
    workspaceOpen: async (pane: string) => ({
      name: `repo-${pane}`,
      root: `/work/${pane}`,
      features: { files: true, git_status: true, git_diff: true, git_branches: true },
      git: { name: `repo-${pane}`, branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({
      path,
      entries: [{ name: "app.ts", path: "app.ts", kind: "file" as const, size: 25, modified_ms: 1, hidden: false, revision }],
      next_cursor: null, truncated: false, revision,
    }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text" as const, size: 25, modified_ms: 1, content: "export const ready = true;\n", truncated: false, revision,
    }),
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: "origin/main", ahead: 0, behind: 0, truncated: false, revision,
      changes: [{ path: "app.ts", original_path: null, index: " ", worktree: "M" }],
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: PATCH, additions: 1, deletions: 1, binary: false, truncated: false, revision,
    }),
    gitBranches: async () => ({
      items: [{ name: "main", kind: "local" as const, current: true, head: "1234567890", upstream: null }],
      truncated: false, revision,
    }),
    promptAgent: async (input: { pane_id: string; text: string }) => {
      prompts.push(input.text);
      return { operation_id: `op-${prompts.length}` };
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

async function boot(): Promise<void> {
  happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
  await act(async () => {
    setLang("zh");
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    setAgentChat(false);
    setFullTerminal(false);
    setOperationBusy(false);
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: true }, []);
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "pairfob" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: ["p1", "p2"].map((pane_id) => ({
        pane_id, workspace_id: "w1", tab_id: "w1:t1", cwd: `/work/${pane_id}`, agent: "codex", agent_status: "idle" as const,
      })),
    });
    attachLiveSession(liveFixture() as never);
    mountTestApp();
    commitTest();
  });
  await act(async () => { toggleWorkspaceInspector(); });
  await settle();
}

function column(): HTMLElement {
  const found = appRoot().querySelector<HTMLElement>("aside.inspector");
  if (!found) throw new Error("the inspector is not on screen");
  return found;
}

function inColumn<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = column().querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector} in the inspector: ${column().innerHTML.slice(0, 400)}`);
  return found;
}

/**
 * A press the way a pointer makes one. `focus` is where the engine leaves
 * focus: on a pressed button in Chrome, on <body> in an engine that does not
 * focus buttons and for a line of text anywhere.
 */
async function press(target: HTMLElement, focus: "target" | "body" = "target"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    if (focus === "target") target.focus();
    else if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur();
    target.click();
  });
  await settle();
}

/** A key pressed on `target`, and whether it got past the column to the page's own key handling. */
async function key(target: Element, init: KeyboardEventInit): Promise<{ defaultPrevented: boolean; reachedDocument: boolean }> {
  const event = new happy.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }) as unknown as Event;
  let reachedDocument = false;
  const seen = () => { reachedDocument = true; };
  document.addEventListener("keydown", seen);
  await act(async () => { target.dispatchEvent(event); });
  document.removeEventListener("keydown", seen);
  await settle();
  return { defaultPrevented: event.defaultPrevented, reachedDocument };
}

async function type(textarea: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    textarea.value = text;
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function editor(): HTMLTextAreaElement {
  return inColumn<HTMLTextAreaElement>(`${UNDER} form.diff-note-inline textarea`);
}

function held(): boolean {
  const active = document.activeElement;
  return Boolean(active?.isConnected && column().contains(active));
}

async function openDiff(): Promise<void> {
  await press(inColumn(".workspace-change"));
  expect(workspaceModel.view).toBe("diff");
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  seedRestorer.capture();
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
    attachLiveSession(null);
    setScreen("home");
    seedRestorer.restore();
    await Promise.resolve();
  });
  appRoot().replaceChildren();
});

describe("a note written in the inspector", () => {
  test("opens under its line with the keyboard in it, and no dialog", async () => {
    await boot();
    await openDiff();
    const line = inColumn(".workspace-diff-line.diff-add");
    await press(line, "body");

    expect(document.querySelector("dialog[open]")).toBeNull();
    const form = inColumn<HTMLFormElement>(`${UNDER} form.diff-note-inline`);
    expect(lineOver(form) === line).toBeTrue();
    expect(form.getAttribute("aria-label")).toBe("给第 2 行写批注");
    expectSameNode(document.activeElement, editor());
    expect(form.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBeTrue();
  });

  test("Escape sets a half-written note aside under its line, and the keyboard stays in the column", async () => {
    await boot();
    await openDiff();
    const line = inColumn(".workspace-diff-line.diff-add");
    await press(line, "body");
    await type(editor(), "never mind");
    const escape = await key(editor(), { key: "Escape" });

    // The key was the editor's: nothing above the column sees it.
    expect(escape.defaultPrevented).toBeTrue();
    expect(escape.reachedDocument).toBeFalse();
    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(diffNotesFor("app.ts", "worktree")).toHaveLength(0);
    // Not saved and not lost: the words wait under the line they were written on.
    const card = inColumn(`${UNDER} .workspace-diff-note.is-draft`);
    expect(card.querySelector(".diff-note-state")?.textContent).toBe("未保存");
    expect(card.querySelector(".diff-note-body")?.textContent).toBe("never mind");
    expect(lineOver(card) === line).toBeTrue();
    // The line the editor belonged to: the next Esc, Ctrl+C or ↑ is not the session's.
    expect(held()).toBeTrue();
    expectSameNode(document.activeElement, inColumn(".workspace-diff-line.diff-add .diff-comment-btn"));

    // One press on the words is the editor again, with the keyboard after the last word.
    await press(inColumn(`${UNDER} .diff-note-resume`));
    expect(column().querySelector(`${UNDER} .workspace-diff-note.is-draft`)).toBeNull();
    expect(editor().value).toBe("never mind");
    expectSameNode(document.activeElement, editor());
    expect(inColumn(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeFalse();

    // Set aside again, any line leads back into it; Cancel is what throws it away.
    await key(editor(), { key: "Escape" });
    await press(inColumn(".workspace-diff-line.diff-delete"), "body");
    expect(editor().value).toBe("never mind");
    expect(lineOver(inColumn(`${UNDER} form.diff-note-inline`)) === line).toBeTrue();
    await press(inColumn(`${UNDER} .diff-note-inline-cancel`));
    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(column().querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    expect(held()).toBeTrue();
    await press(line, "body");
    expect(editor().value).toBe("");
  });

  test("the waiting note is answered from its card, and Escape with nothing new just closes", async () => {
    await boot();
    await openDiff();
    const line = inColumn(".workspace-diff-line.diff-add");

    // Nothing typed: nothing to keep.
    await press(line, "body");
    const empty = await key(editor(), { key: "Escape" });
    expect(empty.reachedDocument).toBeFalse();
    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(column().querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    expect(held()).toBeTrue();

    // Save on the card saves the words as they stand.
    await press(line, "body");
    await type(editor(), "  why true  ");
    await key(editor(), { key: "Escape" });
    await press(inColumn(`${UNDER} .diff-note-keep`));
    expect(column().querySelector(`${UNDER} .workspace-diff-note.is-draft`)).toBeNull();
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["why true"]);
    expect(held()).toBeTrue();

    // A saved note opened and left as it is has nothing new either.
    await press(inColumn(`${UNDER} .diff-note-action`));
    await key(editor(), { key: "Escape" });
    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(column().querySelectorAll(`${UNDER} .workspace-diff-note`)).toHaveLength(1);

    // An edit left with Escape waits beside the note it would replace; Cancel on the card drops only the edit.
    await press(inColumn(`${UNDER} .diff-note-action`));
    await type(editor(), "why true, reworded");
    await key(editor(), { key: "Escape" });
    expect([...column().querySelectorAll(`${UNDER} .workspace-diff-note`)].map((item) => [item.classList.contains("is-draft"), item.querySelector(".diff-note-body")?.textContent]))
      .toEqual([[false, "why true"], [true, "why true, reworded"]]);
    await press(inColumn(`${UNDER} .diff-note-discard`));
    expect(column().querySelector(`${UNDER} .workspace-diff-note.is-draft`)).toBeNull();
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["why true"]);
    expect(held()).toBeTrue();
  });

  test("saving keeps the keyboard in the column, by the button and by Ctrl+Enter", async () => {
    await boot();
    await openDiff();
    await press(inColumn(".workspace-diff-line.diff-add"), "body");
    await type(editor(), "why true");
    await press(inColumn(`${UNDER} .diff-note-inline-save`));

    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(inColumn(`${UNDER} .workspace-diff-note`).textContent).toContain("why true");
    expect(held()).toBeTrue();

    // Editing the saved note happens in the same place, and can delete it.
    await press(inColumn(`${UNDER} .diff-note-action`));
    expect(column().querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
    expect(editor().value).toBe("why true");
    expect(inColumn(`${UNDER} .diff-note-inline .diff-note-remove`).textContent).toBe("删除批注");
    await type(editor(), "why true?");
    await key(editor(), { key: "Enter", ctrlKey: true });
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["why true?"]);
    expect(held()).toBeTrue();
  });

  test("Ctrl+Shift+Enter in the note saves it and sends the diff's notes, from inside the column", async () => {
    await boot();
    await openDiff();
    prompts.length = 0;
    await press(inColumn(".workspace-diff-line.diff-add"), "body");
    await type(editor(), "why true");
    const sent = await key(editor(), { key: "Enter", ctrlKey: true, shiftKey: true });
    // The column answered it: the key did not go on to the page, where the session reads keys.
    expect(sent.defaultPrevented).toBeTrue();
    expect(column().querySelector(`${UNDER} form.diff-note-inline`)).toBeNull();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("why true");
  });

  test("an empty note is refused and a half-written one is not dropped for another line", async () => {
    await boot();
    await openDiff();
    await press(inColumn(".workspace-diff-line.diff-add"), "body");
    await key(editor(), { key: "Enter", metaKey: true });
    expect(inColumn(".diff-note-inline [role='alert']").textContent).toBe("先写一条批注。");
    expect(editor().getAttribute("aria-invalid")).toBe("true");

    await type(editor(), "half");
    await press(inColumn(".workspace-diff-line.diff-delete"), "body");
    expect(column().querySelectorAll(`${UNDER} form.diff-note-inline`)).toHaveLength(1);
    expect(lineOver(inColumn(`${UNDER} form.diff-note-inline`)) === inColumn(".workspace-diff-line.diff-add")).toBeTrue();
    expect(editor().value).toBe("half");
    expectSameNode(document.activeElement, editor());

    // Untouched, it simply moves.
    await press(inColumn(`${UNDER} .diff-note-inline-cancel`));
    await press(inColumn(".workspace-diff-line.diff-add"), "body");
    await press(inColumn(".workspace-diff-line.diff-delete"), "body");
    expect(lineOver(inColumn(`${UNDER} form.diff-note-inline`)) === inColumn(".workspace-diff-line.diff-delete")).toBeTrue();
  });

  test("a half-written note is still there when the column comes back", async () => {
    await boot();
    await openDiff();
    await press(inColumn(".workspace-diff-line.diff-add"), "body");
    await type(editor(), "not lost");

    await act(async () => {
      happy.happyDOM.setWindowSize({ width: 800, height: 900 });
      window.dispatchEvent(new window.Event("resize"));
      commitTest();
    });
    await settle();
    expect(appRoot().querySelector("aside.inspector")).toBeNull();
    await act(async () => {
      happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
      window.dispatchEvent(new window.Event("resize"));
      commitTest();
    });
    await settle();
    expect(editor().value).toBe("not lost");
    expect(inColumn(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeFalse();
  });
});

describe("focus after the inspector's overlays", () => {
  test("the branch sheet closes back into the column even when the press never focused its button", async () => {
    await boot();
    await press(inColumn(".inspector-repo"), "body");
    const menu = document.querySelector<HTMLDialogElement>("dialog.workspace-repo-menu[open]");
    const branches = [...menu?.querySelectorAll<HTMLElement>("button") ?? []].find((button) => button.textContent?.includes("分支与 Worktree"));
    if (!branches) throw new Error("the repository menu did not offer branches");
    await press(branches, "body");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 10)); });
    const sheet = document.querySelector<HTMLDialogElement>("dialog.workspace-branch-sheet");
    if (!sheet) throw new Error("the branch sheet did not open");
    await press(sheet.querySelector<HTMLElement>(".sheet-close")!, "body");
    expect(document.querySelector("dialog.workspace-branch-sheet")).toBeNull();
    expect(held()).toBeTrue();
  });

  test("a file menu closes back into the column, and so does the file it opens", async () => {
    await boot();
    await act(async () => { showWorkspaceTab("files"); });
    await settle();
    await press(inColumn(".workspace-row-more"), "body");
    const menu = document.querySelector<HTMLDialogElement>("dialog.workspace-file-menu");
    if (!menu) throw new Error("the file menu did not open");
    await act(async () => { menu.close("cancel"); });
    await settle();
    // Closed, and out of reach if it is still on the page for its exit (`shared/ui/overlay/modal`).
    expect(document.querySelector("dialog.workspace-file-menu:not([inert])")).toBeNull();
    expect(held()).toBeTrue();

    // The pressed row is replaced by the file it opens; focus does not fall out with it.
    await press(inColumn(".workspace-file .workspace-row-main"));
    expect(workspaceModel.view).toBe("file");
    expect(held()).toBeTrue();
    await press(inColumn(".workspace-detail-more-inline"), "body");
    await act(async () => { document.querySelector<HTMLDialogElement>("dialog.workspace-file-menu")?.close("cancel"); });
    await settle();
    expect(held()).toBeTrue();
  });

  test("it lets go once the reader presses in the session, or the column shows another pane", async () => {
    await boot();
    await openDiff();
    expect(held()).toBeTrue();
    const main = appRoot().querySelector<HTMLElement>(".main");
    if (!main) throw new Error("no session column");
    // A press on the session's text: focus is on <body> and it is the session's turn.
    await press(main, "body");
    await act(async () => { showWorkspaceTab("files"); });
    await settle();
    expectSameNode(document.activeElement, document.body);

    // Back in the column, then on to another session: the keyboard goes with the reader.
    await press(inColumn(".workspace-file .workspace-row-main"), "body");
    expect(held()).toBeTrue();
    await act(async () => {
      selectPane("p2");
      commitTest();
    });
    await settle();
    expect(workspaceModel.paneId).toBe("p2");
    await act(async () => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
    await act(async () => { showWorkspaceTab("files"); });
    await settle();
    expect(held()).toBeFalse();
  });
});
