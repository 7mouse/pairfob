import { useEffect, useRef, useState } from "react";
import { motionMs } from "../ui/dom/motion";

/**
 * Presence for things that leave with an exit.
 *
 * React removes a node in the commit that stops rendering it, which is one
 * frame: an entrance can be a mount animation, an exit cannot. These two hooks
 * keep what just left in the tree for the length of its exit, marked as
 * leaving, and then let it go. Under reduced motion nothing is kept.
 *
 * A thing kept this way is on its way out: mark it `inert` (or `aria-hidden`
 * and unclickable) so a press or a screen reader does not find it there.
 */

export type Presence = {
  /** Render the thing at all. */
  mounted: boolean;
  /** It is being kept only to play its exit. */
  leaving: boolean;
};

/** One thing that is shown or not: stays mounted for `exitMs` after `shown` turns false. */
export function usePresence(shown: boolean, exitMs: number): Presence {
  const [kept, setKept] = useState(false);
  const was = useRef(shown);
  // Decided during render, so the frame that hides it is already the leaving one.
  if (was.current !== shown) {
    was.current = shown;
    const keep = !shown && motionMs(exitMs) > 0;
    if (keep !== kept) setKept(keep);
  }
  useEffect(() => {
    if (!kept) return;
    const timer = window.setTimeout(() => setKept(false), motionMs(exitMs));
    return () => window.clearTimeout(timer);
  }, [kept, exitMs]);
  return { mounted: shown || kept, leaving: !shown && kept };
}

export type Kept<Item> = {
  item: Item;
  key: string;
  /** No longer in the list; kept in its old place to play its exit. */
  leaving: boolean;
  /** Joined a list that was already showing, within the last `ENTER_MS` (never true on the first paint). */
  entering: boolean;
};

/** How long a newcomer reads as entering: longer than any entrance, so the class outlives its animation. */
const ENTER_MS = 700;

/**
 * A keyed list whose removed items stay where they were for `exitMs`.
 *
 * `entering` marks an item that joined a list already on screen. It stays true
 * long enough for an entrance to finish and is then dropped by whichever render
 * comes next, so a first paint, a remount of the list and a poll that repeats
 * the same keys all stay still.
 */
export function useKeptList<Item>(items: readonly Item[], keyOf: (item: Item) => string, exitMs: number): Kept<Item>[] {
  const [, redraw] = useState(0);
  const state = useRef<{ order: string[]; live: Map<string, Item>; gone: Map<string, { item: Item; until: number }>; fresh: Map<string, number>; first: boolean }>(
    { order: [], live: new Map(), gone: new Map(), fresh: new Map(), first: true });
  const s = state.current;
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  const wait = motionMs(exitMs);

  const next = new Map(items.map((item) => [keyOf(item), item]));
  for (const key of next.keys()) {
    if (!s.live.has(key) && !s.gone.has(key) && !s.first && wait > 0) s.fresh.set(key, now + ENTER_MS);
    s.gone.delete(key);
  }
  for (const [key, item] of s.live) {
    if (!next.has(key) && wait > 0) s.gone.set(key, { item, until: now + wait });
  }
  for (const [key, entry] of s.gone) if (entry.until <= now) s.gone.delete(key);
  for (const [key, until] of s.fresh) if (until <= now || !next.has(key)) s.fresh.delete(key);
  // The live rows follow the list; a leaver stays after whatever stood before it.
  const order = [...next.keys()];
  for (let index = 0; index < s.order.length; index++) {
    const key = s.order[index];
    if (next.has(key) || !s.gone.has(key)) continue;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = order.indexOf(s.order[before]);
      if (found >= 0) { at = found + 1; break; }
    }
    order.splice(at, 0, key);
  }
  s.order = order;
  s.live = next;
  s.first = false;

  const pending = s.gone.size;
  useEffect(() => {
    if (!pending) return;
    const soonest = Math.min(...[...state.current.gone.values()].map((entry) => entry.until));
    const timer = window.setTimeout(() => redraw((n) => n + 1), Math.max(0, soonest - (typeof performance === "undefined" ? Date.now() : performance.now())) + 1);
    return () => window.clearTimeout(timer);
  });

  return s.order.map((key) => {
    const live = next.get(key);
    if (live !== undefined) return { item: live, key, leaving: false, entering: s.fresh.has(key) };
    return { item: s.gone.get(key)!.item, key, leaving: true, entering: false };
  });
}
