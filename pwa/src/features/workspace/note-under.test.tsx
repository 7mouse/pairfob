import { act } from "react";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { expectSameNode } from "../../../test-support/node-identity";
import { all, bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen, type } from "../../../test-support/workspace-harness";
import { clearAllDiffNotes, diffNotesFor } from "../../lib/diff-notes";
import { WORKSPACE_CACHE_TTL_MS } from "../../lib/workspace-cache";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { clearWorkspacePendingReveal, loadGitDiff } from "./index";
import { clearOpenNotes } from "./note-drafts";

/**
 * What a note keeps under its line comes and goes by height: the form opens
 * under the pressed line and folds shut when it is answered, a saved note's
 * card opens in its place and a deleted one's folds away, and the bar of notes
 * to send leaves the way it came. What left is kept for that, as it was and
 * out of reach. Only the reader's own change moves: a diff drawn again shows
 * its notes where they are.
 */

/** What stands under a line to be read and pressed. A piece folding shut on its way out is still on the page, and is not that. */
const UNDER = ".diff-note-fold:not(.is-shut)";
/** A piece on its way out. */
const LEAVING = ".diff-note-fold.is-shut";

let revision: string;

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
    changes: [{ path: "src/app.ts", original_path: null, index: " ", worktree: "M" }],
  }),
  gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
    path, layer, patch: "@@ -1,3 +1,3 @@\n keep\n-false\n+true\n tail\n", additions: 1, deletions: 1, binary: false, truncated: false, revision,
  }),
});

const wait = (ms: number) => act(async () => { await new Promise<void>((done) => window.setTimeout(done, ms)); });
/** A press whose first paint is what is asked about: drawn before this returns, so no clock runs in between. */
const tap = (target: HTMLElement): void => { act(() => { target.click(); }); };
/** Long enough for a fold to have shut and let go of what it held. */
const folded = () => wait(MOTION_MS.panel + 80);
const added = () => one(".workspace-diff-line.diff-add");
const form = () => document.querySelector<HTMLFormElement>(`${UNDER} form.diff-note-inline`);
const field = () => one<HTMLTextAreaElement>(`${UNDER} form.diff-note-inline textarea`);
const card = () => document.querySelector<HTMLElement>(`${UNDER} .workspace-diff-note`);
const foldOf = (piece: Element | null) => piece?.closest<HTMLElement>(".diff-note-fold") ?? null;
const bar = () => document.querySelector<HTMLElement>(".workspace-notes-bar");
/** The line a note's form or card stands under: what comes before everything the note keeps there. */
const lineOver = (piece: Element | null | undefined): Element | null => {
  let before = piece?.closest(".diff-note-fold")?.previousElementSibling ?? null;
  while (before?.matches(".diff-note-fold")) before = before.previousElementSibling;
  return before;
};

async function open(width = 390): Promise<void> {
  await bootWorkspaceScreen(live(), { width, capabilities: { prompt_agent: true } });
  await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
  await settle();
}

async function save(body: string): Promise<void> {
  await press(added());
  await type(field(), body);
  await press(one(`${UNDER} .diff-note-inline-save`));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  clearOpenNotes();
  revision = "1".repeat(64);
});
afterEach(async () => {
  setSystemTime();
  await teardownWorkspaceScreen();
  clearAllDiffNotes();
  clearOpenNotes();
});

describe("the form under a line", () => {
  for (const width of [390, 1024, 1440]) {
    test(`opens by height from the press, already able to take the keyboard (${width}px)`, async () => {
      await open(width);
      await press(added());
      const fold = foldOf(form())!;
      // Opening, not shut first: a shut fold is out of reach, and the field must have focus from this press.
      expect(fold.className).toBe("fold fold-appear diff-note-fold");
      expect(fold.hasAttribute("inert")).toBeFalse();
      expect(fold.previousElementSibling === added()).toBeTrue();
      expectSameNode(document.activeElement, field());
    });
  }

  test("Cancel folds it shut: kept as it was, out of reach, then gone", async () => {
    await open();
    await press(added());
    await type(field(), "never mind");
    const fold = foldOf(form())!;
    tap(one(`${UNDER} .diff-note-inline-cancel`));
    expect(form()).toBeNull();
    expect(fold.isConnected).toBeTrue();
    expect(fold.classList.contains("is-shut")).toBeTrue();
    expect(fold.hasAttribute("inert")).toBeTrue();
    // The words it held are still what it shows on the way out, and the keyboard is no longer in it.
    expect(fold.querySelector("textarea")?.value).toBe("never mind");
    expect(fold.contains(document.activeElement)).toBeFalse();
    await folded();
    expect(fold.isConnected).toBeFalse();
    expect(document.querySelector(".diff-note-fold")).toBeNull();
  });

  test("Save folds it shut while the note's card opens in its place", async () => {
    await open();
    await press(added());
    await type(field(), "why true");
    tap(one(`${UNDER} .diff-note-inline-save`));
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(1);
    expect(all(LEAVING).map((fold) => fold.querySelector("form") !== null)).toEqual([true]);
    const fold = foldOf(card())!;
    expect(fold.className).toBe("fold fold-appear diff-note-fold");
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("why true");
    await folded();
    expect(document.querySelector(LEAVING)).toBeNull();
    expect(foldOf(card()) === fold).toBeTrue();
  });

  test("the form opened again while the last one is still folding shut is another form, with the keyboard", async () => {
    await open();
    await press(added());
    const first = foldOf(form())!;
    tap(one(`${UNDER} .diff-note-inline-cancel`));
    tap(added());
    expect(first.isConnected).toBeTrue();
    expect(first.classList.contains("is-shut")).toBeTrue();
    expect(foldOf(form()) === first).toBeFalse();
    expect(foldOf(form())?.className).toBe("fold fold-appear diff-note-fold");
    expectSameNode(document.activeElement, field());
  });
});

