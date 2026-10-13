// Real handshake, AEAD and session state machine against the in-memory relay +
// daemon peer: which reads ride the dial, and who may be answered from them.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SessionSocket, socketPair } from "./session-socket-fixture";
import { sessionOverWS } from "../src/lib/protocol/session-ws";
import type { LiveSession } from "../src/lib/protocol/session-types";

let original: typeof WebSocket;
let live: LiveSession | undefined;
beforeEach(() => {
  original = globalThis.WebSocket;
  SessionSocket.instances = []; SessionSocket.hold = "none"; SessionSocket.script = {}; SessionSocket.log = [];
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: SessionSocket });
});
afterEach(() => {
  live?.close(); live = undefined;
  for (const socket of SessionSocket.instances) socket.finishClose();
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: original });
});
async function until(ready: () => boolean) {
  const end = Date.now() + 2000;
  while (!ready() && Date.now() < end) await Bun.sleep(1);
  expect(ready()).toBe(true);
}
async function connected() {
  live = await sessionOverWS("wss://pairfob.test/v2/ws", socketPair, { networkMode: "relay" });
  return { live, socket: SessionSocket.instances[0]! };
}
const count = (socket: SessionSocket, op: string) => socket.operations.filter((seen) => seen === op).length;
/** Drop the current socket and wait for the session to come back on the next one. */
async function redial(session: LiveSession): Promise<SessionSocket> {
  const next = SessionSocket.instances.length;
  SessionSocket.instances[next - 1]!.finishClose();
  await until(() => SessionSocket.instances.length === next + 1 && session.isConnected());
  return SessionSocket.instances[next]!;
}

