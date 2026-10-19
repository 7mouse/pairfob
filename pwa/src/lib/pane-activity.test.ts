import { describe, expect, test } from "bun:test";
import { herdSignature, mapSnapshotAgents, type SnapshotWire } from "./dashboard.ts";
import { parsePaneActivity } from "./pane-activity.ts";

describe("pane activity from the snapshot", () => {
  test("keeps the reported step and the finished turn's facts", () => {
    expect(parsePaneActivity({
      type: "tool", name: "Edit", label: " internal/journal/activity.go ", state: "running", at: 1760600123000,
      turn: { steps: 12, files: 4, plan: "3/5", failed: true, interrupted: false },
    })).toEqual({
      type: "tool", name: "Edit", label: "internal/journal/activity.go", state: "running", at: 1760600123000,
      turn: { steps: 12, files: 4, plan: "3/5", failed: true },
    });
    expect(parsePaneActivity({ type: "thinking" })).toEqual({ type: "thinking" });
  });

  test("drops what it cannot trust instead of failing the snapshot", () => {
    for (const wire of [undefined, null, "tool", [], { type: "user" }, { type: 1 }]) expect(parsePaneActivity(wire)).toBeUndefined();
    expect(parsePaneActivity({ type: "tool", name: 3, label: "x".repeat(600), state: "maybe", at: -1, turn: { steps: 1 } }))
      .toEqual({ type: "tool" });
    expect(parsePaneActivity({ type: "assistant", turn: { steps: 2, files: 0, plan: "all" } }))
      .toEqual({ type: "assistant", turn: { steps: 2, files: 0 } });
  });

  test("only an agent pane carries it, and a new step is a new list", () => {
    const wire = (activity: unknown, agent = "claude"): SnapshotWire => ({
      workspaces: [{ workspace_id: "w1", label: "alpha" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", agent, agent_status: "working", activity }],
    });
    const step = { type: "tool", name: "Bash", label: "go test ./...", state: "running" };
    expect(mapSnapshotAgents(wire(step))[0].activity).toEqual(step as never);
    expect("activity" in mapSnapshotAgents(wire(step, ""))[0]).toBeFalse();
    expect("activity" in mapSnapshotAgents(wire({ type: "nope" }))[0]).toBeFalse();
    expect(herdSignature(mapSnapshotAgents(wire(step))))
      .not.toBe(herdSignature(mapSnapshotAgents(wire({ ...step, label: "go vet ./..." }))));
  });
});
