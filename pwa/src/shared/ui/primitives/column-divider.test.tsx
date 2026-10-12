import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { COLUMN_KEY_STEP_PX, ColumnDivider, type ColumnBox } from "./column-divider";

/**
 * The line between two columns: it previews while the reader drags or holds a
 * key and hands over one width when they let go.
 */

let box: ColumnBox | null;
let commits: number[];
let resets: number;

beforeEach(async () => {
  await resetBoardTestDOM();
  box = { min: 300, max: 480, width: 360 };
  commits = [];
  resets = 0;
});
afterEach(() => unmountReact());

function mount(side: "before" | "after" = "before"): void {
  renderReact(<><aside id="the-list" /><ColumnDivider label="Resize the list" hint="Arrows resize; Enter restores the default."
    valueText={(width) => `${width} pixels`} controls="the-list" side={side} measure={() => box}
    onCommit={(width) => { commits.push(width); box = box && { ...box, width }; }} onReset={() => { resets += 1; }} /></>);
}
const line = () => document.querySelector<HTMLElement>(".column-divider");
const shift = () => line()!.style.getPropertyValue("--column-divider-shift");
const pointer = (type: string, clientX: number, init: Record<string, unknown> = {}) => act(() => {
  line()!.dispatchEvent(new happy.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX, clientY: 200, ...init,
  }) as unknown as Event);
});
const key = (type: "keydown" | "keyup", name: string, init: Record<string, unknown> = {}): boolean => {
  let delivered = true;
  act(() => {
    delivered = line()!.dispatchEvent(new happy.KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init }) as unknown as Event);
  });
  return delivered;
};

