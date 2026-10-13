/**
 * Lift-to-swap on the board canvas.
 *
 * A long press lifts a tile: it follows the finger, the panes it touches become
 * drop targets labelled with the swap direction, every other pane dims, and
 * the tab row says what a release does (`data-board-lift` is "" while the tile
 * is held in place, "moved" once it has been dragged; see `.board-mode`). The
 * marks are data attributes and CSS variables on the rendered tiles, so the
 * React tree never re-renders at pointer speed; `finish` and `cancel` strip
 * every mark they set. Hit-testing uses tile rects, not `elementFromPoint`, so
 * the lifted tile under the finger never hides its target.
 *
 * A tile that was carried is put down, not dropped: once its lift marks are
 * gone the stylesheet eases it back to its place, and `data-board-settle`
 * keeps it above its neighbours for as long as that takes. Dropped on a
 * neighbour it is held where it was let go (`data-board-settle="held"`) until
 * the layout answers, so it travels once, from the finger to its new place,
 * and not home first.
 */
import { t, type CopyKey } from "../../../lib/i18n";
import type { LayoutDirection } from "../../../lib/operations";
import { MOTION_MS, motionMs } from "../../../shared/ui/dom/motion";

export type LiftResult = {
  target: string;
  direction: LayoutDirection | null;
  moved: boolean;
  /** Put down a tile that is held over its target; call it when the swap it asked for is over. */
  putDown(): void;
};
export type LiftSession = {
  move(point: { x: number; y: number }): void;
  finish(): LiftResult;
  cancel(): void;
};

const LABELS: Record<LayoutDirection, CopyKey> = {
  left: "boardCanvas.liftLeft",
  right: "boardCanvas.liftRight",
  up: "boardCanvas.liftUp",
  down: "boardCanvas.liftDown",
};

/** Tiles on their way back to their place, each with the timer that ends it. */
const settling = new WeakMap<HTMLElement, number>();

function endSettle(tile: HTMLElement): void {
  const timer = settling.get(tile);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  settling.delete(tile);
  delete tile.dataset.boardSettle;
}

/** Keep the tile on top while it travels back (`--dur-3`, board-canvas.scss). */
function settle(tile: HTMLElement): void {
  endSettle(tile);
  const wait = motionMs(MOTION_MS.panel);
  if (!wait) return;
  tile.dataset.boardSettle = "";
  settling.set(tile, window.setTimeout(() => endSettle(tile), wait));
}

/** Tiles held where they were dropped, each with what puts it down. */
const held = new WeakMap<HTMLElement, () => void>();

/**
 * Keep a dropped tile at the finger's offset until its box changes, which is
 * the layout answering. The offset goes in the same frame as the new box
 * arrives, so both leave together and the tile takes one straight path. The
 * caller puts it down itself when the request ends without a new box.
 */
function hold(tile: HTMLElement): () => void {
  const box = () => `${tile.style.left} ${tile.style.top} ${tile.style.width} ${tile.style.height}`;
  const dropped = box();
  const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => { if (box() !== dropped) putDown(); });
  const putDown = () => {
    if (held.get(tile) !== putDown) return;
    held.delete(tile);
    watch?.disconnect();
    tile.style.removeProperty("--board-lift-x");
    tile.style.removeProperty("--board-lift-y");
    if (tile.isConnected) settle(tile);
    else delete tile.dataset.boardSettle;
  };
  held.set(tile, putDown);
  tile.dataset.boardSettle = "held";
  watch?.observe(tile, { attributes: true, attributeFilter: ["style"] });
  return putDown;
}

function contains(rect: DOMRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function startLift(
  root: HTMLElement,
  tile: HTMLElement,
  paneId: string,
  targets: ReadonlyMap<string, LayoutDirection>,
  origin: { x: number; y: number },
  slop: number,
): LiftSession {
  const tiles = [...root.querySelectorAll<HTMLElement>(".board-pane")];
  // The stage is scaled; a screen delta moves the tile by delta / scale stage px.
  const scale = tile.offsetWidth > 0 ? tile.getBoundingClientRect().width / tile.offsetWidth || 1 : 1;
  let moved = false;
  let carried = false;
  let over = "";
  // Picked up again before it was back: the lift is the only mark it has.
  held.get(tile)?.();
  endSettle(tile);
  tile.dataset.boardLift = "";
  for (const other of tiles) {
    const id = other.dataset.paneId || "";
    if (id === paneId) continue;
    const direction = targets.get(id);
    if (direction) {
      other.dataset.boardDrop = direction;
      other.dataset.boardDropLabel = t(LABELS[direction]);
    } else {
      other.dataset.boardDim = "";
    }
  }

  const clear = (keep = false): (() => void) => {
    let putDown = () => {};
    if (keep) {
      putDown = hold(tile);
    } else {
      // Only a tile that left its place has a way back to travel.
      if (carried && tile.isConnected) settle(tile);
      tile.style.removeProperty("--board-lift-x");
      tile.style.removeProperty("--board-lift-y");
    }
    delete tile.dataset.boardLift;
    for (const other of tiles) {
      delete other.dataset.boardDrop;
      delete other.dataset.boardDropLabel;
      delete other.dataset.boardDropOver;
      delete other.dataset.boardDim;
    }
    return putDown;
  };

  return {
    move(point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      // From here a release no longer opens the menu, and the hint in the tab row says so.
      if (!moved && Math.hypot(dx, dy) >= slop) { moved = true; tile.dataset.boardLift = "moved"; }
      carried ||= dx !== 0 || dy !== 0;
      tile.style.setProperty("--board-lift-x", `${dx / scale}px`);
      tile.style.setProperty("--board-lift-y", `${dy / scale}px`);
      const hit = tiles.find((other) => other !== tile && targets.has(other.dataset.paneId || "")
        && contains(other.getBoundingClientRect(), point));
      const next = hit?.dataset.paneId || "";
      if (next === over) return;
      for (const other of tiles) {
        if ((other.dataset.paneId || "") === next) other.dataset.boardDropOver = "";
        else delete other.dataset.boardDropOver;
      }
      over = next;
    },
    finish() {
      const direction = over ? targets.get(over) ?? null : null;
      // A reader who asked for less motion sees the tiles change places at once: nothing to wait over.
      const putDown = clear(!!direction && carried && tile.isConnected && motionMs(MOTION_MS.panel) > 0);
      return { target: over, direction, moved, putDown };
    },
    cancel() { clear(); },
  };
}
