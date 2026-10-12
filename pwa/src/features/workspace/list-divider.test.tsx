import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createRef } from "react";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { DETAIL_MIN_REM, LIST_FLOOR_REM, LIST_MAX_REM, LIST_MIN_REM, ListDivider, listBounds, listColumnStyle } from "./list-divider";
import { setWorkspaceListWidth, useWorkspaceListWidth, workspaceListWidth } from "./prefs";

/** The list's width beside the open file: the reader's, within what the window leaves the file. */

const KEY = "pairfob.workspace.listWidth";

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => {
  unmountReact();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

/** The screen's body with a list this wide in it, as a browser would measure them. */
function Body({ total, list }: { total: number; list: number }) {
  const body = createRef<HTMLDivElement>();
  const width = useWorkspaceListWidth();
  const rect = (value: number) => () => ({ width: value, height: 600, left: 0, top: 0, right: value, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  return <div ref={(node) => {
    body.current = node;
    if (node) node.getBoundingClientRect = rect(total);
  }} className="workspace-body" style={listColumnStyle(width)}>
    <aside className="workspace-nav" ref={(node) => { if (node) node.getBoundingClientRect = rect(width ?? list); }} />
    <ListDivider body={body} />
    <main className="workspace-main" />
  </div>;
}

const line = () => document.querySelector<HTMLElement>(".workspace-list-divider");
const pointer = (type: string, clientX: number) => act(() => {
  line()!.dispatchEvent(new happy.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX, clientY: 200,
  }) as unknown as Event);
});

describe("list bounds", () => {
  test("the list is 300–480px where the open file has its room", () => {
    expect(listBounds(1440, 16)).toEqual({ min: 300, max: 480 });
    expect(listBounds(1076, 16)).toEqual({ min: 300, max: 480 });
  });

  test("a narrower window gives the file its width first, down to the layout's own list", () => {
    expect(listBounds(1024, 16)).toEqual({ min: 300, max: 428 });
    // 900px: the list the layout always drew there (304px) is the most it can be.
    expect(listBounds(900, 16)).toEqual({ min: 300, max: 304 });
  });

  test("the bounds grow with the text size, as the style sheet's do", () => {
    expect(listBounds(2000, 20)).toEqual({ min: 375, max: 600 });
  });

  test("the style sheet holds the same numbers", () => {
    const sheet = readFileSync(fileURLToPath(new URL("./workspace.scss", import.meta.url)), "utf8");
    expect(sheet).toContain(`--workspace-list-max: max(${LIST_FLOOR_REM}rem, min(${LIST_MAX_REM}rem, 100% - ${DETAIL_MIN_REM}rem));`);
    expect(sheet).toContain(`--workspace-list-w: clamp(${LIST_MIN_REM}rem, var(--workspace-list-chosen, clamp(19rem, 26vw, 24rem)), var(--workspace-list-max));`);
    expect(sheet).toContain("grid-template-columns: var(--workspace-list-w) minmax(0, 1fr);");
  });
});

describe("list divider", () => {
  test("one pane at a time has no line", () => {
    renderReact(<Body total={390} list={390} />);
    expect(line()).toBeNull();
  });

  test("side by side, a drag sets the list's width on the body and keeps it for this device", () => {
    happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
    renderReact(<Body total={1440} list={374} />);
    const el = line()!;
    expect(el.getAttribute("aria-label")).not.toBe("");
    expect([el.getAttribute("aria-valuemin"), el.getAttribute("aria-valuemax"), el.getAttribute("aria-valuenow")]).toEqual(["300", "480", "374"]);
    const body = document.querySelector<HTMLElement>(".workspace-body")!;
    expect(body.style.getPropertyValue("--workspace-list-chosen")).toBe("");

    pointer("pointerdown", 374);
    pointer("pointermove", 440);
    // Nothing moves but the preview until the reader lets go.
    expect(workspaceListWidth()).toBeNull();
    pointer("pointerup", 440);
    expect(workspaceListWidth()).toBe(440);
    expect(body.style.getPropertyValue("--workspace-list-chosen")).toBe("440px");
    expect(localStorage.getItem(KEY)).toBe("440");
    expect(line()!.getAttribute("aria-valuenow")).toBe("440");
  });

  test("pressing the line twice gives the width back to the layout", () => {
    happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
    act(() => setWorkspaceListWidth(440));
    renderReact(<Body total={1440} list={374} />);
    for (let presses = 0; presses < 2; presses++) {
      pointer("pointerdown", 440);
      pointer("pointerup", 440);
    }
    expect(workspaceListWidth()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.querySelector<HTMLElement>(".workspace-body")!.style.getPropertyValue("--workspace-list-chosen")).toBe("");
  });

  test("storage that throws leaves the width for this visit", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      setWorkspaceListWidth(420);
      expect(workspaceListWidth()).toBe(420);
      setWorkspaceListWidth(null);
      expect(workspaceListWidth()).toBeNull();
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }
  });
});
