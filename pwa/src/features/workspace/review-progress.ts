import { useSyncExternalStore } from "react";
import type { GitLayer } from "../../lib/workspace";
import { currentDaemonId } from "../computers/catalog-store";
import { reviewOrder, type ChangeStep } from "./git-marks";
import type { WorkspaceSnapshot } from "./model";

/**
 * Which diffs the reader has seen, per repository root of one computer, on
 * this device. Two computers may hold a checkout at the same path; what was
 * seen on one says nothing of the other.
 *
 * A diff counts as seen once the reader has scrolled it to its end, or when it
 * fit without scrolling; the row then shows the filled dot the session list
 * uses for "done". The mark is kept with the diff's revision (the daemon
 * hashes the patch), so a file the agent changes again reads as unseen as soon
 * as its new diff is opened. The daemon knows nothing of this; storage can be
 * missing or throw, and the marks then live in memory only.
 */

const KEY = "pairfob.workspace.reviewed";
const MAX_PER_ROOT = 400;
/** Roots kept, the ones written last: a device that visits many repositories does not keep them all for ever. */
export const REVIEW_ROOTS_KEPT = 24;

/** `layer:path` → the diff revision that was seen. */
type Seen = Record<string, string>;
/** Keyed by computer and root (`place`), in the order they were last written. */
type Store = Record<string, Seen>;

/** A root on the computer in use. */
function place(root: string): string {
  return `${currentDaemonId() ?? ""}\n${root}`;
}

/** The store with one place's marks replaced (or dropped, when none are left), written last. */
function withSeen(at: string, seen: Seen): Store {
  const next: Store = { ...store };
  delete next[at];
  if (Object.keys(seen).length) next[at] = seen;
  const places = Object.keys(next);
  for (const old of places.slice(0, Math.max(0, places.length - REVIEW_ROOTS_KEPT))) delete next[old];
  return next;
}

const listeners = new Set<() => void>();
let store: Store = read();
let version = 0;

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Store = {};
    // A place is a computer and a root; anything else is not this store's.
    const places = Object.entries(parsed as Record<string, unknown>).filter(([at]) => at.includes("\n"));
    for (const [at, seen] of places.slice(-REVIEW_ROOTS_KEPT)) {
      if (!seen || typeof seen !== "object" || Array.isArray(seen)) continue;
      out[at] = Object.fromEntries(Object.entries(seen as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Seen;
    }
    return out;
  } catch {
    return {};
  }
}

function write(): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(store)); } catch { /* memory only */ }
  version++;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const reviewKey = (layer: GitLayer, path: string): string => `${layer}:${path}`;

/** The revision the reader saw for this diff, if any. */
export function reviewedRevision(root: string, layer: GitLayer, path: string): string | undefined {
  return store[place(root)]?.[reviewKey(layer, path)];
}

/**
 * Diffs the reader marked unseen themselves, by root and key, for this visit.
 * Reading one to its end again does not mark it behind their back; their own
 * "seen", or a new patch of the file, lets go of it.
 */
const heldUnseen = new Set<string>();
const heldKey = (root: string, key: string): string => `${place(root)}\n${key}`;

/** The diff was read to its end. `reader` is their own answer from the menu, which also overrides a held "unseen". */
export function markReviewed(root: string, layer: GitLayer, path: string, revision: string, reader = false): void {
  if (!root || !revision) return;
  const key = reviewKey(layer, path);
  if (reader) heldUnseen.delete(heldKey(root, key));
  else if (heldUnseen.has(heldKey(root, key))) return;
  const at = place(root);
  if (store[at]?.[key] === revision) return;
  const seen = { ...(store[at] ?? {}), [key]: revision };
  const keys = Object.keys(seen);
  if (keys.length > MAX_PER_ROOT) for (const old of keys.slice(0, keys.length - MAX_PER_ROOT)) delete seen[old];
  store = withSeen(at, seen);
  write();
}

/** The reader's own toggle on a row: unseen again, or seen as the diff stands. */
export function setReviewed(root: string, layer: GitLayer, path: string, revision: string | null): void {
  const key = reviewKey(layer, path);
  if (revision) {
    markReviewed(root, layer, path, revision, true);
    return;
  }
  heldUnseen.add(heldKey(root, key));
  const at = place(root);
  if (!store[at]?.[key]) return;
  const seen = { ...store[at] };
  delete seen[key];
  store = withSeen(at, seen);
  write();
}

