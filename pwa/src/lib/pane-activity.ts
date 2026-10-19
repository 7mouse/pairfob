/**
 * The step an agent is on, as a snapshot reports it for the list
 * (`proto/agent-activity.md`): the latest tool, thinking or reply of the
 * current turn, and for a finished turn what it came to. Older computers send
 * none, and a malformed one is dropped rather than failing the snapshot: the
 * row then reads as it always did.
 */
export type PaneActivityTurn = {
  steps: number;
  files: number;
  plan?: string;
  failed?: boolean;
  interrupted?: boolean;
};

export type PaneActivity = {
  type: "tool" | "thinking" | "assistant";
  name?: string;
  label?: string;
  state?: "running" | "done" | "error";
  at?: number;
  turn?: PaneActivityTurn;
};

const TYPES = new Set(["tool", "thinking", "assistant"]);
const STATES = new Set(["running", "done", "error"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseTurn(value: unknown): PaneActivityTurn | undefined {
  const wire = record(value);
  const steps = count(wire?.steps);
  const files = count(wire?.files);
  if (!wire || steps === undefined || files === undefined) return undefined;
  const plan = text(wire.plan, 16);
  return {
    steps,
    files,
    ...(plan && /^\d+\/\d+$/.test(plan) ? { plan } : {}),
    ...(wire.failed === true ? { failed: true } : {}),
    ...(wire.interrupted === true ? { interrupted: true } : {}),
  };
}

export function parsePaneActivity(value: unknown): PaneActivity | undefined {
  const wire = record(value);
  if (!wire || typeof wire.type !== "string" || !TYPES.has(wire.type)) return undefined;
  const name = text(wire.name, 128);
  const label = text(wire.label, 512);
  const state = typeof wire.state === "string" && STATES.has(wire.state) ? wire.state as PaneActivity["state"] : undefined;
  const at = count(wire.at);
  const turn = parseTurn(wire.turn);
  return {
    type: wire.type as PaneActivity["type"],
    ...(name ? { name } : {}),
    ...(label ? { label } : {}),
    ...(state ? { state } : {}),
    ...(at ? { at } : {}),
    ...(turn ? { turn } : {}),
  };
}
