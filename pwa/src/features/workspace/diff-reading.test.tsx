import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetTestDOM } from "../../../test-support/boot-dom";

await resetTestDOM();
const { DiffScroller } = await import("./diff");
const { DiffReadingTools } = await import("./diff-reading-tools");
const { DIFF_SIZES, PinchSteps, diffSize, resetDiffSize, setDiffSize, stepDiffSize } = await import("./diff-reading");
const { resetWorkspaceWrap, setWorkspaceWrap } = await import("./prefs");

const SIZE_KEY = "pairfob.workspace.diffSize";

function touch(el: HTMLElement, type: string, points: Array<[number, number]>): Event {
  const event = new (el.ownerDocument.defaultView as unknown as typeof globalThis).Event(type, { bubbles: true, cancelable: true });
  const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(event, "touches", { value: touches });
  act(() => { el.dispatchEvent(event); });
  return event;
}

describe("diff reading size", () => {
  beforeEach(() => { resetDiffSize(); localStorage.removeItem(SIZE_KEY); });
  afterEach(() => { resetDiffSize(); });

  test("a chosen size is kept on the device, and clearing it forgets it", () => {
    setDiffSize(15);
    expect(diffSize()).toBe(15);
    expect(localStorage.getItem(SIZE_KEY)).toBe("15");
    resetDiffSize();
    expect(diffSize()).toBeNull();
    expect(localStorage.getItem(SIZE_KEY)).toBeNull();
  });

  test("only the three steps are accepted", () => {
    setDiffSize(99);
    expect(diffSize()).toBeNull();
    expect(DIFF_SIZES).toEqual([12, 13.5, 15]);
  });

  test("steps walk the sizes and stop at either end", () => {
    setDiffSize(12);
    expect(stepDiffSize(1)).toBe(true);
    expect(diffSize()).toBe(13.5);
    expect(stepDiffSize(1)).toBe(true);
    expect(stepDiffSize(1)).toBe(false);
    expect(diffSize()).toBe(15);
    expect(localStorage.getItem(SIZE_KEY)).toBe("15");
  });
});

describe("pinch steps", () => {
  test("one step per crossing, measured again from where it stepped", () => {
    const pinch = new PinchSteps();
    pinch.start(100);
    expect(pinch.move(110)).toBe(0);
    expect(pinch.move(126)).toBe(1);
    expect(pinch.move(140)).toBe(0);
    expect(pinch.move(158)).toBe(1);
    expect(pinch.move(120)).toBe(-1);
    pinch.end();
    expect(pinch.move(10)).toBe(0);
  });
});

describe("DiffScroller reading", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetDiffSize();
    resetWorkspaceWrap();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetDiffSize();
    resetWorkspaceWrap();
  });

  function render(split = false) {
    act(() => {
      root.render(<>
        <DiffReadingTools split={split} />
        <DiffScroller diffKey="k" split={split}>lines</DiffScroller>
      </>);
    });
    return host.querySelector<HTMLElement>(".workspace-diff")!;
  }

  test("no chosen size leaves the style sheet's size alone", () => {
    const el = render();
    expect(el.classList.contains("has-diff-fs")).toBe(false);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("");
  });

  test("A+ and A− set the size through --diff-fs", () => {
    setDiffSize(12);
    const el = render();
    expect(el.style.getPropertyValue("--diff-fs")).toBe("12px");
    act(() => { host.querySelector<HTMLButtonElement>(".workspace-diff-bigger")!.click(); });
    expect(el.classList.contains("has-diff-fs")).toBe(true);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("13.5px");
    act(() => { host.querySelector<HTMLButtonElement>(".workspace-diff-smaller")!.click(); });
    expect(el.style.getPropertyValue("--diff-fs")).toBe("12px");
    expect(host.querySelector<HTMLButtonElement>(".workspace-diff-smaller")!.disabled).toBe(true);
  });

  test("the wrap toggle keeps lines whole, and a diff wraps until it is turned off", () => {
    const el = render();
    const wrap = host.querySelector<HTMLButtonElement>(".workspace-diff-wrap")!;
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
    expect(el.classList.contains("is-nowrap")).toBe(false);
    act(() => { wrap.click(); });
    expect(el.classList.contains("is-nowrap")).toBe(true);
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
    act(() => { wrap.click(); });
    expect(el.classList.contains("is-nowrap")).toBe(false);
  });

  test("side by side never takes the nowrap class or the toggle", () => {
    act(() => setWorkspaceWrap(false));
    const el = render(true);
    expect(el.classList.contains("is-nowrap")).toBe(false);
    expect(host.querySelector(".workspace-diff-wrap")).toBeNull();
  });

  test("a two-finger spread snaps one step up and a pinch one down; one finger is left alone", () => {
    setDiffSize(12);
    const el = render();
    touch(el, "touchstart", [[0, 0], [100, 0]]);
    const small = touch(el, "touchmove", [[0, 0], [110, 0]]);
    expect(small.defaultPrevented).toBe(true);
    expect(diffSize()).toBe(12);
    touch(el, "touchmove", [[0, 0], [130, 0]]);
    expect(diffSize()).toBe(13.5);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("13.5px");
    touch(el, "touchmove", [[0, 0], [100, 0]]);
    expect(diffSize()).toBe(12);
    touch(el, "touchend", []);

    touch(el, "touchstart", [[0, 0]]);
    const scroll = touch(el, "touchmove", [[0, 300]]);
    expect(scroll.defaultPrevented).toBe(false);
    expect(diffSize()).toBe(12);
  });
});
