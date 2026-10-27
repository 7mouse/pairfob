import type { DashboardAgentCard } from "./dashboard";
import type { AgentStatus } from "./ranking";

export type RuntimeAgentStatuses = Record<string, AgentStatus>;
export type SeenCompletions = Record<string, true | string>;

export function runtimeAgentStatuses(agents: DashboardAgentCard[]): RuntimeAgentStatuses {
  return Object.fromEntries(agents.map((agent) => [agent.paneId, agent.status]));
}

function hasRichIdentity(agent: DashboardAgentCard): boolean {
  return Boolean(agent.runtimeSession || agent.terminalId || agent.agentInstanceId || agent.stateChangeSeq !== undefined || agent.completionId);
}

function legacyCompletionToken(agent: DashboardAgentCard): true | string {
  if (!hasRichIdentity(agent)) return true;
  return JSON.stringify([
    agent.runtimeSession || "",
    agent.terminalId || "",
    agent.agentInstanceId || "",
    agent.stateChangeSeq ?? null,
  ]);
}

export function completionToken(agent: DashboardAgentCard): true | string {
  if (!agent.completionId) {
    const legacy = legacyCompletionToken(agent);
    // Without a transcript binding, an unchanged terminal revision still proves
    // a sequence-only redetection did not produce new terminal output.
    if (typeof legacy === "string" && agent.revision !== undefined) return JSON.stringify([...JSON.parse(legacy), agent.revision]);
    return legacy;
  }
  return JSON.stringify([agent.runtimeSession || "", agent.terminalId || "", agent.agentInstanceId || "", agent.completionId]);
}

type Receipt = [string, string, string, number | null | string, number?];

function receipt(value: true | string | undefined): Receipt | null {
  if (typeof value !== "string") return null;
  try {
    const parts: unknown = JSON.parse(value);
    if (!Array.isArray(parts) || (parts.length !== 4 && parts.length !== 5) || !parts.slice(0, 3).every(p => typeof p === "string")) return null;
    if (parts.length === 5 && !(typeof parts[4] === "number" && Number.isSafeInteger(parts[4]) && parts[4] >= 0)) return null;
    const end = parts[3];
    if (end !== null && !(typeof end === "number" && Number.isSafeInteger(end) && end >= 0) &&
      !(typeof end === "string" && /^[0-9a-f]{64}$/.test(end))) return null;
    return parts as Receipt;
  } catch { return null; }
}

/** Missing observations cannot invalidate a receipt; a known replacement can. */
function sameOccupant(agent: DashboardAgentCard, saved: Receipt): boolean {
  return saved[0] === (agent.runtimeSession || "") &&
    (!agent.terminalId || saved[1] === agent.terminalId) &&
    (!agent.agentInstanceId || saved[2] === agent.agentInstanceId);
}

function completeOccupant(agent: DashboardAgentCard, saved: Receipt): boolean {
  return saved[0] === (agent.runtimeSession || "") && saved[1] === (agent.terminalId || "") && saved[2] === (agent.agentInstanceId || "");
}

function unchangedTerminal(agent: DashboardAgentCard, saved: Receipt | null): boolean {
  return saved !== null && completeOccupant(agent, saved) && saved[4] !== undefined &&
    agent.revision !== undefined && agent.revision <= saved[4];
}

function acknowledgementMatches(agent: DashboardAgentCard, value: true | string | undefined): boolean {
  if (value === undefined) return false;
  if (value === completionToken(agent)) return true;
  const saved = receipt(value);
  // An older response may arrive after the completion was read. It must not
  // re-arm that pane or replace the newer receipt.
  return !agent.completionId && saved !== null && completeOccupant(agent, saved) && typeof saved[3] !== "string" &&
    ((typeof saved[3] === "number" && agent.stateChangeSeq !== undefined && agent.stateChangeSeq <= saved[3]) ||
      unchangedTerminal(agent, saved));
}

/** Keep receipts through observation gaps and check task identity on recovery. */
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
    if (acknowledged === undefined) continue;
    // Recovery observations may carry provisional occupant fields as well as
    // an unknown status. Check the identity once an authoritative state returns.
    if (status === "unknown") {
      seen[paneId] = acknowledged;
      continue;
    }
    const agent = byPane.get(paneId);
    const saved = receipt(acknowledged);
    if (agent && saved && !sameOccupant(agent, saved)) continue;
    if (agent && saved && typeof saved[3] === "string") {
      // Runtime idle/working/unknown/blocked can all be detection churn. Only
      // another completed transcript (or an explicit local submit) retires this
      // receipt. Keep it across missing evidence and verify on recovery.
      if (status !== "done" || !agent.completionId || saved[3] === agent.completionId) seen[paneId] = acknowledged;
      continue;
    }
    // Legacy observations have no task evidence. Idle/unknown do not prove a
    // new turn; observed work still retires the sequence-based receipt.
    if (status === "idle") {
      seen[paneId] = acknowledged;
      continue;
    }
    if (agent && (status === "working" || status === "blocked") && unchangedTerminal(agent, saved)) {
      seen[paneId] = acknowledged;
      continue;
    }
    if (status !== "done") continue;
    const before = Object.hasOwn(previous, paneId) ? previous[paneId] : undefined;
    if (before !== undefined && before !== "done" && before !== "unknown" && before !== "idle" &&
      !(agent && unchangedTerminal(agent, saved))) continue;
    const legacyMatchesExactly = agent && (acknowledged === legacyCompletionToken(agent) ||
      (saved && completeOccupant(agent, saved) && saved[3] === agent.stateChangeSeq && (saved[4] === undefined || saved[4] === agent.revision)));
    if (agent && legacyMatchesExactly) {
      // Upgrade only a proven match; never attach an old receipt to an unseen turn.
      seen[paneId] = completionToken(agent);
      continue;
    }
    if (agent && saved && (!completeOccupant(agent, saved) || (saved[3] !== null && agent.stateChangeSeq === undefined) ||
      (saved[4] !== undefined && agent.revision === undefined))) {
      seen[paneId] = acknowledged;
      continue;
    }
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
    if (agent.status !== "done") return agent;
    const saved = receipt(seen[agent.paneId]);
    const matches = acknowledgementMatches(agent, seen[agent.paneId]);
    // Evidence temporarily unavailable: do not call an old result unread, or
    // claim that a possibly new result is read. Recovery checks the same receipt.
    const uncertain = saved && sameOccupant(agent, saved) && (!completeOccupant(agent, saved) ||
      (typeof saved[3] === "string" ? !agent.completionId : !matches &&
        ((saved[3] !== null && agent.stateChangeSeq === undefined) || (saved[4] !== undefined && agent.revision === undefined))));
    if (!matches && !uncertain) return agent;
    changed = true;
    return { ...agent, status: uncertain ? "unknown" as const : "idle" as const };
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
  if (agent?.status === "unknown") return current;
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
