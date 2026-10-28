import { describe, expect, test } from "bun:test";
import { agentTitle, chromeName, herdSignature, mapSnapshotAgents } from "./dashboard";

function claudeCard(task?: string) {
  return mapSnapshotAgents({
    workspaces: [{ workspace_id: "w", label: "pairfob", cwd: "/repo/pairfob" }],
    panes: [{ pane_id: "p", workspace_id: "w", agent: "claude", agent_status: "working", terminal_title: "Claude Code", tokens: task ? { task } : {} }],
  })[0];
}

describe("Claude session titles", () => {
  test("first-request and generated names replace the generic title on every surface", () => {
    const startup = claudeCard();
    const prompt = claudeCard("检查会话标题");
    const named = claudeCard("修复 Claude 会话标题");
    for (const group of ["flat", "space", "agent"] as const) {
      expect(agentTitle(prompt, group)).toBe("检查会话标题");
      expect(agentTitle(named, group)).toBe("修复 Claude 会话标题");
    }
    expect(chromeName(named)).toBe("修复 Claude 会话标题");
    expect(herdSignature([startup])).not.toBe(herdSignature([prompt]));
    expect(herdSignature([prompt])).not.toBe(herdSignature([named]));
  });

  test("manual names retain priority and another pane cannot borrow the title", () => {
    const named = claudeCard("自动会话名");
    expect(agentTitle({ ...named, paneLabel: "我的任务" })).toBe("我的任务");
    expect(agentTitle({ ...named, workspaceLabel: "手动会话名" })).toBe("手动会话名");
    expect(agentTitle(claudeCard())).not.toBe("自动会话名");
  });
});
