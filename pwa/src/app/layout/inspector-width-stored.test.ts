import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";

/**
 * The column's width kept on this device is read once, when its module loads.
 * What is found there that is not a width falls back to the layout's own.
 */

type Width = typeof import("./inspector-width");
const KEY = "pairfob.inspector.width";
let load = 0;
/** The module as a page load reads it: fresh, over what storage holds now. */
const fresh = async (): Promise<Width> => await import(`./inspector-width.ts?stored-${++load}`) as Width;

beforeEach(async () => {
  await resetBoardTestDOM();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

test("a width is read back, rounded", async () => {
  localStorage.setItem(KEY, "611.5");
  expect((await fresh()).inspectorWidth()).toBe(612);
});

test("anything that is not a width is the layout's own", async () => {
  for (const stored of ["", "wide", "NaN", "Infinity", "-600", "0", "null", "[600]x"]) {
    localStorage.setItem(KEY, stored);
    expect((await fresh()).inspectorWidth()).toBeNull();
  }
  localStorage.removeItem(KEY);
  expect((await fresh()).inspectorWidth()).toBeNull();
});

test("storage that throws when read leaves the layout's own width", async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    expect((await fresh()).inspectorWidth()).toBeNull();
  } finally {
    if (real) Object.defineProperty(globalThis, "localStorage", real);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
