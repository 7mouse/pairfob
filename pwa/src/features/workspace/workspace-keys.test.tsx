import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetInputMode } from "../../app/input-mode";
import { expectSameNode } from "../../../test-support/node-identity";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { all, bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen, type } from "../../../test-support/workspace-harness";
import { workspaceLive, type FixtureChange } from "../../../test-support/workspace-live-fixture";
import { loadGitDiff, loadWorkspaceFile, showWorkspaceTab, workspaceModel } from "./index";
import { workspaceWrap } from "./prefs";

/**
 * The keys of the files and changes: along the list, through the changed
 * files, wrapping an open file, sending the notes of an open diff, and what
 * the controls say of them.
 */

let changes: FixtureChange[];
let prompts: string[];
const live = () => workspaceLive({ changes: () => changes, prompts });

const rows = () => all<HTMLButtonElement>(".workspace-row-main, .workspace-change");
const focusOn = async (target: HTMLElement) => { await act(async () => { target.focus(); }); };
const openDiff = async (path: string) => {
  await act(async () => { await loadGitDiff(path, "worktree"); });
  await settle();
};

beforeEach(async () => {
  await resetBoardTestDOM();
  changes = [{ path: "src/app.ts", index: " ", worktree: "M" }, { path: "src/b.ts", index: " ", worktree: "M" }];
  prompts = [];
});
afterEach(async () => {
  await teardownWorkspaceScreen();
  resetInputMode();
});

describe("the list by keyboard", () => {
  test("the arrows move along the rows and stop at the ends; other keys are not the list's", async () => {
    await bootWorkspaceScreen(live(), { tab: "files" });
    const [first, second, third] = rows();
    await focusOn(first);
    expect((await key("ArrowDown", {}, first)).defaultPrevented).toBeTrue();
    expectSameNode(document.activeElement, second);
    await key("ArrowDown", {}, second);
    await key("ArrowDown", {}, third);
    expectSameNode(document.activeElement, third);
    await key("ArrowUp", {}, third);
    expectSameNode(document.activeElement, second);
    expect((await key("x", {}, second)).defaultPrevented).toBeFalse();
    // A key pressed on nothing in particular moves nothing.
    expect((await key("ArrowDown")).defaultPrevented).toBeFalse();
  });

  test("Left climbs one folder on the files tab, and is not a key of the root or of the changes", async () => {
    await bootWorkspaceScreen(live(), { tab: "files" });
    expect((await key("ArrowLeft", {}, rows()[0])).defaultPrevented).toBeFalse();
    await press(rows()[0]);
    expect(workspaceModel.directory).toBe("src");
    expect((await key("ArrowLeft", {}, rows()[0])).defaultPrevented).toBeTrue();
    await settle();
    expect(workspaceModel.directory).toBe("");
  });

  test("Down from the filter goes into the rows it filtered", async () => {
    await bootWorkspaceScreen(live(), { tab: "files" });
    const filter = one<HTMLInputElement>(".workspace-filter-input");
    await focusOn(filter);
    expect((await key("ArrowDown", {}, filter)).defaultPrevented).toBeTrue();
    expectSameNode(document.activeElement, rows()[0]);
    // Any other key typed there is the field's own.
    expect((await key("[", {}, filter)).defaultPrevented).toBeFalse();
  });
});

