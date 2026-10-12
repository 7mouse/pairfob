import { describe, expect, test } from "bun:test";
import { AgentTraceRPC } from "./agent-trace";
import { parseTurnWrites } from "./agent-trace-writes";

/**
 * The files the agent's edit tools wrote since the reader last spoke to it
 * (proto/agent-trace-writes.md), from a summary read with writes:true.
 */

const tool = (writes?: string[], name = "Edit") => ({ type: "tool", name, state: "done", detail_ref: "r1", ...(writes ? { writes } : {}) });
const page = (items: unknown[]) => ({ items, next_cursor: null, truncated: false });

describe("parseTurnWrites", () => {
  test("counts from the last thing the reader sent, each file once, in order", () => {
    expect(parseTurnWrites(page([
      { type: "user", text: "first" },
      tool(["/repo/old.ts"]),
      { type: "assistant", text: "done" },
      { type: "user", text: "second" },
      { type: "thinking", text: "..." },
      tool(["src/a.ts", "src/b.ts"], "apply_patch"),
      tool(undefined, "Bash"),
      tool(["src/a.ts"]),
    ]))).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("a turn longer than the page counts from the page's start, and an idle turn has none", () => {
    expect(parseTurnWrites(page([tool(["a.ts"]), tool(["b.ts"])]))).toEqual(["a.ts", "b.ts"]);
    expect(parseTurnWrites(page([tool(["a.ts"]), { type: "user", text: "next" }]))).toEqual([]);
    expect(parseTurnWrites(page([]))).toEqual([]);
  });

  test("a file is written once its call is done: a refused, failed or pending edit wrote nothing", () => {
    const call = (state: string, path: string) => ({ ...tool([path]), state });
    expect(parseTurnWrites(page([
      { type: "user", text: "go" },
      call("error", "refused.ts"),
      call("done", "written.ts"),
      call("running", "waiting.ts"),
    ]))).toEqual(["written.ts"]);
    // The same file, refused first and written on the second try, is written.
    expect(parseTurnWrites(page([call("error", "a.ts"), call("done", "a.ts")]))).toEqual(["a.ts"]);
    // A state this client does not know is a malformed page, as is a call without one.
    expect(() => parseTurnWrites(page([call("cancelled", "a.ts")]))).toThrow();
    expect(() => parseTurnWrites(page([{ type: "tool", name: "Edit", detail_ref: "r1", writes: ["a.ts"] }]))).toThrow();
  });

  test("a malformed page is rejected, never partly used", () => {
    const bad = (items: unknown[], extra: Record<string, unknown> = {}) => () => parseTurnWrites({ ...page(items), ...extra });
    expect(bad([tool([])])).toThrow();
    expect(bad([tool(Array.from({ length: 17 }, (_, index) => `f${index}`))])).toThrow();
    expect(bad([tool(["ok.ts", 7 as never])])).toThrow();
    expect(bad([tool(["two\nlines.ts"])])).toThrow();
    expect(bad([tool(["a".repeat(1025)])])).toThrow();
    // Keys this read did not ask for: a label, a time, a marker kind.
    expect(bad([{ ...tool(["a.ts"]), label: "a.ts" }])).toThrow();
    expect(bad([{ type: "user", text: "x", at: 1 }])).toThrow();
    expect(bad([{ type: "compaction" }])).toThrow();
    expect(bad([{ type: "user", text: "x", writes: ["a.ts"] }])).toThrow();
    expect(bad([], { now: 1 })).toThrow();
    expect(() => parseTurnWrites({ items: [], next_cursor: null })).toThrow();
    expect(() => parseTurnWrites(null)).toThrow();
  });
});

describe("AgentTraceRPC.turnWrites", () => {
  test("asks for the newest page with writes only, and only of a daemon that offers them", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const rpc = async (op: string, params: Record<string, unknown>) => {
      calls.push([op, params]);
      return page([{ type: "user", text: "go" }, tool(["src/a.ts"])]);
    };
    const without = new AgentTraceRPC(rpc, () => true, () => true, () => true, () => false);
    expect(await without.turnWrites("p1")).toBeNull();
    expect(calls).toEqual([]);

    const offered = new AgentTraceRPC(rpc, () => true, () => true, () => true, () => true);
    expect(await offered.turnWrites("p1")).toEqual(["src/a.ts"]);
    // Not the conversation's vocabulary: no markers, labels or times ride along.
    expect(calls).toEqual([["AgentTraceSummary", { pane_id: "p1", cursor: null, limit: 200, writes: true }]]);
  });
});
