import { resetBoardTestDOM } from "../../../../test-support/dom";
import { expectSameNode } from "../../../../test-support/node-identity";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { appRoot } from "../../../app/dom-root";
import type { DashboardAgentCard } from "../../../lib/dashboard";
import { setLang } from "../../../lib/i18n";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { setListGroupCollapsed } from "../../settings/preferences-store";
import type { HerdActions } from "../actions";
import { buildHerdViewModel, type HerdModelInput, type HerdViewModel } from "../model/herd-view";
import { HerdScreen } from "./herd-screen";

/**
 * What moves in the list, and what must not. A poll draws the list again with
 * the same data many times a minute: every case here paints twice and checks
 * that the second paint marks nothing. What is marked is told from the data (a
 * session that was not in the list, a status that changed), never from a mount.
 */
const app = appRoot;

function agent(id: string, workspace: string, status: DashboardAgentCard["status"] = "idle"): DashboardAgentCard {
  return {
    paneId: id, paneLabel: id, agent: "codex", hasAgent: true, status,
    workspaceId: workspace, workspaceLabel: workspace, workspaceCwd: `/work/${workspace}`,
    cwd: `/tmp/${workspace}`, tabId: `${workspace}:tab`,
  };
}

const two = [agent("p1", "alpha"), agent("p2", "alpha", "working")];

function model(overrides: Partial<HerdModelInput> = {}): HerdViewModel {
  return buildHerdViewModel({
    agents: two,
    listGroup: "space",
    paneTouched: {},
    paneActivated: {},
    panePinned: {},
    groupCollapsed: {},
    selectedPaneId: "",
    attention: { stagger: false, markOf: () => "", isDismissing: () => false, completed: [] },
    liveness: "live",
    status: { tone: "live", text: "已连接" },
    reading: false,
    snapshotLoaded: true,
    recentDirs: [],
    connected: true,
    networkOnline: true,
    runtimeKind: "herdr",
    createConversation: true,
    operationBusy: false,
    morphingPaneId: null,
    host: { name: "studio", line: "已连接 · P2P 直连 · 18 毫秒", tone: "live" },
    createTab: true,
    now: 10 * 60_000,
    ...overrides,
  });
}

const actions = new Proxy({}, { get: () => () => {} }) as HerdActions;

function paint(view: HerdViewModel, variant: "page" | "rail" = "page"): void {
  act(() => renderReact(<HerdScreen view={view} actions={actions} variant={variant} />));
}

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));
const rowOf = (paneId: string) => app().querySelector(`.card-main[data-pane-id="${paneId}"]`)?.closest<HTMLElement>(".herd-row") ?? null;
/** The rows as drawn: `+` entering, `-` leaving. */
const rows = () => [...app().querySelectorAll<HTMLElement>(".herd-row")].map((row) =>
  `${row.querySelector<HTMLElement>(".card-main")!.dataset.paneId}${row.classList.contains("is-entering") ? "+" : ""}${row.classList.contains("is-leaving") ? "-" : ""}`);
const tickets = () => [...app().querySelectorAll<HTMLElement>(".attn-ticket")].map((ticket) =>
  `${ticket.dataset.paneId}${ticket.classList.contains("is-entering") ? "+" : ""}${ticket.classList.contains("is-leaving") ? "-" : ""}`);
const marked = (selector: string) => app().querySelectorAll(selector).length;

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
});

afterEach(() => { act(() => unmountReact()); });

