import { happy, resetTestDOM } from "../../../../test-support/boot-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { appRoot } from "../../../app/dom-root";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import { clearAgentTraceCache } from "../../../lib/agent-trace-cache";
import { setLang } from "../../../lib/i18n";
import type { AgentTracePage } from "../../../lib/operations";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import type { LiveSession } from "../../../lib/protocol/client";
import { applyTrace, chatSnapshot, setTraceLoadState } from "./trace-store";
import { leaveAgentChat, patchAgentChat, stickAgentStream, submitAgentPrompt } from "./agent-chat-controller";
import { applyCapabilities, setOperationBusy } from "../../operations/capabilities-store";
import { setComposeDraft } from "../compose-store";
import { clearNotice } from "../../../app/notices-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../../dashboard/catalog-store";
import { resetPaneView, selectPane, setAgentChat } from "../session-store";
import { setPhase } from "../../connection/connection-store";
import { setScreen } from "../../../app/navigation-store";
import { bindSessionOwnerFromLive } from "../bind-live";
import { AgentChatPane } from "./agent-chat";
import { endTailGlide, glideToTail, glidingToTail, pinTail } from "./tail-glide";

const handlers = { onBack() {}, onWorkspace() {}, onMenu() {}, onSwitch() {} };
const page: AgentTracePage = { items: [{ type: "user", text: "Question" }, { type: "assistant", text: "Reply" }], nextCursor: null, truncated: false };

type Glide = { top: number; behavior?: string };

/** A stream with a real box: 100 tall over 600 of transcript (or `height()`), and smooth scrolls recorded instead of run. */
function boxed(node: HTMLElement, scrollTop: number, height: () => number = () => 600): Glide[] {
  const glides: Glide[] = [];
  Object.defineProperties(node, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, get: height },
    scrollTo: { configurable: true, value: (options: Glide) => { glides.push(options); } },
  });
  node.scrollTop = scrollTop;
  return glides;
}
const fire = (node: HTMLElement, type: string): void => { node.dispatchEvent(new happy.Event(type, { bubbles: true }) as unknown as Event); };

beforeEach(async () => {
  await resetTestDOM();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.requestAnimationFrame = happy.requestAnimationFrame.bind(happy);
  globals.cancelAnimationFrame = happy.cancelAnimationFrame.bind(happy);
  resetComposeDrafts();
  clearAgentTraceCache();
  resetPaneView();
  setLang("zh");
  setPhase("live");
  setScreen("pane");
  selectPane("p1");
  setCredential(null);
  setAgentChat(true);
  setTraceLoadState("ready");
  applyTrace({ agentTraceItems: page.items, agentTraceTail: 2, agentTraceSig: JSON.stringify(page.items), agentTraceFollow: true });
  setOperationBusy(false);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: true, history: true }, []);
  replaceAgentsFromSnapshot({
    focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
    workspaces: [{ workspace_id: "w1", label: "demo" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
    panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/tmp/glide", agent: "codex", agent_status: "idle", history_available: true }],
  });
  clearNotice();
  attachLiveSession({ isConnected: () => true, agentTrace: async () => page, promptAgent: async () => ({ outcome: "applied" }) } as unknown as LiveSession);
});
afterEach(() => {
  endTailGlide();
  act(unmountReact);
  leaveAgentChat({ paint: false });
  resetComposeDrafts();
  clearAgentTraceCache();
  attachLiveSession(null);
  setAgentChat(false);
  selectPane("");
});

function mount(): HTMLElement {
  bindSessionOwnerFromLive();
  act(() => renderReact(<AgentChatPane includeBack handlers={handlers} />));
  return appRoot().querySelector<HTMLElement>(".agent-stream")!;
}

