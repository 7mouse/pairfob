import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { expectDifferentNode, expectSameNode } from "../../../test-support/node-identity";
import { commitTest, mountTestApp, unmountTestApp } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../app/dom-root";
import { disposeNoticeLifecycle } from "../../app/notices-store";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { clearAllDiffNotes, diffNotesFor } from "../../lib/diff-notes";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { bindOverlayOrigin } from "../../shared/ui/overlay/origin";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities, setOperationBusy } from "../operations/capabilities-store";
import { selectPane, setAgentChat, setFullTerminal } from "../session/session-store";
import { clearWorkspacePendingReveal, enterWorkspace, leaveWorkspace, workspaceModel } from "./index";
import { closeWorkspaceInspector, toggleWorkspaceInspector } from "./inspector";

/**
 * Where the keyboard is after a note's card or its form is answered. The card
 * of a half-written note leaves when it is saved, cancelled or opened into the
 * form, the form leaves with its answer, and a saved note's card leaves with
 * the note: the control that was pressed is gone, and the line the note
 * belongs to takes focus. For a mouse or the keyboard beside the list; a
 * finger, and a phone, are left as they were.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const revision = "a".repeat(64);
const PATCH = "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n";
let release: () => void = () => {};

function liveFixture() {
  return {
    isConnected: () => true,
    paneRead: async () => ({ text: "", hash: "h" }),
    workspaceOpen: async () => ({
      name: "repo",
      root: "/work/p1",
      features: { files: true, git_status: true, git_diff: true, git_branches: true },
      git: { name: "repo", branch: "main", head: "1234567890", detached: false },
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
    gitBranches: async () => ({ items: [], truncated: false, revision }),
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

type Input = "mouse" | "touch";

async function boot(width: number): Promise<void> {
  happy.happyDOM.setWindowSize({ width, height: 900 });
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
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/p1", agent: "codex", agent_status: "idle" as const }],
    });
    attachLiveSession(liveFixture() as never);
    mountTestApp();
    commitTest();
  });
}

function one<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = appRoot().querySelector<T>(selector) ?? document.querySelector<T>(`dialog[open] ${selector}`);
  if (!found) throw new Error(`missing ${selector}: ${appRoot().innerHTML.slice(0, 300)}`);
  return found;
}

const focused = () => document.activeElement as HTMLElement | null;
/** The added line's own button: its number. */
const line = () => one<HTMLButtonElement>(".workspace-diff-line.diff-add .diff-comment-btn");
const draftCard = () => appRoot().querySelector<HTMLElement>(".workspace-diff-note.is-draft");
const savedCard = () => appRoot().querySelector<HTMLElement>(".workspace-diff-note:not(.is-draft)");
/** The note form open under its line. */
const form = () => appRoot().querySelector<HTMLFormElement>("form.diff-note-inline");

/** A press as the engine delivers one: the pointer, focus on the pressed button, the click. */
async function press(target: HTMLElement, input: Input = "mouse"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true, pointerType: input }) as unknown as Event);
    target.focus();
    target.click();
  });
  await settle();
}

async function type(text: string): Promise<void> {
  const field = form()!.querySelector<HTMLTextAreaElement>("textarea.diff-note-body-field")!;
  await act(async () => {
    field.value = text;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

/** Escape in the open form's field. */
async function escapeForm(): Promise<void> {
  const field = form()!.querySelector("textarea")!;
  await act(async () => {
    field.dispatchEvent(new happy.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event);
  });
  await settle();
}

/** The files screen on the one changed file's diff. */
async function openDiffOnScreen(width: number, input: Input = "mouse"): Promise<void> {
  await boot(width);
  await act(async () => { await enterWorkspace("p1"); });
  await settle();
  expect(workspaceModel.tab).toBe("changes");
  await press(one('[data-change="worktree:app.ts"]'), input);
  expect(currentScreen()).toBe("workspace");
  expect(workspaceModel.view).toBe("diff");
}

/** A note begun on the added line and left with Escape: its card waits under the line. */
async function leaveHalfWritten(input: Input = "mouse"): Promise<void> {
  await press(line(), input);
  await type("half written");
  await escapeForm();
  expect(form()).toBeNull();
  expect(draftCard()?.querySelector(".diff-note-body")?.textContent).toBe("half written");
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  seedRestorer.capture();
  release = bindOverlayOrigin(document);
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
  release();
  appRoot().replaceChildren();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

describe("the form opened from a half-written note's card, with a mouse on the files screen", () => {
  for (const width of [800, 720]) {
    test(`Cancel drops the note and focus is on its line (${width}px)`, async () => {
      await openDiffOnScreen(width);
      await leaveHalfWritten();
      await press(draftCard()!.querySelector<HTMLElement>(".diff-note-resume")!);
      // The words are back in the form, under the same line, and no dialog covers the diff.
      expect(form()?.querySelector("textarea")?.value).toBe("half written");
      expect(document.querySelector("dialog[open]")).toBeNull();
      await press(form()!.querySelector<HTMLElement>(".diff-note-inline-cancel")!);
      expect(form()).toBeNull();
      expect(draftCard()).toBeNull();
      expectSameNode(focused(), line());
    });
  }

  test("Escape sets it aside again, and focus is on its line with the card under it", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    expectSameNode(focused(), line());
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-resume")!);
    await escapeForm();
    expect(draftCard()).not.toBeNull();
    expectSameNode(focused(), line());
  });

  test("Save keeps the note and focus is on its line", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-resume")!);
    await press(form()!.querySelector<HTMLElement>(".diff-note-inline-save")!);
    expect(form()).toBeNull();
    expect(diffNotesFor("app.ts", "worktree").map((note) => note.body)).toEqual(["half written"]);
    expectSameNode(focused(), line());
  });
});

describe("a note's card answered in place, with a mouse on the files screen", () => {
  test("the half-written card's own Save and Cancel leave focus on the line", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    expect(draftCard()).toBeNull();
    expect(savedCard()?.querySelector(".diff-note-body")?.textContent).toBe("half written");
    expectSameNode(focused(), line());

    await act(async () => { clearAllDiffNotes(); });
    await leaveScreenAndReturn();
    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-discard")!);
    expect(draftCard()).toBeNull();
    expect(savedCard()).toBeNull();
    expectSameNode(focused(), line());
  });

  test("a saved note deleted from its card, or from its form, leaves focus on the line", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    const [edit, remove] = [...savedCard()!.querySelectorAll<HTMLElement>(".diff-note-action")];
    await press(remove);
    expect(savedCard()).toBeNull();
    expectSameNode(focused(), line());

    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    expect(edit.isConnected).toBeFalse();
    await press(savedCard()!.querySelector<HTMLElement>(".diff-note-action")!);
    await press(form()!.querySelector<HTMLElement>(".diff-note-remove")!);
    expect(form()).toBeNull();
    expect(savedCard()).toBeNull();
    expectSameNode(focused(), line());
  });

  test("an edit that is cancelled puts the saved note back under the line, and focus on the line", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    // The form takes the card's place while the note is edited, so Edit itself is gone with it.
    await press(savedCard()!.querySelector<HTMLElement>(".diff-note-action")!);
    expect(form()?.querySelector("textarea")?.value).toBe("half written");
    expect(savedCard()).toBeNull();
    await press(form()!.querySelector<HTMLElement>(".diff-note-inline-cancel")!);
    expect(form()).toBeNull();
    expect(savedCard()?.querySelector(".diff-note-body")?.textContent).toBe("half written");
    expectSameNode(focused(), line());
  });
});

