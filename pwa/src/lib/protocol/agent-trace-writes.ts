import { ProtocolError } from "./errors";

/**
 * What a summary read with `writes: true` and nothing else returns
 * (proto/agent-trace-writes.md), reduced to what the files screen asks: the
 * files the agent's edit tools wrote since the reader last spoke to it.
 *
 * The page is the newest one. A turn starts at the last thing the reader sent;
 * a turn longer than the page counts from the page's start.
 *
 * `writes` names the files a call was asked to write, whatever came of it. A
 * file counts as written only once its call is done: an edit the reader
 * refused, one that failed, and one still waiting for permission wrote nothing.
 */

const TOOL_KEYS = new Set(["type", "name", "state", "detail_ref", "writes"]);
const TEXT_KEYS = new Set(["type", "text"]);
const TYPES = new Set(["user", "thinking", "tool", "assistant"]);
const STATES = new Set(["running", "done", "error"]);

function bad(detail: string): never {
  throw new ProtocolError("bad_result", `AgentTraceSummary 响应${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path is one line: no control characters and no line or paragraph separator (0x2028, 0x2029). */
function oneLine(path: string): boolean {
  for (const char of path) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

function itemWrites(item: Record<string, unknown>): string[] {
  if (!("writes" in item)) return [];
  const writes = item.writes;
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > 16) bad(" writes 非法");
  for (const path of writes) {
    if (typeof path !== "string" || !path || Array.from(path).length > 1024 || !oneLine(path)) bad(" writes 非法");
  }
  return writes as string[];
}

export function parseTurnWrites(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 200) bad(" items 非法");
  const keys = Object.keys(value);
  if (keys.length !== 3 || !("next_cursor" in value) || typeof value.truncated !== "boolean") bad("字段非法");
  let turn: string[] = [];
  for (const item of value.items as unknown[]) {
    if (!isRecord(item) || typeof item.type !== "string" || !TYPES.has(item.type)) bad("包含非法记录");
    const allowed = item.type === "tool" ? TOOL_KEYS : TEXT_KEYS;
    if (Object.keys(item).some((key) => !allowed.has(key))) bad("包含非法记录");
    if (item.type === "user") turn = [];
    else if (item.type === "tool") {
      if (typeof item.state !== "string" || !STATES.has(item.state)) bad("包含非法记录");
      const writes = itemWrites(item);
      if (item.state === "done") turn.push(...writes);
    }
  }
  return [...new Set(turn)];
}
