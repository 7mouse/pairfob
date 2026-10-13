import { expectDifferentNode, expectSameNode } from "../../../test-support/node-identity";
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
import { clearWorkspacePendingReveal, closeWorkspaceDetail, enterWorkspace, leaveWorkspace, loadGitDiff, workspaceModel } from "./index";
import { closeWorkspaceInspector, expandWorkspaceInspector, toggleWorkspaceInspector } from "./inspector";

/** What stands under a line to be read and pressed. A piece folding shut on its way out is still on the page, and is not that. */
const UNDER = ".diff-note-fold:not(.is-shut)";

/** The line a note's form or card stands under: what comes before everything the note keeps there. */
const lineOver = (piece: Element | null | undefined): Element | null => {
  let before = piece?.closest(".diff-note-fold")?.previousElementSibling ?? null;
  while (before?.matches(".diff-note-fold")) before = before.previousElementSibling;
  return before;
};

/**
 * A half-written line note belongs to its pane, diff and line. The inspector
 * and the workspace screen both show it as the form under its line, or as the
 * card it becomes when the reader sets it aside; these walk one note between
 * the two.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const revision = "a".repeat(64);
const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";

/** Both panes have the same file, so a note that leaked across panes would show. */
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
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

/** A desk session with two panes, the first open with the inspector on its one changed file. */
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
  await press(inColumn(".workspace-change"));
  expect(workspaceModel.view).toBe("diff");
}

function column(): HTMLElement | null {
  return appRoot().querySelector<HTMLElement>("aside.inspector");
}

