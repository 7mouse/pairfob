// Runs in its OWN bun test process (spawned from
// src/lib/protocol/session-review-reads.test.ts), like
// session-upload-v2-isolated.test.ts: it stubs process-global network and
// negotiation I/O with mock.module. The session is production code; only the
// wire answers are scripted here.
//
// What it holds: the review reads (proto/workspace-review.md,
// proto/agent-trace-writes.md) ask a daemon for nothing it did not offer. The
// extra params go out only after a GetConfig that literally says true, and a
// reply carrying keys that were not asked for is malformed.
import { test, expect, mock } from "bun:test";
import { Wire } from "./media-wire-fixture";
import { fingerprint16 } from "../src/lib/protocol/hello";
import * as sockets from "../src/lib/protocol/frame-socket";
import * as handshake from "../src/lib/protocol/session-handshake";
import type { GitStatus, WorkspaceSearchPage } from "../src/lib/workspace";

let relay: Wire;

mock.module("../src/lib/protocol/frame-socket", () => ({ ...sockets, openWS: async () => relay as never }));
mock.module("../src/lib/protocol/session-handshake", () => ({
  ...handshake,
  establishSessionEpoch: async (channel: Wire) => channel.epoch(),
}));

const { sessionOverWS } = await import("../src/lib/protocol/session-ws") as {
  sessionOverWS(url: string, pair: object, opts: object): Promise<Live>;
};

type Live = {
  close(): void;
  getConfig(): Promise<Record<string, unknown>>;
  gitStatus(paneId: string): Promise<GitStatus>;
  agentTurnWrites(paneId: string): Promise<string[] | null>;
  workspaceSearch(paneId: string, root: string, query: string, limit?: number): Promise<WorkspaceSearchPage>;
};

const pk = new Uint8Array(32).fill(3);
const pair = {
  daemonId: "d_" + "a".repeat(20), deviceId: "dev_12345678", daemonPk: pk, psk: new Uint8Array(32).fill(9),
  fp: fingerprint16(pk), relayOrigin: "https://pairfob.com",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The (index+1)th request for `op`, once the wire has seen it. */
async function request(op: string, index = 0) {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const found = relay.requests.filter((item) => item.op === op);
    if (found.length > index) return found[index];
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${op} #${index + 1} (saw ${found.length})`);
    await sleep(2);
  }
}

async function withSession(run: (live: Live) => Promise<void>) {
  relay = new Wire("relay", 1);
  const live = await sessionOverWS("wss://pairfob.com/v2/ws", pair as never, { p2p: false, networkMode: "relay" });
  try {
    await run(live);
  } finally {
    live.close();
    relay.close();
  }
}

let configs = 0;
async function learn(live: Live, capabilities: Record<string, unknown>): Promise<void> {
  const pending = live.getConfig();
  relay.reply(await request("GetConfig", configs++), { capabilities });
  await pending;
}

const status = (change: Record<string, unknown> = {}) => ({
  branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "a".repeat(64),
  changes: [{ path: "src/app.ts", original_path: null, index: " ", worktree: "M", ...change }],
});
const counted = { stat: { worktree: { additions: 3, deletions: 1 } }, modified_ms: 1_700_000_000_000 };
const summary = { items: [{ type: "user", text: "go" }, { type: "tool", name: "Edit", state: "done", detail_ref: "r1", writes: ["src/app.ts"] }], next_cursor: null, truncated: false };

test("before any GetConfig, and from a daemon that offers neither, the reads ask for no extras", () => withSession(async (live) => {
  configs = 0;
  // Nothing learned yet.
  let pending = live.gitStatus("p1");
  let asked = await request("GitStatus", 0);
  expect(asked.params).toEqual({ pane_id: "p1" });
  relay.reply(asked, status());
  expect((await pending).changes[0].stat).toBeUndefined();
  expect(await live.agentTurnWrites("p1")).toBeNull();
  expect(relay.requests.some((item) => item.op === "AgentTraceSummary")).toBeFalse();

  // A daemon that predates the keys, and one that says false.
  for (const capabilities of [{}, { git_change_stats: false, trace_writes: false }, { git_change_stats: "true", trace_writes: 1 }]) {
    await learn(live, capabilities);
    const index = relay.requests.filter((item) => item.op === "GitStatus").length;
    pending = live.gitStatus("p1");
    asked = await request("GitStatus", index);
    expect(asked.params).toEqual({ pane_id: "p1" });
    relay.reply(asked, status());
    await pending;
    expect(await live.agentTurnWrites("p1")).toBeNull();
  }
  expect(relay.requests.some((item) => item.op === "AgentTraceSummary")).toBeFalse();
}));

test("counts and times that were not asked for are a malformed status, not trusted extras", () => withSession(async (live) => {
  configs = 0;
  await learn(live, {});
  const pending = live.gitStatus("p1");
  relay.reply(await request("GitStatus", 0), status(counted));
  await expect(pending).rejects.toThrow("GitStatus change");
}));

test("a daemon that offers them is asked, and its answers are read", () => withSession(async (live) => {
  configs = 0;
  await learn(live, { git_change_stats: true, trace_writes: true });
  const pending = live.gitStatus("p1");
  const asked = await request("GitStatus", 0);
  expect(asked.params).toEqual({ pane_id: "p1", stats: true });
  relay.reply(asked, status(counted));
  expect((await pending).changes[0]).toMatchObject(counted);

  const writes = live.agentTurnWrites("p1");
  const read = await request("AgentTraceSummary", 0);
  expect(read.params).toEqual({ pane_id: "p1", cursor: null, limit: 200, writes: true });
  relay.reply(read, summary);
  expect(await writes).toEqual(["src/app.ts"]);

  // The daemon is downgraded: the next GetConfig takes the extras away again.
  await learn(live, {});
  const again = live.gitStatus("p1");
  const plain = await request("GitStatus", 1);
  expect(plain.params).toEqual({ pane_id: "p1" });
  relay.reply(plain, status());
  await again;
  expect(await live.agentTurnWrites("p1")).toBeNull();
}));

test("a search names its root and its words, and takes only the answer to them", () => withSession(async (live) => {
  let pending = live.workspaceSearch("p1", "/work/pairfob", "app");
  let asked = await request("WorkspaceSearch", 0);
  expect(asked.params).toEqual({ pane_id: "p1", root: "/work/pairfob", query: "app", limit: 30 });
  relay.reply(asked, { query: "app", truncated: false, items: [{ path: "src/app.ts", name: "app.ts" }] });
  expect((await pending).items).toEqual([{ path: "src/app.ts", name: "app.ts" }]);

  pending = live.workspaceSearch("p1", "/work/pairfob", "apple", 5);
  asked = await request("WorkspaceSearch", 1);
  expect(asked.params.limit).toBe(5);
  // An answer that echoes other words is not this search's.
  relay.reply(asked, { query: "app", truncated: false, items: [] });
  await expect(pending).rejects.toThrow("WorkspaceSearch.query");
}));