describe("column divider", () => {
  test("it is a separator that says what the column is and may be", () => {
    mount();
    const el = line()!;
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-label")).toBe("Resize the list");
    expect([el.getAttribute("aria-valuemin"), el.getAttribute("aria-valuemax"), el.getAttribute("aria-valuenow")]).toEqual(["300", "480", "360"]);
    expect(el.tabIndex).toBe(0);
    // Said as a width, of the column it sizes, with how it is operated for whoever cannot watch the line.
    expect(el.getAttribute("aria-valuetext")).toBe("360 pixels");
    expect(document.getElementById(el.getAttribute("aria-controls")!)?.tagName).toBe("ASIDE");
    expect(document.getElementById(el.getAttribute("aria-describedby")!)?.textContent).toBe("Arrows resize; Enter restores the default.");
    expect(el.getAttribute("aria-keyshortcuts")).toBe("ArrowLeft ArrowRight Home End Enter");
  });

  test("with nothing to size, or no room to move, there is no line", () => {
    box = null;
    mount();
    expect(line()).toBeNull();
    unmountReact();
    box = { min: 440, max: 440, width: 440 };
    mount();
    expect(line()).toBeNull();
  });

  test("a drag only previews; the width is handed over once, on release", () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointermove", 400);
    pointer("pointermove", 430);
    expect(commits).toEqual([]);
    expect(line()!.classList.contains("is-active")).toBeTrue();
    expect(shift()).toBe("70px");
    expect(line()!.getAttribute("aria-valuenow")).toBe("430");
    pointer("pointerup", 430);
    expect(commits).toEqual([430]);
    expect(line()!.classList.contains("is-active")).toBeFalse();
    expect(shift()).toBe("0px");
    expect(line()!.getAttribute("aria-valuenow")).toBe("430");
  });

  test("the preview and the result stop at the column's bounds", () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointermove", 900);
    expect(shift()).toBe("120px");
    pointer("pointerup", 900);
    pointer("pointerdown", 480);
    pointer("pointermove", 0);
    pointer("pointerup", 0);
    expect(commits).toEqual([480, 300]);
  });

  test("a column after the line widens as the line moves back", () => {
    mount("after");
    pointer("pointerdown", 1000);
    pointer("pointermove", 940);
    expect(shift()).toBe("-60px");
    pointer("pointerup", 940);
    expect(commits).toEqual([420]);
  });

  test("a click, or a tap that barely moved, changes nothing", () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointermove", 362);
    pointer("pointerup", 362);
    // A finger wanders further than a mouse before it means to drag.
    pointer("pointerdown", 360, { pointerType: "touch" });
    pointer("pointermove", 368, { pointerType: "touch" });
    pointer("pointerup", 368, { pointerType: "touch" });
    expect(commits).toEqual([]);
    expect(line()!.classList.contains("is-active")).toBeFalse();
  });

  test("a finger drags it as a mouse does", () => {
    mount();
    pointer("pointerdown", 360, { pointerType: "touch" });
    pointer("pointermove", 400, { pointerType: "touch" });
    pointer("pointerup", 400, { pointerType: "touch" });
    expect(commits).toEqual([400]);
  });

  test("a drag that is cancelled leaves the column as it was", () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointermove", 420);
    pointer("pointercancel", 420);
    pointer("pointerup", 420);
    expect(commits).toEqual([]);
    expect(shift()).toBe("0px");
  });

  test("the release's own click does not reach what the line was dragged over", () => {
    mount();
    let clicks = 0;
    const under = document.createElement("button");
    under.addEventListener("click", () => { clicks += 1; });
    document.body.append(under);
    pointer("pointerdown", 360);
    pointer("pointermove", 420);
    pointer("pointerup", 420);
    under.dispatchEvent(new happy.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }) as unknown as Event);
    expect(clicks).toBe(0);
    // The next click is the reader's own.
    under.dispatchEvent(new happy.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }) as unknown as Event);
    expect(clicks).toBe(1);
    under.remove();
  });

  test("the arrows move the line a step at a time and the width follows when the key is let go", () => {
    mount();
    expect(key("keydown", "ArrowRight")).toBeFalse();
    // A held key repeats: still one preview, and no width yet.
    key("keydown", "ArrowRight");
    expect(commits).toEqual([]);
    expect(shift()).toBe(`${2 * COLUMN_KEY_STEP_PX}px`);
    key("keyup", "ArrowRight");
    expect(commits).toEqual([360 + 2 * COLUMN_KEY_STEP_PX]);
    key("keydown", "ArrowLeft");
    key("keyup", "ArrowLeft");
    expect(commits).toEqual([392, 376]);
  });

  test("for a column after the line the arrows still move the line", () => {
    mount("after");
    key("keydown", "ArrowLeft");
    key("keyup", "ArrowLeft");
    expect(commits).toEqual([360 + COLUMN_KEY_STEP_PX]);
  });

  test("Home and End are the column at its narrowest and its widest", () => {
    mount();
    key("keydown", "Home");
    key("keyup", "Home");
    key("keydown", "End");
    key("keyup", "End");
    expect(commits).toEqual([300, 480]);
    // Already there: nothing to hand over.
    key("keydown", "End");
    key("keyup", "End");
    expect(commits).toEqual([300, 480]);
  });

  test("Escape puts back what is being moved, and is the page's when nothing is", () => {
    mount();
    key("keydown", "ArrowRight");
    expect(key("keydown", "Escape")).toBeFalse();
    key("keyup", "Escape");
    key("keyup", "ArrowRight");
    expect(commits).toEqual([]);
    expect(shift()).toBe("0px");
    expect(key("keydown", "Escape")).toBeTrue();
  });

  test("keys with a modifier, and other keys, are not the line's", () => {
    mount();
    expect(key("keydown", "ArrowRight", { metaKey: true })).toBeTrue();
    expect(key("keydown", "a")).toBeTrue();
    key("keyup", "a");
    expect(commits).toEqual([]);
  });

  test("leaving the line with a width still asked for keeps that width", () => {
    mount();
    act(() => line()!.focus());
    key("keydown", "ArrowRight");
    act(() => line()!.blur());
    expect(commits).toEqual([360 + COLUMN_KEY_STEP_PX]);
  });

  test("two presses hand the width back to the layout, from a mouse and from a finger alike", () => {
    for (const pointerType of ["mouse", "touch"]) {
      mount();
      pointer("pointerdown", 360, { pointerType });
      pointer("pointerup", 360, { pointerType });
      expect(resets).toBe(0);
      pointer("pointerdown", 362, { pointerType });
      pointer("pointerup", 362, { pointerType });
      expect(resets).toBe(1);
      // A third press starts over: it is not the second half of another pair.
      pointer("pointerdown", 362, { pointerType });
      pointer("pointerup", 362, { pointerType });
      expect(resets).toBe(1);
      expect(commits).toEqual([]);
      unmountReact();
      resets = 0;
    }
  });

  test("two presses apart in place or time, or with a drag between them, are not a double press", async () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointerup", 360);
    pointer("pointerdown", 360, { clientY: 400 });
    pointer("pointerup", 360, { clientY: 400 });
    expect(resets).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 340));
    pointer("pointerdown", 360, { clientY: 400 });
    pointer("pointerup", 360, { clientY: 400 });
    expect(resets).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 340));
    pointer("pointerdown", 360);
    pointer("pointerup", 360);
    pointer("pointerdown", 360);
    pointer("pointermove", 400);
    pointer("pointerup", 400);
    pointer("pointerdown", 400);
    pointer("pointerup", 400);
    expect(resets).toBe(0);
    expect(commits).toEqual([400]);
  });

  test("Enter on the line hands the width back too, and lets go of what was being moved", () => {
    mount();
    key("keydown", "ArrowRight");
    expect(key("keydown", "Enter")).toBeFalse();
    key("keyup", "Enter");
    key("keyup", "ArrowRight");
    expect(resets).toBe(1);
    expect(commits).toEqual([]);
    expect(shift()).toBe("0px");
  });

  test("a line that left under a drag is not still held when it comes back", () => {
    mount();
    pointer("pointerdown", 360);
    pointer("pointermove", 420);
    // The window closed the bounds mid-drag: there is no line to let go of.
    box = { min: 440, max: 440, width: 440 };
    act(() => { window.dispatchEvent(new happy.Event("resize") as unknown as Event); });
    expect(line()).toBeNull();
    box = { min: 300, max: 480, width: 360 };
    act(() => { window.dispatchEvent(new happy.Event("resize") as unknown as Event); });
    expect(line()!.classList.contains("is-active")).toBeFalse();
    pointer("pointerdown", 360, { pointerId: 2 });
    pointer("pointermove", 400, { pointerId: 2 });
    pointer("pointerup", 400, { pointerId: 2 });
    expect(commits).toEqual([400]);
  });

  test("the bounds follow the window", () => {
    mount();
    box = { min: 300, max: 420, width: 360 };
    act(() => { window.dispatchEvent(new happy.Event("resize") as unknown as Event); });
    expect(line()!.getAttribute("aria-valuemax")).toBe("420");
  });
});

