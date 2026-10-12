import { expect, test } from "bun:test";
import { advertisesTraceModels, parseAgentTraceSummaryPage } from "../operations";
import { AgentTraceRPC } from "./agent-trace";
import { parseAgentTraceModelSummary } from "./agent-trace-models";
import { ProtocolError } from "./errors";

const model = { model: "gpt-5", effort: "high", source: "codex_context" };
const page = (models: unknown = [model]) => ({ items: [{ type: "assistant", text: "done", models }], next_cursor: null, truncated: false });

test("model extension validates evidence without relaxing legacy summary validation", () => {
  expect(parseAgentTraceModelSummary(page()).items[0].models).toEqual([model]);
  expect(() => parseAgentTraceSummaryPage(page())).toThrow();
  for (const models of [null, [], [null], [{ ...model, extra: true }], [{ ...model, source: "guess" }],
    [{ ...model, model: "bad\nmodel" }], [{ ...model, effort: "" }], [{ ...model, source: "claude_message" }]]) {
    expect(() => parseAgentTraceModelSummary(page(models))).toThrow();
  }
  expect(() => parseAgentTraceModelSummary({ ...page(), surprise: true })).toThrow();
  expect(() => parseAgentTraceModelSummary({ ...page(), items: [{ type: "user", text: "prompt", models: [model] }] })).toThrow();
  expect(parseAgentTraceModelSummary({ ...page(), items: [{ type: "assistant", text: "no metadata" }] }).items[0].models).toEqual([]);
});

test("only literal capability true selects the new read and downgrade preserves the old shape", async () => {
  const calls: string[] = [];
  let models = false;
  const rpc = new AgentTraceRPC(async (op) => {
    calls.push(op);
    return op === "AgentTraceModelSummary" ? page() : { ...page(), items: [{ type: "assistant", text: "legacy" }] };
  }, () => false, () => false, () => false, () => false, () => models);
  for (const flag of [undefined, "true", 1, true, false]) {
    models = advertisesTraceModels({ capabilities: { trace_models: flag } });
    const result = await rpc.read("p1");
    expect(result.items[0].models).toEqual(flag === true ? [model] : undefined);
  }
  expect(calls).toEqual(["AgentTraceSummary", "AgentTraceSummary", "AgentTraceSummary", "AgentTraceModelSummary", "AgentTraceSummary"]);
});

test("a live connection upgraded from a raw-only daemon can learn model support", async () => {
  let models = false;
  const calls: string[] = [];
  const rpc = new AgentTraceRPC(async op => {
    calls.push(op);
    if (op === "AgentTraceSummary") throw new ProtocolError("unknown_op", op);
    return op === "AgentTraceModelSummary" ? page() : { ...page(), items: [] };
  }, () => false, () => false, () => false, () => false, () => models);
  await rpc.read("p1");
  models = true;
  expect((await rpc.read("p1")).items[0].models).toEqual([model]);
  expect(calls).toEqual(["AgentTraceSummary", "AgentTrace", "AgentTraceModelSummary"]);
});

test("an unavailable extension falls back to the existing summary, real errors do not", async () => {
  const calls: string[] = [];
  let code = "unknown_op";
  const rpc = new AgentTraceRPC(async op => {
    calls.push(op);
    if (op === "AgentTraceModelSummary") throw new ProtocolError(code, op);
    return { ...page(), items: [] };
  }, () => false, () => false, () => false, () => false, () => true);
  await rpc.read("p1");
  code = "transcript_unavailable";
  await expect(rpc.read("p1")).rejects.toMatchObject({ code });
  expect(calls).toEqual(["AgentTraceModelSummary", "AgentTraceSummary", "AgentTraceModelSummary"]);
});
