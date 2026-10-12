import { happy } from "./dom";

/**
 * The diff's box as a browser would lay it out; happy-dom measures nothing.
 * Every row is as high as its kind says, rows stack in document order, and the
 * box scrolls no further than its content, so a test can ask where a hunk is
 * and whether the end was reached.
 */

export type DiffBox = { height: number; line?: number; head?: number; gap?: number };

const ROWS = ".workspace-diff-gap, .workspace-diff-hunk, .diff-split-row, .workspace-diff-line:not(.diff-split-cell), .workspace-diff-more, .workspace-diff-note, .diff-note-editor";
const proto = happy.HTMLElement.prototype;
const real = {
  client: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  scroll: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
  offset: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
  top: Object.getOwnPropertyDescriptor(happy.Element.prototype, "scrollTop"),
  rect: proto.getBoundingClientRect,
};
const tops = new WeakMap<Element, number>();
let box: DiffBox | null = null;

const scrollerOf = (el: Element): HTMLElement | null => el.closest<HTMLElement>(".workspace-diff");
const isScroller = (el: Element): boolean => el.classList.contains("workspace-diff");

function heightOf(row: Element): number {
  if (!box) return 0;
  if (row.classList.contains("workspace-diff-hunk")) return box.head ?? 30;
  if (row.classList.contains("workspace-diff-gap")) return box.gap ?? 28;
  if (row.classList.contains("workspace-diff-more")) return 48;
  if (row.classList.contains("workspace-diff-note") || row.classList.contains("diff-note-editor")) return 0;
  return box.line ?? 20;
}

function rowsOf(scroller: Element): Element[] {
  return [...scroller.querySelectorAll(ROWS)];
}

function contentOf(scroller: Element): number {
  return rowsOf(scroller).reduce((sum, row) => sum + heightOf(row), 0);
}

/** Where `el` starts in its scroller's content: its own row, or the first row inside it. */
function startOf(scroller: Element, el: Element): number {
  let top = 0;
  for (const row of rowsOf(scroller)) {
    if (row === el || row.contains(el) || el.contains(row)) return top;
    top += heightOf(row);
  }
  return top;
}

const maxTop = (scroller: HTMLElement): number => Math.max(0, contentOf(scroller) - (box?.height ?? 0));

/** Lay out every diff from now on as a box of `height` px. */
export function fakeDiffBox(shape: DiffBox): void {
  box = shape;
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return isScroller(this) ? shape.height : real.client?.get?.call(this) ?? 0; },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) { return isScroller(this) ? contentOf(this) : real.scroll?.get?.call(this) ?? 0; },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) { return scrollerOf(this) && !isScroller(this) ? heightOf(this) : real.offset?.get?.call(this) ?? 0; },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (!isScroller(this)) return real.top?.get?.call(this) ?? 0;
      return Math.min(tops.get(this) ?? 0, maxTop(this));
    },
    set(this: HTMLElement, value: number) {
      if (!isScroller(this)) { real.top?.set?.call(this, value); return; }
      tops.set(this, Math.max(0, Math.min(value, maxTop(this))));
    },
  });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const scroller = scrollerOf(this);
    if (!scroller) return real.rect.call(this);
    const top = isScroller(this) ? 0 : startOf(scroller, this) - scroller.scrollTop;
    const height = isScroller(this) ? shape.height : heightOf(this);
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  } as typeof real.rect;
}

export function restoreDiffBox(): void {
  box = null;
  const own = proto as unknown as Record<string, unknown>;
  for (const [name, was] of [["clientHeight", real.client], ["scrollHeight", real.scroll], ["offsetHeight", real.offset]] as const) {
    // What HTMLElement only inherits is read from Element again once the stand-in is gone.
    if (was) Object.defineProperty(proto, name, was);
    else delete own[name];
  }
  delete own.scrollTop;
  proto.getBoundingClientRect = real.rect;
}

/** Scroll the diff to `top` (no further than its content) and let it hear. */
export function scrollDiffTo(scroller: HTMLElement, top: number): void {
  scroller.scrollTop = top;
  scroller.dispatchEvent(new happy.Event("scroll") as unknown as Event);
}
