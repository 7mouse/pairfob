import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { resetWorkspaceWrap, setWorkspaceWrap, workspaceWrap } from "./prefs";

/**
 * Long lines wrap by default under a finger and stay whole under a mouse; the
 * reader's own choice then holds on this device, whatever the pointer.
 */

const realMatchMedia = window.matchMedia;

function pointer(fine: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: fine") ? fine : false,
    media: query, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(async () => {
  await resetBoardTestDOM();
  resetWorkspaceWrap();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

test("under a finger long lines wrap until the reader says otherwise", () => {
  pointer(false);
  expect(workspaceWrap()).toBeTrue();
  setWorkspaceWrap(false);
  expect(workspaceWrap()).toBeFalse();
  expect(localStorage.getItem("pairfob.workspace.wrap")).toBe("0");
});

test("under a mouse they stay whole until the reader says otherwise", () => {
  pointer(true);
  expect(workspaceWrap()).toBeFalse();
  setWorkspaceWrap(true);
  expect(workspaceWrap()).toBeTrue();
});

test("the default follows the pointer, and a choice does not", () => {
  pointer(false);
  expect(workspaceWrap()).toBeTrue();
  pointer(true);
  expect(workspaceWrap()).toBeFalse();
  setWorkspaceWrap(true);
  pointer(false);
  expect(workspaceWrap()).toBeTrue();
  pointer(true);
  expect(workspaceWrap()).toBeTrue();
});
