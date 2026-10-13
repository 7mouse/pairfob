import { resetBoardTestDOM } from "../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { SheetSwap } from "./sheet-swap";

/**
 * The views a create sheet swaps in place: the card eases from the height one
 * had to the height the next has. The test DOM lays nothing out, so the card's
 * height is given.
 */
let root: Root | null = null;
let card: HTMLFormElement;
let height = 0;
let eased: Array<{ frames: Keyframe[]; options: KeyframeAnimationOptions }> = [];
const realMatch = globalThis.matchMedia;

function show(key: string, tall: number): void {
  height = tall;
  act(() => root!.render(<SheetSwap key={key}><p>{key}</p></SheetSwap>));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  const dialog = document.createElement("dialog");
  card = document.createElement("form");
  dialog.append(card);
  document.body.append(dialog);
  eased = [];
  card.getBoundingClientRect = () => ({ height, width: 320, top: 0, left: 0, right: 320, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
  card.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => { eased.push({ frames, options }); return {} as Animation; }) as typeof card.animate;
  root = createRoot(card);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  card.parentElement?.remove();
  globalThis.matchMedia = realMatch;
});

test("the sheet's first view is just there; the view that replaces it eases the card between their heights", () => {
  show("form", 420);
  expect(card.querySelector(".create-swap")?.textContent).toBe("form");
  expect(eased).toEqual([]);
  show("picker", 610);
  expect(eased).toHaveLength(1);
  expect(eased[0].frames).toEqual([{ height: "420px" }, { height: "610px" }]);
  expect(eased[0].options.duration).toBe(MOTION_MS.panel);
  show("form", 420);
  expect(eased[1].frames).toEqual([{ height: "610px" }, { height: "420px" }]);
});

test("a view drawn again, or one of the same height, eases nothing", () => {
  show("form", 420);
  show("form", 420);
  show("picker", 421);
  expect(eased).toEqual([]);
});

test("a reader who asked for less motion gets the new height at once", () => {
  globalThis.matchMedia = ((query: string) => ({ matches: query.includes("prefers-reduced-motion: reduce"), media: query,
    addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
  show("form", 420);
  show("picker", 610);
  expect(eased).toEqual([]);
});
