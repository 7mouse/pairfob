import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

/**
 * One Tab stop for the lines of a diff.
 *
 * Every line that can take a note has a button, and a diff has hundreds of
 * lines: as Tab stops they would stand between the reader and everything after
 * the diff — the notes waiting to be sent, the next file. So the lines share a
 * stop, on the line the reader was last on, and the arrows, Home and End move
 * along them. What stands between the lines is on the same path: a hunk's head
 * (Enter folds it), the unchanged stretch before it, the way to the rest of a
 * long patch. A note's own controls stay ordinary stops under its line.
 */

const NOTE_LINE = ".diff-comment-btn";
const LINE = `${NOTE_LINE}, .diff-stop`;
/** Every stop of the lines' shared path, in the order the arrows walk it. */
export const DIFF_STOPS = LINE;

const HOLD = "pairfob:diff-stop";

/**
 * Makes `stop` the one Tab stop of its diff without moving focus there: for
 * what moves the reader by other means (the hunk stepper), so Tab into the
 * diff arrives where they are reading.
 */
export function holdDiffStop(stop: HTMLElement): void {
  // The element's own window makes the event: the one its listeners are in.
  const view = stop.ownerDocument.defaultView;
  if (view) stop.dispatchEvent(new view.CustomEvent(HOLD, { bubbles: true }));
}

/** The row of two a stop is in, or the stop itself where the diff is one column. */
const rowOf = (stop: HTMLElement): HTMLElement => stop.closest<HTMLElement>(".diff-split-row") ?? stop;
/** The side of that row the stop is on: 0 the old file, 1 the new one. */
const sideOf = (stop: HTMLElement): number => stop.closest(".diff-split-cell")?.previousElementSibling ? 1 : 0;

/**
 * The stop one row down or up. Where the two sides stand next to each other
 * that is the next row, on the side the reader is on when it has a stop there;
 * the other side of the same row is Left and Right.
 */
function rowStep(all: HTMLElement[], at: number, direction: -1 | 1): number {
  const row = rowOf(all[at]);
  let to = at + direction;
  while (all[to] && rowOf(all[to]) === row) to += direction;
  if (!all[to]) return at;
  const next = rowOf(all[to]);
  const same = all.findIndex((stop) => rowOf(stop) === next && sideOf(stop) === sideOf(all[at]));
  return next !== all[to] && same >= 0 ? same : to;
}

function sideStep(all: HTMLElement[], at: number, side: 0 | 1): number {
  const row = rowOf(all[at]);
  if (row === all[at]) return -1;
  const to = all.findIndex((stop) => rowOf(stop) === row && sideOf(stop) === side);
  return to < 0 ? at : to;
}

export function useLineStops(table: RefObject<HTMLElement | null>): {
  onFocus(event: FocusEvent<HTMLElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
} {
  const stop = useRef<HTMLElement | null>(null);
  const lines = (): HTMLElement[] => [...(table.current?.querySelectorAll<HTMLElement>(LINE) ?? [])];
  const hold = (line: HTMLElement | null): void => {
    if (stop.current && stop.current !== line) stop.current.tabIndex = -1;
    if (line) line.tabIndex = 0;
    stop.current = line;
  };

  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const held = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.matches(LINE)) hold(event.target);
    };
    el.addEventListener(HOLD, held);
    return () => el.removeEventListener(HOLD, held);
    // `hold` only reads refs: the first one serves every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  // After every render: lines come and go with the patch, and exactly one holds the stop.
  useLayoutEffect(() => {
    const all = lines();
    // Until the reader has been on one, the stop is the first line of code rather than the head above it.
    const kept = stop.current && all.includes(stop.current) ? stop.current : all.find((line) => line.matches(NOTE_LINE)) ?? all[0] ?? null;
    for (const line of all) {
      const index = line === kept ? 0 : -1;
      if (line.tabIndex !== index) line.tabIndex = index;
    }
    stop.current = kept;
  });

  return {
    onFocus(event) {
      const line = event.target.matches(LINE) ? event.target : null;
      if (line) hold(line);
    },
    onKeyDown(event) {
      const line = event.target as HTMLElement;
      if (!line.matches(LINE) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const all = lines();
      const at = all.indexOf(line);
      if (at < 0) return;
      // J and K are the arrows, as in every reader of diffs.
      const to = event.key === "ArrowDown" || event.key === "j" ? rowStep(all, at, 1)
        : event.key === "ArrowUp" || event.key === "k" ? rowStep(all, at, -1)
        : event.key === "ArrowLeft" ? sideStep(all, at, 0)
        : event.key === "ArrowRight" ? sideStep(all, at, 1)
        : event.key === "Home" ? 0
        : event.key === "End" ? all.length - 1
        : -1;
      // At either end the key is the diff's again: it scrolls to what lies past the last stop.
      if (to < 0 || to === at) return;
      // The arrows are the lines' while one has focus; without this they would scroll the diff as well.
      event.preventDefault();
      hold(all[to]);
      all[to].focus();
    },
  };
}
