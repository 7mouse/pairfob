import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { pointerFine } from "../../app/input-mode";

/**
 * How a diff reads at arm's length: the size of its lines, and whether they
 * wrap. The size is the reader's, per device, in three steps; until they pick
 * one the style sheet's own size applies (a size up under a finger), so a
 * desktop diff reads exactly as it did. Storage can be missing or throw: the
 * in-memory choice still holds for the page.
 */
export const DIFF_SIZES = [12, 13.5, 15] as const;
const SIZE_KEY = "pairfob.workspace.diffSize";
const listeners = new Set<() => void>();

function readSize(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(SIZE_KEY));
    return DIFF_SIZES.find((size) => size === stored) ?? null;
  } catch {
    return null;
  }
}

let chosen = readSize();

/** The reader's size in px; null until they pick one. */
export function diffSize(): number | null {
  return chosen;
}

/** What the style sheet draws when nothing is chosen: the step a size starts from. */
function drawnSize(): number {
  return chosen ?? (pointerFine() ? 12 : 13);
}

export function setDiffSize(next: number | null): void {
  chosen = next === null ? null : DIFF_SIZES.find((size) => size === next) ?? null;
  try {
    if (chosen === null) globalThis.localStorage?.removeItem(SIZE_KEY);
    else globalThis.localStorage?.setItem(SIZE_KEY, String(chosen));
  } catch { /* keep the in-memory value */ }
  for (const listener of listeners) listener();
}

/** One step bigger (1) or smaller (-1). False at either end, where nothing changes. */
export function stepDiffSize(direction: 1 | -1): boolean {
  const now = drawnSize();
  const next = direction > 0 ? DIFF_SIZES.find((size) => size > now) : [...DIFF_SIZES].reverse().find((size) => size < now);
  if (next === undefined) return false;
  setDiffSize(next);
  return true;
}

export function canStepDiffSize(direction: 1 | -1): boolean {
  const now = drawnSize();
  return direction > 0 ? now < DIFF_SIZES[DIFF_SIZES.length - 1] : now > DIFF_SIZES[0];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDiffSize(): number | null {
  return useSyncExternalStore(subscribe, diffSize, diffSize);
}

/** Tests: back to the style sheet's size. */
export function resetDiffSize(): void {
  setDiffSize(null);
}

/**
 * Whether a diff's lines wrap. A diff has always wrapped, under a finger and
 * under a mouse; it only keeps its lines whole once the reader has turned
 * wrapping off, with the same switch the file view uses.
 */
export function diffWraps(wrapChosen: boolean | null): boolean {
  return wrapChosen ?? true;
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
 * so scrolling stays native. Only a two-finger move is held back, which is
 * also what keeps the page itself from zooming (and Safari's gesture events).
 */
export function useDiffPinch(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pinch = new PinchSteps();
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch.start(spread(event.touches));
      else pinch.end();
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.active) return;
      if (event.cancelable) event.preventDefault();
      const step = pinch.move(spread(event.touches));
      if (step) stepDiffSize(step);
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch.end();
    };
    const onGesture = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    el.addEventListener("gesturestart", onGesture);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", onGesture);
    };
  }, [ref]);
}

