import { useSyncExternalStore } from "react";
import { tryAppRoot } from "../dom-root";

/**
 * How wide the files-and-changes column is beside the desk session, on this
 * device. The reader sets it by dragging the line between the two
 * (`inspector-divider`); until they do, the layout's own width applies.
 *
 * The width is the shell's to apply (`--inspector-chosen` on the root, which
 * `desk.scss` holds to the room the window has): it is written with the
 * shell's classes, before React commits, so the session measures the box it
 * will keep and the program on the computer is sized once. Storage can be
 * missing or throw; the layout's width then applies.
 */
const WIDTH_KEY = "pairfob.inspector.width";
/** The column's id, for the line that sizes it to name. */
export const INSPECTOR_COLUMN_ID = "files-and-changes";
const PROPERTY = "--inspector-chosen";
const listeners = new Set<() => void>();

/**
 * The column's bounds and the session's floor, in rem as `desk.scss` writes
 * them (`--inspector-w`, `--session-min`): change both together.
 */
export const INSPECTOR_MIN_REM = 27.5;
export const INSPECTOR_MAX_REM = 45;
/** 459px at the default text size: the session's width in a 900px window, the narrowest the layout gives it. */
export const SESSION_MIN_REM = 28.6875;

/** What the column may be when it and the session share this much room, in px. */
export function inspectorBounds(shared: number, rem: number): { min: number; max: number } {
  const min = INSPECTOR_MIN_REM * rem;
  return { min, max: Math.max(min, Math.min(INSPECTOR_MAX_REM * rem, shared - SESSION_MIN_REM * rem)) };
}

function read(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.round(stored) : null;
  } catch {
    return null;
  }
}

/** In px; null until the reader sets one. */
let chosen = read();

export function inspectorWidth(): number | null {
  return chosen;
}

/** Write the reader's width on the shell root, or take it off when there is none. Idempotent. */
export function applyInspectorWidth(root: HTMLElement): void {
  if (chosen === null) root.style.removeProperty(PROPERTY);
  else root.style.setProperty(PROPERTY, `${chosen}px`);
}

export function clearInspectorWidth(root: HTMLElement): void {
  root.style.removeProperty(PROPERTY);
}

export function setInspectorWidth(next: number | null): void {
  chosen = next === null ? null : Math.round(next);
  try {
    if (chosen === null) globalThis.localStorage?.removeItem(WIDTH_KEY);
    else globalThis.localStorage?.setItem(WIDTH_KEY, String(chosen));
  } catch { /* keep the in-memory value */ }
  // The column changes now, in one step, not at the next composition.
  const root = tryAppRoot();
  if (root) applyInspectorWidth(root);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useInspectorWidth(): number | null {
  return useSyncExternalStore(subscribe, inspectorWidth, inspectorWidth);
}

/** Tests: back to the layout's own width. */
export function resetInspectorWidth(): void {
  setInspectorWidth(null);
}
