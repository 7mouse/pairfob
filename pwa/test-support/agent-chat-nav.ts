import { beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { resetChatDOM } from "./chat-dom";
import { closeTestDialogs } from "./close-dialogs";
import type { LiveSession } from "../src/lib/protocol/client";
import type { SnapshotWire } from "../src/lib/dashboard";

const { applyTrace, chatSnapshot } = await import("../src/features/session/chat/trace-store.ts");
const { appRoot } = await import("../src/app/dom-root.ts");
const { commitView } = await import("../src/app/host.ts");
const { mountApp, unmountApp } = await import("../src/app/mount.tsx");
const { registerSessionOwnerPreparer } = await import("../src/app/frame.ts");
const { registerSessionView } = await import("../src/features/session/register.ts");
const { resetTransitionState } = await import("../src/app/transition.ts");
const { clearAgentTraceCache } = await import("../src/lib/agent-trace-cache.ts");
const { resetComposeDrafts } = await import("../src/features/session/drafts/compose-drafts.ts");
const { setLang } = await import("../src/lib/i18n.ts");
const { setPhase } = await import("../src/features/connection/connection-store.ts");
const { setScreen } = await import("../src/app/navigation-store.ts");
const { selectPane, setAgentChat, resetPaneView, setFullTerminal } = await import("../src/features/session/session-store.ts");
const { applyCapabilities } = await import("../src/features/operations/capabilities-store.ts");
const { attachLiveSession } = await import("../src/features/computers/catalog-store.ts");
const { applySnapshot } = await import("../src/features/dashboard/catalog-store.ts");
const { paneTermMode, setPaneTermMode, resetPreferences } = await import("../src/features/settings/preferences-store.ts");
const { setComposeDraft, resetComposeField } = await import("../src/features/session/compose-store.ts");
const { clearNotice } = await import("../src/app/notices-store.ts");
import { happy as happyDom } from "./dom";

const app = appRoot();

const SEED_ITEMS = [
  { type: "user" as const, text: "inspect this" },
  { type: "thinking" as const, text: "I will read it" },
  { type: "tool" as const, name: "Read", input: "{\"path\":\"a.ts\"}", output: "ok" },
  { type: "assistant" as const, text: "looks fine" },
];

function live(): LiveSession {
  return {
    agentTrace: async () => ({
      items: SEED_ITEMS.map((item) => ({ ...item })),
      nextCursor: null,
      truncated: false,
    }),
    agentTraceDetail: async (_paneId: string, detailRef: string) => ({ detailRef, input: "{}", output: "ok", truncated: false }),
    promptAgent: async () => ({ operation_id: "op_AAECAwQFBgcICQoL", pane_id: "p1", agent_status: "working", outcome: "applied" }),
    sendKeys: async () => undefined,
    sendText: async () => undefined,
    isConnected: () => true,
    onEvent: () => () => undefined,
    reconnectNow: () => undefined,
    close: () => undefined,
  } as unknown as LiveSession;
}

// Typed accessors replacing the legacy state facade in the test bodies.
const trace = () => chatSnapshot();
const setTrace = (patch: Parameters<typeof applyTrace>[0]): void => { applyTrace(patch); };
const setLive = (handle: LiveSession | null): void => { attachLiveSession(handle); };
// A seeded agent row as the tests build it (camelCase, like the old facade card).
type SeedAgent = {
  paneId?: string;
  agent?: string;
  hasAgent?: boolean;
  status?: string;
  cwd?: string;
  historyAvailable?: boolean;
};
const setAgents = (agents: ReadonlyArray<SeedAgent>, cwd = "/tmp/demo"): void => {
  const snapshot: SnapshotWire = {
    workspaces: [{ workspace_id: "w1", label: "demo", cwd }],
    panes: agents.map((a) => ({
      pane_id: a.paneId ?? "p1",
      workspace_id: "w1",
      agent: a.hasAgent === false || a.agent === "" ? "" : (a.agent ?? "codex"),
      agent_status: a.status ?? "working",
      cwd: a.cwd ?? cwd,
      history_available: a.historyAvailable ?? true,
    })),
  };
  applySnapshot(snapshot);
};

function paintPane(): void {
  commitView();
}

function bootAgentChat(draft = ""): void {
  act(() => {
    setLang("zh");
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    resetPaneView();
    setFullTerminal(false);
    setAgentChat(true);
    setComposeDraft(draft);
    applyCapabilities({ prompt_agent: true, history: true }, []);
    setLive(live());
    setAgents([{
      paneId: "p1",
      agent: "codex",
      hasAgent: true,
      status: "working",
      cwd: "/tmp/demo",
      historyAvailable: true,
    }]);
    setTrace({
      agentTraceLoadState: "ready",
      agentTraceItems: SEED_ITEMS.map((item) => ({ ...item })),
      agentTraceTail: SEED_ITEMS.length,
      agentTraceSig: "seed",
      agentTraceTruncated: false,
      agentTracePending: "",
      agentTracePendingBase: [],
      agentTraceFollow: true,
      agentTraceUnread: false,
    });
    setPaneTermMode("p1", "agent");
    commitView();
  });
}

function click(selector: string): void {
  const el = app.querySelector(selector);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`missing ${selector}: ${app.innerHTML.slice(0, 280)}`);
  el.click();
}

