// A ready direct candidate meets a relay read that is still out, through the
// real session, driver and commit. The direct negotiation is a stand-in; the
// candidate is a real encrypted transport that answers its Ping.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { ProbeWire, deferred } from "./probe-wire-fixture";
import { SessionSocket, socketPair } from "./session-socket-fixture";
import { connectionDiagnostics } from "../src/lib/protocol/connection-diagnostics";
import type { LiveSession } from "../src/lib/protocol/session-types";
import * as policy from "../src/lib/protocol/direct-retry-policy";
import * as upgrades from "../src/lib/protocol/session-upgrade";

let prepare: () => Promise<unknown> = () => new Promise(() => undefined);
mock.module("../src/lib/protocol/session-upgrade.ts", () => ({ ...upgrades, prepareDirectSession: () => prepare() }));
// Shorter than the product's wait, still longer than the 2-second drain behind it.
mock.module("../src/lib/protocol/direct-retry-policy.ts", () => ({ ...policy, DIRECT_COMMIT_IDLE_MS: 3_000 }));
const { sessionOverWS } = await import("../src/lib/protocol/session-ws");

const realm = new Window();
Object.defineProperty(realm.document, "visibilityState", { get: () => "visible" });
Object.defineProperty(globalThis, "document", { configurable: true, value: realm.document });
Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, writable: true, value: class {} });

let original: typeof WebSocket;
let live: LiveSession | undefined;
beforeEach(() => {
  original = globalThis.WebSocket;
  SessionSocket.instances = []; SessionSocket.hold = "none"; SessionSocket.script = { answerCommit: true }; SessionSocket.log = [];
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: SessionSocket });
});
afterEach(() => {
  live?.close(); live = undefined;
  for (const socket of SessionSocket.instances) socket.finishClose();
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: original });
});

async function until(ready: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!ready() && Date.now() < end) await Bun.sleep(1);
  expect(ready()).toBe(true);
}
const count = (socket: SessionSocket, op: string) => socket.operations.filter((entry) => entry === op).length;
const failures = () => connectionDiagnostics().filter((record) => record.event === "direct_failed");

/** A relay session with a device list the computer has not answered yet, and a candidate about to be ready. */
async function slowRead() {
  const direct = new ProbeWire("p2p", 5);
  const negotiated = deferred<void>();
  prepare = () => negotiated.promise.then(() => ({
    attemptId: "p2p_0123456789abcdef", iceGathering: "reflexive", channel: direct, epoch: direct.epoch(), close: () => direct.close(),
  }));
  live = await sessionOverWS("wss://pairfob.test/v2/ws", socketPair, { networkMode: "auto", p2p: true });
  const relay = SessionSocket.instances[0]!;
  // Park this socket's next reply, and every reply behind it, until released.
  (relay as unknown as { hold: string }).hold = "ping";
  const read = live.listDevices();
  // The session closes after each test with this read possibly still out.
  read.catch(() => undefined);
  await until(() => relay.blocked === "ping");
  const before = failures().length;
  negotiated.resolve();
  return { live, relay, direct, read, newFailures: () => failures().slice(before) };
}

test("a ready candidate waits out a slow read instead of being given up after the 2-second drain", async () => {
  const f = await slowRead();
  await Bun.sleep(2_500);
  expect(f.direct.closed).toBe(false);
  expect(count(f.relay, "TransportCommit")).toBe(0);
  // Requests keep flowing while it waits; nothing is held back yet.
  void f.live.listDevices().catch(() => undefined);
  await until(() => count(f.relay, "ListDevices") === 2, 200);

  f.relay.releaseLate();
  await expect(f.read).resolves.toMatchObject({ op: "ListDevices" });
  await until(() => count(f.relay, "TransportCommit") === 1);
  await until(() => f.direct.requests.some((request) => request.op === "Ping"));
  // Reads now travel the direct path.
  const read = f.live.snapshot();
  await until(() => f.direct.requests.some((request) => request.op === "Snapshot"));
  f.direct.reply(f.direct.requests.find((request) => request.op === "Snapshot")!, { ok: true });
  await expect(read).resolves.toEqual({ ok: true });
  expect(f.newFailures()).toEqual([]);
}, 10_000);

test("a read that never finishes gives the candidate up after the wait and the drain, and says why", async () => {
  const f = await slowRead();
  const started = Date.now();
  await until(() => f.direct.closed, 7_000);
  expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
  expect(count(f.relay, "TransportCommit")).toBe(0);
  expect(f.newFailures()).toEqual([
    expect.objectContaining({ event: "direct_failed", transport: "p2p", reason: "commit", code: "timeout" }),
  ]);
  expect(f.newFailures()[0]!.elapsed_ms).toBeGreaterThanOrEqual(4_900);
  // The read itself is still the caller's; the relay session carries on.
  expect(f.live.isConnected()).toBe(true);
}, 10_000);
