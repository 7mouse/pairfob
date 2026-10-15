// A ready direct candidate meets a relay read the computer is still working on,
// through the real session, driver and commit. The direct negotiation is a
// stand-in; the candidate is a real encrypted transport that answers its Ping.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { ProbeWire, deferred } from "./probe-wire-fixture";
import { SessionSocket, socketPair, type SocketScript } from "./session-socket-fixture";
import { connectionDiagnostics } from "../src/lib/protocol/connection-diagnostics";
import type { LiveSession } from "../src/lib/protocol/session-types";
import * as upgrades from "../src/lib/protocol/session-upgrade";

let prepare: () => Promise<unknown> = () => new Promise(() => undefined);
mock.module("../src/lib/protocol/session-upgrade.ts", () => ({ ...upgrades, prepareDirectSession: () => prepare() }));
const { sessionOverWS } = await import("../src/lib/protocol/session-ws");

const realm = new Window();
Object.defineProperty(realm.document, "visibilityState", { get: () => "visible" });
Object.defineProperty(globalThis, "document", { configurable: true, value: realm.document });
Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, writable: true, value: class {} });

let original: typeof WebSocket;
let live: LiveSession | undefined;
beforeEach(() => {
  original = globalThis.WebSocket;
  SessionSocket.instances = []; SessionSocket.hold = "none"; SessionSocket.log = [];
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
async function slowRead(script: SocketScript, holdPing = false) {
  SessionSocket.script = { ...script, slowOps: ["ListDevices", "SendText"] };
  const direct = new ProbeWire("p2p", 5);
  direct.hold = holdPing;
  const negotiated = deferred<void>();
  prepare = () => negotiated.promise.then(() => ({
    attemptId: "p2p_0123456789abcdef", iceGathering: "reflexive", channel: direct, epoch: direct.epoch(), close: () => direct.close(),
  }));
  live = await sessionOverWS("wss://pairfob.test/v2/ws", socketPair, { networkMode: "auto", p2p: true });
  const relay = SessionSocket.instances[0]!;
  const read = live.listDevices();
  // The session closes after each test with this read possibly still out.
  read.catch(() => undefined);
  await until(() => count(relay, "ListDevices") === 1);
  const before = failures().length;
  negotiated.resolve();
  const id = relay.requests.find((request) => request.op === "ListDevices")!.id;
  return { live, relay, direct, read, id, newFailures: () => failures().slice(before) };
}

test("a read still out does not hold the switch: the computer answers it on the direct route", async () => {
  const f = await slowRead({ answerCommit: true });
  const started = Date.now();
  await until(() => f.direct.requests.some((request) => request.op === "Ping"));
  await until(() => f.relay.closeCalls > 0);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(count(f.relay, "TransportCommit")).toBe(1);

  f.direct.reply({ id: f.id }, { op: "ListDevices" });
  await expect(f.read).resolves.toMatchObject({ op: "ListDevices" });
  // Carried, never sent again.
  expect(f.direct.requests.some((request) => request.op === "ListDevices")).toBe(false);
  expect(count(f.relay, "ListDevices")).toBe(1);
  // Reads now travel the direct path.
  const read = f.live.snapshot();
  await until(() => f.direct.requests.some((request) => request.op === "Snapshot"));
  f.direct.reply(f.direct.requests.find((request) => request.op === "Snapshot")!, { ok: true });
  await expect(read).resolves.toEqual({ ok: true });
  expect(f.newFailures()).toEqual([]);
}, 10_000);

test("a commit the computer refuses leaves the read on the relay, and says why", async () => {
  const f = await slowRead({ answerCommit: false });
  await until(() => f.direct.closed);
  expect(count(f.relay, "TransportCommit")).toBe(1);
  expect(f.newFailures()).toEqual([
    expect.objectContaining({ event: "direct_failed", transport: "p2p", reason: "commit" }),
  ]);
  f.relay.answer(f.id, { op: "ListDevices" });
  await expect(f.read).resolves.toMatchObject({ op: "ListDevices" });
  expect(f.live.isConnected()).toBe(true);
  expect(f.relay.closeCalls).toBe(0);
}, 10_000);

test("a carried mutation whose direct route then fails its proof hears its outcome is unknown, not refused", async () => {
  const f = await slowRead({ answerCommit: true }, true);
  const typed = f.live.sendText("w1:p1", "ls").catch((caught) => caught as { code: string });
  await until(() => count(f.relay, "SendText") === 1);
  await until(() => f.direct.held.length === 1);
  f.direct.failPing();
  expect((await typed).code).toBe("unknown_outcome");
  expect(f.direct.requests.some((request) => request.op === "SendText")).toBe(false);
}, 10_000);
