import { expect, test } from "bun:test";
import { createScreenWake, type ScreenLock } from "./screen-wake";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function sentinel() {
  let released = false;
  let releases = 0;
  const listeners = new Set<() => void>();
  const result: ScreenLock & { revoke(): void; releases(): number } = {
    get released() { return released; },
    async release() { releases++; result.revoke(); },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    revoke() { released = true; for (const listener of listeners) listener(); },
    releases: () => releases,
  };
  return result;
}
function pending() {
  let resolve!: (lock: ScreenLock) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ScreenLock>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("held only while wanted: asked for once, released when nothing is watched any more", async () => {
  const locks = [sentinel(), sentinel()];
  let calls = 0;
  const wake = createScreenWake(async () => locks[calls++]);
  expect(wake.get()).toEqual({ status: "off", denied: false });
  expect(calls).toBe(0);
  wake.setWanted(true);
  wake.setWanted(true);
  expect(wake.get().status).toBe("requesting");
  await tick();
  expect(wake.get().status).toBe("active");
  expect(calls).toBe(1);
  wake.setWanted(false);
  expect(locks[0].releases()).toBe(1);
  expect(wake.get().status).toBe("off");
  wake.setWanted(true);
  await tick();
  expect(calls).toBe(2);
  expect(wake.get().status).toBe("active");
  wake.dispose();
  expect(locks[1].releases()).toBe(1);
});

test("background releases and visibility reacquires once; repeated visible events do nothing", async () => {
  const locks = [sentinel(), sentinel()];
  let calls = 0;
  const wake = createScreenWake(async () => locks[calls++]);
  wake.setWanted(true);
  await tick();
  wake.setVisible(false);
  expect(locks[0].releases()).toBe(1);
  expect(wake.get().status).toBe("paused");
  wake.setVisible(true);
  wake.setVisible(true);
  await tick();
  expect(calls).toBe(2);
  expect(wake.get().status).toBe("active");
  wake.dispose();
  expect(locks[1].releases()).toBe(1);
});

test("wanted in the background waits for the page instead of asking", async () => {
  let calls = 0;
  const wake = createScreenWake(async () => { calls++; return sentinel(); });
  wake.setVisible(false);
  wake.setWanted(true);
  await tick();
  expect(calls).toBe(0);
  expect(wake.get().status).toBe("paused");
  wake.setVisible(true);
  await tick();
  expect(calls).toBe(1);
  expect(wake.get().status).toBe("active");
});

test("a refusal is remembered until a grant; an OS release is not a refusal and starts no retry loop", async () => {
  const lock = sentinel();
  let calls = 0;
  const wake = createScreenWake(async () => { if (++calls === 1) throw new Error("denied"); return lock; });
  wake.setWanted(true);
  await tick();
  expect(wake.get()).toEqual({ status: "unavailable", denied: true });
  expect(calls).toBe(1);
  wake.setWanted(false);
  expect(wake.get()).toEqual({ status: "off", denied: true });
  wake.setWanted(true);
  wake.retry();
  await tick();
  expect(calls).toBe(2);
  expect(wake.get()).toEqual({ status: "active", denied: false });
  lock.revoke();
  await tick();
  expect(wake.get()).toEqual({ status: "unavailable", denied: false });
  expect(calls).toBe(2);
  wake.retry();
  wake.retry();
  await tick();
  expect(calls).toBe(3);
});

test("retry with nothing to watch asks once and lets go, so Settings can say whether the system allows it", async () => {
  const lock = sentinel();
  let calls = 0;
  const wake = createScreenWake(async () => { if (++calls === 1) throw new Error("denied"); return lock; });
  wake.retry();
  wake.retry();
  await tick();
  expect(calls).toBe(1);
  expect(wake.get()).toEqual({ status: "off", denied: true });
  wake.retry();
  await tick();
  expect(calls).toBe(2);
  expect(lock.releases()).toBe(1);
  expect(wake.get()).toEqual({ status: "off", denied: false });
});

for (const boundary of ["off", "hidden", "dispose"] as const) {
  test(`a late grant after ${boundary} is released without publishing active`, async () => {
    const flight = pending();
    const wake = createScreenWake(() => flight.promise);
    wake.setWanted(true);
    if (boundary === "off") wake.setWanted(false);
    if (boundary === "hidden") wake.setVisible(false);
    if (boundary === "dispose") wake.dispose();
    const lock = sentinel();
    flight.resolve(lock);
    await tick();
    expect(lock.releases()).toBe(1);
    expect(wake.get().status).not.toBe("active");
  });
}

test("an old rejected request cannot overwrite a newer active one", async () => {
  const first = pending();
  const second = sentinel();
  let calls = 0;
  const wake = createScreenWake(() => ++calls === 1 ? first.promise : Promise.resolve(second));
  wake.setWanted(true);
  wake.setWanted(false);
  wake.setWanted(true);
  await tick();
  first.reject(new Error("old"));
  await tick();
  expect(wake.get()).toEqual({ status: "active", denied: false });
  expect(second.releases()).toBe(0);
  wake.dispose();
});

test("unsupported and an already released grant never claim active", async () => {
  const unsupported = createScreenWake(null);
  unsupported.setWanted(true);
  unsupported.retry();
  expect(unsupported.get()).toEqual({ status: "unsupported", denied: false });
  const lock = sentinel();
  lock.revoke();
  const wake = createScreenWake(async () => lock);
  wake.setWanted(true);
  await tick();
  expect(wake.get()).toEqual({ status: "unavailable", denied: true });
});
