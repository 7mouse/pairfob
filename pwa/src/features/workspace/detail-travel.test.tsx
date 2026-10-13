import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen } from "../../../test-support/workspace-harness";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { stepWorkspaceDiff } from "./actions";
import { arrivingDirectly } from "./detail-travel";
import { clearWorkspacePendingReveal, enterWorkspace, getWorkspaceSnapshot, loadGitDiff, loadWorkspaceFile, refreshWorkspace } from "./index";

/**
 * One pane at a time, the reader's own step from the list into a file or a
 * diff, and back, travels like a change of screen. The shell is marked for the
 * length of the move and the pane on its way out is kept, out of reach. A pane
 * that changes for any other reason (the screen opening on the detail it was
 * left at, a refresh, a link that opens the screen on a file) is drawn where it
 * stands, and so is everything from 900px, where the two are side by side.
 */

const live = () => ({
  isConnected: () => true,
  workspaceOpen: async () => ({
    name: "pairfob", root: "/work/pairfob",
    features: { files: true, git_status: true, git_diff: true, git_branches: false },
    git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
  }),
  workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
  workspaceRead: async (_pane: string, path: string) => ({
    path, kind: "text" as const, size: 10, modified_ms: 1, content: "export {};\n", truncated: false, revision: "f".repeat(64),
  }),
  gitStatus: async () => ({
    branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
    changes: [
      { path: "src/app.ts", original_path: null, index: " ", worktree: "M" },
      { path: "src/b.ts", original_path: null, index: " ", worktree: "M" },
    ],
  }),
  gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
    path, layer, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c\n", additions: 2, deletions: 1, binary: false, truncated: false, revision: "1".repeat(64),
  }),
});

const shell = () => one(".workspace-shell");
const list = () => one(".workspace-nav");
const detail = () => one(".workspace-main");
const row = (path: string) => one(`[data-change="worktree:${path}"]`);
const wait = (ms: number) => act(async () => { await new Promise<void>((done) => window.setTimeout(done, ms)); });
/** A press whose first paint is what is asked about: drawn before this returns, so no clock runs in between. */
const tap = (target: HTMLElement): void => { act(() => { target.click(); }); };
/** Escape as the screen hears it, drawn before this returns. */
const escape = (): void => {
  act(() => { document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
};
/** Long enough for a screen's move to be over. */
const settled = () => wait(MOTION_MS.screen + 60);

/** Every class the shell is given from now on, so a mark that came and went is still seen. */
function watchShell(): { marks: () => string[]; stop: () => void } {
  const seen: string[] = [];
  const watch = new MutationObserver(() => { seen.push(shell().className); });
  watch.observe(shell(), { attributes: true, attributeFilter: ["class"] });
  return { marks: () => [...seen, shell().className].filter((name) => name.includes("is-detail-")), stop: () => watch.disconnect() };
}

type Media = typeof window.matchMedia;
let realMedia: Media | null = null;

/** A reader who asked for less motion, in a window that is still as wide as it was. */
function reduceMotion(): void {
  const real = window.matchMedia.bind(window);
  realMedia = window.matchMedia;
  const reduced = ((query: string) => query.includes("prefers-reduced-motion")
    ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
    : real(query)) as unknown as Media;
  window.matchMedia = reduced;
  globalThis.matchMedia = reduced;
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
});

afterEach(async () => {
  await teardownWorkspaceScreen();
  if (realMedia) {
    window.matchMedia = realMedia;
    globalThis.matchMedia = realMedia;
    realMedia = null;
  }
});

describe("the reader's step between the list and what it opened", () => {
  test("a pressed row: the detail arrives over the list, which steps back out of reach, and then both stand", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    expect(shell().className).toBe("workspace-shell");
    tap(row("src/app.ts"));
    expect(getWorkspaceSnapshot().view).toBe("diff");
    expect(shell().className).toBe("workspace-shell detail is-detail-arriving");
    // The list is still drawn for its way back, and nothing in it can be pressed or tabbed to.
    expect(list().hasAttribute("inert")).toBeTrue();
    expect(list().querySelector("[data-change]")).not.toBeNull();
    expect(detail().hasAttribute("inert")).toBeFalse();
    await settled();
    expect(shell().className).toBe("workspace-shell detail");
    expect(list().hasAttribute("inert")).toBeFalse();
  });

  test("Back: the detail leaves as it was last drawn, out of reach, over the list that is already the reader's", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    await press(row("src/app.ts"));
    await settled();
    const lines = one(".workspace-main .workspace-diff");
    tap(one(".workspace-chrome .back"));
    expect(getWorkspaceSnapshot().view).toBe("browser");
    expect(shell().className).toBe("workspace-shell is-detail-leaving");
    // The store has no diff any more; the pane on its way out still shows the one it had.
    expect(getWorkspaceSnapshot().diff).toBeNull();
    expect(one(".workspace-main .workspace-diff") === lines).toBeTrue();
    expect(lines.querySelectorAll(".workspace-diff-line")).toHaveLength(3);
    expect(detail().hasAttribute("inert")).toBeTrue();
    expect(list().hasAttribute("inert")).toBeFalse();
    await settled();
    expect(shell().className).toBe("workspace-shell");
    expect(document.querySelector(".workspace-main .workspace-diff")).toBeNull();
    expect(detail().hasAttribute("inert")).toBeFalse();
  });

  test("Escape is the same step back", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    await press(row("src/app.ts"));
    await settled();
    escape();
    expect(shell().className).toBe("workspace-shell is-detail-leaving");
  });

  test("a step taken back before the last one is over starts from where the panes are told to be", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    tap(row("src/app.ts"));
    expect(shell().className).toBe("workspace-shell detail is-detail-arriving");
    tap(one(".workspace-chrome .back"));
    expect(shell().className).toBe("workspace-shell is-detail-leaving");
    expect(list().hasAttribute("inert")).toBeFalse();
    await settled();
    expect(shell().className).toBe("workspace-shell");
  });
});

