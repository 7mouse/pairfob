import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetTestDOM } from "../../../test-support/boot-dom";

await resetTestDOM();
const { DiffScroller } = await import("./diff");
const { DiffReadingButton } = await import("./diff-reading-tools");
const { closeTestDialogs } = await import("../../../test-support/close-dialogs");
const { PinchSteps, autoDiffSize, canStepDiffSize, stepDiffSize } = await import("./diff-reading");
const { DIFF_SIZES, beforeReadingChange, diffSize, diffWrap, resetDiffSize, resetDiffWrap, resetWorkspaceWrap, setDiffSize, setDiffWrap, setWorkspaceWrap, workspaceWrap } = await import("./prefs");
const { t } = await import("../../lib/i18n");

const SIZE_KEY = "pairfob.workspace.diffSize";
const WRAP_KEY = "pairfob.workspace.diffWrap";

function altZ(el: HTMLElement): void {
  const KeyboardEventType = (el.ownerDocument.defaultView as unknown as typeof globalThis).KeyboardEvent;
  act(() => { el.dispatchEvent(new KeyboardEventType("keydown", { key: "z", code: "KeyZ", altKey: true, bubbles: true, cancelable: true })); });
}

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

  test("only the steps are accepted, up to a size for poor sight", () => {
    setDiffSize(99);
    expect(diffSize()).toBeNull();
    expect(DIFF_SIZES).toEqual([12, 13.5, 15, 17, 19]);
    setDiffSize(19);
    expect(diffSize()).toBe(19);
  });

  test("steps walk the sizes with the style sheet's own among them, and stepping back onto it gives the choice back", () => {
    // The style sheet's 12.5 sits between the steps.
    const walked: Array<number | null> = [];
    while (stepDiffSize(1, 12.5)) walked.push(diffSize());
    expect(walked).toEqual([13.5, 15, 17, 19]);
    expect(canStepDiffSize(1, 12.5)).toBe(false);
    expect(localStorage.getItem(SIZE_KEY)).toBe("19");
    for (const size of [17, 15, 13.5]) {
      expect(stepDiffSize(-1, 12.5)).toBe(true);
      expect(diffSize()).toBe(size);
    }
    expect(stepDiffSize(-1, 12.5)).toBe(true);
    expect(diffSize()).toBeNull();
    expect(localStorage.getItem(SIZE_KEY)).toBeNull();
    expect(stepDiffSize(-1, 12.5)).toBe(true);
    expect(diffSize()).toBe(12);
    expect(canStepDiffSize(-1, 12.5)).toBe(false);
  });

  test("the style sheet's size on a step is that step; past the steps it is the last one", () => {
    expect(stepDiffSize(1, 13.5)).toBe(true);
    expect(diffSize()).toBe(15);
    expect(stepDiffSize(-1, 13.5)).toBe(true);
    expect(diffSize()).toBeNull();
    // A large terminal draws 16.5, between 15 and 17.
    expect(stepDiffSize(1, 16.5)).toBe(true);
    expect(diffSize()).toBe(17);
    expect(stepDiffSize(-1, 16.5)).toBe(true);
    expect(diffSize()).toBeNull();
    expect(stepDiffSize(-1, 16.5)).toBe(true);
    expect(diffSize()).toBe(15);
    resetDiffSize();
    // The largest terminal draws past the steps: + has nowhere to go, − comes down, + goes back up to it.
    expect(stepDiffSize(1, 21.5)).toBe(false);
    expect(stepDiffSize(-1, 21.5)).toBe(true);
    expect(diffSize()).toBe(19);
    expect(stepDiffSize(1, 21.5)).toBe(true);
    expect(diffSize()).toBeNull();
  });
});

