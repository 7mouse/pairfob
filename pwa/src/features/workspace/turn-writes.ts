import { useSyncExternalStore } from "react";
import type { LiveSession } from "../../lib/protocol/client";
import { dashboardStore } from "../dashboard/catalog-store";

/**
 * The files the agent wrote in its current turn, for the pane whose files are
 * shown.
 *
 * The agent's own edit tools say which files they write (trace_writes); the
 * daemon passes the paths as the tools named them, absolute or relative to
 * the agent's working directory. Here they become paths of the workspace on
 * screen, and the ones outside it are dropped. A pane without a transcript, or
 * a daemon that cannot say, simply has none: this is a hint beside the list,
 * never a condition for anything.
 *
 * A turn moves on while the files are on screen. It is read again when the
 * reader comes back to the changes (`rereadTurnWrites`) and whenever the
 * pane's agent starts or stops working, which is when a turn begins and when
 * its last file has been written.
 */

type Writes = { session: object; paneId: string; root: string; paths: readonly string[] };
type Target = { session: LiveSession; paneId: string; root: string; cwd: string | undefined };

const NONE: readonly string[] = Object.freeze([]);
const listeners = new Set<() => void>();
let shown: Writes | null = null;
let request = 0;
/** The pane last read, and what its agent was doing then. */
let target: Target | null = null;
let agentStatus: string | undefined;
let watching = false;

function agentOf(paneId: string) {
  return dashboardStore.get().agents.find((agent) => agent.paneId === paneId);
}

/** The session list already knows what every agent is doing: a change of the shown pane's reads its turn again. */
function followAgent(): void {
  // Nothing on screen lists the turn's files: the next look reads them.
  if (!target || !listeners.size) return;
  const agent = agentOf(target.paneId);
  if (agent?.status === agentStatus) return;
  void loadTurnWrites(target.session, target.paneId, target.root, agent?.cwd ?? target.cwd);
}

function publish(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Told when the shown pane's turn files change; while anything is subscribed, the turn is followed. */
export const subscribeTurnWrites = subscribe;

/** `a/./b/../c` to `a/c`; null when the path climbs out of where it started. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/**
 * A written path as a path of the workspace: relative to `root`, or null when
 * it lies outside. `cwd` is the pane's working directory as the agent sees it,
 * which is the same directory as `root` before its symlinks were resolved.
 */
export function workspacePathOf(written: string, root: string, cwd: string | undefined): string | null {
  const bases = [root, cwd].filter((base): base is string => Boolean(base)).map((base) => base.replace(/\/+$/, ""));
  if (written.startsWith("/")) {
    for (const base of bases) {
      if (written === base) return null;
      if (written.startsWith(`${base}/`)) return normalize(written.slice(base.length + 1)) || null;
    }
    return null;
  }
  return normalize(written) || null;
}

/** Read the pane's current turn again. Failures leave it without any: the list works the same. */
export async function loadTurnWrites(session: LiveSession, paneId: string, root: string, cwd: string | undefined): Promise<void> {
  const read = session.agentTurnWrites;
  const mine = ++request;
  target = { session, paneId, root, cwd };
  agentStatus = agentOf(paneId)?.status;
  if (!watching) {
    watching = true;
    dashboardStore.subscribe(followAgent);
  }
  if (shown && (shown.session !== session || shown.paneId !== paneId || shown.root !== root)) {
    shown = null;
    publish();
  }
  if (!read) return;
  let written: string[] | null = null;
  try {
    written = await read(paneId);
  } catch {
    written = null;
  }
  if (mine !== request) return;
  const paths = [...new Set((written ?? []).flatMap((path) => workspacePathOf(path, root, cwd) ?? []))];
  const same = shown && shown.paths.length === paths.length && shown.paths.every((path, index) => path === paths[index]);
  if (same && shown?.session === session) return;
  shown = { session, paneId, root, paths: Object.freeze(paths) };
  publish();
}

/** Read the shown pane's turn again, as it stands now. */
export function rereadTurnWrites(): void {
  if (target) void loadTurnWrites(target.session, target.paneId, target.root, agentOf(target.paneId)?.cwd ?? target.cwd);
}

/** The current turn's files for this pane and root; empty for any other. */
export function turnWrites(paneId: string, root: string | undefined): readonly string[] {
  return shown && shown.paneId === paneId && shown.root === root ? shown.paths : NONE;
}

export function useTurnWrites(paneId: string, root: string | undefined): readonly string[] {
  return useSyncExternalStore(subscribe, () => turnWrites(paneId, root), () => NONE);
}

/** Tests: forget what was read. */
export function resetTurnWrites(): void {
  request++;
  shown = null;
  target = null;
  agentStatus = undefined;
  publish();
}