describe("a group folds", () => {
  test("a folded group keeps its rows in a shut fold, out of reach, and opens the same fold", async () => {
    paint(model({ groupCollapsed: { alpha: true } }));
    const fold = app().querySelector<HTMLElement>(".herd-group-fold")!;
    expect(fold.classList.contains("is-shut")).toBe(true);
    expect(fold.hasAttribute("inert")).toBe(true);
    // The rows are there for the body to show on its way open.
    expect(rows()).toEqual(["p1", "p2"]);
    expect(app().querySelector(".group-title")?.getAttribute("aria-expanded")).toBe("false");

    paint(model());
    expectSameNode(app().querySelector(".herd-group-fold"), fold);
    expect(fold.classList.contains("is-shut")).toBe(false);
    expect(fold.hasAttribute("inert")).toBe(false);
    // Still clipping while the body opens; at rest a row's focus ring may pass its edge.
    expect(fold.classList.contains("is-folding")).toBe(true);
    await wait(MOTION_MS.panel + 40);
    expect(fold.classList.contains("is-folding")).toBe(false);
  });

  test("a row asked for in a folded group is scrolled to once the body has opened; in an open group, at once", async () => {
    const scrolled: string[] = [];
    const proto = Object.getPrototypeOf(document.createElement("button")) as { scrollIntoView?: unknown };
    const original = Object.getOwnPropertyDescriptor(proto, "scrollIntoView");
    Object.defineProperty(proto, "scrollIntoView", {
      configurable: true, writable: true,
      value(this: HTMLElement) { scrolled.push(this.dataset.paneId ?? ""); },
    });
    try {
      const waiting = [agent("p1", "alpha", "blocked"), agent("p2", "alpha")];
      paint(model({ agents: waiting, groupCollapsed: { alpha: true } }));
      act(() => app().querySelector<HTMLButtonElement>(".group-mark.is-blocked")!.click());
      // The reader's fold is the preference's; the list is drawn again with it open.
      paint(model({ agents: waiting }));
      expect(document.activeElement?.getAttribute("data-pane-id")).toBe("p1");
      // The row is still where the shut body kept it: the scroll waits for where it ends up.
      expect(scrolled).toEqual([]);
      await wait(MOTION_MS.panel + 40);
      expect(scrolled).toEqual(["p1"]);

      act(() => app().querySelector<HTMLButtonElement>(".group-mark.is-blocked")!.click());
      expect(scrolled).toEqual(["p1", "p1"]);
    } finally {
      if (original) Object.defineProperty(proto, "scrollIntoView", original);
      else delete proto.scrollIntoView;
      act(() => setListGroupCollapsed({}));
    }
  });

  test("a group drawn open was never folding, and drawing it again changes nothing", () => {
    paint(model());
    const fold = app().querySelector<HTMLElement>(".herd-group-fold")!;
    expect(fold.className).toBe("fold herd-group-fold");
    paint(model());
    expect(fold.className).toBe("fold herd-group-fold");
    expect(marked(".fold-appear")).toBe(0);
  });
});

describe("one session more or less", () => {
  test("the first paint and a repaint draw every row still", () => {
    paint(model());
    expect(rows()).toEqual(["p1", "p2"]);
    paint(model());
    paint(model({ now: 11 * 60_000 }));
    expect(rows()).toEqual(["p1", "p2"]);
    expect(marked(".fold-appear, .herd-list.enter")).toBe(0);
  });

  test("a new session's row enters alone; the list does not replay its entrance", () => {
    paint(model());
    const kept = rowOf("p1");
    paint(model({ agents: [...two, agent("p3", "alpha")] }));
    expect(rows()).toEqual(["p1", "p2", "p3+"]);
    // It opens into its place from shut; the rows that were there are the same nodes, untouched.
    expect(rowOf("p3")!.classList.contains("fold-appear")).toBe(true);
    expectSameNode(rowOf("p1"), kept);
    expect(marked(".fold-appear")).toBe(1);
    expect(marked(".herd-list.enter")).toBe(0);
    // A poll inside the entrance keeps the mark and adds none.
    paint(model({ agents: [...two, agent("p3", "alpha")] }));
    expect(rows()).toEqual(["p1", "p2", "p3+"]);
  });

  test("a closed session's row is kept where it was, shut and out of reach, and then goes", async () => {
    paint(model({ agents: [...two, agent("p3", "alpha")] }));
    paint(model({ agents: [two[0], agent("p3", "alpha")] }));
    expect(rows()).toEqual(["p1", "p2-", "p3"]);
    const leaving = rowOf("p2")!;
    expect(leaving.classList.contains("is-shut")).toBe(true);
    expect(leaving.hasAttribute("inert")).toBe(true);
    // The heading counts what is in the list, not what is leaving it.
    expect(app().querySelector(".section-count")?.textContent).toBe("2");
    await wait(MOTION_MS.element + MOTION_MS.panel + 40);
    expect(rows()).toEqual(["p1", "p3"]);
  });

  test("the last session of a group takes its heading with it", async () => {
    paint(model({ agents: [...two, agent("b1", "beta")] }));
    paint(model());
    const gone = rowOf("b1")!.closest<HTMLElement>(".herd-group")!;
    expect(gone.classList.contains("is-leaving")).toBe(true);
    expect(gone.hasAttribute("inert")).toBe(true);
    expect(gone.querySelector(".group-name")?.textContent).toBe("beta");
    await wait(MOTION_MS.element + MOTION_MS.panel + 40);
    expect([...app().querySelectorAll(".group-name")].map((node) => node.textContent)).toEqual(["alpha"]);
  });

  test("a row that only changed group is neither new nor closed", () => {
    paint(model());
    paint(model({ panePinned: { p2: 5 } }));
    expect(rows()).toEqual(["p2", "p1"]);
  });

  test("a list built again starts over: nothing enters and nothing is kept", () => {
    paint(model());
    paint(model({ agents: [agent("q1", "gamma"), agent("q2", "gamma")], listEpoch: 1,
      attention: { stagger: true, markOf: () => "", isDismissing: () => false, completed: [] } }));
    expect(rows()).toEqual(["q1", "q2"]);
    expect(marked(".fold-appear")).toBe(0);
    // The whole entrance is the list's, for this one paint.
    expect(marked(".herd-list.enter")).toBe(1);
  });

  test("the rail's rows are the same folds: the fold is the list's item", () => {
    paint(model(), "rail");
    paint(model({ agents: [...two, agent("p3", "alpha")] }), "rail");
    expect(rows()).toEqual(["p1", "p2", "p3+"]);
    expect([...app().querySelectorAll(".herd-row")].every((row) => row.getAttribute("role") === "listitem")).toBe(true);
  });
});

