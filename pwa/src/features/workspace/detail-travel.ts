import { useEffect, useRef, useState } from "react";
import { MOTION_MS, prefersReducedMotion } from "../../shared/ui/dom/motion";
import { listBeside } from "./list-beside";
import type { WorkspaceView } from "./model";

/**
 * The reader's own step between the list and what a row opened, one pane at a
 * time.
 *
 * Under 900px the files screen shows the list or the detail, and going from
 * one to the other is a move like any between screens: the detail arrives from
 * the right while the list steps back, and leaves the way it came
 * (`workspace.scss`).
 *
 * The screen changes pane for reasons that are not that step. It opens on the
 * detail the reader left it at; a refresh empties it and puts the detail back;
 * a link in the session opens it on a file. So the step is declared by the
 * action that takes it, as `app/transition` has a navigation declared, and a
 * pane that changes with nothing declared for it is drawn where it stands. A
 * poll changes no pane, and a window dragged across 900px has the two side by
 * side, where nothing travels.
 */

type Direction = "arriving" | "leaving";

let declared: { direction: Direction; serial: number } = { direction: "arriving", serial: 0 };
/** Above zero while an action opens a detail for a screen that is itself arriving. */
let direct = 0;

/**
 * Called by the action that moved the view, as it commits the move. Only list
 * to detail and back is a step: from one file to the next the pane stays.
 */
export function noteDetailTravel(from: WorkspaceView, to: WorkspaceView): void {
  const was = from !== "browser";
  const now = to !== "browser";
  if (direct > 0 || was === now) return;
  declared = { direction: now ? "arriving" : "leaving", serial: declared.serial + 1 };
}

/**
 * Open a detail for a screen that arrives on it (a file link in the session):
 * the screen's own arrival is the one move, and the pane inside it stands
 * still. Covers what `open` commits before it first waits.
 */
export function arrivingDirectly<Result>(open: () => Result): Result {
  direct += 1;
  try {
    return open();
  } finally {
    direct -= 1;
  }
}

export type DetailTravel = {
  /** What the shell is marked with while its panes move; empty when they stand. */
  className: "" | " is-detail-arriving" | " is-detail-leaving";
  /** The pane on its way out: still on the page, and out of reach, until it is gone. */
  leaving: "list" | "detail" | null;
};

const STANDING: DetailTravel = { className: "", leaving: null };

type Move = { direction: Direction; reduced: boolean };

/**
 * `detail` is whether the screen shows a file or a diff. The answer names the
 * move for as long as it runs, and is `STANDING` again once it is over.
 */
export function useDetailTravel(detail: boolean): DetailTravel {
  const [, redraw] = useState(0);
  const state = useRef<{ detail: boolean; serial: number; move: Move | null }>({ detail, serial: declared.serial, move: null });
  const s = state.current;
  if (s.detail !== detail) {
    s.detail = detail;
    const direction: Direction = detail ? "arriving" : "leaving";
    const stepped = declared.serial !== s.serial && declared.direction === direction && !listBeside();
    s.move = stepped ? { direction, reduced: prefersReducedMotion() } : null;
  }
  // A declaration is for the paint that follows it and for no other.
  s.serial = declared.serial;
  const move = s.move;
  useEffect(() => {
    if (!move) return;
    // Without travel the arriving pane only fades in, which is over sooner.
    const timer = window.setTimeout(() => {
      if (state.current.move !== move) return;
      state.current.move = null;
      redraw((turn) => turn + 1);
    }, move.reduced ? MOTION_MS.element : MOTION_MS.screen);
    return () => window.clearTimeout(timer);
  }, [move]);
  if (!move) return STANDING;
  return {
    className: move.direction === "arriving" ? " is-detail-arriving" : " is-detail-leaving",
    // A reader who asked for less motion sees the old pane go at once: nothing is kept.
    leaving: move.reduced ? null : move.direction === "arriving" ? "list" : "detail",
  };
}
