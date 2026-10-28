import { expect, test } from "bun:test";
import { agentTitle, chromeName, mapSnapshotAgents } from "./dashboard";

// The runtime owns the launch catalog. Observation rendering must not require
// another allowlist whenever that catalog gains an agent.
const kinds = ["pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "opencode", "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "qwen", "letta", "maki", "muse", "future-agent"];

test("every launch kind can display an observed task and tool activity", () => {
  for (const agent of kinds) {
    const card = mapSnapshotAgents({
      workspaces: [{ workspace_id: "w", label: "repo", cwd: "/repo" }],
      panes: [{ pane_id: "p", workspace_id: "w", agent, agent_status: "working", tokens: { task: "修复会话标题" },
        activity: { type: "tool", name: "Read", label: "src/main.ts", state: "running", at: 1000 } }],
    })[0];
    expect(agentTitle(card)).toBe("修复会话标题");
    expect(chromeName(card)).toBe("修复会话标题");
    expect(card.activity?.label).toBe("src/main.ts");
    expect(agentTitle({ ...card, paneLabel: "手动名称" })).toBe("手动名称");
  }
});
