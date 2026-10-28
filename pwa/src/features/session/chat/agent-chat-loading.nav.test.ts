import { describe, expect, test } from "bun:test";
import { act } from "react";
import { expectSameNode } from "../../../../test-support/node-identity";
import {
  app, live, trace, setTrace, setLive, setAgents, paintPane, bootAgentChat, showChatPane,
  useAgentChatNavFixture,
} from "../../../../test-support/agent-chat-nav";

import { ProtocolError } from "../../../lib/protocol/errors";
import type { LiveSession } from "../../../lib/protocol/client";

const { goBackFromPane } = await import("../pane-actions.ts");
const { leaveAgentChat, patchAgentChat, refreshAgentTrace, restoreAgentTrace } = await import("./agent-chat-controller.ts");
const { selectedAgent } = await import("../../dashboard/catalog-store.ts");
const { setPaneTermMode } = await import("../../settings/preferences-store.ts");

useAgentChatNavFixture();

describe("agent-chat trace loading across navigation", () => {
  test("a cold working conversation shows loading instead of the empty call to action", async () => await act(async () => {
    bootAgentChat();
    let finish: ((page: Awaited<ReturnType<ReturnType<typeof live>["agentTrace"]>>) => void) | undefined;
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive({
      ...live(),
      agentTrace: () => new Promise((resolve) => { finish = resolve; }),
    });

    paintPane();
    expect(app.querySelector(".agent-empty-working .agent-empty-title")?.textContent).toBe("正在执行");
    expect(app.querySelector(".agent-empty .spinner")).toBeTruthy();
    expect(app.textContent).not.toContain("还没有对话");

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    finish?.({ items: [], nextCursor: null, truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(app.querySelector(".agent-empty-working")).toBeTruthy();
    expect(app.textContent).not.toContain("还没有对话");
  }));

  test("a cold idle conversation uses loading and only shows the empty action after success", async () => await act(async () => {
    bootAgentChat();
    let finish: ((page: { items: []; nextCursor: null; truncated: false }) => void) | undefined;
    setAgents([{ ...(selectedAgent() ?? { paneId: "p1" }), status: "idle" }]);
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive({
      ...live(),
      agentTrace: () => new Promise((resolve) => { finish = resolve; }),
    });

    paintPane();
    expect(app.querySelector(".agent-empty-loading")).toBeTruthy();
    expect(app.querySelector(".agent-empty-title")?.textContent).toBe("正在读取执行过程");
    expect(app.querySelector(".agent-empty .spinner")).toBeTruthy();
    expect(app.textContent).not.toContain("还没有对话");
    expect(app.querySelector(".agent-stream")?.getAttribute("aria-busy")).toBe("true");

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    finish?.({ items: [], nextCursor: null, truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(app.querySelector(".agent-empty-empty .agent-empty-title")?.textContent).toBe("还没有对话");
    expect(app.querySelector(".agent-empty-sub")?.textContent).toContain("在下面");
    expect(app.querySelector(".agent-stream")?.getAttribute("aria-busy")).toBe("false");
  }));

  test("returning to a pane paints its last successful trace before refreshing", async () => await act(async () => {
    bootAgentChat();
    await refreshAgentTrace();
    goBackFromPane();
    showChatPane("p1");
    expect(restoreAgentTrace("p1")).toBe(true);
    paintPane();
    expect(app.textContent).toContain("looks fine");
    expect(app.textContent).not.toContain("还没有对话");
  }));

  test("the newest page paints before background context pagination finishes", async () => await act(async () => {
    bootAgentChat();
    let finishOlder: ((page: { items: Array<{ type: "user"; text: string }>; nextCursor: null; truncated: false }) => void) | undefined;
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive({
      ...live(),
      agentTrace: async (_paneId: string, cursor: string | null) => {
        if (!cursor) return { items: [{ type: "assistant" as const, text: "newest reply" }], nextCursor: "older-1", truncated: false };
        return new Promise((resolve) => { finishOlder = resolve; });
      },
    });

    paintPane();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    expect(app.textContent).toContain("newest reply");
    expect(trace().agentTraceBusy).toBe(true);

    finishOlder?.({ items: [{ type: "user", text: "owning prompt" }], nextCursor: null, truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(app.textContent).toContain("owning prompt");
  }));

  test("deduplicates a repeated page-context user without losing older steps on refresh", async () => await act(async () => {
    bootAgentChat();
    let latestOutput = "latest-old";
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceTail: 0 });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive({
      ...live(),
      agentTrace: async (_paneId: string, cursor: string | null) => cursor
        ? {
            items: [
              { type: "user" as const, text: "owning prompt" },
              { type: "tool" as const, name: "Early", output: "early" },
            ],
            nextCursor: null,
            truncated: false,
          }
        : {
            items: [
              { type: "user" as const, text: "owning prompt" },
              { type: "tool" as const, name: "Latest", output: latestOutput },
            ],
            nextCursor: "older-1",
            truncated: false,
          },
    });

    await refreshAgentTrace();
    await refreshAgentTrace(true);
    expect(trace().agentTraceItems.filter((item) => item.type === "user")).toHaveLength(1);
    expect(trace().agentTraceItems.map((item) => item.name || item.text)).toEqual(["owning prompt", "Early", "Latest"]);

    latestOutput = "latest-new";
    await refreshAgentTrace();
    expect(trace().agentTraceItems.map((item) => item.name || item.text)).toEqual(["owning prompt", "Early", "Latest"]);
    expect(trace().agentTraceItems.at(-1)?.output).toBe("latest-new");
  }));

  test("a stale pane request cannot replace or unlock the current conversation", async () => await act(async () => {
    bootAgentChat();
    let finishP1: ((page: { items: Array<{ type: "assistant"; text: string }>; nextCursor: null; truncated: false }) => void) | undefined;
    let finishP2: ((page: { items: Array<{ type: "assistant"; text: string }>; nextCursor: null; truncated: false }) => void) | undefined;
    const session = {
      ...live(),
      agentTrace: (paneId: string) => new Promise((resolve) => {
        if (paneId === "p1") finishP1 = resolve;
        else finishP2 = resolve;
      }),
    } as unknown as LiveSession;
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive(session);
    refreshAgentTrace();

    paintPane();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(trace().agentTraceBusy).toBe(true);

    leaveAgentChat({ rememberGuided: false, paint: false });
    setAgents([{ paneId: "p2", agent: "codex", status: "working" }]);
    // The stale-p2 case explicitly re-enters agent chat on p2 (original set
    // agentChat=true after the owner switch).
    setPaneTermMode("p2", "agent");
    showChatPane("p2", true);
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    refreshAgentTrace();
    paintPane();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(trace().agentTraceBusy).toBe(true);

    finishP1?.({ items: [{ type: "assistant", text: "stale p1 reply" }], nextCursor: null, truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(trace().agentTraceBusy).toBe(true);
    expect(app.textContent).not.toContain("stale p1 reply");

    finishP2?.({ items: [{ type: "assistant", text: "current p2 reply" }], nextCursor: null, truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(trace().agentTraceBusy).toBe(false);
    expect(app.textContent).toContain("current p2 reply");
  }));

  test("renders trace clipping as a quiet stream note instead of a pinned global notice", async () => {
    bootAgentChat();
    setLive({
      ...live(),
      agentTrace: async () => ({ ...(await live().agentTrace()), truncated: true }),
    });
    await act(async () => { await refreshAgentTrace(); });

    const limit = app.querySelector(".agent-stream-inner > .agent-trace-limit");
    expect(limit?.textContent).toBe("部分较长内容已省略");
    expect(app.querySelector(".agent-chat-root > [data-app-notice]")).toBeNull();
    expect(trace().agentTraceNote).toBe("");

    setLive(live());
    await act(async () => { await refreshAgentTrace(); });
    expect(app.querySelector(".agent-trace-limit")).toBeNull();
  });

  test("an oversized trace read keeps the current chat instead of claiming the prompt was not sent", async () => await act(async () => {
    bootAgentChat();
    setLive({
      ...live(),
      agentTrace: async () => { throw new ProtocolError("too_large", "response exceeds protocol limit"); },
    });
    await refreshAgentTrace();
    const notice = app.querySelector(".agent-chat-root > [data-app-notice]");
    expect(notice?.textContent).toContain("没能完整读取");
    expect(app.querySelector(".agent-dock [data-app-notice]")).toBeNull();
    expect(app.querySelector(".agent-stream [data-app-notice]")).toBeNull();
    expect(app.textContent).not.toContain("没有发送");
    expect(app.textContent).toContain("looks fine");
    expect(patchAgentChat({ follow: true })).toBe(true);
    expectSameNode(app.querySelector(".agent-chat-root > [data-app-notice]"), notice);
  }));

  test("a failed empty read offers retry in the centered empty state", async () => await act(async () => {
    bootAgentChat();
    setAgents([{ ...(selectedAgent() ?? { paneId: "p1" }), status: "idle" }]);
    setTrace({ agentTraceItems: [] });
    setTrace({ agentTraceLoadState: "cold" });
    setTrace({ agentTraceSig: "" });
    setLive({
      ...live(),
      agentTrace: async () => { throw new ProtocolError("internal", "boom"); },
    });
    setTrace({ agentTraceBusy: false });
    await refreshAgentTrace();
    expect(app.querySelector(".agent-empty-error")).toBeTruthy();
    expect(app.querySelector(".agent-empty-error button")?.textContent).toBe("重试");
    expect(app.querySelector(".agent-dock [data-app-notice]")).toBeNull();
  }));
});