describe("a saved note's card", () => {
  test("deleted, it fades and folds away before it is gone, and the line is free again", async () => {
    await open();
    await save("why true");
    await folded();
    const fold = foldOf(card())!;
    tap(all(`${UNDER} .diff-note-action`)[1]);
    expect(diffNotesFor("src/app.ts", "worktree")).toHaveLength(0);
    expect(card()).toBeNull();
    expect(added().classList.contains("has-note")).toBeFalse();
    expect(fold.isConnected).toBeTrue();
    expect(fold.classList.contains("is-shut")).toBeTrue();
    expect(fold.hasAttribute("inert")).toBeTrue();
    expect(fold.querySelector(".diff-note-body")?.textContent).toBe("why true");
    await folded();
    expect(fold.isConnected).toBeFalse();
  });

  test("edited, it gives way to the form, and is back in its place when the edit is left", async () => {
    await open();
    await save("why true");
    await folded();
    const fold = foldOf(card())!;
    tap(one(`${UNDER} .diff-note-action`));
    expect(fold.classList.contains("is-shut")).toBeTrue();
    expect(foldOf(form())?.className).toBe("fold fold-appear diff-note-fold");
    await key("Escape", {}, field());
    expect(form()).toBeNull();
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("why true");
    expect(lineOver(card()) === added()).toBeTrue();
  });

  test("drawn again with its diff, it is simply there: nothing opens that the reader did not change", async () => {
    await open();
    await save("why true");
    await folded();
    const fold = foldOf(card())!;
    // The same patch read again: the same card, so nothing can start over.
    await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
    await settle();
    expect(foldOf(card()) === fold).toBeTrue();
    expect(fold.classList.contains("is-shut")).toBeFalse();
    // Another revision of the file, with the note's line unchanged: the lines are drawn anew, and the card with them.
    revision = "2".repeat(64);
    setSystemTime(new Date(Date.now() + WORKSPACE_CACHE_TTL_MS + 1));
    await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
    await settle();
    expect(foldOf(card()) === fold).toBeFalse();
    expect(card()?.querySelector(".diff-note-body")?.textContent).toBe("why true");
    expect(foldOf(card())?.className).toBe("fold diff-note-fold");
    expect(card()?.classList.contains("is-fresh")).toBeFalse();
    expect(document.querySelector(LEAVING)).toBeNull();
  });
});

describe("the bar of notes to send", () => {
  test("leaves the way it came once the last note is gone: kept as it stood, out of reach, then gone", async () => {
    await open();
    await save("why true");
    await folded();
    expect(bar()?.className).toBe("workspace-notes-bar");
    expect(bar()?.hasAttribute("inert")).toBeFalse();
    const node = bar()!;
    tap(all(`${UNDER} .diff-note-action`)[1]);
    expect(bar() === node).toBeTrue();
    expect(node.className).toBe("workspace-notes-bar is-leaving");
    expect(node.hasAttribute("inert")).toBeTrue();
    expect(node.querySelector(".workspace-notes-count")?.textContent).toBe("1 条批注待发送");
    await wait(MOTION_MS.element + 80);
    expect(bar()).toBeNull();
    // Nothing left to say: the footer is empty again, which is what takes its rule away.
    expect(one(".workspace-diff-footer").childElementCount).toBe(0);
  });

  test("the next note brings it back, in reach", async () => {
    await open();
    await save("why true");
    await folded();
    tap(all(`${UNDER} .diff-note-action`)[1]);
    expect(bar()?.classList.contains("is-leaving")).toBeTrue();
    await save("on second thought");
    expect(bar()?.className).toBe("workspace-notes-bar");
    expect(bar()?.hasAttribute("inert")).toBeFalse();
  });

  test("drawn again with the same notes, it is never marked as leaving", async () => {
    await open();
    await save("why true");
    await folded();
    const node = bar()!;
    await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
    await settle();
    expect(bar() === node).toBeTrue();
    expect(node.className).toBe("workspace-notes-bar");
  });
});

describe("the style sheet", () => {
  test("gives the bar its entrance played back a step quicker, and eases a note that is being sent", async () => {
    const css = await Bun.file(new URL("./workspace-detail.scss", import.meta.url)).text();
    expect(css).toContain("animation: notes-bar-in var(--dur-3) var(--ease);");
    expect(css).toContain(".workspace-notes-bar.is-leaving { animation: notes-bar-out var(--dur-2) var(--ease) both; pointer-events: none; }");
    const frames = (name: string) => css.slice(css.indexOf(`@keyframes ${name} {`), css.indexOf("\n}\n", css.indexOf(`@keyframes ${name} {`)));
    expect(frames("notes-bar-in")).toContain("from { opacity: 0; transform: translateY(40%); }");
    expect(frames("notes-bar-out")).toContain("to { opacity: 0; transform: translateY(40%); }");
    expect(css).toContain(".workspace-diff-note { transition: opacity var(--dur-2) var(--ease); }");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
    expect(reduced.slice(0, reduced.indexOf("\n}\n"))).toContain(".workspace-notes-bar.is-leaving { animation: none; }");
  });
});