describe("an open diff or file by keyboard", () => {
  test("[ and ] step through the changed files and stop at the ends", async () => {
    await bootWorkspaceScreen(live());
    await openDiff("src/app.ts");
    expect((await key("[")).defaultPrevented).toBeFalse();
    expect((await key("]")).defaultPrevented).toBeTrue();
    expect(workspaceModel.detailPath).toBe("src/b.ts");
    expect((await key("]")).defaultPrevented).toBeFalse();
    await key("[");
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("a bracket typed on a third level is still a bracket; with Command or Ctrl alone it is another key", async () => {
    await bootWorkspaceScreen(live());
    await openDiff("src/app.ts");
    // AltGr+9 on a German keyboard arrives with Ctrl and Alt; Option+6 on a Mac's with Alt.
    expect((await key("]", { ctrlKey: true, altKey: true, code: "Digit9" })).defaultPrevented).toBeTrue();
    expect(workspaceModel.detailPath).toBe("src/b.ts");
    expect((await key("[", { altKey: true, code: "Digit5" })).defaultPrevented).toBeTrue();
    expect(workspaceModel.detailPath).toBe("src/app.ts");
    expect((await key("]", { metaKey: true })).defaultPrevented).toBeFalse();
    expect((await key("]", { ctrlKey: true })).defaultPrevented).toBeFalse();
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("J and K move along the lines of the diff as the arrows do", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    const lines = all<HTMLButtonElement>(".diff-comment-btn");
    await focusOn(lines[0]);
    await key("j", {}, lines[0]);
    expectSameNode(document.activeElement, lines[1]);
    await key("k", {}, lines[1]);
    expectSameNode(document.activeElement, lines[0]);
  });

  test("Alt+Z wraps an open file: by its letter where Alt leaves the letter alone, by its key where it does not", async () => {
    await bootWorkspaceScreen(live(), { tab: "files" });
    await act(async () => { await loadWorkspaceFile("a.md"); });
    await settle();
    const before = workspaceWrap();
    // A Mac types Ω with Option+Z: the key's place says which it was.
    expect((await key("Ω", { altKey: true, code: "KeyZ" })).defaultPrevented).toBeTrue();
    expect(workspaceWrap()).toBe(!before);
    expect(one(".workspace-code").classList.contains("is-wrap")).toBe(!before);
    // A German keyboard has Z where the US one has Y, and Alt leaves the letter alone there.
    expect((await key("z", { altKey: true, code: "KeyY" })).defaultPrevented).toBeTrue();
    expect(workspaceWrap()).toBe(before);
    // The key labelled Y there sits in the US layout's Z position: it is not this key.
    expect((await key("y", { altKey: true, code: "KeyZ" })).defaultPrevented).toBeFalse();
    expect(workspaceWrap()).toBe(before);
    // In the list it is nobody's key.
    await act(async () => { showWorkspaceTab("files"); });
    await settle();
    expect((await key("Ω", { altKey: true, code: "KeyZ" })).defaultPrevented).toBeFalse();
  });
});

describe("sending the notes of an open diff by keyboard", () => {
  const field = () => one<HTMLTextAreaElement>("form.diff-note-inline textarea");

  test("from the note being typed, the key saves it and sends it with the rest; it does not only save", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await press(one(".diff-delete .diff-comment-btn"));
    await type(field(), "why remove this");
    await press(one(".diff-note-inline-save"));
    await press(one(".diff-add .diff-comment-btn"));
    await type(field(), "and why add that");
    const sent = await key("Enter", { metaKey: true, shiftKey: true }, field());
    expect(sent.defaultPrevented).toBeTrue();
    expect(document.querySelector("form.diff-note-inline")).toBeNull();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("why remove this");
    expect(prompts[0]).toContain("and why add that");
  });

  test("without Shift the key is still the note's own Save", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await press(one(".diff-add .diff-comment-btn"));
    await type(field(), "only saved");
    await key("Enter", { metaKey: true }, field());
    expect(document.querySelector("form.diff-note-inline")).toBeNull();
    expect(prompts).toEqual([]);
    expect(one(".workspace-notes-send").hasAttribute("disabled")).toBeFalse();
  });

  test("an empty note is not saved, says so, and nothing is sent past it", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { prompt_agent: true } });
    await openDiff("src/app.ts");
    await press(one(".diff-delete .diff-comment-btn"));
    await type(field(), "a saved one");
    await press(one(".diff-note-inline-save"));
    await press(one(".diff-add .diff-comment-btn"));
    const sent = await key("Enter", { ctrlKey: true, shiftKey: true }, field());
    expect(sent.defaultPrevented).toBeTrue();
    expect(document.querySelector("form.diff-note-inline")).not.toBeNull();
    expect(prompts).toEqual([]);
  });
});

describe("what a control says of its key", () => {
  const wrap = () => one<HTMLButtonElement>(".workspace-preview-action[aria-pressed]");

  test("nothing where the reader has shown no keyboard; with one, the key in the tooltip and for assistive technology", async () => {
    // Under a finger, with no key pressed: nothing to say.
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      resetInputMode();
      await bootWorkspaceScreen(live(), { tab: "files" });
      await act(async () => { await loadWorkspaceFile("a.md"); });
      await settle();
      expect(wrap().hasAttribute("aria-keyshortcuts")).toBeFalse();
      expect(wrap().title).toBe(wrap().getAttribute("aria-label")!);
    } finally {
      window.matchMedia = realMatchMedia;
      await teardownWorkspaceScreen();
    }
    // A mouse is there, and so is a keyboard.
    await bootWorkspaceScreen(live(), { tab: "files" });
    await act(async () => { await loadWorkspaceFile("a.md"); });
    await settle();
    expect(wrap().getAttribute("aria-keyshortcuts")).toBe("Alt+Z");
    expect(wrap().title).toMatch(/\((Alt\+Z|⌥Z)\)$/u);
    // The name itself stays the plain one.
    expect(wrap().getAttribute("aria-label")).not.toContain("Z");
  });
});