test("the first config, snapshot and pane read are answered by the dial, each exactly once", async () => {
  const f = await connected();
  expect(f.socket.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
  expect(await f.live.getConfig()).toMatchObject({ op: "GetConfig" });
  expect(await f.live.snapshot()).toMatchObject({ op: "Snapshot" });
  expect(f.socket.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
  // A second read is a fresh question.
  await f.live.snapshot();
  await f.live.getConfig();
  expect(count(f.socket, "Snapshot")).toBe(2);
  expect(count(f.socket, "GetConfig")).toBe(2);

  await f.live.paneRead("w1:p1", 80);
  const next = await redial(f.live);
  expect(next.operations).toEqual(["Ping", "GetConfig", "Snapshot", "PaneRead"]);
  expect(next.requests[3]!.params).toEqual({ pane_id: "w1:p1", source: "visible", format: "ansi", lines: 80 });
  // The app still asks in its own order; nothing more goes on the wire.
  await f.live.getConfig();
  await f.live.snapshot();
  expect(await f.live.paneRead("w1:p1", 80)).toMatchObject({ op: "PaneRead" });
  expect(next.operations).toEqual(["Ping", "GetConfig", "Snapshot", "PaneRead"]);
});

test("a different pane, size or format is always read fresh", async () => {
  const f = await connected();
  await f.live.getConfig(); await f.live.snapshot();
  await f.live.paneRead("w1:p1", 80);
  const next = await redial(f.live);
  await f.live.paneRead("w1:p2", 80);
  await f.live.paneRead("w1:p1", 40);
  await f.live.paneRead("w1:p1", 80, "text");
  expect(count(next, "PaneRead")).toBe(4);
});

test("a read after a mutation is never answered from before it", async () => {
  const f = await connected();
  await f.live.sendText("w1:p1", "ls").catch(() => undefined);
  await f.live.snapshot();
  await f.live.getConfig();
  expect(count(f.socket, "SendText")).toBe(1);
  expect(count(f.socket, "Snapshot")).toBe(2);
  expect(count(f.socket, "GetConfig")).toBe(2);
});

test("switching the Herdr session reads the new one fresh and asks ahead for it afterwards", async () => {
  const f = await connected();
  f.live.selectHerdSession("work");
  await f.live.getConfig();
  await f.live.snapshot();
  expect(count(f.socket, "GetConfig")).toBe(2);
  expect(f.socket.requests.at(-1)!.params).toEqual({ session: "work" });
  const next = await redial(f.live);
  expect(next.requests.slice(1).map((request) => request.params)).toEqual([{ session: "work" }, { session: "work" }]);
});

test("a session nobody reads from soon dials with the readiness Ping alone", async () => {
  const f = await connected();
  // One connection that went unread is not yet a reason to stop asking.
  expect((await redial(f.live)).operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
  expect((await redial(f.live)).operations).toEqual(["Ping"]);
  await f.live.snapshot();
  expect((await redial(f.live)).operations).toEqual(["Ping", "Snapshot"]);
});

test("a first read that failed is asked again instead of handing its failure on", async () => {
  SessionSocket.script = { failOps: ["Snapshot"] };
  const f = await connected();
  SessionSocket.script = {};
  await Bun.sleep(5);
  await expect(f.live.snapshot()).rejects.toMatchObject({ code: "herdr_offline" });
  expect(count(f.socket, "Snapshot")).toBe(2);
});

test("a foreground probe carries the same reads on the live path, beside its Ping", async () => {
  const f = await connected();
  await f.live.getConfig(); await f.live.snapshot(); await f.live.paneRead("w1:p1", 80);
  const before = f.socket.operations.length;
  let ready = false;
  f.live.onEvent((event) => { if (event.type === "connected") ready = true; });
  f.live.reconnectNow("probe");
  f.live.reconnectNow("path");
  expect(f.live.isChecking?.()).toBe(true);
  await until(() => ready);
  expect(f.socket.operations.slice(before)).toEqual(["Ping", "GetConfig", "Snapshot", "PaneRead"]);
  await f.live.getConfig(); await f.live.snapshot(); await f.live.paneRead("w1:p1", 80);
  expect(f.socket.operations.slice(before)).toEqual(["Ping", "GetConfig", "Snapshot", "PaneRead"]);
  expect(SessionSocket.instances).toHaveLength(1);
});

test("reads sent with a probe that fails are asked again by the dial that follows", async () => {
  const f = await connected();
  await f.live.getConfig(); await f.live.snapshot();
  f.socket.silent = true;
  f.live.reconnectNow("probe");
  f.socket.finishClose();
  await until(() => SessionSocket.instances.length === 2 && f.live.isConnected());
  expect(SessionSocket.instances[1]!.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
  expect(await f.live.snapshot()).toMatchObject({ op: "Snapshot" });
  expect(count(SessionSocket.instances[1]!, "Snapshot")).toBe(1);
});

test("a hint that something changed makes the next read fresh", async () => {
  const f = await connected();
  f.socket.poke();
  await f.live.snapshot();
  expect(count(f.socket, "Snapshot")).toBe(2);
});

test("a read keeps the answer it claimed even when a mutation is issued right behind it", async () => {
  const f = await connected();
  const config = f.live.getConfig();
  const snapshot = f.live.snapshot();
  void f.live.sendText("w1:p1", "ls").catch(() => undefined);
  await config; await snapshot;
  expect(count(f.socket, "GetConfig")).toBe(1);
  expect(count(f.socket, "Snapshot")).toBe(1);
});

test("a hint that arrives while the dial is still proving itself keeps its answers from being held", async () => {
  SessionSocket.hold = "ping";
  const pending = connected();
  const end = Date.now() + 1000;
  while (SessionSocket.instances[0]?.blocked !== "ping" && Date.now() < end) await Bun.sleep(1);
  SessionSocket.hold = "none";
  const socket = SessionSocket.instances[0]!;
  // Established and already pushing: the hint lands with the answers, before
  // the session has reported itself connected.
  socket.poke();
  socket.releaseLate();
  const f = await pending;
  await f.live.snapshot();
  await f.live.getConfig();
  expect(count(socket, "Snapshot")).toBe(2);
  expect(count(socket, "GetConfig")).toBe(2);
});
