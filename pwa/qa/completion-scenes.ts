import type { SnapshotWire } from "../src/lib/dashboard";
import { replaceAgentsFromSnapshot } from "../src/features/dashboard/catalog-store";
import { snapshot } from "./data";

export type CompletionObservation = "initial" | "idle" | "working" | "unknown" | "missing" | "recovered" | "new-turn";

export function completionSnapshot(stage: CompletionObservation = "initial"): SnapshotWire {
  const base = snapshot();
  return {
    ...base,
    panes: base.panes!.slice(0, 3).map((pane, index) => ({
      ...pane, agent: "codex", label: `Completion ${index + 1}`,
      terminal_id: `completion-terminal-${index}`, agent_instance_id: `${index + 1}`.repeat(64),
      agent_status: ["idle", "working", "unknown"].includes(stage) ? stage : "done",
      state_change_seq: stage === "initial" ? 7 : 11,
      completion_id: ["idle", "working", "unknown", "missing"].includes(stage) ? undefined
        : (stage === "new-turn" && index === 1 ? "f" : `${index + 1}`).repeat(64),
    })),
  };
}

export function applyCompletionObservation(stage: CompletionObservation): void {
  replaceAgentsFromSnapshot(completionSnapshot(stage));
}
