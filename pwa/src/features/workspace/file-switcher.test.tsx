import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { expectDifferentNode, expectSameNode } from "../../../test-support/node-identity";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { bootWorkspaceScreen, key, one, press, settle, teardownWorkspaceScreen, type } from "../../../test-support/workspace-harness";
import { workspaceLive, type FixtureChange } from "../../../test-support/workspace-live-fixture";
import { bindOverlayOrigin } from "../../shared/ui/overlay/origin";
import { openFileSwitcher, SWITCHER_FILTER_MIN } from "./file-switcher";
import { loadGitDiff, workspaceModel } from "./index";

/**
 * The column's file switcher: the changed files as a menu at the file's name,
 * with a filter above it once the list is long. The filter is a field, not a
 * command: it stands outside the menu, takes the keyboard only from a mouse or
 * a key, and its Down and Enter lead into the list it narrowed.
 */

let changes: FixtureChange[];
let release = () => {};

const many = (count: number): FixtureChange[] => Array.from({ length: count }, (_, index) => ({ path: `src/file-${index}.ts`, index: " ", worktree: "M" }));

beforeEach(async () => {
  await resetBoardTestDOM();
  changes = many(SWITCHER_FILTER_MIN + 1);
  release = bindOverlayOrigin(document);
});
afterEach(async () => {
  release();
  await teardownWorkspaceScreen();
});

const menu = () => one<HTMLDialogElement>("dialog.workspace-switcher[open]");
const choices = () => [...menu().querySelectorAll<HTMLElement>(".workspace-switch-row")];
const filter = () => menu().querySelector<HTMLInputElement>(".workspace-switch-filter");

/** Open the switcher on the diff of `src/file-3.ts`, by a press of `pointerType` on a control of the page. */
async function open(pointerType: "mouse" | "touch", width = 1440): Promise<void> {
  await bootWorkspaceScreen(workspaceLive({ changes: () => changes }), { width });
  await act(async () => { await loadGitDiff("src/file-3.ts", "worktree"); });
  await settle();
  const trigger = one("button");
  await act(async () => {
    trigger.dispatchEvent(new happy.PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, isPrimary: true, button: 0, pointerType, clientX: 500, clientY: 100,
    }) as unknown as Event);
    openFileSwitcher(trigger);
  });
  await settle();
}

describe("the file switcher", () => {
  test("a long list of changes gets a filter; a short one does not", async () => {
    await open("mouse");
    expect(choices()).toHaveLength(SWITCHER_FILTER_MIN + 1);
    expect(choices().find((choice) => choice.getAttribute("aria-current"))?.dataset.switch).toBe("worktree:src/file-3.ts");
    await type(filter()!, "file-1");
    expect(choices().map((choice) => choice.dataset.switch)).toEqual(
      ["worktree:src/file-1.ts", "worktree:src/file-10.ts", "worktree:src/file-11.ts", "worktree:src/file-12.ts"]);
    await press(choices()[1]);
    await settle();
    expect(workspaceModel.detailPath).toBe("src/file-10.ts");
  });

  test("it is offered from the thirteenth diff, and a file changed in both layers counts twice", async () => {
    changes = many(SWITCHER_FILTER_MIN);
    await open("mouse");
    expect(filter()).toBeNull();
    await teardownWorkspaceScreen();
    // Eleven files in the working tree and one in both layers: thirteen diffs.
    changes = [...many(SWITCHER_FILTER_MIN - 1), { path: "src/both.ts", index: "M", worktree: "M" }];
    await open("mouse");
    expect(choices()).toHaveLength(SWITCHER_FILTER_MIN + 1);
    expect(filter()).not.toBeNull();
  });

  test("opened with a mouse it is a menu whose commands are the list: the filter stands outside it and has the keyboard", async () => {
    await open("mouse");
    expect(menu().getAttribute("data-popover")).toBe("menu");
    // The body is not the menu: the field in it is not a command.
    expect(menu().querySelector(".sheet-body")!.hasAttribute("role")).toBeFalse();
    const list = one(".workspace-switch-list");
    expect(list.getAttribute("role")).toBe("menu");
    expect(list.contains(filter())).toBeFalse();
    expect(choices().every((choice) => choice.getAttribute("role") === "menuitem" && list.contains(choice))).toBeTrue();
    expectSameNode(document.activeElement, filter());
  });

  test("Down from the filter goes to the open file's row, or to the first where the filter left it out", async () => {
    await open("mouse");
    const down = await key("ArrowDown", {}, filter()!);
    expect(down.defaultPrevented).toBeTrue();
    expect((document.activeElement as HTMLElement).dataset.switch).toBe("worktree:src/file-3.ts");
    await type(filter()!, "file-1");
    await key("ArrowDown", {}, filter()!);
    expect((document.activeElement as HTMLElement).dataset.switch).toBe("worktree:src/file-1.ts");
  });

  test("Enter in the filter opens the first match; with nothing typed, or nothing found, it opens nothing", async () => {
    await open("mouse");
    await key("Enter", {}, filter()!);
    expect(document.querySelector("dialog.workspace-switcher[open]")).not.toBeNull();
    await type(filter()!, "no such file");
    expect(one(".workspace-switch-none").getAttribute("role")).toBe("status");
    await key("Enter", {}, filter()!);
    expect(document.querySelector("dialog.workspace-switcher[open]")).not.toBeNull();
    await type(filter()!, "file-12");
    const enter = await key("Enter", {}, filter()!);
    await settle();
    expect(enter.defaultPrevented).toBeTrue();
    expect(document.querySelector("dialog.workspace-switcher[open]")).toBeNull();
    expect(workspaceModel.detailPath).toBe("src/file-12.ts");
  });

  test("under a finger it is a sheet, and the filter does not take focus by itself: no keyboard rises over the list", async () => {
    await open("touch");
    expect(menu().hasAttribute("data-popover")).toBeFalse();
    expect(filter()).not.toBeNull();
    expectDifferentNode(document.activeElement, filter());
    expect((document.activeElement as HTMLElement).dataset.switch).toBe("worktree:src/file-3.ts");
    // A sheet is not a menu: its rows are plain buttons.
    expect(one(".workspace-switch-list").hasAttribute("role")).toBeFalse();
    // The field is the reader's once they press it, and its keys work the same.
    await type(filter()!, "file-11");
    await key("Enter", {}, filter()!);
    await settle();
    expect(workspaceModel.detailPath).toBe("src/file-11.ts");
  });
});
