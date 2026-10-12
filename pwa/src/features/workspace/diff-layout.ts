import { useSyncExternalStore } from "react";
import { WIDE_QUERY } from "../../app/viewport";

/**
 * Whether a diff shows its two sides next to each other. The reader chooses,
 * per device, and the choice only shows where the window has the room for two
 * columns of code beside the list (1200px, the tier at which the app lays
 * everything side by side); below that every diff is one column whatever was
 * chosen. Storage can be missing or throw: one column then.
 */
const SPLIT_KEY = "pairfob.workspace.diffSplit";
const listeners = new Set<() => void>();

function readSplit(): boolean {
  try { return globalThis.localStorage?.getItem(SPLIT_KEY) === "1"; } catch { return false; }
}

let chosen = readSplit();

const wide = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null;
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

/** The window has room for two sides: the choice is offered. */
export function useSplitOffered(): boolean {
  return useSyncExternalStore(subscribe, wide, wide);
}

export function splitChosen(): boolean {
  return chosen;
}

/** The reader's choice, whether or not this window can show it. */
export function useSplitChosen(): boolean {
  return useSyncExternalStore(subscribe, splitChosen, splitChosen);
}

export function setSplitChosen(next: boolean): void {
  chosen = next;
  try { globalThis.localStorage?.setItem(SPLIT_KEY, next ? "1" : "0"); } catch { /* keep the in-memory value */ }
  for (const listener of listeners) listener();
}

/** Tests: back to one column. */
export function resetSplitChosen(): void {
  chosen = false;
  try { globalThis.localStorage?.removeItem(SPLIT_KEY); } catch { /* ignore */ }
  for (const listener of listeners) listener();
}
