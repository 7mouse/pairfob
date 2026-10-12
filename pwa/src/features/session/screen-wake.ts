/** The screen lock, held while it is wanted and the page is in front. No timers, storage, RPCs, or background work. */
export type WakeStatus = "off" | "requesting" | "active" | "paused" | "unavailable" | "unsupported";
/** `denied`: the system refused the last request, and none has been granted since. */
export type WakeSnapshot = { status: WakeStatus; denied: boolean };
export type ScreenLock = {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
};

export function createScreenWake(request: (() => Promise<ScreenLock>) | null) {
  let wanted = false;
  let visible = true;
  let epoch = 0;
  let lock: ScreenLock | null = null;
  let detach: (() => void) | null = null;
  let snapshot: WakeSnapshot = { status: request ? "off" : "unsupported", denied: false };
  const listeners = new Set<() => void>();
  const publish = (status: WakeStatus, denied = snapshot.denied) => {
    if (snapshot.status === status && snapshot.denied === denied) return;
    snapshot = { status, denied };
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
    if (!request || !wanted || !visible) return;
    const ticket = ++epoch;
    publish("requesting");
    try {
      const granted = await request();
      if (ticket !== epoch) { release(granted); return; }
      if (granted.released) { publish("unavailable", true); return; }
      lock = granted;
      const released = () => {
        if (lock !== granted) return;
        detach?.();
        detach = null;
        lock = null;
        // An OS revocation is not permission to spin in a retry loop: the next
        // request waits for the page to return or for something new to watch.
        publish(visible ? "unavailable" : "paused");
      };
      granted.addEventListener("release", released);
      detach = () => granted.removeEventListener("release", released);
      publish("active", false);
    } catch {
      if (ticket === epoch) publish("unavailable", true);
    }
  };
  let probing = false;
  /** Ask once and let go: whether the system allows a lock, with nothing on screen to hold it for. */
  const probe = async () => {
    if (!request || !visible || probing) return;
    probing = true;
    try {
      const granted = await request();
      const refused = granted.released;
      release(granted);
      publish(snapshot.status, refused);
    } catch {
      publish(snapshot.status, true);
    } finally {
      probing = false;
    }
  };
  return {
    get: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setWanted(next: boolean) {
      if (!request || wanted === next) return;
      wanted = next;
      retire();
      if (!next) publish("off");
      else if (!visible) publish("paused");
      else void acquire();
    },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (!wanted) return;
      if (!visible) { retire(); publish("paused"); }
      else void acquire();
    },
    /** The reader's own retry after a refusal. */
    retry() {
      if (wanted) { if (snapshot.status === "unavailable") void acquire(); }
      else void probe();
    },
    dispose() { wanted = false; retire(); publish(request ? "off" : "unsupported", false); },
  };
}
