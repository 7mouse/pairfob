import { describe, expect, test } from "bun:test";
import { agentMeta, agentTitle, chromeName, herdSignature, mapSnapshotAgents } from "./dashboard";

function piCard(title: string, tokens?: Record<string, string>) {
  return mapSnapshotAgents({
    workspaces: [{ workspace_id: "w", label: "pairfob", cwd: "/repo/pairfob" }],
    panes: [{ pane_id: "p", workspace_id: "w", agent: "pi", agent_status: "working", terminal_title: title, ...(tokens ? { tokens } : {}) }],
  })[0];
}

describe("Pi session titles", () => {
  test("bound task metadata titles a Pi pane and feeds the card signature", () => {
    const startup = piCard("π - pairfob");
    const titled = piCard("π - pairfob", { task: "修复 Pi 会话标题" });
    expect(agentTitle(titled)).toBe("修复 Pi 会话标题");
    expect(chromeName(titled)).toBe("修复 Pi 会话标题");
    expect(herdSignature([startup])).not.toBe(herdSignature([titled]));
    expect(agentMeta(titled)).toBe("pi · pairfob");
  });

  test("manual pane and workspace names still win", () => {
    const agent = piCard("π - 修复 Pi 会话标题 - pairfob", { task: "修复 Pi 会话标题" });
    expect(agentTitle({ ...agent, paneLabel: "我的 Pi 任务" })).toBe("我的 Pi 任务");
    expect(agentTitle({ ...agent, workspaceLabel: "手动会话名" })).toBe("手动会话名");
  });

  test("the π marker and the cwd never become a title", () => {
    for (const title of ["π - pairfob", "π", "π -", "π -  - pairfob"]) expect(agentTitle(piCard(title)), title).toBe("pi");
    expect(agentTitle(piCard("π - skill-quoted-stop-hold - pairfob"))).toBe("skill-quoted-stop-hold");
    expect(agentTitle(piCard("Review | pairfob"))).toBe("Review | pairfob");
  });
});