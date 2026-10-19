import { beforeEach, describe, expect, test } from "bun:test";
import type { DashboardAgentCard } from "./dashboard";
import { setLang } from "./i18n";
import type { PaneActivity } from "./pane-activity";
import { rowStep, rowStepAt } from "./pane-step";

function agent(status: DashboardAgentCard["status"], activity?: PaneActivity): DashboardAgentCard {
  return { paneId: "p1", agent: "claude", hasAgent: true, status, workspaceLabel: "pairfob", cwd: "/repo", ...(activity ? { activity } : {}) };
}

const step = (status: DashboardAgentCard["status"], activity: PaneActivity) => rowStep(agent(status, activity), false);

beforeEach(() => setLang("zh"));

describe("the row's step", () => {
  test("a working agent names the step it is on, in the chat view's words", () => {
    expect(step("working", { type: "tool", name: "Edit", label: "internal/journal/activity.go", state: "running" }))
      .toEqual({ lead: "编辑", object: "journal/activity.go", running: true, failed: false });
    expect(step("working", { type: "tool", name: "Bash", label: "go test ./internal/journal", state: "done" }))
      .toEqual({ lead: "命令", object: "go test ./internal/journal", running: false, failed: false });
    expect(step("working", { type: "tool", name: "mcp__ego__screenshot" })?.object).toBe("ego · screenshot");
    expect(step("working", { type: "thinking" })).toEqual({ lead: "思考", object: "", running: false, failed: false });
    expect(step("working", { type: "assistant" })?.lead).toBe("写回复");
  });

  test("a blocked agent says what it waits to do", () => {
    expect(step("blocked", { type: "tool", name: "Bash", label: "git push origin main", state: "running" }))
      .toEqual({ lead: "要运行", object: "git push origin main", running: false, failed: false });
    expect(step("blocked", { type: "tool", name: "Write", label: "a/b/c.ts", state: "running" })?.lead).toBe("要修改");
    expect(step("blocked", { type: "tool", name: "AskUserQuestion", label: "Which theme?" })?.lead).toBe("在问你");
    expect(step("blocked", { type: "tool", name: "Frobnicate" })?.lead).toBe("要使用 Frobnicate");
    expect(step("blocked", { type: "thinking" })).toBeNull();
  });

  test("a finished turn leads with its result", () => {
    const last: PaneActivity = { type: "tool", name: "Bash", label: "go vet ./...", state: "error" };
    expect(step("done", { ...last, turn: { steps: 9, files: 4, plan: "5/5" } }))
      .toEqual({ lead: "改了 4 个文件", object: "计划 5/5", running: false, failed: false });
    expect(step("done", { ...last, turn: { steps: 9, files: 4, failed: true } }))
      .toEqual({ lead: "最后一步失败", object: "go vet ./...", running: false, failed: true });
    expect(step("done", { ...last, turn: { steps: 9, files: 2, interrupted: true } })?.lead).toBe("已中断");
    expect(step("done", { type: "assistant", turn: { steps: 3, files: 0, plan: "3/7" } })?.lead).toBe("计划 3/7");
    expect(step("done", { type: "assistant", turn: { steps: 3, files: 0 } })?.lead).toBe("完成 3 步");
    expect(step("done", { type: "assistant", turn: { steps: 0, files: 0 } })).toBeNull();
    // The computer could not see the turn whole: its last step, without claiming it is still running.
    expect(step("done", { type: "tool", name: "Read", label: "README.md", state: "running" }))
      .toEqual({ lead: "读取", object: "README.md", running: false, failed: false });
    expect(step("done", { type: "assistant" })).toBeNull();
  });

  test("the usual line stays for a read, idle, unconfirmed or unreported row", () => {
    const tool: PaneActivity = { type: "tool", name: "Bash", label: "make", state: "running", at: 5 };
    expect(step("idle", tool)).toBeNull();
    expect(step("unknown", tool)).toBeNull();
    expect(rowStep(agent("working", tool), true)).toBeNull();
    expect(rowStep(agent("working"), false)).toBeNull();
    expect(rowStep({ ...agent("working", tool), hasAgent: false }, false)).toBeNull();
  });

  test("its time is the agent's last step, else when the list saw the change", () => {
    expect(rowStepAt(agent("working", { type: "thinking", at: 1234 }), 99)).toBe(1234);
    expect(rowStepAt(agent("working", { type: "thinking" }), 99)).toBe(99);
    expect(rowStepAt(agent("idle"), undefined)).toBeUndefined();
  });
});
