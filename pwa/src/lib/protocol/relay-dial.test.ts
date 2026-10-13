import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { SessionSocket, socketPair, type HoldStage } from "../../../test-support/session-socket-fixture";
import { parseJSON, Typ } from "./envelope";
import { HelloBudget } from "./reconnect-policy";
import type { DialStyle } from "./relay-dial";
import { connectSession } from "./session-connect";

const URL_WS = "wss://pairfob.test/v2/ws";
const READS = [{ op: "GetConfig", params: {} }, { op: "Snapshot", params: { session: null } }];
let original: typeof WebSocket;
const open: Array<{ close(): void }> = [];

beforeEach(() => {
  original = globalThis.WebSocket;
  SessionSocket.instances = []; SessionSocket.hold = "none"; SessionSocket.script = {}; SessionSocket.log = [];
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: SessionSocket });
});
afterEach(() => {
  for (const transport of open.splice(0)) transport.close();
  for (const socket of SessionSocket.instances) socket.finishClose();
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: original });
});

async function blockedAt(stage: HoldStage): Promise<SessionSocket> {
  const end = Date.now() + 1000;
  while (SessionSocket.instances.at(-1)?.blocked !== stage && Date.now() < end) await Bun.sleep(1);
  const socket = SessionSocket.instances.at(-1)!;
  expect(socket.blocked).toBe(stage);
  return socket;
}
const dial = (style?: DialStyle, budget?: HelloBudget) =>
  connectSession(URL_WS, socketPair, () => undefined, undefined, undefined, undefined, { reads: READS, style, budget })
    .then((connection) => { open.push(connection.transport); return connection; });

test("the first flight carries HELLO, ATTACH and DeviceHello1 before the relay has answered", async () => {
  SessionSocket.hold = "bound";
  const pending = dial();
  const socket = await blockedAt("bound");
  expect(socket.frames.map((frame) => frame.typ)).toEqual([Typ.HELLO_CLIENT, Typ.SESSION_ATTACH, Typ.FWD]);
  const hello = socket.frames[2]!;
  expect(parseJSON(hello).op).toBe("DeviceHello1");
  // The relay stamps the bound route; the phone does not know it yet.
  expect([...hello.routeId]).toEqual(new Array(16).fill(0));
  socket.releaseLate();
  expect((await pending).transport.kind).toBe("relay");
});

test("the second flight carries DeviceHello3 and the first reads before SESSION_ESTABLISHED", async () => {
  SessionSocket.hold = "established";
  const pending = dial();
  const socket = await blockedAt("established");
  expect(socket.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
  socket.releaseLate();
  const { reads } = await pending;
  expect(reads.map((read) => read.op)).toEqual(["GetConfig", "Snapshot"]);
  expect(await reads[0]!.answer).toMatchObject({ op: "GetConfig" });
  expect(await reads[1]!.answer).toMatchObject({ op: "Snapshot" });
  // One round trip each way after the socket opened: nothing was asked twice.
  expect(socket.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
});

test("a dial is not ready until an encrypted answer arrives, even with SESSION_ESTABLISHED in hand", async () => {
  SessionSocket.hold = "ping";
  let ready = false;
  const pending = dial().then((connection) => { ready = true; return connection; });
  const socket = await blockedAt("ping");
  await Bun.sleep(10);
  expect(ready).toBe(false);
  socket.releaseLate();
  await pending;
  expect(ready).toBe(true);
});

test("a relay that refuses DeviceHello1 ahead of the bind costs one dial, not every later one", async () => {
  const style = { helloAhead: true, readsAhead: true };
  SessionSocket.script = { bindLate: "refuse" };
  expect(await dial(style).catch((error) => error.code)).toBe("unbound");
  expect(style).toEqual({ helloAhead: false, readsAhead: true });
  await dial(style);
  const socket = SessionSocket.instances[1]!;
  const hello = socket.frames.find((frame) => frame.typ === Typ.FWD)!;
  expect(parseJSON(hello).op).toBe("DeviceHello1");
  expect([...hello.routeId]).toEqual(new Array(16).fill(2));
  expect(socket.operations).toEqual(["Ping", "GetConfig", "Snapshot"]);
});

test("a computer that ignores reads sent ahead costs one dial, not every later one", async () => {
  const style = { helloAhead: true, readsAhead: true };
  SessionSocket.script = { dropAhead: true };
  const realTimeout = globalThis.setTimeout;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realTimeout(fn, ms === 8_000 ? 20 : ms)) as typeof setTimeout);
  try {
    expect(await dial(style).catch((error) => error.code)).toBe("timeout");
    expect(style).toEqual({ helloAhead: true, readsAhead: false });
    const { reads } = await dial(style);
    expect(reads).toEqual([]);
    // The readiness Ping left only after SESSION_ESTABLISHED had come back.
    expect(SessionSocket.instances[1]!.operations).toEqual(["Ping"]);
  } finally { timers.mockRestore(); }
});