describe("the keyboard takes the same way back", () => {
  test("Enter on the card, then Escape: focus is on the line, not on the screen's Back", async () => {
    await openDiffOnScreen(800);
    await leaveHalfWritten();
    const resume = draftCard()!.querySelector<HTMLElement>(".diff-note-resume")!;
    await act(async () => {
      resume.focus();
      resume.dispatchEvent(new happy.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
      resume.click();
    });
    await settle();
    await escapeForm();
    expect(draftCard()).not.toBeNull();
    expectSameNode(focused(), line());
  });
});

describe("touch and the phone are unchanged: no line is focused for them", () => {
  test("a finger at 800px answers the card and its form, and focus is left where it fell", async () => {
    await openDiffOnScreen(800, "touch");
    // (The note is set aside with Escape, which is a key: what follows is the finger's.)
    await leaveHalfWritten("touch");
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-resume")!, "touch");
    // A finger writes in the same form, under the line.
    expect(form()?.querySelector("textarea")?.value).toBe("half written");
    await press(form()!.querySelector<HTMLElement>(".diff-note-inline-cancel")!, "touch");
    expect(form()).toBeNull();
    expectDifferentNode(focused(), line());

    await leaveHalfWritten("touch");
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!, "touch");
    expect(savedCard()).not.toBeNull();
    expectDifferentNode(focused(), line());
    await press([...savedCard()!.querySelectorAll<HTMLElement>(".diff-note-action")][1], "touch");
    expect(savedCard()).toBeNull();
    expectDifferentNode(focused(), line());
  });

  test("a mouse on the phone layout (390px) is left alone too", async () => {
    await openDiffOnScreen(390);
    await leaveHalfWritten();
    expectDifferentNode(focused(), line());
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    expect(savedCard()).not.toBeNull();
    expectDifferentNode(focused(), line());
    await press([...savedCard()!.querySelectorAll<HTMLElement>(".diff-note-action")][1]);
    expect(savedCard()).toBeNull();
    expectDifferentNode(focused(), line());
  });
});

describe("beside the session the card under a line answers the same way", () => {
  test("the column's half-written card saved with a mouse leaves focus on its line, inside the column", async () => {
    await boot(1440);
    await act(async () => { toggleWorkspaceInspector(); });
    await settle();
    await press(one('aside.inspector [data-change="worktree:app.ts"]'));
    await press(line());
    await type("in the column");
    await escapeForm();
    expect(draftCard()?.closest("aside.inspector")).not.toBeNull();
    await press(draftCard()!.querySelector<HTMLElement>(".diff-note-keep")!);
    expect(savedCard()?.querySelector(".diff-note-body")?.textContent).toBe("in the column");
    expectSameNode(focused(), line());
    expect(line().closest("aside.inspector")).not.toBeNull();
  });
});

/** Off the screen and on again: the diff is drawn anew, as after any visit to the session. */
async function leaveScreenAndReturn(): Promise<void> {
  await act(async () => { leaveWorkspace(); commitTest(); });
  await settle();
  await act(async () => { await enterWorkspace("p1"); });
  await settle();
  expect(workspaceModel.view).toBe("diff");
}
