import type { AgentTraceItem, AgentTraceModel } from "../src/lib/operations";
import { trace } from "./data";

/** Record-local fixtures: deliberately different models across two turns. */
export function modelTrace(scene: string): AgentTraceItem[] {
  const first: AgentTraceModel = { model: "gpt-5", effort: "high", source: "codex_context" };
  const next: AgentTraceModel = { model: "gpt-5-mini", effort: "medium", source: "codex_context" };
  const models = scene === "chat-models-missing" ? []
    : scene === "chat-models-claude" ? [{ model: "claude-sonnet-4-20250514", source: "claude_message" } as AgentTraceModel]
    : scene === "chat-models-long" ? [{ ...first, model: "provider/custom-reasoning-model-2026-extended", effort: "xhigh" }]
    : scene === "chat-models-multi" ? [first, next] : [first];
  const items = trace();
  const two = scene === "chat-models" || scene === "chat-models-live";
  const result = (two ? items : items.slice(0, 4)).map((item, index) => ({
    ...item, models: item.type === "user" ? [] : index < 4 ? models : [next],
  }));
  if (scene === "chat-models") result.push({ type: "assistant", text: "窄屏检查完成，原有控件与交互已保留。", models: [next] });
  return result;
}
