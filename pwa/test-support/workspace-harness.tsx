import { act } from "react";
import { closeTestDialogs } from "./close-dialogs";
import { happy } from "./dom";
import { renderReact, unmountReact } from "./react-harness";
import { WorkspaceSnapshotRestorer } from "./workspace-snapshot-restore";
import { setScreen } from "../src/app/navigation-store";
import { attachLiveSession } from "../src/features/computers/catalog-store";
import { setPhase } from "../src/features/connection/connection-store";
import { replaceAgentsFromSnapshot } from "../src/features/dashboard/catalog-store";
import { applyCapabilities } from "../src/features/operations/capabilities-store";
import { selectPane } from "../src/features/session/session-store";
import { clearWorkspacePendingReveal, enterWorkspace } from "../src/features/workspace";
import { setLang } from "../src/lib/i18n";
import { NO_OPERATION_CAPABILITIES, type OperationCapabilities } from "../src/lib/operations";
import { WorkspaceScreen } from "../src/pages/workspace/screen";

/**
 * The files screen over a fixture session, for tests of what it shows: one
 * pane with an agent in `/work/pairfob`, the screen entered on that pane.
 * A test supplies the session's answers and says how wide the window is.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();

export const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};
export const all = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];

export async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

export async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

/** A key pressed on `target` (the page's body when none is given); the event, to ask whether it was taken. */
export async function key(name: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): Promise<KeyboardEvent> {
  const event = new happy.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }) as unknown as KeyboardEvent;
  await act(async () => { target.dispatchEvent(event); });
  await settle();
  return event;
}

/** Type into a field the way React hears it. */
export async function type(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  const proto = field instanceof happy.HTMLTextAreaElement ? happy.HTMLTextAreaElement.prototype : happy.HTMLInputElement.prototype;
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
    field.dispatchEvent(new happy.Event("input", { bubbles: true }) as unknown as Event);
    field.dispatchEvent(new happy.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
  await settle();
}

export type AgentStatusWire = "idle" | "working" | "blocked" | "done";

/** What the list of sessions says of the pane's agent. */
export function setAgentStatus(status: AgentStatusWire): void {
  replaceAgentsFromSnapshot({
    focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
    workspaces: [{ workspace_id: "w1", label: "pairfob" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
    panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/pairfob", agent: "codex", agent_status: status }],
  });
}

export async function bootWorkspaceScreen(live: object, options: {
  width?: number; capabilities?: Partial<OperationCapabilities>; tab?: "changes" | "files";
} = {}): Promise<void> {
  happy.happyDOM.setWindowSize({ width: options.width ?? 390, height: 844 });
  await act(async () => {
    setLang("zh");
    seedRestorer.capture();
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, ...options.capabilities }, []);
    setAgentStatus("idle");
    attachLiveSession(live as never);
    renderReact(<WorkspaceScreen />);
    await enterWorkspace("p1", undefined, false, options.tab ?? "changes");
  });
  await settle();
}

export async function teardownWorkspaceScreen(): Promise<void> {
  await act(async () => { unmountReact(); });
  clearWorkspacePendingReveal();
  await act(async () => { closeTestDialogs(); await Promise.resolve(); });
  await act(async () => {
    seedRestorer.restore();
    attachLiveSession(null);
    setScreen("home");
    selectPane("");
  });
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
}
