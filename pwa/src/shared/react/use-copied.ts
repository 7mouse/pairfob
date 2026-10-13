import { useCallback, useEffect, useState } from "react";

/** How long a pressed control reads as copied before it is itself again. */
export const COPIED_MS = 1600;

/**
 * The copied state of one control: `confirm(what)` starts it (again, when it is
 * already showing) and it ends by itself after `ms`.
 */
export function useCopied<What extends string = "done">(ms = COPIED_MS): [copied: What | null, confirm: (what: What) => void] {
  // A new object for every press, so a second press restarts the wait.
  const [shown, setShown] = useState<{ what: What } | null>(null);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), ms);
    return () => window.clearTimeout(timer);
  }, [shown, ms]);
  const confirm = useCallback((what: What) => setShown({ what }), []);
  return [shown?.what ?? null, confirm];
}
