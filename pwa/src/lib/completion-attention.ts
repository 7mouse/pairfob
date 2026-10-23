import type { DashboardAgentCard } from "./dashboard";
import type { AgentStatus } from "./ranking";

export type RuntimeAgentStatuses = Record<string, AgentStatus>;
export type SeenCompletions = Record<string, true | string>;

export function runtimeAgentStatuses(agents: DashboardAgentCard[]): RuntimeAgentStatuses {
  return Object.fromEntries(agents.map((agent) => [agent.paneId, agent.status]));
}

function hasRichIdentity(agent: DashboardAgentCard): boolean {
  return Boolean(agent.runtimeSession || agent.terminalId || agent.agentInstanceId || agent.stateChangeSeq !== undefined);
}

export function completionToken(agent: DashboardAgentCard): true | string {
  if (!hasRichIdentity(agent)) return true;
  return JSON.stringify([
    agent.runtimeSession || "",
    agent.terminalId || "",
    agent.agentInstanceId || "",
    agent.stateChangeSeq ?? null,
  ]);
}

function acknowledgementMatches(agent: DashboardAgentCard, value: true | string | undefined): boolean {
  return value !== undefined && value === completionToken(agent);
}

/** Keep acknowledgements through unknown observations; verify identity on recovery. */
export function reconcileSeenCompletions(
  previous: RuntimeAgentStatuses,
  next: RuntimeAgentStatuses,
  current: SeenCompletions,
  agents?: readonly DashboardAgentCard[],
): SeenCompletions {
  const byPane = new Map((agents || []).map((agent) => [agent.paneId, agent]));
  const seen: SeenCompletions = Object.create(null);
  for (const [paneId, status] of Object.entries(next)) {
    const acknowledged = current[paneId];
    // Unknown is a gap in observation, not evidence of a new turn. Keep the
    // receipt without projecting it as idle; a later done must still match its
    // full identity and sequence. Missing panes and observed work still retire it.
    if (status === "unknown") {
      if (acknowledged !== undefined) seen[paneId] = acknowledged;
      continue;
    }
    if (status !== "done") continue;
    const before = Object.hasOwn(previous, paneId) ? previous[paneId] : undefined;
    if (before !== undefined && before !== "done" && before !== "unknown") continue;
    const agent = byPane.get(paneId);
    if (agent ? acknowledgementMatches(agent, acknowledged) : acknowledged !== undefined) {
      seen[paneId] = acknowledged!;
    }
  }
  const keys = Object.keys(seen);
  const currentKeys = Object.keys(current);
  if (keys.length === currentKeys.length && keys.every((paneId) => seen[paneId] === current[paneId])) return current;
  return seen;
}

export function applySeenCompletions(agents: DashboardAgentCard[], seen: SeenCompletions): DashboardAgentCard[] {
  let changed = false;
  const displayed = agents.map((agent) => {
    if (agent.status !== "done" || !acknowledgementMatches(agent, seen[agent.paneId])) return agent;
    changed = true;
    return { ...agent, status: "idle" as const };
  });
  return changed ? displayed : agents;
}

export function projectCompletionAttention(
  rawAgents: DashboardAgentCard[],
  previous: RuntimeAgentStatuses,
  current: SeenCompletions,
): { agents: DashboardAgentCard[]; runtimeStatuses: RuntimeAgentStatuses; seen: SeenCompletions } {
  const runtimeStatuses = runtimeAgentStatuses(rawAgents);
  const seen = reconcileSeenCompletions(previous, runtimeStatuses, current, rawAgents);
  return { agents: applySeenCompletions(rawAgents, seen), runtimeStatuses, seen };
}

export function markCompletionSeen(
  current: SeenCompletions,
  runtimeStatuses: RuntimeAgentStatuses,
  paneId: string,
  agents?: readonly DashboardAgentCard[],
): SeenCompletions {
  if (runtimeStatuses[paneId] !== "done") return current;
  const agent = agents?.find((item) => item.paneId === paneId);
  const token = agent ? completionToken(agent) : true;
  if (current[paneId] === token) return current;
  return { ...current, [paneId]: token };
}

/**
 * Acknowledge every completion the list shows as unread. `added` holds only the
 * acknowledgements this call made, so an undo takes back no more than that.
 */
export function markAllCompletionsSeen(
  current: SeenCompletions,
  runtimeStatuses: RuntimeAgentStatuses,
  agents: readonly DashboardAgentCard[],
): { seen: SeenCompletions; added: SeenCompletions } {
  let seen = current;
  const added: SeenCompletions = Object.create(null);
  for (const agent of agents) {
    if (!agent.hasAgent || agent.status !== "done") continue;
    const next = markCompletionSeen(seen, runtimeStatuses, agent.paneId, agents);
    if (next === seen) continue;
    seen = next;
    added[agent.paneId] = next[agent.paneId];
  }
  return { seen, added };
}

/**
 * Undo `markAllCompletionsSeen`: drop each acknowledgement it made that is still
 * the one on record. A pane opened or read again since keeps its own.
 */
export function forgetCompletionsSeen(current: SeenCompletions, added: SeenCompletions): SeenCompletions {
  const drop = Object.keys(added).filter((paneId) => current[paneId] === added[paneId]);
  if (!drop.length) return current;
  const next = { ...current };
  for (const paneId of drop) delete next[paneId];
  return next;
}

/** Show a completion as unread again once its acknowledgement is gone. */
export function restoreUnseenCompletions(
  agents: DashboardAgentCard[],
  runtimeStatuses: RuntimeAgentStatuses,
  seen: SeenCompletions,
): DashboardAgentCard[] {
  let changed = false;
  const displayed = agents.map((agent) => {
    if (agent.status !== "idle" || runtimeStatuses[agent.paneId] !== "done" || acknowledgementMatches(agent, seen[agent.paneId])) return agent;
    changed = true;
    return { ...agent, status: "done" as const };
  });
  return changed ? displayed : agents;
}

/** A successful submit re-arms completion even if a fast turn hides working. */
export function rearmCompletion(current: SeenCompletions, paneId: string): SeenCompletions {
  if (!Object.hasOwn(current, paneId)) return current;
  const next = { ...current };
  delete next[paneId];
  return next;
}

export function projectAgentSubmission(
  agents: DashboardAgentCard[],
  runtimeStatuses: RuntimeAgentStatuses,
  seen: SeenCompletions,
  paneId: string,
): { agents: DashboardAgentCard[]; runtimeStatuses: RuntimeAgentStatuses; seen: SeenCompletions } {
  const target = agents.find((agent) => agent.paneId === paneId);
  if (!target?.hasAgent) return { agents, runtimeStatuses, seen };
  return {
    agents: agents.map((agent) => agent.paneId === paneId ? { ...agent, status: "working" as const } : agent),
    runtimeStatuses: { ...runtimeStatuses, [paneId]: "working" },
    seen: rearmCompletion(seen, paneId),
  };
}

export function parseSeenCompletions(raw: string | null, limit = 512): SeenCompletions {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const seen: SeenCompletions = Object.create(null);
    let count = 0;
    for (const [paneId, acknowledged] of Object.entries(value as Record<string, unknown>)) {
      if (count >= limit) break;
      const validToken = acknowledged === true || (typeof acknowledged === "string" && acknowledged.length > 0 && acknowledged.length <= 1024);
      if (validToken && paneId.length > 0 && paneId.length <= 256) {
        seen[paneId] = acknowledged as true | string;
        count++;
      }
    }
    return seen;
  } catch {
    return {};
  }
}
