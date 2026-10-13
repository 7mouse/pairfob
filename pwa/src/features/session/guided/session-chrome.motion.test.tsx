import { expectDifferentNode, expectSameNode } from "../../../../test-support/node-identity";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../../app/dom-root";
import { setLang, t } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import { setPhase, setNetworkOnline } from "../../connection/connection-store";
import { applyRuntimeIdentity, runtimeIdentity } from "../../connection/runtime-store";
import { attachLiveSession } from "../../computers/catalog-store";
import { applySnapshot, liveAgents } from "../../dashboard/catalog-store";
import { selectPane } from "../session-store";
import { SessionChrome } from "./session-chrome";
import type { SessionHandlers } from "./view";

/**
 * A status that changes under the reader is marked in the session header; the
 * same status drawn again, and a header handed another session, are not.
 */

const shell = await Bun.file(new URL("./session-shell.scss", import.meta.url)).text();
const restorer = new WorkspaceSnapshotRestorer();
const noop = () => {};
const handlers: SessionHandlers = { onBack: noop, onMenu: noop, onWorkspace: noop };

type PaneStatus = "working" | "blocked" | "done" | "idle";

function publish(panes: Record<string, PaneStatus>): void {
  act(() => applySnapshot({
    workspaces: [{ workspace_id: "w", label: "project", cwd: "/repo/project" }],
    panes: Object.entries(panes).map(([pane_id, agent_status]) => (
      { pane_id, workspace_id: "w", agent: "codex", agent_status, launch_pending: false, interactive_ready: true })),
  }));
}

function paint(paneId = "open"): void {
  const selected = liveAgents().find((agent) => agent.paneId === paneId);
  act(() => renderReact(<SessionChrome selected={selected} includeBack handlers={handlers} />));
}

const word = () => appRoot().querySelector<HTMLElement>(".chrome-status")!;
const dot = () => appRoot().querySelector<HTMLElement>(".chrome-avatar .agent-avatar-status")!;
const badge = () => appRoot().querySelector<HTMLElement>(".chrome-back-badge");

beforeEach(async () => {
  await resetBoardTestDOM();
  unmountReact();
  restorer.capture();
  act(() => {
    setLang("zh");
    setPhase("live");
    setNetworkOnline(true);
    applyRuntimeIdentity({ herdHost: runtimeIdentity().herdHost, runtimeKind: "herdr" });
    attachLiveSession({ isConnected: () => true } as unknown as LiveSession);
    selectPane("open");
  });
});

afterEach(() => {
  unmountReact();
  act(() => {
    restorer.restore();
    attachLiveSession(null);
    selectPane("");
  });
});

test("the status word fades in when the status changes, and is still on a first paint and a repaint", () => {
  publish({ open: "working" });
  paint();
  expect(word().textContent).toBe(t("status.working"));
  expect(word().classList.contains("swap-in")).toBeFalse();
  const first = word();
  // A poll that reports the same status draws the same node again.
  publish({ open: "working" });
  paint();
  expectSameNode(word(), first);
  expect(word().classList.contains("swap-in")).toBeFalse();

  publish({ open: "done" });
  paint();
  expect(word().textContent).toBe(t("status.done"));
  expect(word().className).toBe("chrome-status is-done swap-in");
});

test("the avatar's dot keeps its node across a status change, so its colour can cross over", () => {
  publish({ open: "working" });
  paint();
  const first = dot();
  publish({ open: "blocked" });
  paint();
  expectSameNode(dot(), first);
  expect(dot().classList.contains("is-blocked")).toBeTrue();
  const rule = shell.slice(shell.indexOf("\n.chrome-avatar .agent-avatar-status {"));
  expect(rule.slice(0, rule.indexOf("}"))).toMatch(/transition:\s*background-color var\(--dur-2\) var\(--ease\)/);
});

test("the back count pops when a pane starts waiting under the reader, not when the header opens with it", () => {
  publish({ open: "working", other: "blocked" });
  paint();
  expect(badge()?.textContent).toBe("1");
  expect(badge()?.classList.contains("pop-in")).toBeFalse();

  unmountReact();
  publish({ open: "working", other: "working" });
  paint();
  expect(badge()).toBeNull();
  publish({ open: "working", other: "blocked" });
  paint();
  expect(badge()?.className).toBe("chrome-back-badge pop-in");
  // A second pane joining changes the number in the mark that is already there.
  const mark = badge();
  publish({ open: "working", other: "blocked", third: "blocked" });
  paint();
  expectSameNode(badge(), mark);
  expect(badge()?.textContent).toBe("2");
});

test("a header handed another session draws its status as a first paint", () => {
  publish({ open: "working", other: "done" });
  paint("open");
  const first = { word: word(), dot: dot() };
  paint("other");
  expect(word().textContent).toBe(t("status.done"));
  expectDifferentNode(word(), first.word);
  expect(word().classList.contains("swap-in")).toBeFalse();
  // A new dot has no colour to cross from.
  expectDifferentNode(dot(), first.dot);
  expect(badge()?.classList.contains("pop-in") ?? false).toBeFalse();
});
