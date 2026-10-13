import { useRef } from "react";
import { MOTION_MS } from "../../shared/ui/dom/motion";

/**
 * How long a row reads as arriving: its bar's growth after the longest step
 * (six rows at the cards' 40ms, one panel duration), and a press to spare, so
 * the mark outlives what it starts.
 */
const ARRIVE_MS = MOTION_MS.screen + MOTION_MS.panel + MOTION_MS.press;

/**
 * Which quota rows have just been read.
 *
 * A row is an arrival when it joins a view that was already on screen (the
 * loading rows it replaces, an empty page): `arrive` is its place among the
 * rows that came with it, for the step between their bars. The first paint of
 * a view, a repaint and a refresh of rows that were there give none. The mark
 * is dropped by whichever render comes after the arrival has played; nothing
 * here asks for one.
 */
export function useArrivals<Item>(items: readonly Item[], keyOf: (item: Item) => string): Array<{ item: Item; arrive: number | undefined }> {
  const state = useRef<{ seen: Set<string> | null; fresh: Map<string, number> }>({ seen: null, fresh: new Map() });
  const { seen, fresh } = state.current;
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  const keys = items.map(keyOf);
  const here = new Set(keys);
  for (const key of keys) if (seen && !seen.has(key)) fresh.set(key, now + ARRIVE_MS);
  for (const [key, until] of fresh) if (until <= now || !here.has(key)) fresh.delete(key);
  state.current.seen = here;
  let place = 0;
  return items.map((item, index) => ({ item, arrive: fresh.has(keys[index]) ? place++ : undefined }));
}