/** Whether the change list shows this row as seen: a revision is on record for it. */
export function isReviewed(root: string, layer: GitLayer, path: string): boolean {
  return reviewedRevision(root, layer, path) !== undefined;
}

/** How many of the listed changes have been seen, and the first that has not, in review order. */
export function reviewProgress(snapshot: Pick<WorkspaceSnapshot, "descriptor" | "status">): { seen: number; total: number; next: ChangeStep | null } {
  const root = snapshot.descriptor?.root ?? "";
  const order = reviewOrder(snapshot.status?.changes ?? []);
  let seen = 0;
  let next: ChangeStep | null = null;
  for (const step of order) {
    if (isReviewed(root, step.layer, step.path)) seen++;
    else if (!next) next = step;
  }
  return { seen, total: order.length, next };
}

/**
 * The size of a diff the reader has opened, kept in memory so its row can say
 * `+3 −1` once it is known. The status the daemon lists carries no line
 * counts, so a row the reader has not opened yet shows none.
 */
export type DiffStat = { additions: number; deletions: number; revision: string };
const stats = new Map<string, DiffStat>();
const statKey = (root: string, layer: GitLayer, path: string): string => `${place(root)}\n${reviewKey(layer, path)}`;

export function diffStat(root: string, layer: GitLayer, path: string): DiffStat | undefined {
  return stats.get(statKey(root, layer, path));
}

/**
 * The size of one change in one layer: what the status says when the daemon
 * counts lines (git_change_stats), otherwise what an opened diff showed.
 */
export function changeLineCount(root: string, step: ChangeStep): { additions: number; deletions: number; binary: boolean } | null {
  const counted = step.change.stat?.[step.layer];
  if (counted) return { additions: counted.additions, deletions: counted.deletions, binary: counted.binary === true };
  const read = diffStat(root, step.layer, step.path);
  return read ? { additions: read.additions, deletions: read.deletions, binary: false } : null;
}

/**
 * The lines every listed change adds and removes. Null unless every one of
 * them has a count: a sum of the diffs opened so far is not the total, and
 * reads as one. A daemon that counts lines (git_change_stats) gives them all;
 * one that does not has them only once each diff has been read.
 */
export function changeTotals(snapshot: Pick<WorkspaceSnapshot, "descriptor" | "status">): { additions: number; deletions: number } | null {
  const root = snapshot.descriptor?.root ?? "";
  const order = reviewOrder(snapshot.status?.changes ?? []);
  if (!order.length) return null;
  let additions = 0;
  let deletions = 0;
  for (const step of order) {
    const count = changeLineCount(root, step);
    if (!count) return null;
    additions += count.additions;
    deletions += count.deletions;
  }
  return { additions, deletions };
}

/**
 * A diff was read. Its size is remembered, and a mark made on an older patch
 * of the same file is withdrawn: what the reader saw is not what is there now.
 */
export function noteDiffRead(root: string, diff: { path: string; layer: GitLayer; additions: number; deletions: number; revision: string }): void {
  if (!root || !diff.revision) return;
  const key = statKey(root, diff.layer, diff.path);
  const known = stats.get(key);
  const seen = reviewedRevision(root, diff.layer, diff.path);
  const stale = seen !== undefined && seen !== diff.revision;
  if (known?.revision === diff.revision && !stale) return;
  stats.set(key, { additions: diff.additions, deletions: diff.deletions, revision: diff.revision });
  // Another patch: what the reader said about the last one does not carry over.
  if (known && known.revision !== diff.revision) heldUnseen.delete(heldKey(root, reviewKey(diff.layer, diff.path)));
  if (stale) {
    const at = place(root);
    const next = { ...store[at] };
    delete next[reviewKey(diff.layer, diff.path)];
    store = withSeen(at, next);
  }
  write();
}

