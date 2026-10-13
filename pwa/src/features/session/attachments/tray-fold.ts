import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS, motionMs } from "../../../shared/ui/dom/motion";
import { playMove } from "../measured-move";

/**
 * The tray opening and shutting by height.
 *
 * The tray is in the dock's flow, above the keys and the field. Appearing in
 * one frame it pushed everything over it up by its height, and took that back
 * as abruptly when the last file left. It folds open and shut instead (the
 * shared `Fold`), kept on the page for the length of its exit.
 *
 * Three things a plain fold does not know:
 *
 * - `appear`: only a tray that got its first content while it was already on
 *   the page opens. One drawn with files in it (a session reopened, a mode
 *   switched) is simply there.
 * - `rest`: a fold clips what it holds, and at rest the tray must not be
 *   clipped: the action bar rises out of it, and under a finger the thumbnails'
 *   × areas reach past its edge. The clip is taken off once the move is over.
 * - `instant`: in the complete terminal the tray's height is the computer's
 *   rows, so there it is there or it is not, in one frame.
 */
export type TrayFold = {
  /** Draw the tray at all: shown, or shutting. */
  mounted: boolean;
  /** Open from shut on the frame it is first drawn. */
  appear: boolean;
  /** Neither opening nor shutting. */
  rest: boolean;
};

export function useTrayFold(shown: boolean, instant: boolean): TrayFold {
  const exit = instant ? 0 : MOTION_MS.panel;
  const presence = usePresence(shown, exit);
  const was = useRef<boolean | null>(null);
  const appear = useRef(false);
  const [moving, setMoving] = useState(false);
  // Decided during render, so the frame that opens or shuts it is already the moving one.
  if (was.current !== shown) {
    const changed = was.current !== null && motionMs(exit) > 0;
    was.current = shown;
    if (shown) appear.current = changed;
    if (changed && !moving) setMoving(true);
  }
  useEffect(() => {
    if (!moving) return;
    const timer = window.setTimeout(() => setMoving(false), motionMs(MOTION_MS.panel));
    return () => window.clearTimeout(timer);
  }, [moving, shown]);
  return { mounted: presence.mounted, appear: appear.current, rest: !moving };
}

/**
 * The open tray following the height of what it holds.
 *
 * The last thumbnail leaving for the undo line, a second row of notices: the
 * tray stays open at another height, and everything above it would jump by
 * the difference. The fold eases from the height it had to the one it has.
 * `still` is every time that is not this move: the tray opening or shutting,
 * which is the fold's own, and the complete terminal.
 *
 * A repaint in the middle of the move finds the same height underneath and
 * lets the move carry on from where it is drawn.
 */
export function useTrayHeight(still: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  const move = useRef<{ animation: Animation; ends: number } | null>(null);
  useLayoutEffect(() => {
    const fold = ref.current;
    const now = performance.now();
    const running = move.current && move.current.ends > now ? move.current : null;
    // The height while a move runs is the drawn one; the real one is under it.
    const drawn = fold && running ? fold.offsetHeight : null;
    move.current?.animation.cancel();
    move.current = null;
    if (!fold || still) { last.current = null; return; }
    const height = fold.offsetHeight;
    const from = drawn ?? last.current;
    last.current = height;
    if (from === null || from === height) return;
    const ms = running ? running.ends - now : MOTION_MS.element;
    const animation = playMove(fold, [{ height: `${from}px`, overflow: "clip" }, { height: `${height}px`, overflow: "clip" }], ms);
    if (animation) move.current = { animation, ends: now + ms };
  });
  return ref;
}