test("a DeviceHello1 lost behind a late bind costs one dial, not every later one", async () => {
  const style = { helloAhead: true, readsAhead: true };
  // The relay forwards it before the computer knows the route; nothing answers.
  SessionSocket.script = { bindLate: "drop" };
  const realTimeout = globalThis.setTimeout;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realTimeout(fn, ms === 8_000 ? 20 : ms)) as typeof setTimeout);
  try {
    expect(await dial(style).catch((error) => error.code)).toBe("timeout");
    expect(style).toEqual({ helloAhead: false, readsAhead: true });
    await dial(style);
    expect(SessionSocket.log.filter((entry) => entry.startsWith("2:"))).toEqual(["2:DeviceHello1", "2:DeviceHello3", "2:Ping", "2:GetConfig", "2:Snapshot"]);
  } finally { timers.mockRestore(); }
});

test("an answer that overtakes SESSION_ESTABLISHED fails closed and costs one dial", async () => {
  const style = { helloAhead: true, readsAhead: true };
  SessionSocket.script = { establishLate: true };
  expect(await dial(style).catch((error) => error.code)).toBe("bad_message");
  expect(style).toEqual({ helloAhead: true, readsAhead: false });
  const { reads } = await dial(style);
  expect(reads).toEqual([]);
  expect(SessionSocket.instances[1]!.operations).toEqual(["Ping"]);
});

test("a timeout before the route was bound says nothing about the order", async () => {
  const style = { helloAhead: true, readsAhead: true };
  SessionSocket.hold = "bound";
  const realTimeout = globalThis.setTimeout;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realTimeout(fn, ms === 8_000 ? 20 : ms)) as typeof setTimeout);
  try {
    expect(await dial(style).catch((error) => error.code)).toBe("timeout");
    expect(style).toEqual({ helloAhead: true, readsAhead: true });
  } finally { timers.mockRestore(); }
});

test("a refused handshake reports the computer's code and keeps the fast order", async () => {
  const style = { helloAhead: true, readsAhead: true };
  SessionSocket.script = { refuseHello: "rate_limited" };
  expect(await dial(style).catch((error) => error.code)).toBe("rate_limited");
  expect(style).toEqual({ helloAhead: true, readsAhead: true });
  expect(SessionSocket.instances[0]!.closeCalls).toBeGreaterThan(0);
});

test("reads are sealed only after the computer has proved itself", async () => {
  const stranger = { ...socketPair, psk: new Uint8Array(32).fill(1) };
  const code = await connectSession(URL_WS, stranger, () => undefined, undefined, undefined, undefined, { reads: READS })
    .then(() => "connected", (error) => error.code);
  expect(code).toBe("bad_proof");
  // DeviceHello3 and the reads never left.
  expect(SessionSocket.log).toEqual(["1:DeviceHello1", "1:close"]);
});

test("a computer whose signature fails never receives DeviceHello3 or the reads", async () => {
  SessionSocket.script = { forgeSignature: true };
  expect(await dial().catch((error) => error.code)).toBe("bad_signature");
  expect(SessionSocket.log).toEqual(["1:DeviceHello1", "1:close"]);
});

test("every dial spends exactly one DeviceHello1 from the session's budget", async () => {
  const budget = new HelloBudget();
  const spent = spyOn(budget, "spend");
  await dial(undefined, budget);
  expect(spent).toHaveBeenCalledTimes(1);
  expect(SessionSocket.log.filter((entry) => entry.endsWith(":DeviceHello1"))).toHaveLength(1);
});
