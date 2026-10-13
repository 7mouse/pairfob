import { useRef } from "react";

/**
 * True once `on` became true in front of this component, until it is false
 * again. Already true when the component was first drawn is false.
 *
 * It is how the transcript tells a change from a paint: a step that finishes,
 * a turn that ends or an agent that stops to ask does so on a card that was on
 * screen before; the same result drawn by a first paint, by older history or
 * by a remount was never seen changing, and its mark must not move.
 */
export function useTurned(on: boolean): boolean {
  const was = useRef(on);
  const turned = useRef(false);
  if (was.current !== on) {
    turned.current = on;
    was.current = on;
  }
  return turned.current;
}
