import { expect, test } from "bun:test";
import { FIRST_READ_KEEP_MS, FirstReads } from "./first-reads";
import type { SessionTransport } from "./session-transport";

const PANE = { pane_id: "w1:p1", source: "visible", format: "ansi", lines: 80 };
const transport = () => ({}) as SessionTransport;

function sent(op: string, params: unknown) {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const answer = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  answer.catch(() => undefined);
  return { op, params, answer, settle: resolve, fail: () => reject(new Error("failed")) };
}
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test("a new session asks for config and snapshot, and for the pane only once the app has read one", () => {
  const reads = new FirstReads();
  expect(reads.plan(null).map((read) => read.op)).toEqual(["GetConfig", "Snapshot"]);
  reads.note("PaneRead", PANE);
  expect(reads.plan(null)).toEqual([
    { op: "GetConfig", params: {} },
    { op: "Snapshot", params: { session: null } },
    { op: "PaneRead", params: PANE },
  ]);
});

test("reads are scoped to the Herdr session the connection targets", () => {
  const reads = new FirstReads();
  reads.note("PaneRead", PANE);
  expect(reads.plan("work").map((read) => read.params)).toEqual([
    { session: "work" }, { session: "work" }, { ...PANE, session: "work" },
  ]);
});

test("a session nobody reads from stops asking, and asks again once it is read", () => {
  const reads = new FirstReads();
  reads.ready();
  // One connection that went unread is not yet a reason to stop.
  expect(reads.plan(null).map((read) => read.op)).toEqual(["GetConfig", "Snapshot"]);
  reads.ready();
  expect(reads.plan(null)).toEqual([]);
  reads.note("GetConfig", {});
  reads.note("Snapshot", { session: null });
  expect(reads.plan(null).map((read) => read.op)).toEqual(["GetConfig", "Snapshot"]);
});

test("the pane is asked for only while the app keeps reading it", () => {
  const reads = new FirstReads();
  reads.note("PaneRead", PANE);
  reads.note("Snapshot", { session: null });
  expect(reads.plan(null).map((read) => read.op)).toContain("PaneRead");
  reads.note("Snapshot", { session: null });
  expect(reads.plan(null).map((read) => read.op)).not.toContain("PaneRead");
  // A guard read asks for text and must always be fresh: it is never remembered.
  reads.note("PaneRead", { ...PANE, format: "text" });
  expect(reads.plan(null).map((read) => read.op)).not.toContain("PaneRead");
});

test("an answer goes once, to the exact read, on the transport it arrived on", async () => {
  const reads = new FirstReads();
  const owner = transport();
  const config = sent("GetConfig", {});
  const pane = sent("PaneRead", PANE);
  reads.hold(owner, [config, pane]);
  config.settle({ runtime: "herdr" });
  expect(reads.take(transport(), "GetConfig", {})).toBeNull();
  expect(reads.take(owner, "GetConfig", { session: "work" })).toBeNull();
  expect(reads.take(owner, "PaneRead", { ...PANE, lines: 40 })).toBeNull();
  expect(await reads.take(owner, "GetConfig", {})).toEqual({ runtime: "herdr" });
  expect(reads.take(owner, "GetConfig", {})).toBeNull();
  // Still in flight: the caller waits for the answer already on its way.
  const waiting = reads.take(owner, "PaneRead", PANE);
  pane.settle({ text: "ready" });
  expect(await waiting).toEqual({ text: "ready" });
});

test("an answer that waited too long or failed is not handed out", async () => {
  const reads = new FirstReads();
  const owner = transport();
  const config = sent("GetConfig", {});
  const snapshot = sent("Snapshot", { session: null });
  reads.hold(owner, [config, snapshot]);
  config.settle({});
  snapshot.fail();
  await settle();
  expect(reads.take(owner, "Snapshot", { session: null })).toBeNull();
  expect(reads.take(owner, "GetConfig", {}, Date.now() + FIRST_READ_KEEP_MS + 1)).toBeNull();
});

test("dropping answers nothing; retargeting also forgets the pane", async () => {
  const reads = new FirstReads();
  const owner = transport();
  reads.note("PaneRead", PANE);
  reads.hold(owner, [sent("GetConfig", {})]);
  reads.ready(); reads.ready();
  reads.drop();
  expect(reads.take(owner, "GetConfig", {})).toBeNull();
  expect(reads.plan(null).map((read) => read.op)).toEqual(["PaneRead"]);
  reads.retarget();
  expect(reads.plan("work").map((read) => read.op)).toEqual(["GetConfig", "Snapshot"]);
});

test("a probe sends the planned reads on the live transport and holds their answers", async () => {
  const reads = new FirstReads();
  const asked: string[] = [];
  const live = { rpc: async (op: string) => { asked.push(op); return { op }; } } as unknown as SessionTransport;
  reads.note("PaneRead", PANE);
  reads.send(live, null);
  expect(asked).toEqual(["GetConfig", "Snapshot", "PaneRead"]);
  expect(await reads.take(live, "Snapshot", { session: null })).toEqual({ op: "Snapshot" });
  // A probe that failed leaves the plan intact for the dial that follows.
  expect(reads.plan(null).map((read) => read.op)).toEqual(["GetConfig", "Snapshot", "PaneRead"]);
});

test("answers planned before something changed are not held", () => {
  const reads = new FirstReads();
  const owner = transport();
  reads.plan(null);
  // A Poke during the dial, or the page hiding while it was in flight.
  reads.drop();
  reads.hold(owner, [sent("Snapshot", { session: null })]);
  expect(reads.take(owner, "Snapshot", { session: null })).toBeNull();
  reads.plan(null);
  reads.hold(owner, [sent("Snapshot", { session: null })]);
  expect(reads.take(owner, "Snapshot", { session: null })).not.toBeNull();
});
