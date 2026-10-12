/** A temporary screen lock. No timers, storage, RPCs, or background work. */
export type WakeStatus = "off" | "requesting" | "active" | "paused" | "unavailable" | "unsupported";
export type WakeSnapshot = { enabled: boolean; eligible: boolean; status: WakeStatus };
export type ScreenLock = {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
};

export function createScreenWake(request: (() => Promise<ScreenLock>) | null) {
  let scope: string | null = null;
  let visible = true;
  let epoch = 0;
  let lock: ScreenLock | null = null;
  let detach: (() => void) | null = null;
  let snapshot: WakeSnapshot = { enabled: false, eligible: false, status: request ? "off" : "unsupported" };
  const listeners = new Set<() => void>();
  const publish = (enabled: boolean, status: WakeStatus) => {
    if (snapshot.enabled === enabled && snapshot.status === status && snapshot.eligible === !!scope) return;
    snapshot = { enabled, status, eligible: !!scope };
    for (const listener of listeners) listener();
  };
  const release = (held: ScreenLock) => { void held.release().catch(() => {}); };
  const retire = () => {
    epoch++;
    detach?.();
    detach = null;
    if (lock) release(lock);
    lock = null;
  };
  const acquire = async () => {
    if (!request || !scope || !snapshot.enabled || !visible) return;
    const ticket = ++epoch;
    publish(true, "requesting");
    try {
      const granted = await request();
      if (ticket !== epoch) { release(granted); return; }
      if (granted.released) { publish(true, "unavailable"); return; }
      lock = granted;
      const released = () => {
        if (lock !== granted) return;
        detach?.();
        detach = null;
        lock = null;
        // An OS revocation is not permission to spin in a retry loop.
        publish(true, visible ? "unavailable" : "paused");
      };
      granted.addEventListener("release", released);
      detach = () => granted.removeEventListener("release", released);
      publish(true, "active");
    } catch {
      if (ticket === epoch) publish(true, "unavailable");
    }
  };
  return {
    get: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScope(next: string | null) {
      if (scope === next) return;
      retire();
      scope = next;
      publish(false, request ? "off" : "unsupported");
    },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (!snapshot.enabled) return;
      if (!visible) { retire(); publish(true, "paused"); }
      else void acquire();
    },
    setEnabled(enabled: boolean) {
      if (enabled === snapshot.enabled || (enabled && (!scope || !request))) return;
      retire();
      publish(enabled, request ? (enabled ? "paused" : "off") : "unsupported");
      if (enabled) void acquire();
    },
    retry() { if (snapshot.status === "unavailable") void acquire(); },
    dispose() { retire(); scope = null; publish(false, request ? "off" : "unsupported"); },
  };
}