function inColumn<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = column()?.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector} in the inspector: ${column()?.innerHTML.slice(0, 400)}`);
  return found;
}

function onScreen<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = appRoot().querySelector<T>(`.workspace-shell ${selector}`);
  if (!found) throw new Error(`missing ${selector} on the workspace screen`);
  return found;
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

async function type(textarea: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    textarea.value = text;
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

/** A domain change the way the app makes one: write, then commit. */
async function change(write: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await write();
    commitTest();
  });
  await settle();
}

async function resize(width: number): Promise<void> {
  await change(() => {
    happy.happyDOM.setWindowSize({ width, height: 900 });
    window.dispatchEvent(new window.Event("resize"));
  });
}

/** What the files button does while the window has no room for the column: a press, then the screen. */
async function openScreen(): Promise<void> {
  await act(async () => { document.body.dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event); });
  await change(() => enterWorkspace("p1"));
  expect(currentScreen()).toBe("workspace");
  expect(workspaceModel.view).toBe("diff");
}

async function leaveScreen(): Promise<void> {
  await change(() => leaveWorkspace());
  expect(currentScreen()).toBe("pane");
}

/** The form under the line in the inspector; null while none is open. */
function inline(): HTMLTextAreaElement | null {
  return column()?.querySelector<HTMLTextAreaElement>(`${UNDER} form.diff-note-inline textarea`) ?? null;
}

/** The screen's card for a note that was set aside, not saved yet. */
function card(): HTMLElement | null {
  return appRoot().querySelector<HTMLElement>(`.workspace-shell ${UNDER} .workspace-diff-note.is-draft`);
}

/** The form under the line on the workspace screen; null while none is open. */
function screenField(): HTMLTextAreaElement | null {
  return appRoot().querySelector<HTMLTextAreaElement>(`.workspace-shell ${UNDER} form.diff-note-inline textarea`);
}

/** The column's card for a note left with Escape. */
function columnCard(): HTMLElement | null {
  return column()?.querySelector<HTMLElement>(`${UNDER} .workspace-diff-note.is-draft`) ?? null;
}

function escapeKey(target: Element): void {
  target.dispatchEvent(new happy.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event);
}

/** Escape in a field, or wherever `target` says the key was pressed. */
async function escape(target: Element): Promise<void> {
  await act(async () => { escapeKey(target); });
  await settle();
}

/** Half a note on the added line, written in the inspector. */
async function writeInColumn(text: string): Promise<void> {
  await press(inColumn(".workspace-diff-line.diff-add"));
  await type(inline()!, text);
}

/** The same, then left with Escape: it waits under its line as a card. */
async function setAsideInColumn(text: string): Promise<void> {
  await writeInColumn(text);
  await escape(inline()!);
  expect(inline()).toBeNull();
  expect(columnCard()?.querySelector(".diff-note-body")?.textContent).toBe(text);
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
    setAgentChat(false);
    setFullTerminal(false);
    setScreen("home");
    seedRestorer.restore();
    await Promise.resolve();
  });
  appRoot().replaceChildren();
});

describe("a half-written note, from the inspector to the workspace screen and back", () => {
  test("the screen shows it in the same form under its line, and the column has it back in place", async () => {
    await boot();
    await writeInColumn("half written");

    await resize(800);
    expect(column()).toBeNull();
    await openScreen();
    // The same form, under the same line; no dialog covers the diff.
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(screenField()?.value).toBe("half written");
    expect(lineOver(screenField()) === onScreen(".workspace-diff-line.diff-add")).toBeTrue();
    expect(onScreen(`${UNDER} form.diff-note-inline`).getAttribute("aria-label")).toBe("给第 2 行写批注");
    expect(onScreen(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeFalse();
    // It waits there: the reader pressed the files button since, so the keyboard is theirs to bring.
    expectDifferentNode(document.activeElement, screenField());
    // Not a saved note: nothing to send yet.
    expect(diffNotesFor("app.ts", "worktree")).toHaveLength(0);
    expect(appRoot().querySelector(".workspace-notes-bar:not(.is-leaving)")).toBeNull();

    await resize(1440);
    // Widening does not leave the screen, and the form is still there.
    expect(currentScreen()).toBe("workspace");
    expect(screenField()?.value).toBe("half written");
    await leaveScreen();
    expect(inline()?.value).toBe("half written");
    expect(lineOver(inline()) === inColumn(".workspace-diff-line.diff-add")).toBeTrue();
    expect(inColumn(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeFalse();
  });

  test("expanding the column into the screen carries it too", async () => {
    await boot();
    await writeInColumn("carried");
    await change(() => expandWorkspaceInspector());
    expect(currentScreen()).toBe("workspace");
    expect(screenField()?.value).toBe("carried");
    await leaveScreen();
    expect(inline()?.value).toBe("carried");
  });

  test("what is added on the screen is in the column when the screen goes away under it", async () => {
    await boot();
    await writeInColumn("first half");
    await resize(800);
    await openScreen();
    await type(screenField()!, "first half, second half");

    // A jump to the session from elsewhere: the screen and its form unmount without an answer.
    await leaveScreen();
    expect(screenField()).toBeNull();
    await resize(1440);
    expect(inline()?.value).toBe("first half, second half");
  });

  test("a note begun on the screen is kept the same way, and shows on either side", async () => {
    await boot();
    await resize(800);
    await openScreen();
    await press(onScreen(".workspace-diff-line.diff-delete"));
    await type(screenField()!, "begun on the screen");
    await leaveScreen();

    await openScreen();
    expect(screenField()?.value).toBe("begun on the screen");
    expect(lineOver(screenField()) === onScreen(".workspace-diff-line.diff-delete")).toBeTrue();
    await leaveScreen();
    await resize(1440);
    expect(inline()?.value).toBe("begun on the screen");
    expect(lineOver(inline()) === inColumn(".workspace-diff-line.diff-delete")).toBeTrue();
    // Brought back, it waits: the keyboard stays where the reader left it.
    expectDifferentNode(document.activeElement, inline());
  });

  test("leaving the diff for the list keeps it too, as a phone's Back does", async () => {
    await boot();
    await resize(800);
    await openScreen();
    await press(onScreen(".workspace-diff-line.diff-add"));
    await type(screenField()!, "typed, then back");
    await change(() => closeWorkspaceDetail());
    expect(workspaceModel.view).toBe("browser");
    await change(() => loadGitDiff("app.ts", "worktree"));
    expect(screenField()?.value).toBe("typed, then back");
  });

  test("it stays with its pane through a session switch, beside the session and on the screen", async () => {
    await boot();
    await writeInColumn("p1 only");

    await change(() => selectPane("p2"));
    await press(inColumn(".workspace-change"));
    // The same file in another pane has no note in progress.
    expect(workspaceModel.paneId).toBe("p2");
    expect(inline()).toBeNull();
    await change(() => selectPane("p1"));
    expect(inline()?.value).toBe("p1 only");

    await resize(800);
    await change(() => selectPane("p2"));
    await change(() => enterWorkspace("p2"));
    expect(workspaceModel.view).toBe("diff");
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    await leaveScreen();
    await change(() => selectPane("p1"));
    await openScreen();
    expect(screenField()?.value).toBe("p1 only");
  });
});

describe("the column's editor, back after the window had no room for it", () => {
  const caret = (field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd];

  /** What the reader does somewhere else while the column is away. */
  async function readerActs(type: "pointerdown" | "keydown", key = "a"): Promise<void> {
    await act(async () => {
      const target = appRoot().querySelector(".main") ?? document.body;
      target.dispatchEvent((type === "pointerdown"
        ? new happy.PointerEvent("pointerdown", { bubbles: true })
        : new happy.KeyboardEvent("keydown", { key, bubbles: true })) as unknown as Event);
    });
  }

  test("it has the keyboard again when the reader was typing in it and did nothing in between, after the last word", async () => {
    await boot();
    await writeInColumn("draft one");
    expectSameNode(document.activeElement, inline());
    await resize(800);
    expect(column()).toBeNull();
    // A window is often dragged or tiled with a modifier held: that is not the reader moving on.
    await readerActs("keydown", "Meta");
    await resize(1440);
    const field = inline()!;
    expect(field.value).toBe("draft one");
    expectSameNode(document.activeElement, field);
    // The next words go after the ones already there, not in front of them.
    expect(caret(field)).toEqual([9, 9]);

    // And again: every return is the same handover.
    await resize(800);
    await resize(1440);
    expectSameNode(document.activeElement, inline());
  });

  test("it had no keyboard when the column left: it comes back without one", async () => {
    await boot();
    await writeInColumn("draft one");
    // Typing redrew the form, and the column looks after focus a moment after any redraw (`focus-keeper`).
    // That look belongs to the typing: it has to be over before the reader leaves the field, as it is
    // in a browser, or it finds the field just left and puts the keyboard back in it.
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 5)); });
    await act(async () => { inline()!.blur(); });
    expectDifferentNode(document.activeElement, inline());
    await resize(800);
    await resize(1440);
    expect(inline()!.value).toBe("draft one");
    expectDifferentNode(document.activeElement, inline());
  });

  for (const moved of ["pointerdown", "keydown"] as const) {
    test(`after a ${moved} somewhere else it waits without the keyboard, and another line pressed resumes it after the last word`, async () => {
      await boot();
      await writeInColumn("draft one");
      await resize(800);
      expect(column()).toBeNull();
      await readerActs(moved);
      await resize(1440);
      const field = inline()!;
      expect(field.value).toBe("draft one");
      expectDifferentNode(document.activeElement, field);
      // Where a browser leaves the caret of a field mounted with text in it.
      field.setSelectionRange(0, 0);

      await press(inColumn(".workspace-diff-line.diff-delete"));
      // Still the one note of this diff, under the line it was written on.
      expect(column()!.querySelectorAll(`${UNDER} form.diff-note-inline`)).toHaveLength(1);
      expect(lineOver(inColumn(`${UNDER} form.diff-note-inline`)) === inColumn(".workspace-diff-line.diff-add")).toBeTrue();
      expect(inline() === field).toBeTrue();
      expectSameNode(document.activeElement, field);
      // The next words go after the ones already there, not in front of them.
      expect(caret(field)).toEqual([9, 9]);
    });
  }

  test("its own line pressed again resumes it the same way", async () => {
    await boot();
    await writeInColumn("draft one");
    await resize(800);
    await readerActs("pointerdown");
    await resize(1440);
    const field = inline()!;
    field.setSelectionRange(0, 0);
    await press(inColumn(".workspace-diff-line.diff-add"));
    expectSameNode(document.activeElement, field);
    expect(caret(field)).toEqual([9, 9]);
  });

  test("a note set aside or cancelled with the keyboard in it does not take the keyboard later", async () => {
    await boot();
    await writeInColumn("draft one");
    await act(async () => { escapeKey(inline()!); });
    await settle();
    expect(columnCard()).not.toBeNull();
    await resize(800);
    await resize(1440);
    expect(inline()).toBeNull();
    expect(columnCard()).not.toBeNull();
  });

  test("an editor that never left keeps the caret where the reader put it", async () => {
    await boot();
    await writeInColumn("draft one");
    const field = inline()!;
    await act(async () => {
      field.setSelectionRange(5, 5);
      field.blur();
    });
    await press(inColumn(".workspace-diff-line.diff-delete"));
    expectSameNode(document.activeElement, field);
    expect(caret(field)).toEqual([5, 5]);
  });
});

describe("an answer on either side lets go of the note on both", () => {
  /** A note set aside in the column, shown on the screen as its card. */
  async function parked(text: string): Promise<void> {
    await boot();
    await setAsideInColumn(text);
    await resize(800);
    await openScreen();
    expect(card()).not.toBeNull();
  }

  /** A note left open in the column, shown on the screen in its form. */
  async function open(text: string): Promise<void> {
    await boot();
    await writeInColumn(text);
    await resize(800);
    await openScreen();
    expect(screenField()?.value).toBe(text);
  }

  async function backInColumn(): Promise<void> {
    await leaveScreen();
    await resize(1440);
  }

  test("Cancel on the card", async () => {
    await parked("never mind");
    await press(onScreen(`${UNDER} .diff-note-discard`));
    expect(card()).toBeNull();
    expect(diffNotesFor("app.ts", "worktree")).toHaveLength(0);
    await backInColumn();
    expect(inline()).toBeNull();
    expect(column()?.querySelector(`${UNDER} .workspace-diff-note`)).toBeNull();
  });

  test("Save on the card saves the words as they stand", async () => {
    await parked("  keep this  ");
    await press(onScreen(`${UNDER} .diff-note-keep`));
    expect(card()).toBeNull();
    expect(diffNotesFor("app.ts", "worktree").map((note) => [note.line, note.body])).toEqual([[2, "keep this"]]);
    expect(onScreen(`${UNDER} .workspace-diff-note .diff-note-body`).textContent).toBe("keep this");
    expect(onScreen(".workspace-notes-count").textContent).toBe("1 条批注待发送");
    await backInColumn();
    expect(inline()).toBeNull();
    expect(inColumn(`${UNDER} .workspace-diff-note`).textContent).toContain("keep this");
  });

  test("Cancel in the screen's form", async () => {
    await open("never mind");
    await type(screenField()!, "never mind at all");
    await press(onScreen(`${UNDER} .diff-note-inline-cancel`));
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    await backInColumn();
    expect(inline()).toBeNull();
    expect(columnCard()).toBeNull();
  });

  test("Save in the screen's form", async () => {
    await open("almost");
    await type(screenField()!, "almost there");
    await change(() => { screenField()!.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["almost there"]);
    await backInColumn();
    expect(inline()).toBeNull();
    expect(inColumn(`${UNDER} .workspace-diff-note`).textContent).toContain("almost there");
  });

  test("Save or Cancel in the column, for a note the screen was showing", async () => {
    await open("in the column");
    await backInColumn();
    await press(inColumn(`${UNDER} .diff-note-inline-cancel`));
    await resize(800);
    await openScreen();
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();

    await backInColumn();
    await writeInColumn("saved in the column");
    await change(() => { inline()!.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    await resize(800);
    await openScreen();
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    expect(onScreen(`${UNDER} .workspace-diff-note .diff-note-body`).textContent).toBe("saved in the column");
  });
});

describe("the screen's form around a note in progress", () => {
  test("one press on the card opens the form on the words, ready to go on", async () => {
    await boot();
    await setAsideInColumn("half written");
    await resize(800);
    await openScreen();
    await press(onScreen(`${UNDER} .diff-note-resume`));
    expect(screenField()?.value).toBe("half written");
    expectSameNode(document.activeElement, screenField());
    expect([screenField()?.selectionStart, screenField()?.selectionEnd]).toEqual([12, 12]);
    expect(onScreen(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeFalse();
    expect(onScreen(`${UNDER} form.diff-note-inline .diff-note-count`).textContent).toBe("12 / 2000");
    // The form shows it now, so the card does not say it twice.
    expect(card()).toBeNull();
  });

  test("another line pressed while one is half written goes to that note, where it is", async () => {
    await boot();
    await writeInColumn("not dropped");
    await resize(800);
    await openScreen();
    const field = screenField()!;
    await press(onScreen(".workspace-diff-line.diff-delete"));
    // Still the one note of this diff, under the line it was written on, and now with the keyboard.
    expect(appRoot().querySelectorAll(`.workspace-shell ${UNDER} form.diff-note-inline`)).toHaveLength(1);
    expect(screenField() === field).toBeTrue();
    expect(field.value).toBe("not dropped");
    expect(lineOver(field.closest("form")) === onScreen(".workspace-diff-line.diff-add")).toBeTrue();
    expectSameNode(document.activeElement, field);
  });

  test("an edit of a saved note, set aside, waits beside the note it would replace", async () => {
    await boot();
    await writeInColumn("first");
    await change(() => { inline()!.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    await press(inColumn(".workspace-diff-line.diff-add"));
    expect(inline()?.value).toBe("first");
    await type(inline()!, "first, reworded");
    await escape(inline()!);
    await resize(800);
    await openScreen();
    const cards = [...appRoot().querySelectorAll(`.workspace-shell ${UNDER} .workspace-diff-note`)];
    expect(cards.map((item) => [item.classList.contains("is-draft"), item.querySelector(".diff-note-body")?.textContent]))
      .toEqual([[false, "first"], [true, "first, reworded"]]);
    expect(card()?.querySelector(".diff-note-resume")?.getAttribute("aria-label")).toBe("编辑第 2 行的批注");
    await press(onScreen(`${UNDER} .diff-note-keep`));
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["first, reworded"]);
    expect(card()).toBeNull();
  });

  test("an edit of a saved note left open takes the note's place on the screen, as in the column", async () => {
    await boot();
    await writeInColumn("first");
    await change(() => { inline()!.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    await press(inColumn(".workspace-diff-line.diff-add"));
    await type(inline()!, "first, reworded");
    await resize(800);
    await openScreen();
    expect(screenField()?.value).toBe("first, reworded");
    expect(onScreen(`${UNDER} form.diff-note-inline`).getAttribute("aria-label")).toBe("编辑第 2 行的批注");
    expect(appRoot().querySelector(`.workspace-shell ${UNDER} .workspace-diff-note`)).toBeNull();
    // Cancel puts the saved note back as it was.
    await press(onScreen(`${UNDER} .diff-note-inline-cancel`));
    expect(onScreen(`${UNDER} .workspace-diff-note .diff-note-body`).textContent).toBe("first");
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["first"]);
  });

  test("an editor left open with nothing written is still open, empty, and moves to the line that is pressed", async () => {
    await boot();
    await press(inColumn(".workspace-diff-line.diff-add"));
    expect(inline()?.value).toBe("");
    await resize(800);
    await openScreen();
    expect(card()).toBeNull();
    expect(screenField()?.value).toBe("");
    expect(lineOver(screenField()) === onScreen(".workspace-diff-line.diff-add")).toBeTrue();
    // Nothing would be lost, so another line simply takes the form.
    await press(onScreen(".workspace-diff-line.diff-delete"));
    expect(appRoot().querySelectorAll(`.workspace-shell ${UNDER} form.diff-note-inline`)).toHaveLength(1);
    expect(screenField()?.value).toBe("");
    expect(lineOver(screenField()) === onScreen(".workspace-diff-line.diff-delete")).toBeTrue();
    expect(onScreen(`${UNDER} form.diff-note-inline`).getAttribute("aria-label")).toBe("给第 2 行写批注");
  });

  test("with no note in progress a press opens it empty, and nothing is kept after Cancel", async () => {
    await boot();
    await resize(800);
    await openScreen();
    expect(card()).toBeNull();
    expect(screenField()).toBeNull();
    await press(onScreen(".workspace-diff-line.diff-add"));
    expect(screenField()?.value).toBe("");
    expectSameNode(document.activeElement, screenField());
    expect(onScreen(`${UNDER} .diff-note-inline-save`).hasAttribute("disabled")).toBeTrue();
    await type(screenField()!, "typed, then cancelled");
    await press(onScreen(`${UNDER} .diff-note-inline-cancel`));
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    await press(onScreen(".workspace-diff-line.diff-add"));
    expect(screenField()?.value).toBe("");
  });
});

describe("Escape leaves an editor without an answer, like every other way out", () => {
  test("on the screen the words wait under their line, and Cancel is still what drops them", async () => {
    await boot();
    await resize(800);
    await openScreen();
    await press(onScreen(".workspace-diff-line.diff-delete"));
    await type(screenField()!, "begun on the screen");
    await escape(screenField()!);

    expect(screenField()).toBeNull();
    // The diff under the note stayed open: the key was the note's.
    expect(workspaceModel.view).toBe("diff");
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("begun on the screen");
    expect(lineOver(card()) === onScreen(".workspace-diff-line.diff-delete")).toBeTrue();
    expect(diffNotesFor("app.ts", "worktree")).toHaveLength(0);

    await press(onScreen(`${UNDER} .diff-note-resume`));
    expect(screenField()?.value).toBe("begun on the screen");
    await press(onScreen(`${UNDER} .diff-note-inline-cancel`));
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
  });

  test("a note left with Escape on the screen is the same card in the column", async () => {
    await boot();
    await writeInColumn("half written");
    await resize(800);
    await openScreen();
    await escape(screenField()!);
    expect(screenField()).toBeNull();
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("half written");

    // The reader closed the editor, so the column does not open one either.
    await leaveScreen();
    await resize(1440);
    expect(inline()).toBeNull();
    expect(columnCard()?.querySelector(".diff-note-body")?.textContent).toBe("half written");
  });

  test("set aside in the column, it is the same card on the screen and back", async () => {
    await boot();
    await setAsideInColumn("aside");

    await change(() => expandWorkspaceInspector());
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("aside");
    await leaveScreen();
    expect(inline()).toBeNull();
    expect(columnCard()?.querySelector(".diff-note-body")?.textContent).toBe("aside");

    // Taken up again on the screen and left when the screen goes: the editor was open, so the column opens it.
    await change(() => expandWorkspaceInspector());
    await press(onScreen(`${UNDER} .diff-note-resume`));
    await type(screenField()!, "aside, and more");
    await leaveScreen();
    expect(columnCard()).toBeNull();
    expect(inline()?.value).toBe("aside, and more");
  });

  test("on the screen the key counts wherever focus is: the note is set aside before the diff closes", async () => {
    await boot();
    await resize(800);
    await openScreen();
    await press(onScreen(".workspace-diff-line.diff-delete"));
    await type(screenField()!, "tabbed past the last control");
    // Focus has left the form for <body>: the screen's own Escape answers, and the note is what is on top.
    await act(async () => { screenField()!.blur(); });
    await escape(document.body);
    expect(screenField()).toBeNull();
    expect(workspaceModel.view).toBe("diff");
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("tabbed past the last control");
    // With the note out of the way the next press closes the diff.
    await escape(document.body);
    expect(workspaceModel.view).toBe("browser");
  });

  test("an empty form just closes", async () => {
    await boot();
    await resize(800);
    await openScreen();
    await press(onScreen(".workspace-diff-line.diff-add"));
    await escape(screenField()!);
    expect(screenField()).toBeNull();
    expect(card()).toBeNull();
    expect(workspaceModel.view).toBe("diff");
  });
});
