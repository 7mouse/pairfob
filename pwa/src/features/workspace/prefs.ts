import { useSyncExternalStore } from "react";
import { pointerFine } from "../../app/input-mode";

/**
 * Per-device reading preferences for the inspector. Storage can be missing or
 * throw (private mode, blocked site data); the default then simply applies.
 *
 * Wrapping defaults by how the page is operated, not by its width: under a
 * finger long lines wrap, because panning a file sideways to read every line
 * is the worst way to read one; a mouse keeps lines whole, as an editor does.
 * Once the reader has chosen, the choice is theirs on this device either way.
 */
const WRAP_KEY = "pairfob.workspace.wrap";
const listeners = new Set<() => void>();

function readWrap(): boolean | null {
  try {
    const stored = globalThis.localStorage?.getItem(WRAP_KEY);
    return stored === "1" ? true : stored === "0" ? false : null;
  } catch {
    return null;
  }
}

/** The reader's own choice; null until they make one. */
let chosen = readWrap();

export function workspaceWrap(): boolean {
  return chosen ?? !pointerFine();
}

export function setWorkspaceWrap(next: boolean): void {
  chosen = next;
  try { globalThis.localStorage?.setItem(WRAP_KEY, next ? "1" : "0"); } catch { /* keep the in-memory value */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWorkspaceWrap(): boolean {
  return useSyncExternalStore(subscribe, workspaceWrap, workspaceWrap);
}

/** The reader's own choice, or null when the default for the input applies. */
export function workspaceWrapChosen(): boolean | null {
  return chosen;
}

export function useWorkspaceWrapChosen(): boolean | null {
  return useSyncExternalStore(subscribe, workspaceWrapChosen, workspaceWrapChosen);
}

/** Tests: back to no choice, so the default for the input applies. */
export function resetWorkspaceWrap(): void {
  chosen = null;
  try { globalThis.localStorage?.removeItem(WRAP_KEY); } catch { /* ignore */ }
  for (const listener of listeners) listener();
}

/**
 * The width an HTML preview is drawn at: a phone's, a tablet's, or the room
 * the page has. Whether the choice is offered, and so whether it applies, is
 * the preview's own question (`preview-controls`).
 */
export const PREVIEW_WIDTHS = [375, 768] as const;
export type PreviewWidth = (typeof PREVIEW_WIDTHS)[number] | "auto";

const PREVIEW_WIDTH_KEY = "pairfob.workspace.previewWidth";
const previewWidthListeners = new Set<() => void>();

function readPreviewWidth(): PreviewWidth {
  try {
    const stored = Number(globalThis.localStorage?.getItem(PREVIEW_WIDTH_KEY));
    return PREVIEW_WIDTHS.find((width) => width === stored) ?? "auto";
  } catch {
    return "auto";
  }
}

let previewWidthChosen = readPreviewWidth();

export function previewWidth(): PreviewWidth {
  return previewWidthChosen;
}

export function setPreviewWidth(next: PreviewWidth): void {
  previewWidthChosen = next;
  try {
    if (next === "auto") globalThis.localStorage?.removeItem(PREVIEW_WIDTH_KEY);
    else globalThis.localStorage?.setItem(PREVIEW_WIDTH_KEY, String(next));
  } catch { /* keep the in-memory value */ }
  for (const listener of previewWidthListeners) listener();
}

function subscribePreviewWidth(listener: () => void): () => void {
  previewWidthListeners.add(listener);
  return () => { previewWidthListeners.delete(listener); };
}

export function usePreviewWidth(): PreviewWidth {
  return useSyncExternalStore(subscribePreviewWidth, previewWidth, previewWidth);
}

/** Tests: back to the room the page has. */
export function resetPreviewWidth(): void {
  setPreviewWidth("auto");
}

/**
 * How wide the list is beside the open file, where the screen shows both. The
 * reader sets it by dragging the line between them (`list-divider`); until
 * they do, the layout's own width applies. The style sheet holds whatever is
 * kept here to the room the window has.
 */
const LIST_WIDTH_KEY = "pairfob.workspace.listWidth";
const listWidthListeners = new Set<() => void>();

function readListWidth(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(LIST_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.round(stored) : null;
  } catch {
    return null;
  }
}

/** In px; null until the reader sets one. */
let listWidthChosen = readListWidth();

export function workspaceListWidth(): number | null {
  return listWidthChosen;
}

export function setWorkspaceListWidth(next: number | null): void {
  listWidthChosen = next === null ? null : Math.round(next);
  try {
    if (listWidthChosen === null) globalThis.localStorage?.removeItem(LIST_WIDTH_KEY);
    else globalThis.localStorage?.setItem(LIST_WIDTH_KEY, String(listWidthChosen));
  } catch { /* keep the in-memory value */ }
  for (const listener of listWidthListeners) listener();
}

function subscribeListWidth(listener: () => void): () => void {
  listWidthListeners.add(listener);
  return () => { listWidthListeners.delete(listener); };
}

export function useWorkspaceListWidth(): number | null {
  return useSyncExternalStore(subscribeListWidth, workspaceListWidth, workspaceListWidth);
}

/** Tests: back to the layout's own width. */
export function resetWorkspaceListWidth(): void {
  setWorkspaceListWidth(null);
}
