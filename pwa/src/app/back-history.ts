/**
 * One disposable browser entry while the UI has a way back, not a route log.
 * Only an opaque page token is serialized. The UI remains the authority and
 * Forward cannot resurrect a file, a dismissed dialog, or another computer.
 * Same-entry events (including iframe history) belong to the browser.
 */
export type BackHistoryPort = {
  state(): unknown;
  replace(state: unknown): void;
  push(state: unknown): void;
  back(): void;
  listen(pop: () => void): () => void;
};
const KEY = "pairfobBack";
type Mark = { token: string; guard: boolean };
function mark(state: unknown): Mark | undefined {
  if (!state || typeof state !== "object") return;
  const value = (state as Record<string, unknown>)[KEY];
  if (!value || typeof value !== "object") return;
  const item = value as Mark;
  return typeof item.token === "string" && typeof item.guard === "boolean" ? item : undefined;
}
function stamped(state: unknown, value: Mark): unknown {
  return { ...(state && typeof state === "object" ? state : {}), [KEY]: value };
}

export function bindBackHistory(port: BackHistoryPort, action: () => (() => void | Promise<void>) | null, token: string) {
  let alive = true;
  let traversing = false;
  let handling = false;
  let guarded = mark(port.state())?.guard === true;
  // Adopt a refreshed document's existing guard rather than stack another one.
  const previous = mark(port.state());
  const pageToken = previous?.token ?? token;
  const write = (guard: boolean) => stamped(port.state(), { token: pageToken, guard });
  if (!previous) port.replace(write(false));
  const sync = () => {
    if (!alive || handling || traversing) return;
    if (action()) {
      if (!guarded) { port.push(write(true)); guarded = true; }
    } else if (guarded) {
      traversing = true;
      port.back();
    }
  };
  const pop = () => {
    if (!alive) return;
    const target = mark(port.state());
    if (target?.token !== pageToken) return; // Never redirect unrelated navigation.
    if (traversing) {
      // An iframe may have added history under the guard; retire those entries
      // when the application has already returned to its root with a UI button.
      if (target.guard) { port.back(); return; }
      traversing = false;
      guarded = false;
      if (handling && action()) { port.push(write(true)); guarded = true; }
      else sync();
      return;
    }
    if (target.guard) {
      if (guarded) return; // iframe's own traversal, not application Back
      // A stale Forward entry has no route to restore. Return to the root once.
      traversing = true;
      port.back();
      return;
    }
    if (!guarded) return;
    guarded = false;
    if (handling) {
      // A second Back during a pending navigation stays in the application.
      port.push(write(true));
      guarded = true;
      return;
    }
    const back = action();
    handling = true;
    try {
      const done = back?.();
      if (action()) { port.push(write(true)); guarded = true; }
      Promise.resolve(done).finally(() => { handling = false; sync(); }).catch(() => {});
    } catch {
      handling = false;
      sync();
    }
  };
  const stop = port.listen(pop);
  sync();
  return {
    sync,
    /** A consumed notification hash added an entry; fold it into our boundary. */
    consumeHashEntry() {
      if (!alive) return;
      port.replace(write(true));
      guarded = true;
      if (!traversing) { traversing = true; port.back(); }
    },
    dispose() { alive = false; stop(); },
  };
}
