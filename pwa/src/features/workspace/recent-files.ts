import { useSyncExternalStore } from "react";
import type { WorkspaceEntry } from "../../lib/workspace";
import { currentDaemonId } from "../computers/catalog-store";

/**
 * The files the reader opened last, per repository root of one computer, on
 * this device. Two computers may hold a checkout at the same path, and a file
 * opened on one may not exist on the other.
 *
 * The daemon has no history, so this is kept here: a short list the files tab
 * shows above the root directory, so a file the reader keeps coming back to is
 * one press away instead of a walk down the tree. Storage can be missing or
 * throw (private mode, blocked site data); the list then lives in memory only.
 */

export const RECENT_FILES_LIMIT = 5;
/** Roots kept, the ones written last: a device that visits many repositories does not keep them all for ever. */
export const RECENT_ROOTS_KEPT = 24;
const KEY = "pairfob.workspace.recent";
const OPEN_KEY = "pairfob.workspace.recentOpen";

type Recent = { path: string; size: number; modified_ms: number; at: number };
/** Keyed by computer and root (`place`), in the order they were last written. */
type Store = Record<string, Recent[]>;

/** A root on the computer in use. */
function place(root: string): string {
  return `${currentDaemonId() ?? ""}\n${root}`;
}

/** A stored number the list can draw: a size or a time that is not one reads as unknown. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** One stored entry, or null for anything that is not one. */
function recent(item: unknown): Recent | null {
  if (!item || typeof item !== "object") return null;
  const { path, size, modified_ms, at } = item as Record<string, unknown>;
  if (typeof path !== "string" || !path || typeof at !== "number" || !Number.isFinite(at)) return null;
  return { path, size: count(size), modified_ms: count(modified_ms), at };
}

/** The store with one place's list replaced (or dropped, when empty), written last. */
function withList(at: string, list: Recent[]): Store {
  const next: Store = { ...store };
  delete next[at];
  if (list.length) next[at] = list;
  const places = Object.keys(next);
  for (const old of places.slice(0, Math.max(0, places.length - RECENT_ROOTS_KEPT))) delete next[old];
  return next;
}

function save(): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(store)); } catch { /* memory only */ }
  publish();
}

const listeners = new Set<() => void>();
let store: Store = read();
let open = readOpen();

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Store = {};
    // A place is a computer and a root; anything else is not this store's.
    const places = Object.entries(parsed as Record<string, unknown>).filter(([at]) => at.includes("\n"));
    for (const [at, list] of places.slice(-RECENT_ROOTS_KEPT)) {
      if (!Array.isArray(list)) continue;
      const kept = list.flatMap((item) => recent(item) ?? []).slice(0, RECENT_FILES_LIMIT);
      if (kept.length) out[at] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

function readOpen(): boolean {
  try { return globalThis.localStorage?.getItem(OPEN_KEY) !== "0"; } catch { return true; }
}

function publish(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A file was opened: it moves to the front of its root's list. */
export function noteRecentFile(root: string, file: { path: string; size: number; modified_ms: number }, now = Date.now()): void {
  if (!root || !file.path) return;
  const at = place(root);
  const rest = (store[at] ?? []).filter((item) => item.path !== file.path);
  store = withList(at, [{ path: file.path, size: file.size, modified_ms: file.modified_ms, at: now }, ...rest].slice(0, RECENT_FILES_LIMIT));
  save();
}

/** A file was renamed or deleted, here or on the computer: its entry goes, or follows the new name. */
export function forgetRecentFile(root: string, path: string, renamedTo?: string): void {
  const at = place(root);
  const list = store[at];
  if (!list?.some((item) => item.path === path)) return;
  store = withList(at, list.flatMap((item) => item.path !== path ? [item] : renamedTo ? [{ ...item, path: renamedTo }] : []));
  save();
}

export function recentFiles(root: string): readonly Recent[] {
  return store[place(root)] ?? [];
}

/** Recent files as rows the list can draw: no revision, so no rename or delete from here. */
export function recentEntries(root: string): WorkspaceEntry[] {
  return recentFiles(root).map((item) => ({
    name: item.path.split("/").pop() || item.path,
    path: item.path,
    kind: "file",
    size: item.size,
    modified_ms: item.modified_ms,
    hidden: false,
  }));
}

export function recentOpen(): boolean {
  return open;
}

export function setRecentOpen(next: boolean): void {
  open = next;
  try { globalThis.localStorage?.setItem(OPEN_KEY, next ? "1" : "0"); } catch { /* memory only */ }
  publish();
}

export function useRecentFiles(root: string): { entries: WorkspaceEntry[]; open: boolean } {
  useSyncExternalStore(subscribe, () => store, () => store);
  useSyncExternalStore(subscribe, recentOpen, recentOpen);
  return { entries: recentEntries(root), open };
}

/** Tests: read storage again, as a reload of the page does. */
export function rereadRecentFiles(): void {
  store = read();
  publish();
}

/** Tests: forget every root. */
export function resetRecentFiles(): void {
  store = {};
  open = true;
  try { globalThis.localStorage?.removeItem(KEY); globalThis.localStorage?.removeItem(OPEN_KEY); } catch { /* ignore */ }
  publish();
}