describe("the needs-you strip", () => {
  const waiting = [agent("p1", "alpha", "blocked"), agent("p2", "alpha", "working")];
  const both = [agent("p1", "alpha", "blocked"), agent("p2", "alpha", "blocked")];

  test("nothing waiting: the fold is there, shut, and holds no strip", () => {
    paint(model());
    const wrap = app().querySelector<HTMLElement>(".attn-wrap")!;
    expect(wrap.className).toBe("fold is-shut attn-wrap");
    expect(wrap.hasAttribute("inert")).toBe(true);
    expect(app().querySelector(".attn-strip")).toBeNull();
  });

  test("the first ticket opens the fold that was there; a strip drawn with its tickets is still", () => {
    paint(model());
    const wrap = app().querySelector<HTMLElement>(".attn-wrap")!;
    paint(model({ agents: waiting }));
    expectSameNode(app().querySelector(".attn-wrap"), wrap);
    expect(wrap.classList.contains("is-shut")).toBe(false);
    expect(wrap.hasAttribute("inert")).toBe(false);
    expect(tickets()).toEqual(["p1+"]);

    act(() => unmountReact());
    paint(model({ agents: both }));
    expect(tickets()).toEqual(["p1", "p2"]);
    paint(model({ agents: both }));
    expect(tickets()).toEqual(["p1", "p2"]);
    expect(marked(".attn-count.swap-in")).toBe(0);
  });

  test("a ticket joins and leaves by itself, and the count marks its own change", async () => {
    paint(model({ agents: waiting }));
    expect(tickets()).toEqual(["p1"]);
    paint(model({ agents: both }));
    expect(tickets()).toEqual(["p1", "p2+"]);
    expect(app().querySelector(".attn-count")?.textContent).toBe("2");
    expect(marked(".attn-count.swap-in")).toBe(1);

    paint(model({ agents: [agent("p1", "alpha", "working"), agent("p2", "alpha", "blocked")] }));
    expect(tickets()[0]).toBe("p1-");
    const leaving = app().querySelector<HTMLElement>('.attn-ticket[data-pane-id="p1"]')!;
    expect(leaving.hasAttribute("inert")).toBe(true);
    expect(app().querySelector(".attn-count")?.textContent).toBe("1");
    await wait(MOTION_MS.element + 40);
    expect(tickets().map((ticket) => ticket.replace("+", ""))).toEqual(["p2"]);
  });
});

describe("the connection drops and comes back", () => {
  const line = () => app().querySelector<HTMLElement>(".host-title-line")!;

  test("a latency that ticks is the same status; a status that changes is marked", () => {
    paint(model());
    expect(line().classList.contains("swap-in")).toBe(false);
    const drawn = line();
    paint(model({ host: { name: "studio", line: "已连接 · P2P 直连 · 21 毫秒", tone: "live" } }));
    expectSameNode(line(), drawn);
    expect(line().textContent).toBe("已连接 · P2P 直连 · 21 毫秒");
    expect(line().classList.contains("swap-in")).toBe(false);

    paint(model({ host: { name: "studio", line: "连接中断，正在自动重连", tone: "warn" } }));
    expect(line().classList.contains("swap-in")).toBe(true);
    expect(app().querySelector(".host-title .dot")?.className).toBe("dot dot-warn");
  });

  test("the rail's status marks the same change on its parts", () => {
    paint(model(), "rail");
    expect(marked(".host-title-fact.swap-in")).toBe(0);
    paint(model({ host: { name: "studio", line: "已连接 · P2P 直连 · 21 毫秒", tone: "live" } }), "rail");
    expect(marked(".host-title-fact.swap-in")).toBe(0);
    paint(model({ host: { name: "studio", line: "连接中断，正在自动重连", tone: "warn" } }), "rail");
    expect(marked(".host-title-fact.swap-in")).toBeGreaterThan(0);
  });

  test("a row's status word marks the moment it can no longer be confirmed, on the row that stays", () => {
    paint(model());
    const card = app().querySelector<HTMLElement>(".card")!;
    expect(marked(".card-status.swap-in")).toBe(0);
    paint(model({ liveness: "unverifiable" }));
    // The same row dims (a transition on the class); only its word is a new node.
    expectSameNode(app().querySelector(".card"), card);
    expect(card.classList.contains("unverifiable")).toBe(true);
    expect(marked(".card-status.swap-in")).toBe(2);
    paint(model({ liveness: "unverifiable" }));
    expectSameNode(app().querySelector(".card"), card);
  });
});
