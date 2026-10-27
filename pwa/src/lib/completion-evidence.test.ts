import { describe, expect, test } from "bun:test";
import { herdSignature, mapSnapshotAgents, type DashboardAgentCard } from "./dashboard";
import { markCompletionSeen, projectCompletionAttention, projectAgentSubmission, parseSeenCompletions } from "./completion-attention";

const first: DashboardAgentCard = {
  paneId: "p1", status: "done", agent: "codex", hasAgent: true, workspaceLabel: "", cwd: "",
  terminalId: "t1", agentInstanceId: "a1", stateChangeSeq: 7, completionId: "a".repeat(64),
};
const read = () => markCompletionSeen({}, { p1: "done" }, "p1", [first]);

describe("transcript completion receipts", () => {
  test("snapshot mapping accepts only opaque digests and observes evidence-only changes", () => {
    const pane = { pane_id: "p1", workspace_id: "w1", agent: "codex", agent_status: "done" };
    const map = (completion_id: unknown) => mapSnapshotAgents({ panes: [{ ...pane, completion_id }] });
    for (const invalid of [undefined, null, 3, "", "private transcript text", "A".repeat(64), "a".repeat(63)]) {
      expect(map(invalid)[0].completionId).toBeUndefined();
    }
    expect(map(first.completionId)[0].completionId).toBe(first.completionId);
    expect(herdSignature(map(first.completionId))).not.toBe(herdSignature(map("b".repeat(64))));
  });
  test("runtime churn cannot rearm the same result, including across reloads", () => {
    for (const status of ["idle", "unknown", "working", "blocked"] as const) {
      const gap = projectCompletionAttention([{ ...first, status, stateChangeSeq: 8, completionId: undefined }], { p1: "done" }, read());
      expect(gap.agents[0].status).toBe(status);
      const stored = parseSeenCompletions(JSON.stringify(gap.seen));
      const recovered = projectCompletionAttention([{ ...first, stateChangeSeq: 9 }], {}, stored);
      expect(recovered.agents[0].status).toBe("idle");
    }
    expect(projectCompletionAttention([{ ...first, stateChangeSeq: 99 }], { p1: "done" }, read()).agents[0].status).toBe("idle");
  });

  test("a new completed transcript rearms even without a runtime sequence change", () => {
    const fresh = projectCompletionAttention([{ ...first, completionId: "b".repeat(64) }], { p1: "done" }, read());
    expect(fresh.agents[0].status).toBe("done");
    expect(fresh.seen).toEqual({});
  });

  test("missing evidence or optional identity is uncertain and keeps the receipt", () => {
    for (const change of [{ completionId: undefined }, { terminalId: undefined }, { agentInstanceId: undefined }]) {
      const seen = read();
      const gap = projectCompletionAttention([{ ...first, ...change }], { p1: "done" }, seen);
      expect(gap.agents[0].status).toBe("unknown");
      expect(gap.seen).toBe(seen);
      expect(markCompletionSeen(gap.seen, gap.runtimeStatuses, "p1", gap.agents)).toBe(seen);
      expect(projectCompletionAttention([first], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("idle");
      expect(projectCompletionAttention([{ ...first, completionId: "b".repeat(64) }], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("done");
    }
  });

  test("unknown recovery cannot invalidate receipts with provisional occupant fields", () => {
    for (const completionId of [first.completionId, undefined]) {
      const card = { ...first, completionId };
      const seen = markCompletionSeen({}, { p1: "done" }, "p1", [card]);
      const gap = projectCompletionAttention([{ ...card, status: "unknown", agentInstanceId: "provisional", stateChangeSeq: 0 }], { p1: "done" }, seen);
      expect(gap.seen).toBe(seen);
      expect(projectCompletionAttention([card], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("idle");
      expect(projectCompletionAttention([{ ...card, agentInstanceId: "replacement" }], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("done");
    }
  });

  test("replacement, removal, submission and session changes still retire receipts", () => {
    for (const change of [{ terminalId: "t2" }, { agentInstanceId: "a2" }, { runtimeSession: "other" }]) {
      const result = projectCompletionAttention([{ ...first, ...change }], { p1: "done" }, read());
      expect(result.agents[0].status).toBe("done");
      expect(result.seen).toEqual({});
    }
    expect(projectCompletionAttention([], { p1: "done" }, read()).seen).toEqual({});
    const sent = projectAgentSubmission([first], { p1: "done" }, read(), "p1");
    expect(sent.seen).toEqual({});
    expect(projectCompletionAttention([first], sent.runtimeStatuses, sent.seen).agents[0].status).toBe("done");
  });

  test("old receipts upgrade only at the exact acknowledged observation", () => {
    const legacy = { ...first, completionId: undefined };
    const seen = markCompletionSeen({}, { p1: "done" }, "p1", [legacy]);
    const upgraded = projectCompletionAttention([first], { p1: "done" }, seen);
    expect(upgraded.seen).toEqual(read());
    expect(projectCompletionAttention([{ ...first, stateChangeSeq: 10 }], upgraded.runtimeStatuses, upgraded.seen).agents[0].status).toBe("idle");
    expect(projectCompletionAttention([{ ...first, stateChangeSeq: 8 }], { p1: "done" }, seen).agents[0].status).toBe("done");
  });

  test("newly supplied identity does not leave a partial legacy receipt permanently unknown", () => {
    for (const missing of [{ agentInstanceId: undefined }, { terminalId: undefined }]) {
      const partial = { ...first, ...missing, completionId: undefined };
      const seen = markCompletionSeen({}, { p1: "done" }, "p1", [partial]);
      const upgraded = projectCompletionAttention([first], { p1: "done" }, seen);
      expect(upgraded.agents[0].status).toBe("done");
      expect(upgraded.seen).toEqual({});
      expect(markCompletionSeen(upgraded.seen, upgraded.runtimeStatuses, "p1", upgraded.agents)).toEqual(read());
    }
  });

  test("legacy idle and missing sequence do not delete a receipt; actual work does", () => {
    const legacy = { ...first, completionId: undefined };
    const seen = markCompletionSeen({}, { p1: "done" }, "p1", [legacy]);
    for (const change of [{ status: "idle" as const }, { stateChangeSeq: undefined }, { terminalId: undefined }]) {
      const gap = projectCompletionAttention([{ ...legacy, ...change }], { p1: "done" }, seen);
      expect(gap.seen).toBe(seen);
      expect(projectCompletionAttention([legacy], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("idle");
    }
    const stale = projectCompletionAttention([{ ...legacy, stateChangeSeq: 5 }], { p1: "done" }, seen);
    expect(stale.seen).toBe(seen);
    expect(stale.agents[0].status).toBe("idle");
    for (const status of ["working", "blocked"] as const) {
      const active = projectCompletionAttention([{ ...legacy, status }], { p1: "done" }, seen);
      expect(active.seen).toEqual({});
      expect(projectCompletionAttention([legacy], active.runtimeStatuses, active.seen).agents[0].status).toBe("done");
    }
  });

  test("unbound agents ignore sequence-only redetection but still report new output", () => {
    const unbound = { ...first, completionId: undefined, revision: 20 };
    const seen = markCompletionSeen({}, { p1: "done" }, "p1", [unbound]);
    const redetected = { ...unbound, stateChangeSeq: 30 };
    expect(projectCompletionAttention([redetected], { p1: "done" }, seen).agents[0].status).toBe("idle");
    const gap = projectCompletionAttention([{ ...redetected, status: "unknown" }], { p1: "done" }, seen);
    expect(projectCompletionAttention([redetected], gap.runtimeStatuses, gap.seen).agents[0].status).toBe("idle");
    for (const status of ["working", "blocked"] as const) {
      const churn = projectCompletionAttention([{ ...redetected, status }], { p1: "done" }, seen);
      expect(churn.seen).toBe(seen);
      expect(churn.agents[0].status).toBe(status);
      expect(projectCompletionAttention([redetected], churn.runtimeStatuses, churn.seen).agents[0].status).toBe("idle");
      const working = projectCompletionAttention([{ ...redetected, status, revision: 21 }], churn.runtimeStatuses, churn.seen);
      expect(working.seen).toEqual({});
      expect(projectCompletionAttention([{ ...redetected, revision: 21 }], working.runtimeStatuses, working.seen).agents[0].status).toBe("done");
    }
    const missing = projectCompletionAttention([{ ...redetected, revision: undefined }], { p1: "done" }, seen);
    expect(missing.agents[0].status).toBe("unknown");
    expect(missing.seen).toBe(seen);
    expect(projectCompletionAttention([{ ...redetected, revision: 21 }], { p1: "done" }, seen).agents[0].status).toBe("done");
    // The first transcript binding must not swallow new output just because
    // Herdr has not advanced its state sequence yet.
    expect(projectCompletionAttention([{ ...unbound, revision: 21, completionId: first.completionId }], { p1: "done" }, seen).agents[0].status).toBe("done");
  });
});