/** Marks for changes the status no longer lists are dropped: a file committed and changed again starts unseen. */
export function pruneReviewed(root: string, listed: ReadonlySet<string>): void {
  const at = place(root);
  const seen = store[at];
  if (!seen) return;
  const stale = Object.keys(seen).filter((key) => !listed.has(key));
  if (!stale.length) return;
  const next = { ...seen };
  for (const key of stale) delete next[key];
  store = withSeen(at, next);
  write();
}

/** How many seen diffs one status load reads again at most, when the status says they changed. */
export const REVIEW_VERIFY_LIMIT = 24;
/** The same, when the status cannot say (no git_change_stats): the least recently checked ones. */
export const REVIEW_RECHECK_LIMIT = 8;
/** A diff checked this recently is not read again by a status that cannot say whether it changed. */
export const REVIEW_RECHECK_MS = 30_000;

type StatusLike = { head: string; changes: ReadonlyArray<Parameters<typeof reviewOrder>[0][number]> };
type ReadDiff = { path: string; layer: GitLayer; additions: number; deletions: number; revision: string };

/**
 * What the status says of one diff, when it says anything: the commit it is
 * against, the change's state, and that layer's line counts and the file's
 * time. Null from a daemon that sends neither counts nor times.
 */
function statusMark(head: string, step: ChangeStep): string | null {
  const { change, layer } = step;
  if (!change.stat && change.modified_ms === undefined) return null;
  return JSON.stringify([head, change.index, change.worktree, change.stat?.[layer] ?? null, change.modified_ms ?? null]);
}

/** A seen diff that was read again and found unchanged: its revision, what the status said of it then, and when. */
const checked = new Map<string, { revision: string; mark: string | null; at: number }>();

/**
 * After a status load: the list may still mark as seen a file the agent has
 * changed since. A seen diff is read again and `noteDiffRead` withdraws the
 * mark when its patch is another one.
 *
 * Which ones are read depends on what the status can say. With line counts and
 * times (git_change_stats) a diff whose entry reads as it did when it was last
 * checked is left alone, so an unchanged status reads nothing; the ones that
 * differ are read, up to a limit, and the rest at the next load. Without them
 * nothing in the status tells, so a few are read each time, the least recently
 * checked first, and none more often than every half minute. Either way every
 * seen diff gets its turn, however many there are.
 */
export function verifyReviewed(root: string, status: StatusLike, read: (path: string, layer: GitLayer) => Promise<ReadDiff>, now = Date.now()): void {
  if (!root) return;
  const order = reviewOrder(status.changes);
  pruneReviewed(root, new Set(order.map((step) => reviewKey(step.layer, step.path))));
  const said: Array<{ step: ChangeStep; mark: string }> = [];
  const blind: Array<{ step: ChangeStep; mark: null; last: number }> = [];
  for (const step of order) {
    const seen = reviewedRevision(root, step.layer, step.path);
    if (seen === undefined) continue;
    const last = checked.get(statKey(root, step.layer, step.path));
    const current = last?.revision === seen ? last : undefined;
    const mark = statusMark(status.head, step);
    if (mark !== null) {
      if (current?.mark !== mark) said.push({ step, mark });
    } else if (!current || now - current.at >= REVIEW_RECHECK_MS) {
      blind.push({ step, mark: null, last: current?.at ?? 0 });
    }
  }
  blind.sort((a, b) => a.last - b.last);
  const asked = place(root);
  for (const { step, mark } of [...said.slice(0, REVIEW_VERIFY_LIMIT), ...blind.slice(0, REVIEW_RECHECK_LIMIT)]) {
    void read(step.path, step.layer).then((diff) => {
      // Another computer has been switched to meanwhile: this answer says nothing of its checkout.
      if (place(root) !== asked) return;
      noteDiffRead(root, diff);
      // Still the patch that was seen: remembered with what the status said of it.
      if (reviewedRevision(root, step.layer, step.path) === diff.revision) {
        checked.set(statKey(root, step.layer, step.path), { revision: diff.revision, mark, at: now });
      }
    }, () => undefined);
  }
}

/** Subscribe a component to the marks; returns a version that changes with them. */
export function useReviewVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Tests: forget every root. */
export function resetReviewProgress(): void {
  store = {};
  stats.clear();
  checked.clear();
  heldUnseen.clear();
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ }
  write();
}
