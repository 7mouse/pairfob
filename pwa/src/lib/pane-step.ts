/**
 * What a list row says the agent is doing, from the step its snapshot reports
 * (`pane-activity.ts`): the step a working agent is on, what a blocked one
 * waits to do, and what a finished turn came to. The words are the chat view's
 * (`agent-trace-steps.ts`), so a row and the open session name a step alike.
 */
import type { DashboardAgentCard } from "./dashboard";
import { t } from "./i18n";
import type { AgentTraceItem } from "./operations";
import type { PaneActivity } from "./pane-activity";
import { categoryLabel, stepCategory, stepObject } from "./agent-trace-steps";

/** `lead` is the kind or result, `object` its target; `running` a step not yet answered. */
export type RowStep = { lead: string; object: string; running: boolean; failed: boolean };

function traceItem(activity: PaneActivity): AgentTraceItem {
  return { type: activity.type, name: activity.name, label: activity.label, toolState: activity.state };
}

function currentStep(activity: PaneActivity): RowStep {
  if (activity.type === "thinking") return { lead: categoryLabel("think"), object: "", running: false, failed: false };
  if (activity.type === "assistant") return { lead: t("list.stepReply"), object: "", running: false, failed: false };
  const item = traceItem(activity);
  return { lead: categoryLabel(stepCategory(item)), object: stepObject(item), running: activity.state === "running", failed: false };
}

/** The chat view's `pendingAsk` words for the tool a blocked agent holds. */
function askStep(activity: PaneActivity): RowStep | null {
  if (activity.type !== "tool") return null;
  const item = traceItem(activity);
  const category = stepCategory(item);
  const lead = category === "command" ? t("needs.run") : category === "edit" ? t("needs.edit")
    : category === "question" ? t("needs.ask") : t("needs.tool", { name: activity.name || "" });
  return { lead, object: stepObject(item), running: false, failed: false };
}

/** Result first, as the chat view's turn card puts it; a turn the computer could not see whole names its last step. */
function outcomeStep(activity: PaneActivity): RowStep | null {
  const turn = activity.turn;
  if (!turn) return activity.type === "tool" ? currentStep({ ...activity, state: undefined }) : null;
  const plan = turn.plan ? t("work.plan", { progress: turn.plan }) : "";
  if (turn.interrupted) return { lead: t("work.interrupted"), object: "", running: false, failed: false };
  if (turn.failed) {
    return { lead: t("work.endedFailed"), object: activity.type === "tool" ? stepObject(traceItem(activity)) : "", running: false, failed: true };
  }
  if (turn.files) return { lead: t("work.changedFiles", { n: turn.files }), object: plan, running: false, failed: false };
  if (plan) return { lead: plan, object: "", running: false, failed: false };
  if (turn.steps) return { lead: t("work.doneSteps", { n: turn.steps }), object: "", running: false, failed: false };
  return null;
}

/** Null keeps the row's usual line: no report, a status with nothing to add, or one that cannot be confirmed. */
export function rowStep(agent: DashboardAgentCard, stale: boolean): RowStep | null {
  const activity = agent.activity;
  if (!activity || stale || !agent.hasAgent) return null;
  switch (agent.status) {
    case "working": return currentStep(activity);
    case "blocked": return askStep(activity);
    case "done": return outcomeStep(activity);
    default: return null;
  }
}

/** When the agent last did something, by its own records; the list's own note otherwise. */
export function rowStepAt(agent: DashboardAgentCard, touched: number | undefined): number | undefined {
  return agent.activity?.at ?? touched;
}
