import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";

/**
 * What the files screen kept on this device is read once, when its module
 * loads. Whatever is found there that is not a width (another version's value,
 * a hand edit, storage that throws) falls back to the layout's own.
 */

type Prefs = typeof import("./prefs");
let load = 0;
/** The module as a page load reads it: fresh, over what storage holds now. */
const freshPrefs = async (): Promise<Prefs> => await import(`./prefs.ts?stored-${++load}`) as Prefs;

beforeEach(async () => {
  await resetBoardTestDOM();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("the list's stored width", () => {
  test("a width is read back, rounded", async () => {
    localStorage.setItem("pairfob.workspace.listWidth", "412.6");
    expect((await freshPrefs()).workspaceListWidth()).toBe(413);
  });

  test("anything that is not a width is the layout's own", async () => {
    for (const stored of ["", "wide", "NaN", "Infinity", "-320", "0", "null", "{}"]) {
      localStorage.setItem("pairfob.workspace.listWidth", stored);
      expect((await freshPrefs()).workspaceListWidth()).toBeNull();
    }
    localStorage.removeItem("pairfob.workspace.listWidth");
    expect((await freshPrefs()).workspaceListWidth()).toBeNull();
  });
});

describe("the preview's stored width", () => {
  test("one of the offered widths is read back; anything else is the room there is", async () => {
    localStorage.setItem("pairfob.workspace.previewWidth", "768");
    expect((await freshPrefs()).previewWidth()).toBe(768);
    for (const stored of ["", "auto", "1024", "375px", "-375", "NaN"]) {
      localStorage.setItem("pairfob.workspace.previewWidth", stored);
      expect((await freshPrefs()).previewWidth()).toBe("auto");
    }
  });
});

test("storage that throws when read leaves every choice at its default", async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    const prefs = await freshPrefs();
    expect(prefs.workspaceListWidth()).toBeNull();
    expect(prefs.previewWidth()).toBe("auto");
  } finally {
    if (real) Object.defineProperty(globalThis, "localStorage", real);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
