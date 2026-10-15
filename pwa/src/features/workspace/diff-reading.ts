import { useEffect, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { pointerFine } from "../../app/input-mode";
import { isPageZoomed } from "../../lib/gesture-boundary";

/**
 * How a diff reads at arm's length: the size of its lines, and whether they
 * wrap. Both are the reader's, per device. Until they pick a size the style
 * sheet's own applies (it follows the terminal's size, a size up under a
 * finger), so a desktop diff reads exactly as it did; a diff wraps until they
 * turn it off, whatever the file view does. Storage can be missing or throw:
 * the in-memory choice still holds for the page.
 */
export const DIFF_SIZES = [12, 13.5, 15] as const;
const SIZE_KEY = "pairfob.workspace.diffSize";
const WRAP_KEY = "pairfob.workspace.diffWrap";
const listeners = new Set<() => void>();
const beforeListeners = new Set<() => void>();

function readSize(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(SIZE_KEY));
    return DIFF_SIZES.find((size) => size === stored) ?? null;
  } catch {
    return null;
  }
}

function readWrap(): boolean {
  try {
    return globalThis.localStorage?.getItem(WRAP_KEY) !== "0";
  } catch {
    return true;
  }
}

let chosen = readSize();
let wraps = readWrap();

function changed(): void {
  for (const listener of listeners) listener();
}

/**
 * Hear just before the size or the wrap changes, while the lines are still
 * drawn the old way: an open diff keeps the line being read where it is, from
 * whichever control, key or pinch the change came.
 */
export function beforeReadingChange(listener: () => void): () => void {
  beforeListeners.add(listener);
  return () => { beforeListeners.delete(listener); };
}

function aboutToChange(): void {
  for (const listener of beforeListeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The reader's size in px; null until they pick one. */
export function diffSize(): number | null {
  return chosen;
}

export function setDiffSize(next: number | null): void {
  const size = next === null ? null : DIFF_SIZES.find((step) => step === next) ?? null;
  if (size === chosen) return;
  aboutToChange();
  chosen = size;
  try {
    if (chosen === null) globalThis.localStorage?.removeItem(SIZE_KEY);
    else globalThis.localStorage?.setItem(SIZE_KEY, String(chosen));
  } catch { /* keep the in-memory value */ }
  changed();
}

export function useDiffSize(): number | null {
  return useSyncExternalStore(subscribe, diffSize, diffSize);
}

export type DiffReading = { className: string; style?: CSSProperties };

/** The reader's size on a box of diff lines (`has-diff-fs`): the lines, and the skeleton that stands in for them. */
export function useDiffSizeBox(): DiffReading {
  const size = useDiffSize();
  return size === null ? { className: "" } : { className: " has-diff-fs", style: { "--diff-fs": `${size}px` } as CSSProperties };
}

/** Tests: back to the style sheet's size. */
export function resetDiffSize(): void {
  setDiffSize(null);
}

/**
 * The size the lines are drawn at: the reader's, or else the one the style
 * sheet gave them, read off the lines themselves, so a step always starts from
 * what is on screen whatever the terminal's size.
 */
export function drawnDiffSize(lines: Element | null): number {
  if (chosen !== null) return chosen;
  const style = lines?.ownerDocument.defaultView?.getComputedStyle(lines);
  const drawn = style ? Number.parseFloat(style.fontSize) : Number.NaN;
  return drawn > 0 ? drawn : pointerFine() ? 12 : 13;
}

/** A drawn size this close to a step is that step. */
const SAME_SIZE = 0.05;

function nextSize(direction: 1 | -1, from: number): number | undefined {
  return direction > 0
    ? DIFF_SIZES.find((size) => size > from + SAME_SIZE)
    : [...DIFF_SIZES].reverse().find((size) => size < from - SAME_SIZE);
}

export function canStepDiffSize(direction: 1 | -1, from: number): boolean {
  return nextSize(direction, from) !== undefined;
}

/** The step bigger (1) or smaller (-1) than `from`. False past either end, where nothing changes. */
export function stepDiffSize(direction: 1 | -1, from = drawnDiffSize(null)): boolean {
  const next = nextSize(direction, from);
  if (next === undefined) return false;
  setDiffSize(next);
  return true;
}

/** Whether a diff's lines wrap: until the reader turns it off, they do. */
export function diffWrap(): boolean {
  return wraps;
}

export function setDiffWrap(next: boolean): void {
  if (next === wraps) return;
  aboutToChange();
  wraps = next;
  try { globalThis.localStorage?.setItem(WRAP_KEY, next ? "1" : "0"); } catch { /* keep the in-memory value */ }
  changed();
}

export function useDiffWrap(): boolean {
  return useSyncExternalStore(subscribe, diffWrap, diffWrap);
}

/** Tests: back to wrapping, with nothing kept. */
export function resetDiffWrap(): void {
  wraps = true;
  try { globalThis.localStorage?.removeItem(WRAP_KEY); } catch { /* ignore */ }
  changed();
}

/** Fingers have to spread or close this much before the size takes a step. */
export const PINCH_IN = 0.8;
export const PINCH_OUT = 1.25;

/**
 * A two-finger pinch over the lines, as a ratio of the fingers' distance to
 * where it last took a step. Each crossing takes one step and starts measuring
 * again from there, so a long spread walks through the sizes one at a time.
 */
export class PinchSteps {
  private base = 0;

  start(distance: number): void {
    this.base = distance > 0 ? distance : 0;
  }

  /** The step this distance asks for: 1 bigger, -1 smaller, 0 none yet. */
  move(distance: number): 1 | -1 | 0 {
    if (this.base <= 0 || distance <= 0) return 0;
    const ratio = distance / this.base;
    if (ratio >= PINCH_OUT) { this.base = distance; return 1; }
    if (ratio <= PINCH_IN) { this.base = distance; return -1; }
    return 0;
  }

  end(): void {
    this.base = 0;
  }

  get active(): boolean {
    return this.base > 0;
  }
}

type TouchPoint = { clientX: number; clientY: number };
function spread(touches: ArrayLike<TouchPoint>): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Two fingers on the diff step its size instead of zooming the page. One
 * finger is left alone: the listener for a one-finger move never cancels it,
 * so scrolling stays native. A page the reader has already zoomed keeps its
 * own pinch, so it can always be zoomed back out over the lines (the style
 * sheet hands `pinch-zoom` back too, and `gesture-boundary` Safari's gesture
 * events).
 */
export function useDiffPinch(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pinch = new PinchSteps();
    const zoomed = () => isPageZoomed(el.ownerDocument);
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2 && !zoomed()) pinch.start(spread(event.touches));
      else pinch.end();
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.active) return;
      if (zoomed()) {
        pinch.end();
        return;
      }
      if (event.cancelable) event.preventDefault();
      const step = pinch.move(spread(event.touches));
      if (!step) return;
      stepDiffSize(step, drawnDiffSize(el));
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch.end();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);
}