// Re-point the navigation to a pane's chat view (typed domain actions + commit).
// Reads the saved per-pane term mode (it does NOT write a preference); callers
// that must force agent mode (the stale-p2 owner switch) pass agent=true after
// explicitly setting the pane term mode.
function showChatPane(paneId: string, agent = paneTermMode(paneId) === "agent"): void {
  setScreen("pane");
  selectPane(paneId);
  setAgentChat(agent);
  commitView();
}

export function useAgentChatNavFixture(): void {
  beforeEach(async () => {
    await resetChatDOM();
    // The app refuses to render a pane before its connected features are loaded.
    // Load them here, as the app tests do, so this file does not depend on
    // running after another file in the suite.
    await (await import("../src/app/connected-loader.ts")).loadConnectedRuntime();
    resetTransitionState();
    clearAgentTraceCache();
    resetComposeDrafts();
    registerSessionOwnerPreparer(registerSessionView);
    act(() => mountApp());
  });

  afterEach(async () => await act(async () => {
    closeTestDialogs();
    // Drop any in-flight trace read and reset the chat view synchronously, then
    // let leaked read/detail continuations settle before unmount so they cannot
    // hold busy or publish into the next test's mount.
    clearAgentTraceCache();
    setTrace({
      agentTraceItems: [],
      agentTraceLoadState: "cold",
      agentTraceSig: "",
      agentTraceTail: 0,
      agentTracePending: "",
      agentTracePendingBase: [],
      agentTraceNext: null,
      agentTraceFollow: true,
      agentTraceBusy: false,
      agentTraceNote: "",
      agentTraceTruncated: false,
    });
    // The original teardown reset the pinned notice; a leaked copy/completion
    // notice would otherwise persist into the next mount.
    clearNotice();
    attachLiveSession(null);
    setAgentChat(false);
    setFullTerminal(false);
    selectPane("");
    setScreen("home");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    unmountApp();
    // Restore the named data baselines (compose field, draft store, per-pane
    // preferences) after the App unmounts; the original afterEach cleared the
    // draft and paneTermModes. These reset data only — the subscriber registry
    // stays intact for the next mount.
    resetComposeField();
    resetComposeDrafts();
    resetPreferences();
    registerSessionOwnerPreparer(null);
    resetTransitionState();
    await happyDom.happyDOM.abort();
  }));
}

export { app, SEED_ITEMS, live, trace, setTrace, setLive, setAgents, paintPane, bootAgentChat, click, showChatPane };
