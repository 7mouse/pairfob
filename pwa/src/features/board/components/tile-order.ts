import { useEffect, useRef, useState } from "react";
import { MOTION_MS, motionMs } from "../../../shared/ui/dom/motion";

/**
 * The order a tab's tiles are in the document.
 *
 * A swap gives the same panes in another order. Following it at once would
 * have React move a node, and a node that is moved ends its travel where it
 * is: one of the two tiles would jump while the other slides. So while the
 * tiles travel (`--dur-3`, board-canvas.scss) each stays where it is in the
 * document, and they take the layout's order, which is the order focus walks
 * them in, once they have arrived.
 *
 * Only a pure reorder waits. A pane that joined or left changes the set, and
 * the list is followed as it comes.
 */
export function useSettledOrder<Item>(items: readonly Item[], keyOf: (item: Item) => string): Item[] {
  const [, redraw] = useState(0);
  const state = useRef<{ order: string[]; until: number }>({ order: [], until: 0 });
  const held = state.current;
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  const wait = motionMs(MOTION_MS.panel);
  const keys = items.map(keyOf);
  const samePanes = keys.length === held.order.length && keys.every((key) => held.order.includes(key));
  const reordered = samePanes && keys.some((key, index) => held.order[index] !== key);
  if (reordered && wait > 0) {
    if (!held.until) held.until = now + wait;
  } else {
    held.until = 0;
  }
  const holding = held.until > now;
  if (!holding) {
    held.until = 0;
    held.order = keys;
  }
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(() => redraw((count) => count + 1), Math.max(0, state.current.until - (typeof performance === "undefined" ? Date.now() : performance.now())) + 1);
    return () => window.clearTimeout(timer);
  });
  if (!holding) return [...items];
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  return held.order.map((key) => byKey.get(key)!);
}
