import { resetBoardTestDOM } from "../../../../test-support/dom";
import { expectSameNode, expectSameNodes } from "../../../../test-support/node-identity";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { DashboardAgentCard } from "../../../lib/dashboard";
import { setLang } from "../../../lib/i18n";
import type { TabLayout } from "../../../lib/layout";
import { appRoot } from "../../../app/dom-root";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { boardCanvasModel, type BoardCanvasModel } from "../model/board-view";
import { setLayoutDraft } from "../model/draft-store";
import { BoardCanvasView, type BoardCanvasController } from "./board-canvas";

/**
 * What a layout change makes of the tiles. A tile travels because its box
 * changed (the stylesheet, on the same element), arrives or leaves because its
 * pane joined or left a tab that was already drawn, and is otherwise still: a
 * first paint, another tab and a poll that repeats the layout mark nothing.
 */
type Rect = { x: number; y: number; width: number; height: number };
function layout(tabId: string, panes: Array<[string, Rect]>): TabLayout {
  return {
    workspaceId: "w1", tabId, zoomed: false, focusedPaneId: panes[0]?.[0] ?? "", area: { x: 0, y: 0, width: 100, height: 40 },
    panes: panes.map(([paneId, rect]) => ({ paneId, focused: false, rect })),
  };
}
const whole = { x: 0, y: 0, width: 100, height: 40 };
const one = layout("w1:t1", [["w1:p1", whole]]);
const split = layout("w1:t1", [["w1:p1", { x: 0, y: 0, width: 60, height: 40 }], ["w1:p2", { x: 60, y: 0, width: 40, height: 40 }]]);
const swapped = layout("w1:t1", [["w1:p2", { x: 0, y: 0, width: 40, height: 40 }], ["w1:p1", { x: 40, y: 0, width: 60, height: 40 }]]);
const otherTab = layout("w1:t2", [["w1:p8", { x: 0, y: 0, width: 50, height: 40 }], ["w1:p9", { x: 50, y: 0, width: 50, height: 40 }]]);

function canvas(value: TabLayout): BoardCanvasModel {
  const agents = value.panes.map(({ paneId }): DashboardAgentCard => ({
    paneId, paneLabel: paneId, agent: "claude", hasAgent: true, status: "idle",
    workspaceId: "w1", workspaceLabel: "alpha", tabId: value.tabId, cwd: "/tmp/a",
  }));
  return boardCanvasModel({
    workspaceList: [], tabList: [], agents, layouts: [value], workspaceId: "w1", tabId: value.tabId, selectedPaneId: "",
    status: { tone: "live", text: "" }, canCreateTab: false, operationBusy: false, connected: true,
    layoutCaps: { resize: true, swap: true, split: true, zoom: true },
  });
}

const shared: string[] = [];
const controller = new Proxy({} as BoardCanvasController, {
  get: (_target, name) => name === "bindGestures" ? () => () => {}
    : name === "layoutReason" ? () => ""
    : name === "shareTileOpening" ? (paneId: string) => { shared.push(paneId); }
    : () => {},
});
const paint = (value: TabLayout) => act(() => renderReact(<BoardCanvasView canvas={canvas(value)} controller={controller} />));
const tile = (id: string) => appRoot().querySelector<HTMLElement>(`.board-pane[data-pane-id="${id}"]`);
const phases = () => [...appRoot().querySelectorAll<HTMLElement>(".board-pane")]
  .map((node) => `${node.dataset.paneId}:${[...node.classList].filter((name) => name.startsWith("is-")).join(",")}`);
const exitOver = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, MOTION_MS.press + 60)); });

beforeEach(async () => { await resetBoardTestDOM(); setLang("zh"); shared.length = 0; });
afterEach(() => { act(() => unmountReact()); setLayoutDraft(null); });

