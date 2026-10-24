import { describe, expect, test } from "bun:test";
import type { DashboardAgentCard } from "./dashboard";
import {
  forgetCompletionsSeen,
  markAllCompletionsSeen,
  markCompletionSeen,
  parseSeenCompletions,
  projectAgentSubmission,
  projectCompletionAttention,
  restoreUnseenCompletions,
} from "./completion-attention";

function agent(paneId: string, status: DashboardAgentCard["status"]): DashboardAgentCard {
  return { paneId, status, agent: "codex", hasAgent: true, workspaceLabel: "Pairfob", cwd: "/repo" };
}

describe("completion attention", () => {
  test("a viewed completion is presented as idle across snapshots", () => {
    const first = projectCompletionAttention([agent("p1", "done")], {}, { p1: true });
    expect(first.runtimeStatuses.p1).toBe("done");
    expect(first.agents[0].status).toBe("idle");

    const next = projectCompletionAttention([agent("p1", "done")], first.runtimeStatuses, first.seen);
    expect(next.agents[0].status).toBe("idle");
    expect(next.seen).toBe(first.seen);
  });

  test("a new completion becomes visible after intervening work", () => {
    const working = projectCompletionAttention([agent("p1", "working")], { p1: "done" }, { p1: true });
    expect(working.seen).toEqual({});
    expect(working.agents[0].status).toBe("working");

    const completed = projectCompletionAttention([agent("p1", "done")], working.runtimeStatuses, working.seen);
    expect(completed.agents[0].status).toBe("done");
  });

  test("an unknown observation preserves read completions until their identity can be checked again", () => {
    const finished = [
      agent("legacy", "done"),
      { ...agent("rich", "done"), terminalId: "t1", agentInstanceId: "a1", stateChangeSeq: 7 },
    ];
    const { seen } = markAllCompletionsSeen({}, { legacy: "done", rich: "done" }, finished);
    // Recovery may not yet have the optional runtime identity/sequence either.
    const unknown = projectCompletionAttention(finished.map(a => agent(a.paneId, "unknown")),
      { legacy: "done", rich: "done" }, seen);
    expect(unknown.seen).toBe(seen);
    expect(unknown.agents.map(a => a.status)).toEqual(["unknown", "unknown"]);
    const restored = projectCompletionAttention(finished, unknown.runtimeStatuses, unknown.seen);
    expect(restored.agents.map(a => a.status)).toEqual(["idle", "idle"]);

    for (const change of [{ stateChangeSeq: 8 }, { agentInstanceId: "a2" }, { terminalId: "t2" }, { runtimeSession: "other" }]) {
      const newer = projectCompletionAttention([finished[0], { ...finished[1], ...change }], unknown.runtimeStatuses, unknown.seen);
      expect(newer.agents.map(a => a.status)).toEqual(["idle", "done"]);
    }
    for (const status of ["working", "blocked"] as const) {
      const active = projectCompletionAttention([agent("legacy", status)], unknown.runtimeStatuses, unknown.seen);
      expect(projectCompletionAttention([agent("legacy", "done")], active.runtimeStatuses, active.seen).agents[0].status).toBe("done");
    }
  });

  test("reading only acknowledges a currently completed pane", () => {
    const seen = markCompletionSeen({}, { p1: "done", p2: "working" }, "p1");
    expect(seen).toEqual({ p1: true });
    expect(markCompletionSeen(seen, { p1: "done", p2: "working" }, "p2")).toBe(seen);
  });

  test("a successful submit starts a new cycle before the next terminal read", () => {
    const submitted = projectAgentSubmission(
      [agent("p1", "idle"), agent("p2", "idle")],
      { p1: "done", p2: "done" },
      { p1: true, p2: true },
      "p1",
    );
    expect(submitted.agents[0].status).toBe("working");
    expect(submitted.runtimeStatuses.p1).toBe("working");
    expect(submitted.seen).toEqual({ p2: true });

    const completed = projectCompletionAttention([agent("p1", "done")], submitted.runtimeStatuses, submitted.seen);
    expect(completed.agents[0].status).toBe("done");
  });

  test("rich acknowledgements are scoped to session, occupant, and sequence", () => {
    const rich = { ...agent("p1", "done"), runtimeSession: "named", terminalId: "t1", agentInstanceId: "a1", stateChangeSeq: 7 };
    const seen = markCompletionSeen({}, { p1: "done" }, "p1", [rich]);
    expect(seen.p1).toBe('["named","t1","a1",7]');
    expect(projectCompletionAttention([rich], { p1: "done" }, seen).agents[0].status).toBe("idle");
    expect(projectCompletionAttention([{ ...rich, stateChangeSeq: 8 }], { p1: "done" }, seen).agents[0].status).toBe("done");
    expect(projectCompletionAttention([{ ...rich, agentInstanceId: "a2" }], { p1: "done" }, seen).seen).toEqual({});
    expect(projectCompletionAttention([{ ...agent("p1", "done"), runtimeSession: "other" }], { p1: "done" }, { p1: true }).agents[0].status).toBe("done");
  });

  test("removed panes and malformed stored entries are discarded", () => {
    const projected = projectCompletionAttention([agent("p2", "done")], { p1: "done" }, { p1: true, p2: true });
    expect(projected.seen).toEqual({ p2: true });
    expect(parseSeenCompletions('{"p1":true,"p2":false,"p3":"token","":true}')).toEqual({ p1: true, p3: "token" });
    expect(parseSeenCompletions("not json")).toEqual({});
  });

  test("stored pane ids cannot affect object prototypes", () => {
    const parsed = parseSeenCompletions('{"__proto__":true,"constructor":true}');
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.hasOwn(parsed, "constructor")).toBe(true);
  });

  test("mark all read acknowledges only the unread completions, and an undo takes back only those", () => {
    const rich = { ...agent("p3", "done"), runtimeSession: "named", terminalId: "t3", agentInstanceId: "a3", stateChangeSeq: 2 };
    const agents = [agent("p1", "done"), agent("p2", "working"), rich, { ...agent("p4", "idle") }, { ...agent("p5", "done"), hasAgent: false }];
    const statuses = { p1: "done", p2: "working", p3: "done", p4: "done", p5: "done" } as const;
    // p4 was read before: it is idle on the list and keeps its own acknowledgement.
    const before = { p4: true } as const;
    const { seen, added } = markAllCompletionsSeen(before, statuses, agents);
    expect(seen).toEqual({ p4: true, p1: true, p3: '["named","t3","a3",2]' });
    expect(added).toEqual({ p1: true, p3: '["named","t3","a3",2]' });
    expect(markAllCompletionsSeen(seen, statuses, agents).seen).toBe(seen);

    // p1 was read again after the bulk read with a newer completion: its own acknowledgement stays.
    const later = { ...seen, p1: '["x","","",9]' };
    const undone = forgetCompletionsSeen(later, added);
    expect(undone).toEqual({ p4: true, p1: '["x","","",9]' });
    expect(forgetCompletionsSeen(undone, added)).toBe(undone);

    const shown = restoreUnseenCompletions([agent("p1", "idle"), { ...rich, status: "idle" }, agent("p4", "idle"), agent("p2", "working")],
      statuses, forgetCompletionsSeen(seen, added));
    expect(shown.map((card) => card.status)).toEqual(["done", "done", "idle", "working"]);
    const unchanged = [agent("p4", "idle")];
    expect(restoreUnseenCompletions(unchanged, statuses, { p4: true })).toBe(unchanged);
  });
});
