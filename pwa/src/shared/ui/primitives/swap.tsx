import { useRef, type ComponentPropsWithoutRef } from "react";

type SwapProps = ComponentPropsWithoutRef<"span"> & {
  /** The value whose change is worth marking: a status word, a count, a name. */
  on: string | number;
  as?: "span" | "strong" | "b" | "em" | "small" | "p" | "div";
};

/**
 * A label that fades in when what it says changes (`.swap-in`, the list card's
 * `pill-swap` for everything else that swaps a word in place).
 *
 * It marks a change, never a paint: the first render and any repaint with the
 * same `on` are still. A remount by the parent starts over as a first render.
 */
export function Swap({ on, as: Element = "span", className = "", ...props }: SwapProps) {
  const seen = useRef(on);
  const turn = useRef(0);
  if (seen.current !== on) {
    seen.current = on;
    turn.current += 1;
  }
  // A new key per change restarts the animation on a fresh node.
  return <Element {...props} key={turn.current} className={`${className}${turn.current ? " swap-in" : ""}`.trim() || undefined} />;
}