describe("board tiles through a layout change", () => {
  test("a first paint, and the same layout drawn again, mark no tile", () => {
    paint(split);
    expect(phases()).toEqual(["w1:p1:", "w1:p2:"]);
    const nodes = [tile("w1:p1"), tile("w1:p2")];
    paint(split);
    expectSameNodes([tile("w1:p1"), tile("w1:p2")], nodes);
    expect(phases()).toEqual(["w1:p1:", "w1:p2:"]);
  });

  test("a split keeps the tile that was there, with a new box to travel to, and the new tile enters", () => {
    paint(one);
    const first = tile("w1:p1")!;
    const before = first.style.width;
    paint(split);
    // The same element with another inline box: that is what the transition runs on.
    expectSameNode(tile("w1:p1"), first);
    expect(first.style.width).not.toBe(before);
    expect(first.style.minWidth).toBe(first.style.width);
    expect(phases()).toEqual(["w1:p1:", "w1:p2:is-entering"]);
    // A repaint while it enters keeps the node, so the entrance does not start over.
    const entered = tile("w1:p2");
    paint(split);
    expectSameNode(tile("w1:p2"), entered);
  });

  test("a closed pane's tile stays where it stood to fade, out of reach, and the rest wait for it before travelling", async () => {
    paint(split);
    const gone = tile("w1:p2")!;
    const box = { left: gone.style.left, width: gone.style.width };
    shared.length = 0;
    paint(one);
    expectSameNode(tile("w1:p2"), gone);
    expect({ left: gone.style.left, width: gone.style.width }).toEqual(box);
    expect(gone.hasAttribute("inert")).toBeTrue();
    expect(phases()).toEqual(["w1:p1:is-after-exit", "w1:p2:is-leaving"]);
    // It is no pane to open from any more.
    expect(shared).toEqual(["w1:p1"]);
    // The tile that stays already has its new box; only its travel is held back.
    expect(tile("w1:p1")!.style.width).toBe(appRoot().querySelector<HTMLElement>(".board-stage")!.style.width);
    await exitOver();
    expect(tile("w1:p2")).toBeNull();
    expect(phases()).toEqual(["w1:p1:"]);
  });

  test("a swap moves both tiles and marks neither", () => {
    paint(split);
    const [a, b] = [tile("w1:p1")!, tile("w1:p2")!];
    const lefts = [a.style.left, b.style.left];
    paint(swapped);
    expectSameNodes([tile("w1:p1"), tile("w1:p2")], [a, b]);
    expect([a.style.left, b.style.left]).not.toEqual(lefts);
    expect(phases().sort()).toEqual(["w1:p1:", "w1:p2:"]);
  });

  test("a swap leaves both nodes where they are in the document until they have travelled", async () => {
    paint(split);
    const stage = appRoot().querySelector<HTMLElement>(".board-stage")!;
    const order = () => [...stage.querySelectorAll<HTMLElement>(".board-pane")].map((node) => node.dataset.paneId);
    // A node that is moved ends its transition: neither may be re-inserted while it travels.
    const moved: string[] = [];
    const insert = stage.insertBefore.bind(stage);
    stage.insertBefore = ((node: Node, before: Node | null) => {
      const id = (node as HTMLElement).dataset?.paneId;
      if (id) moved.push(id);
      return insert(node, before);
    }) as typeof stage.insertBefore;
    paint(swapped);
    expect(order()).toEqual(["w1:p1", "w1:p2"]);
    // A poll that repeats the swapped layout does not start the wait again or move anything.
    paint(swapped);
    expect(moved).toEqual([]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, MOTION_MS.panel + 60)); });
    // Arrived: the document takes the layout's order, which is the order focus walks.
    expect(order()).toEqual(["w1:p2", "w1:p1"]);
  });

  test("another tab's tiles are just there: nothing enters, and the tab left behind is not kept to fade", () => {
    paint(split);
    paint(otherTab);
    expect(phases()).toEqual(["w1:p8:", "w1:p9:"]);
    expect(appRoot().querySelector(".is-leaving, .is-entering, .is-after-exit")).toBeNull();
  });

  test("a divider under a finger moves its tiles unanimated; a committed one lets them ease", () => {
    paint(split);
    const stage = appRoot().querySelector<HTMLElement>(".board-stage")!;
    expect(stage.className).toBe("board-stage");
    act(() => setLayoutDraft({ tabId: "w1:t1", splitId: "s0", ratio: 0.5, pending: false }));
    expect(stage.className).toBe("board-stage is-dragging");
    // Released: the request is in flight and the tiles may settle to what comes back.
    act(() => setLayoutDraft({ tabId: "w1:t1", splitId: "s0", ratio: 0.5, pending: true }));
    expect(stage.className).toBe("board-stage");
    // A drag in another tab is not this stage's.
    act(() => setLayoutDraft({ tabId: "w1:t9", splitId: "s0", ratio: 0.5, pending: false }));
    expect(stage.className).toBe("board-stage");
  });
});
