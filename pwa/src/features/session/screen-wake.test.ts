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

test("default off, active only after a grant; leaving and re-entering never remembers the choice", async () => {
  const lock = sentinel();
  let calls = 0;
  const wake = createScreenWake(async () => { calls++; return lock; });
  wake.setScope("computer/runtime/pane");
  expect(wake.get().enabled).toBeFalse();
  expect(calls).toBe(0);
  wake.setEnabled(true);
  expect(wake.get().status).toBe("requesting");
  await tick();
  expect(wake.get().status).toBe("active");
  wake.setScope(null);
  expect(lock.releases()).toBe(1);
  wake.setScope("computer/runtime/pane");
  expect(wake.get()).toEqual({ enabled: false, eligible: true, status: "off" });
  expect(calls).toBe(1);
});

test("background releases and visibility reacquires once; repeated visible events do nothing", async () => {
  const locks = [sentinel(), sentinel()];
  let calls = 0;
  const wake = createScreenWake(async () => locks[calls++]);
  wake.setScope("one");
  wake.setEnabled(true);
  await tick();
  wake.setVisible(false);
  expect(locks[0].releases()).toBe(1);
  expect(wake.get()).toMatchObject({ enabled: true, status: "paused" });
  wake.setVisible(true);
  wake.setVisible(true);
  await tick();
  expect(calls).toBe(2);
  expect(wake.get().status).toBe("active");
  wake.dispose();
  expect(locks[1].releases()).toBe(1);
});

test("rejection and OS release require deliberate retry, without a retry loop", async () => {
  const lock = sentinel();
  let calls = 0;
  const wake = createScreenWake(async () => { if (++calls === 1) throw new Error("denied"); return lock; });
  wake.setScope("one");
  wake.setEnabled(true);
  await tick();
  expect(wake.get().status).toBe("unavailable");
  expect(calls).toBe(1);
  wake.retry();
  wake.retry();
  await tick();
  expect(calls).toBe(2);
  lock.revoke();
  await tick();
  expect(wake.get().status).toBe("unavailable");
  expect(calls).toBe(2);
});

for (const boundary of ["off", "hidden", "scope", "dispose"] as const) {
  test(`a late grant after ${boundary} is released without publishing active`, async () => {
    const flight = pending();
    const wake = createScreenWake(() => flight.promise);
    wake.setScope("one");
    wake.setEnabled(true);
    if (boundary === "off") wake.setEnabled(false);
    if (boundary === "hidden") wake.setVisible(false);
    if (boundary === "scope") wake.setScope("two");
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
  wake.setScope("one");
  wake.setEnabled(true);
  wake.setEnabled(false);
  wake.setEnabled(true);
  await tick();
  first.reject(new Error("old"));
  await tick();
  expect(wake.get().status).toBe("active");
  expect(second.releases()).toBe(0);
  wake.dispose();
});

test("unsupported, no scope and an already released grant never claim active", async () => {
  const unsupported = createScreenWake(null);
  unsupported.setScope("one");
  unsupported.setEnabled(true);
  expect(unsupported.get()).toMatchObject({ enabled: false, status: "unsupported" });
  const lock = sentinel();
  lock.revoke();
  const wake = createScreenWake(async () => lock);
  wake.setEnabled(true);
  expect(wake.get().enabled).toBeFalse();
  wake.setScope("one");
  wake.setEnabled(true);
  await tick();
  expect(wake.get().status).toBe("unavailable");
});