describe("diff wrap", () => {
  beforeEach(() => { resetDiffWrap(); resetWorkspaceWrap(); });
  afterEach(() => { resetDiffWrap(); resetWorkspaceWrap(); });

  test("a diff wraps until the reader turns it off, and the file view's switch is its own", () => {
    expect(diffWrap()).toBe(true);
    setWorkspaceWrap(false);
    expect(diffWrap()).toBe(true);
    setDiffWrap(false);
    expect(localStorage.getItem(WRAP_KEY)).toBe("0");
    setDiffWrap(true);
    expect(workspaceWrap()).toBe(false);
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
  let kept: number;
  let stopKeeping = () => {};

  beforeEach(() => {
    resetDiffSize();
    resetDiffWrap();
    resetWorkspaceWrap();
    kept = 0;
    stopKeeping = beforeReadingChange(() => { kept++; });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await closeTestDialogs();
    act(() => root.unmount());
    host.remove();
    stopKeeping();
    resetDiffSize();
    resetDiffWrap();
    resetWorkspaceWrap();
    Reflect.deleteProperty(window, "visualViewport");
  });

  function Reading({ split }: { split: boolean }) {
    const lines = useRef<HTMLDivElement>(null);
    return <>
      <DiffReadingButton split={split} lines={lines} />
      <DiffScroller diffKey="k" split={split} scroller={lines} digits={5}>lines</DiffScroller>
    </>;
  }

  /** The lines as the style sheet would size them when the reader has picked nothing. */
  function render(split = false, auto = "12.5px") {
    act(() => { root.render(<Reading split={split} />); });
    const el = host.querySelector<HTMLElement>(".workspace-diff")!;
    el.style.setProperty("--diff-fs-auto", auto);
    return el;
  }

  async function openSettings() {
    await act(async () => { host.querySelector<HTMLButtonElement>(".workspace-diff-reading")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return document.querySelector<HTMLDialogElement>("dialog.diff-reading-sheet[open]")!;
  }
  const stepper = (sheet: HTMLElement) => [...sheet.querySelectorAll<HTMLButtonElement>(".menu-stepper-btn")];
  const shown = (sheet: HTMLElement) => sheet.querySelector(".menu-stepper-value")!.textContent;

  test("no chosen size leaves the style sheet's size alone; the gutter is told the longest number", () => {
    const el = render();
    expect(el.classList.contains("has-diff-fs")).toBe(false);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("");
    expect(el.style.getPropertyValue("--diff-digits")).toBe("5");
  });

  test("one control opens size and wrap; − and + set the size through --diff-fs, holding the line being read", async () => {
    setDiffSize(12);
    const el = render();
    kept = 0;
    const button = host.querySelector(".workspace-diff-reading")!;
    const label = t("workspace.diffReading");
    expect(button.classList.contains("is-set")).toBe(true);
    // The light is said as well as shown.
    expect(button.getAttribute("aria-label")).toBe(t("workspace.diffReadingSet", { label }));
    expect(button.getAttribute("title")).toBe(label);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("12px");
    const sheet = await openSettings();
    const [smaller, bigger] = stepper(sheet);
    expect(shown(sheet)).toBe("12px");
    expect(smaller.disabled).toBe(true);
    // Up to the style sheet's own 12.5: the choice is given back, and the control is no longer lit.
    await act(async () => { bigger.click(); });
    expect(el.classList.contains("has-diff-fs")).toBe(false);
    expect(shown(sheet)).toBe("12.5px");
    expect(button.classList.contains("is-set")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe(label);
    await act(async () => { bigger.click(); });
    expect(el.classList.contains("has-diff-fs")).toBe(true);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("13.5px");
    expect(shown(sheet)).toBe("13.5px");
    expect(kept).toBe(2);
    await act(async () => { smaller.click(); });
    await act(async () => { smaller.click(); });
    expect(el.style.getPropertyValue("--diff-fs")).toBe("12px");
    expect(smaller.disabled).toBe(true);
    expect(kept).toBe(4);
  });

  test("with no size chosen, the steps start from the style sheet's size, and come back to it", async () => {
    render(false, "21.5px");
    const sheet = await openSettings();
    const [smaller, bigger] = stepper(sheet);
    expect(shown(sheet)).toBe("21.5px");
    expect(bigger.disabled).toBe(true);
    await act(async () => { smaller.click(); });
    expect(diffSize()).toBe(19);
    expect(bigger.disabled).toBe(false);
    await act(async () => { bigger.click(); });
    expect(diffSize()).toBeNull();
  });

  test("the wrap switch keeps lines whole, and a diff wraps until it is turned off", async () => {
    const el = render();
    const button = host.querySelector(".workspace-diff-reading")!;
    const sheet = await openSettings();
    const wrap = sheet.querySelector<HTMLButtonElement>(".menu-switch")!;
    expect(wrap.getAttribute("aria-label")).toBe(t("workspace.wrap"));
    expect(wrap.getAttribute("aria-checked")).toBe("true");
    expect(el.classList.contains("is-nowrap")).toBe(false);
    await act(async () => { wrap.click(); });
    expect(el.classList.contains("is-nowrap")).toBe(true);
    expect(wrap.getAttribute("aria-checked")).toBe("false");
    expect(button.classList.contains("is-set")).toBe(true);
    expect(kept).toBe(1);
    await act(async () => { wrap.click(); });
    expect(el.classList.contains("is-nowrap")).toBe(false);
    expect(button.classList.contains("is-set")).toBe(false);
  });

  test("Alt+Z still turns the wrap while the panel is open, and the panel follows", async () => {
    const el = render();
    const sheet = await openSettings();
    const wrap = sheet.querySelector<HTMLButtonElement>(".menu-switch")!;
    altZ(wrap);
    expect(el.classList.contains("is-nowrap")).toBe(true);
    expect(wrap.getAttribute("aria-checked")).toBe("false");
    altZ(wrap);
    expect(diffWrap()).toBe(true);
  });

  test("side by side never takes the nowrap class, the switch or its key, and the control is only the size", async () => {
    act(() => setDiffWrap(false));
    const el = render(true);
    expect(el.classList.contains("is-nowrap")).toBe(false);
    const button = host.querySelector(".workspace-diff-reading")!;
    expect(button.getAttribute("aria-label")).toBe(t("pane.fontSize"));
    expect(button.classList.contains("is-set")).toBe(false);
    const sheet = await openSettings();
    expect(sheet.querySelector(".menu-switch")).toBeNull();
    expect(stepper(sheet)).toHaveLength(2);
    altZ(sheet);
    expect(diffWrap()).toBe(false);
  });

  test("a change that changes nothing holds no place for a redraw that will not come", () => {
    setDiffSize(15);
    setDiffSize(15);
    setDiffWrap(true);
    expect(kept).toBe(1);
  });

  test("where the style sheet's size cannot be read as a length, it is read off the lines, or off a box only the sheet sizes", () => {
    const sheet = document.createElement("style");
    sheet.textContent = ".workspace-diff-pending { font-size: 16.5px; }";
    document.head.append(sheet);
    try {
      const el = render(false, "");
      el.style.fontSize = "13px";
      expect(autoDiffSize(el)).toBe(13);
      act(() => setDiffSize(12));
      expect(autoDiffSize(el)).toBe(16.5);
      // The box it was read off is gone again.
      expect(host.querySelectorAll(".workspace-diff-pending")).toHaveLength(0);
    } finally {
      sheet.remove();
    }
  });

  test("a two-finger spread snaps one step up and a pinch one down; one finger is left alone", () => {
    setDiffSize(12);
    const el = render();
    kept = 0;
    touch(el, "touchstart", [[0, 0], [100, 0]]);
    const small = touch(el, "touchmove", [[0, 0], [110, 0]]);
    expect(small.defaultPrevented).toBe(true);
    expect(diffSize()).toBe(12);
    // One step up is the style sheet's 12.5: the size is its own again.
    touch(el, "touchmove", [[0, 0], [130, 0]]);
    expect(diffSize()).toBeNull();
    expect(kept).toBe(1);
    touch(el, "touchmove", [[0, 0], [170, 0]]);
    expect(diffSize()).toBe(13.5);
    expect(el.style.getPropertyValue("--diff-fs")).toBe("13.5px");
    touch(el, "touchmove", [[0, 0], [130, 0]]);
    touch(el, "touchmove", [[0, 0], [100, 0]]);
    expect(diffSize()).toBe(12);
    // Past the smallest step nothing changes, and no place is held.
    touch(el, "touchmove", [[0, 0], [60, 0]]);
    expect(diffSize()).toBe(12);
    expect(kept).toBe(4);
    touch(el, "touchend", []);

    touch(el, "touchstart", [[0, 0]]);
    const scroll = touch(el, "touchmove", [[0, 300]]);
    expect(scroll.defaultPrevented).toBe(false);
    expect(diffSize()).toBe(12);
  });

  test("on a page the reader has zoomed, two fingers zoom the page, not the lines", () => {
    setDiffSize(12);
    const el = render();
    const viewport = { scale: 2 };
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    touch(el, "touchstart", [[0, 0], [100, 0]]);
    const zoom = touch(el, "touchmove", [[0, 0], [150, 0]]);
    expect(zoom.defaultPrevented).toBe(false);
    expect(diffSize()).toBe(12);
    touch(el, "touchend", []);
    // Zoomed while the fingers were already down: the pinch is handed back there and then.
    viewport.scale = 1;
    touch(el, "touchstart", [[0, 0], [100, 0]]);
    viewport.scale = 2;
    expect(touch(el, "touchmove", [[0, 0], [150, 0]]).defaultPrevented).toBe(false);
    viewport.scale = 1;
    expect(touch(el, "touchmove", [[0, 0], [200, 0]]).defaultPrevented).toBe(false);
    expect(diffSize()).toBe(12);
  });
});
