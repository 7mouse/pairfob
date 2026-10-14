import { describe, expect, test } from "bun:test";
import { DirectSessionDriver, type DirectSessionHost } from "./session-direct.ts";

describe("direct attempt lifecycle", () => {
  test("dispose aborts an in-flight attempt but leaves it authoritative until it settles", () => {
    const host = {} as DirectSessionHost;
    const driver = new DirectSessionDriver(host);
    const pending = new Promise<void>(() => undefined);
    const internals = driver as unknown as { directAttempt: Promise<void> | null };
    internals.directAttempt = pending;

    driver.dispose();

    expect(internals.directAttempt).toBe(pending);
  });
});

describe("a relay lost while a direct candidate holds the switch", () => {
  function fixture(room = true) {
    const standbys: Array<() => void> = [];
    let prepared = 0;
    const host = {
      stopped: false,
      networkAvailable: true,
      standbyRelay: (ready: () => void) => { if (room) standbys.push(ready); return room; },
      prepareRelay: () => { prepared++; },
    } as unknown as DirectSessionHost;
    const driver = new DirectSessionDriver(host);
    const commit = { abandon: new AbortController(), standby: false };
    const internals = driver as unknown as { commitAttempt: typeof commit | null };
    return { driver, host, commit, internals, standbys, prepared: () => prepared };
  }

  test("outside a commit there is nothing to stand by for", () => {
    const f = fixture();
    f.driver.relayLostInSwitch();
    expect(f.standbys).toHaveLength(0);
    expect(f.prepared()).toBe(0);
  });

  test("one standby is started, and its readiness gives the candidate up", () => {
    const f = fixture();
    f.internals.commitAttempt = f.commit;
    f.driver.relayLostInSwitch();
    f.driver.relayLostInSwitch();
    expect(f.standbys).toHaveLength(1);
    expect(f.commit.abandon.signal.aborted).toBe(false);
    f.standbys[0]!();
    expect(f.commit.abandon.signal.aborted).toBe(true);
  });

  test("without handshake budget a plain socket is prepared and the candidate keeps its deadline", () => {
    const f = fixture(false);
    f.internals.commitAttempt = f.commit;
    f.driver.relayLostInSwitch();
    expect(f.prepared()).toBe(1);
    expect(f.commit.abandon.signal.aborted).toBe(false);
  });

  test("a hidden page, a lost network or a stopped session prepares nothing", () => {
    for (const block of ["hidden", "offline", "stopped"] as const) {
      const f = fixture();
      f.internals.commitAttempt = f.commit;
      if (block === "hidden") f.driver.setPageHidden(true);
      if (block === "offline") (f.host as { networkAvailable: boolean }).networkAvailable = false;
      if (block === "stopped") (f.host as { stopped: boolean }).stopped = true;
      f.driver.relayLostInSwitch();
      expect(f.standbys).toHaveLength(0);
      expect(f.prepared()).toBe(0);
    }
  });
});
