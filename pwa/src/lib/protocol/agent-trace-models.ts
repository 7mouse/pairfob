import { parseAgentTraceSummaryPage, type AgentTraceModel, type AgentTracePage } from "../operations";
import { ProtocolError } from "./errors";

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function bad(): never { throw new ProtocolError("bad_result", "AgentTraceModelSummary 响应模型记录非法"); }

/** Validate only the new operation; legacy summary validators stay strict. */
export function parseAgentTraceModelSummary(value: unknown): AgentTracePage {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 200) bad();
  const observations: AgentTraceModel[][] = [];
  const items = value.items.map((item: unknown) => {
    if (!record(item)) bad();
    const { models, ...legacy } = item;
    const list: AgentTraceModel[] = [];
    if ("models" in item) {
      if (!["assistant", "thinking", "tool"].includes(String(item.type)) || !Array.isArray(models) || !models.length || models.length > 32) bad();
      for (const model of models) {
        if (!record(model) || Object.keys(model).some(key => !["model", "effort", "source"].includes(key))
          || typeof model.model !== "string" || !TOKEN.test(model.model)
          || ("effort" in model && (typeof model.effort !== "string" || !TOKEN.test(model.effort)))
          || (model.source !== "codex_context" && model.source !== "claude_message")
          || (model.source === "claude_message" && "effort" in model)) bad();
        list.push(model as AgentTraceModel);
      }
    }
    observations.push(list);
    return legacy;
  });
  const page = parseAgentTraceSummaryPage({ ...value, items });
  return { ...page, items: page.items.map((item, index) => ({ ...item, models: observations[index] })) };
}