test("a glide is one smooth scroll to the tail, and pinning the tail meanwhile retargets it instead of jumping", () => {
  const stream = happy.document.createElement("div") as unknown as HTMLElement;
  const glides = boxed(stream, 380);
  let height = 600;
  Object.defineProperty(stream, "scrollHeight", { configurable: true, get: () => height });
  glideToTail(stream);
  expect(glides).toEqual([{ top: 600, behavior: "smooth" }]);
  expect([glidingToTail(stream), stream.scrollTop]).toEqual([true, 380]);
  // The same tail: the scroll already heads there and is not started over.
  pinTail(stream);
  expect([glides.length, stream.scrollTop]).toEqual([1, 380]);
  // The transcript grew under the glide: it is sent on to the new tail.
  height = 700;
  pinTail(stream);
  expect(glides[1]).toEqual({ top: 700, behavior: "smooth" });
  expect(stream.scrollTop).toBe(380);
  height = 600;
  // Nearly there is still on the way; arrived, it is over and the tail is pinned by a plain jump again.
  stream.scrollTop = 480;
  fire(stream, "scroll");
  expect(glidingToTail(stream)).toBeTrue();
  stream.scrollTop = 500;
  fire(stream, "scroll");
  expect(glidingToTail(stream)).toBeFalse();
  stream.scrollTop = 300;
  pinTail(stream);
  expect([stream.scrollTop, glides.length]).toEqual([600, 2]);
});

test("the reader's own scroll ends a glide at once", () => {
  for (const input of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    const stream = happy.document.createElement("div") as unknown as HTMLElement;
    boxed(stream, 100);
    glideToTail(stream);
    expect(glidingToTail(stream)).toBeTrue();
    fire(stream, input);
    expect(glidingToTail(stream), input).toBeFalse();
  }
});

test("under reduced motion the tail is reached by the jump it always was", () => {
  const globals = globalThis as unknown as { matchMedia: unknown };
  const media = globals.matchMedia;
  globals.matchMedia = () => ({ matches: true });
  try {
    const stream = happy.document.createElement("div") as unknown as HTMLElement;
    const glides = boxed(stream, 100);
    glideToTail(stream);
    expect([stream.scrollTop, glides.length, glidingToTail(stream)]).toEqual([600, 0, false]);
  } finally {
    globals.matchMedia = media;
  }
});

test("a prompt sent from the tail scrolls in; the glide keeps the reader following and a poll during it does not cut it short", async () => {
  const stream = mount();
  // Each prompt adds 300 to the transcript: at the tail before the send, 300 short of it after.
  const glides = boxed(stream, 500, () => 300 + 300 * stream.querySelectorAll(".agent-user").length);
  setComposeDraft("Next question");
  let sent!: Promise<void>;
  act(() => { sent = submitAgentPrompt(); });
  expect(appRoot().querySelectorAll(".agent-user")).toHaveLength(2);
  expect(glides[0]).toEqual({ top: 900, behavior: "smooth" });
  expect(glidingToTail(stream)).toBeTrue();
  // On its way the stream is short of its tail. That is not the reader leaving: the follow holds.
  stream.scrollTop = 650;
  act(() => fire(stream, "scroll"));
  expect([glidingToTail(stream), chatSnapshot().agentTraceFollow]).toEqual([true, true]);
  // What pins the tail meanwhile (the field resizing, the send's own second paint, a poll) moves the target, never the position.
  act(() => { stickAgentStream(); patchAgentChat(); });
  expect(stream.scrollTop).toBe(650);
  expect(glides.every((glide) => glide.behavior === "smooth")).toBeTrue();
  await act(async () => { await sent; });
  expect(chatSnapshot().agentTraceFollow).toBeTrue();
});

test("a prompt sent from further up takes the reader to it at once", async () => {
  applyTrace({ agentTraceFollow: false });
  const stream = mount();
  const glides = boxed(stream, 80);
  setComposeDraft("Next question");
  let sent!: Promise<void>;
  act(() => { sent = submitAgentPrompt(); });
  expect([stream.scrollTop, glides.length, glidingToTail(stream)]).toEqual([600, 0, false]);
  await act(async () => { await sent; });
});
