import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { swallowReleaseClick } from "../overlay/object-press";

/**
 * The line between two columns, which the reader can move to set one column's
 * width: with a drag (a mouse or a finger), or with the arrows, Home and End
 * once it has focus. Pressing it twice, or Enter while it has focus, hands the
 * width back to the layout.
 *
 * Nothing moves but a preview line until the reader lets go. A column's width
 * is its neighbour's too, and a neighbour may be a terminal whose box sizes the
 * program on the computer: one gesture is one new width, not one per pixel of
 * travel or per repeat of a held key.
 *
 * The owner says what the column is and may be right now (`measure`) and takes
 * the result (`onCommit`, `onReset`); where the width is kept, and the layout
 * rule that reads it, are the owner's.
 */

/** The column's width and what it may be, in px. The bounds follow the window. */
export type ColumnBox = { min: number; max: number; width: number };

/** How far a press must travel before it is a drag: a click or a tap moves nothing. */
const SLOP_MOUSE_PX = 3;
const SLOP_TOUCH_PX = 10;
/** One press of an arrow. */
export const COLUMN_KEY_STEP_PX = 16;
/** How long after a drag its own click can still arrive (a touch click trails the lift). */
const RELEASE_CLICK_MS = 700;
/** Two presses this close in time and place are one double press, from a mouse or a finger alike. */
const DOUBLE_PRESS_MS = 320;
const DOUBLE_PRESS_PX = 32;

type Drag = { pointerId: number; x: number; box: ColumnBox; travelled: boolean };
/** The width the reader is asking for, and the width the column had when they began. */
type Asked = { width: number; from: number };

/** One rem in px: the style sheets write the columns' bounds in rem, and the bounds here must be theirs. */
export function remPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

const within = (width: number, box: ColumnBox): number => Math.round(Math.min(box.max, Math.max(box.min, width)));
const same = (left: ColumnBox | null, right: ColumnBox | null): boolean =>
  left === right || (!!left && !!right && left.min === right.min && left.max === right.max && left.width === right.width);

export function ColumnDivider({ label, hint, valueText, controls, side, measure, onCommit, onReset, className = "" }: {
  label: string;
  /** How it is operated, for whoever cannot see the line move: the keys, and how the width is handed back. */
  hint: string;
  /** The width as it is said, e.g. "480 pixels". */
  valueText(width: number): string;
  /** The id of the column the line sizes. */
  controls?: string;
  /** Where the column it sizes lies: `before` the line (moving the line on widens it) or `after` it. */
  side: "before" | "after";
  /** The column as it stands, or null while there is nothing to size. */
  measure(): ColumnBox | null;
  onCommit(width: number): void;
  onReset(): void;
  className?: string;
}) {
  const [box, setBox] = useState<ColumnBox | null>(null);
  /** What the reader is asking for and has not let go of yet. */
  const [preview, setPreview] = useState<Asked | null>(null);
  const asked = useRef<Asked | null>(null);
  const drag = useRef<Drag | null>(null);
  /** The last press that moved nothing: a second one beside it is a double press. */
  const lastPress = useRef<{ x: number; y: number; at: number } | null>(null);
  const hintId = useId();
  const read = useRef(measure);
  read.current = measure;
  const toward = side === "before" ? 1 : -1;

  const sync = () => {
    const next = read.current();
    setBox((current) => same(current, next) ? current : next);
  };
  // After every render: a width the owner applied is on the page by now.
  useLayoutEffect(sync);
  useEffect(() => {
    // Once more when everything is mounted: an owner's ref to an ancestor is attached after this line's own layout effect.
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const show = (next: Asked | null) => {
    asked.current = next;
    setPreview(next);
  };
  const drop = () => {
    drag.current = null;
    show(null);
  };
  const settle = () => {
    const last = asked.current;
    show(null);
    if (last && last.width !== Math.round(last.from)) onCommit(last.width);
  };
  const reset = () => {
    drop();
    onReset();
  };

  const present = !!box && box.max - box.min >= 1;
  // The line can leave under a drag (a rotation or a narrower window closes the
  // bounds): a drag that lost its line is over, or the next press would find it still held.
  useEffect(() => {
    if (present) return;
    drag.current = null;
    lastPress.current = null;
    if (asked.current) show(null);
  }, [present]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const now = read.current();
    if (!now) return;
    // The press is the line's: it selects no text and starts no gesture of the page under it.
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not every DOM implements capture */ }
    drag.current = { pointerId: event.pointerId, x: event.clientX, box: now, travelled: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const travel = event.clientX - current.x;
    if (!current.travelled && Math.abs(travel) < (event.pointerType === "mouse" ? SLOP_MOUSE_PX : SLOP_TOUCH_PX)) return;
    current.travelled = true;
    event.preventDefault();
    show({ width: within(current.box.width + toward * travel, current.box), from: current.box.width });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
    if (!current.travelled) {
      // Read here and not from `dblclick`, which a finger rarely sends.
      const before = lastPress.current;
      const doubled = before !== null && event.timeStamp - before.at <= DOUBLE_PRESS_MS
        && Math.hypot(event.clientX - before.x, event.clientY - before.y) <= DOUBLE_PRESS_PX;
      lastPress.current = doubled ? null : { x: event.clientX, y: event.clientY, at: event.timeStamp };
      if (doubled) reset();
      return;
    }
    lastPress.current = null;
    // The release may land on a row or a button the line was dragged over: its click is not for them.
    swallowReleaseClick(event.currentTarget.ownerDocument, event.pointerId, { withinMs: RELEASE_CLICK_MS });
    settle();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") {
      // Only what the reader is in the middle of is Escape's here; otherwise it is the page's.
      if (asked.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      drop();
      return;
    }
    if (event.key === "Enter") {
      // The same as pressing the line twice: the layout's own width again.
      event.preventDefault();
      event.stopPropagation();
      reset();
      return;
    }
    const now = read.current();
    if (!now) return;
    const from = asked.current?.width ?? now.width;
    // The arrows move the line; Home and End are the column at its narrowest and its widest.
    const to = event.key === "ArrowRight" ? from + toward * COLUMN_KEY_STEP_PX
      : event.key === "ArrowLeft" ? from - toward * COLUMN_KEY_STEP_PX
      : event.key === "Home" ? now.min
      : event.key === "End" ? now.max
      : null;
    if (to === null) return;
    event.preventDefault();
    event.stopPropagation();
    show({ width: within(to, now), from: asked.current?.from ?? now.width });
  };

  if (!box || !present) return null;
  const shown = preview?.width ?? box.width;
  const style = { "--column-divider-shift": `${preview ? Math.round(toward * (preview.width - preview.from)) : 0}px` } as CSSProperties;
  return <div className={`column-divider${preview === null ? "" : " is-active"}${className ? ` ${className}` : ""}`}
    role="separator" tabIndex={0} aria-orientation="vertical" aria-label={label} aria-describedby={hintId} aria-controls={controls}
    aria-valuemin={Math.round(box.min)} aria-valuemax={Math.round(box.max)} aria-valuenow={Math.round(shown)}
    aria-valuetext={valueText(Math.round(shown))} aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter"
    style={style}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={drop}
    onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) drop(); }}
    onKeyDown={onKeyDown}
    onKeyUp={() => { if (!drag.current) settle(); }}
    onBlur={() => { if (!drag.current) settle(); }}
    onContextMenu={(event) => event.preventDefault()}>
    <span className="column-divider-line" aria-hidden="true" />
    <span className="column-divider-knob" aria-hidden="true" />
    <span id={hintId} hidden>{hint}</span>
  </div>;
}