/**
 * The line runs the whole height of two columns, over a gutter on one side
 * and the ends of rows on the other. What a finger presses is the knob, not a
 * wide strip along all of it.
 */
describe("column divider targets", () => {
  const sheet = readFileSync(fileURLToPath(new URL("../styles/column-divider.scss", import.meta.url)), "utf8");
  const coarse = sheet.slice(sheet.indexOf("@media not all and (hover: hover) and (pointer: fine) {"));

  test("the strip is 12px under any pointer: 6px into each column, no more", () => {
    expect(sheet).toMatch(/\.column-divider \{\s*--column-divider-hit: 12px;/);
    // Nothing widens it again, for a finger or for a mouse.
    expect(sheet.match(/--column-divider-hit:/g)).toHaveLength(1);
  });

  test("under a finger the knob is pressed 44px by 44px, about the 4px by 22px it is drawn", () => {
    const knob = sheet.slice(sheet.indexOf(".column-divider-knob {"), sheet.indexOf("}", sheet.indexOf(".column-divider-knob {")));
    const drawn = { width: Number(/width:\s*(\d+)px/.exec(knob)![1]), height: Number(/height:\s*(\d+)px/.exec(knob)![1]) };
    const reach = /\.column-divider-knob::after \{ content: ""; position: absolute; inset: -(\d+)px -(\d+)px; \}/.exec(coarse);
    if (!reach) throw new Error("missing the knob's hit area");
    expect(drawn.height + 2 * Number(reach[1])).toBe(44);
    expect(drawn.width + 2 * Number(reach[2])).toBe(44);
    // The area hangs from the knob, so it moves with it while the line is dragged.
    expect(knob).toMatch(/position:\s*relative/);
  });
});