describe("a pane that changed for another reason stands still", () => {
  test("the screen entered again on the diff it was left at", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    await press(row("src/app.ts"));
    await settled();
    const seen = watchShell();
    await act(async () => { await enterWorkspace("p1"); });
    await settle();
    expect(getWorkspaceSnapshot().view).toBe("diff");
    expect(shell().classList.contains("detail")).toBeTrue();
    expect(seen.marks()).toEqual([]);
    seen.stop();
  });

  test("a refresh empties the screen and puts the diff back", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    await press(row("src/app.ts"));
    await settled();
    const seen = watchShell();
    await act(async () => { await refreshWorkspace(); });
    await settle();
    expect(getWorkspaceSnapshot().view).toBe("diff");
    expect(seen.marks()).toEqual([]);
    expect(list().hasAttribute("inert")).toBeFalse();
    expect(detail().hasAttribute("inert")).toBeFalse();
    seen.stop();
  });

  test("the open diff read again, and the step to the next file: the pane stays", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    await press(row("src/app.ts"));
    await settled();
    const seen = watchShell();
    await act(async () => { await loadGitDiff("src/app.ts", "worktree"); });
    await act(async () => { stepWorkspaceDiff(1); });
    await settle();
    expect(getWorkspaceSnapshot().detailPath).toBe("src/b.ts");
    expect(seen.marks()).toEqual([]);
    seen.stop();
  });

  test("a file the screen arrives on, as a link in the session opens it", async () => {
    await bootWorkspaceScreen(live(), { width: 390 });
    const seen = watchShell();
    await act(async () => { await arrivingDirectly(() => loadWorkspaceFile("src/app.ts")); });
    await settle();
    expect(getWorkspaceSnapshot().view).toBe("file");
    expect(shell().className).toBe("workspace-shell detail");
    expect(seen.marks()).toEqual([]);
    // The reader's own step back from it travels as any does.
    tap(one(".workspace-chrome .back"));
    expect(shell().className).toBe("workspace-shell is-detail-leaving");
    seen.stop();
  });

  test("side by side, from 900px, nothing travels and nothing is put out of reach", async () => {
    await bootWorkspaceScreen(live(), { width: 1280 });
    const seen = watchShell();
    await press(row("src/app.ts"));
    expect(shell().className).toBe("workspace-shell detail");
    expect(list().hasAttribute("inert")).toBeFalse();
    await key("Escape");
    expect(shell().className).toBe("workspace-shell");
    expect(detail().hasAttribute("inert")).toBeFalse();
    expect(seen.marks()).toEqual([]);
    seen.stop();
  });
});

describe("for a reader who asked for less motion", () => {
  test("the shell is marked for the fade, and the pane that leaves is gone at once", async () => {
    reduceMotion();
    await bootWorkspaceScreen(live(), { width: 390 });
    tap(row("src/app.ts"));
    expect(shell().className).toBe("workspace-shell detail is-detail-arriving");
    expect(list().hasAttribute("inert")).toBeFalse();
    await wait(MOTION_MS.element + 60);
    await settle();
    expect(shell().className).toBe("workspace-shell detail");
    tap(one(".workspace-chrome .back"));
    expect(shell().className).toBe("workspace-shell is-detail-leaving");
    expect(detail().hasAttribute("inert")).toBeFalse();
    expect(document.querySelector(".workspace-main .workspace-diff")).toBeNull();
  });
});

describe("the style sheet", () => {
  test("travels the two panes as the app's screens travel, below 900px only, and only fades without motion", async () => {
    const css = await Bun.file(new URL("./workspace.scss", import.meta.url)).text();
    const from = css.indexOf("@media (max-width: 899.98px) {\n  .workspace-body { position: relative; }");
    expect(from).toBeGreaterThan(0);
    const block = css.slice(from, css.indexOf("\n}\n", from));
    expect(block).toContain(".workspace-shell.is-detail-arriving .workspace-nav { animation: screen-behind var(--dur-4) var(--ease) both; }");
    expect(block).toContain(".workspace-shell.is-detail-arriving .workspace-main { z-index: 1; animation: screen-from-right var(--dur-4) var(--ease); }");
    expect(block).toContain(".workspace-shell.is-detail-leaving .workspace-nav { animation: screen-forward var(--dur-4) var(--ease); }");
    expect(block).toContain(".workspace-shell.is-detail-leaving .workspace-main { z-index: 1; animation: screen-to-right var(--dur-4) var(--ease) both; }");
    // Nothing outside that query names the marks, so from 900px they do nothing.
    const outside = css.slice(0, from) + css.slice(css.indexOf("@media (min-width: 900px)", from));
    expect(outside).not.toContain("is-detail-");
    const reduced = css.slice(css.indexOf("@media (max-width: 899.98px) and (prefers-reduced-motion: reduce) {"));
    const still = reduced.slice(0, reduced.indexOf("\n}\n"));
    expect(still).toContain(".workspace-shell.is-detail-leaving .workspace-main { display: none; animation: none; }");
    expect(still).toContain("animation: workspace-reveal var(--dur-2) var(--ease);");
    expect(still).not.toContain("screen-");
  });
});
