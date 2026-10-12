import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { appRoot } from "../dom-root";
import { computeLayout } from "../layout";
import { applyShell, clearShell } from "../shell";
import { InspectorDivider } from "./inspector-divider";
import {
  INSPECTOR_MAX_REM, INSPECTOR_MIN_REM, SESSION_MIN_REM, inspectorBounds, inspectorWidth, resetInspectorWidth, setInspectorWidth,
} from "./inspector-width";

/**
 * The inspector column's width: the reader's, kept on this device, applied by
 * the shell and bounded so the session beside it keeps its floor.
 */

const KEY = "pairfob.inspector.width";
const chosen = () => appRoot().style.getPropertyValue("--inspector-chosen");
const desk = () => computeLayout({
  phase: "live", screen: "pane", fullTerminal: false, agentChat: false, desk: true, wide: true, inspector: true,
  hasSelectedPane: true, termFontPx: 12, operationBusy: false,
});

beforeEach(async () => {
  await resetBoardTestDOM();
  resetInspectorWidth();
});
afterEach(() => {
  resetInspectorWidth();
  clearShell();
});

describe("inspector bounds", () => {
  test("the column is 440–720px where the session has its room", () => {
    // 1680px with a 320px list: 1360px for the two.
    expect(inspectorBounds(1360, 16)).toEqual({ min: 440, max: 720 });
  });

  test("a narrower window gives the session its floor first", () => {
    // 1440px with a 302px list.
    expect(inspectorBounds(1138, 16)).toEqual({ min: 440, max: 679 });
    // 900px, the list given way: the layout's own 441px is the most the column can be.
    expect(inspectorBounds(900, 16)).toEqual({ min: 440, max: 441 });
    expect(inspectorBounds(800, 16)).toEqual({ min: 440, max: 440 });
  });

  test("the style sheet holds the same numbers, and the layout's own widths until one is chosen", () => {
    const sheet = readFileSync(fileURLToPath(new URL("./styles/desk.scss", import.meta.url)), "utf8");
    expect(sheet).toContain(`--session-min: ${SESSION_MIN_REM}rem;`);
    expect(sheet).toContain(`--inspector-max: max(${INSPECTOR_MIN_REM}rem, min(${INSPECTOR_MAX_REM}rem, 100vw - var(--rail-w) - var(--session-min)));`);
    expect(sheet).toContain(`--inspector-w: clamp(${INSPECTOR_MIN_REM}rem, var(--inspector-chosen, 36vw), var(--inspector-max));`);
    expect(sheet).toContain(`--inspector-max: max(${INSPECTOR_MIN_REM}rem, min(${INSPECTOR_MAX_REM}rem, 100vw - var(--session-min)));`);
    expect(sheet).toContain(`--inspector-w: clamp(${INSPECTOR_MIN_REM}rem, var(--inspector-chosen, min(49vw, 36.5rem)), var(--inspector-max));`);
  });
});

describe("inspector width", () => {
  test("a width the reader set is on the shell root at once and kept for this device", () => {
    applyShell(desk());
    expect(chosen()).toBe("");
    setInspectorWidth(560.4);
    expect(inspectorWidth()).toBe(560);
    expect(chosen()).toBe("560px");
    expect(localStorage.getItem(KEY)).toBe("560");
    setInspectorWidth(null);
    expect(chosen()).toBe("");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  test("the shell applies it with its classes and takes it away when it goes", () => {
    setInspectorWidth(600);
    appRoot().style.removeProperty("--inspector-chosen");
    applyShell(desk());
    expect(chosen()).toBe("600px");
    applyShell(desk());
    expect(chosen()).toBe("600px");
    clearShell();
    expect(chosen()).toBe("");
    expect(inspectorWidth()).toBe(600);
  });

  test("storage that throws leaves the width for this visit", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      setInspectorWidth(520);
      expect(inspectorWidth()).toBe(520);
      expect(chosen()).toBe("520px");
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }
  });
});

describe("inspector divider", () => {
  let root: Root | null = null;
  const rect = (value: number) => () => ({ width: value, height: 800, left: 0, top: 0, right: value, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  let session: HTMLElement;
  let column: HTMLElement;
  let host: HTMLElement;
  /** Session and column as the grid would size them: the column takes what was chosen. */
  const lay = (shared: number, layoutWidth: number) => {
    column.getBoundingClientRect = () => rect(inspectorWidth() ?? layoutWidth)();
    session.getBoundingClientRect = () => rect(shared - (inspectorWidth() ?? layoutWidth))();
  };

  beforeEach(() => {
    const app = appRoot();
    session = document.createElement("section");
    session.className = "main";
    host = document.createElement("div");
    host.style.display = "contents";
    column = document.createElement("aside");
    column.className = "inspector";
    app.replaceChildren(session, host, column);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    appRoot().replaceChildren();
  });

  const line = () => document.querySelector<HTMLElement>(".inspector-divider");
  const pointer = (type: string, clientX: number) => act(() => {
    line()!.dispatchEvent(new happy.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX, clientY: 300,
    }) as unknown as Event);
  });

  test("dragging the line toward the session widens the column, once, on release", () => {
    lay(1138, 518);
    act(() => root!.render(<InspectorDivider />));
    const el = line()!;
    expect([el.getAttribute("aria-valuemin"), el.getAttribute("aria-valuemax"), el.getAttribute("aria-valuenow")]).toEqual(["440", "679", "518"]);
    const writes: string[] = [];
    const style = appRoot().style;
    const set = style.setProperty.bind(style);
    style.setProperty = (name: string, value: string | null, priority?: string) => {
      if (name === "--inspector-chosen") writes.push(String(value));
      set(name, value, priority);
    };
    try {
      pointer("pointerdown", 922);
      pointer("pointermove", 880);
      pointer("pointermove", 860);
      pointer("pointermove", 822);
      // The session's box has not changed yet: only the preview line moved.
      expect(writes).toEqual([]);
      expect(inspectorWidth()).toBeNull();
      pointer("pointerup", 822);
      expect(writes).toEqual(["618px"]);
    } finally {
      style.setProperty = set;
    }
    expect(inspectorWidth()).toBe(618);
    expect(line()!.getAttribute("aria-valuenow")).toBe("618");
  });

  test("the session keeps its floor however far the line is dragged", () => {
    lay(1138, 518);
    act(() => root!.render(<InspectorDivider />));
    pointer("pointerdown", 922);
    pointer("pointermove", 100);
    pointer("pointerup", 100);
    expect(inspectorWidth()).toBe(679);
    expect(1138 - 679).toBe(SESSION_MIN_REM * 16);
  });

  test("pressing the line twice gives the width back to the layout", () => {
    setInspectorWidth(600);
    lay(1138, 518);
    act(() => root!.render(<InspectorDivider />));
    expect(line()!.getAttribute("aria-valuenow")).toBe("600");
    for (let presses = 0; presses < 2; presses++) {
      pointer("pointerdown", 538);
      pointer("pointerup", 538);
    }
    expect(inspectorWidth()).toBeNull();
    expect(chosen()).toBe("");
    expect(line()!.getAttribute("aria-valuenow")).toBe("518");
  });

  test("where the window leaves the column one width, there is no line", () => {
    lay(880, 440);
    act(() => root!.render(<InspectorDivider />));
    expect(line()).toBeNull();
  });
});
