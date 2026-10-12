import { useEffect, useSyncExternalStore } from "react";

/**
 * What the files tab's filter holds while its list is away.
 *
 * Beside the session the list gives its place to the file that is opened, and
 * comes back when that closes. What was typed, and what the computer answered,
 * are kept here so the reader returns to the results they were going through
 * instead of typing the same letters once per file.
 *
 * The filter belongs to one directory of one pane's workspace: another
 * directory starts empty, as it always has.
 */

type Held = { place: string; query: string };

const listeners = new Set<() => void>();
let held: Held = { place: "", query: "" };
/** Bumped when the workspace was read again: what a search found may no longer be what is there. */
let searchEpoch = 0;

function publish(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The filter of `place` (a pane, its root and the directory listed) and its setter. */
export function useFileFilter(place: string): [string, (query: string) => void] {
  const query = useSyncExternalStore(subscribe, () => (held.place === place ? held.query : ""), () => "");
  useEffect(() => {
    // Another directory: what was typed for the last one is not carried back to it.
    if (held.place !== place && held.query) {
      held = { place, query: "" };
      publish();
    }
  }, [place]);
  return [query, (next) => {
    if (held.place === place && held.query === next) return;
    held = { place, query: next };
    publish();
  }];
}

/** The workspace was refreshed, or a file renamed or deleted: searches on screen ask again. */
export function renewFileSearch(): void {
  searchEpoch++;
  publish();
}

export function useFileSearchEpoch(): number {
  return useSyncExternalStore(subscribe, () => searchEpoch, () => searchEpoch);
}

/** Tests: nothing typed, nothing remembered. */
export function resetFileFilter(): void {
  held = { place: "", query: "" };
  searchEpoch = 0;
  publish();
}
