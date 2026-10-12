import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { expectDifferentNode, expectSameNode } from "../../../test-support/node-identity";
import { commitTest, mountTestApp, unmountTestApp } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../app/dom-root";
import { disposeNoticeLifecycle } from "../../app/notices-store";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities, setOperationBusy } from "../operations/capabilities-store";
import { selectPane, setAgentChat, setFullTerminal } from "../session/session-store";
import { resetFileFilter } from "./file-filter";
import { SEARCH_DELAY_MS, resetFileSearch } from "./file-search";
import { clearWorkspacePendingReveal, leaveWorkspace, showWorkspaceTab, workspaceModel } from "./index";
import { closeWorkspaceInspector, toggleWorkspaceInspector } from "./inspector";
import { inspectorOpen } from "./inspector-store";

/**
 * The files tab in the column beside the session. The column holds one thing
 * at a time, so the list gives its place to the file that is opened: what was
 * typed into its filter, and what the computer found, are there again when the
 * reader comes back. A find row open over the file closes before the file.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const revision = "a".repeat(64);
let searches: string[] = [];

function liveFixture() {
  const file = (path: string) => ({ name: path.split("/").pop()!, path, kind: "file" as const, size: 25, modified_ms: 1, hidden: false, revision });
  return {
    isConnected: () => true,
    paneRead: async () => ({ text: "", hash: "h" }),
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({
      path, entries: [file("app.ts"), file("README.md")], next_cursor: null, truncated: false, revision,
    }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text" as const, size: 25, modified_ms: 1, content: "const alpha = 1;\nexport { alpha };\n", truncated: false, revision,
    }),
    workspaceSearch: async (_pane: string, _root: string, query: string) => {
      searches.push(query);
      return { query, items: [{ path: "src/deep/apply.ts", name: "apply.ts" }], truncated: false };
    },
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision, changes: [],
    }),
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

async function boot(): Promise<void> {
  happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
  await act(async () => {
    setLang("zh");
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    setAgentChat(false);
    setFullTerminal(false);
    setOperationBusy(false);
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, search_files: true }, []);
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "pairfob" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/pairfob", agent: "codex", agent_status: "idle" as const }],
    });
    attachLiveSession(liveFixture() as never);
    mountTestApp();
    commitTest();
  });
  await act(async () => { toggleWorkspaceInspector(); });
  await settle();
  await act(async () => { showWorkspaceTab("files"); });
  await settle();
}

const column = () => appRoot().querySelector<HTMLElement>("aside.inspector")!;
function inColumn<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = column().querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector} in the inspector`);
  return found;
}
const filter = () => inColumn<HTMLInputElement>(".workspace-filter-input");
const results = () => [...column().querySelectorAll(".workspace-row.is-search .workspace-row-name")].map((node) => node.textContent);

async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

async function type(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new happy.Event("input", { bubbles: true }) as unknown as Event);
    field.dispatchEvent(new happy.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
  await settle();
}

async function answered(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, SEARCH_DELAY_MS + 30)); });
  await settle();
}

async function key(name: string, target: EventTarget): Promise<KeyboardEvent> {
  const event = new happy.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
  await act(async () => { target.dispatchEvent(event); });
  await settle();
  return event;
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  seedRestorer.capture();
  searches = [];
  resetFileFilter();
  resetFileSearch();
});

afterEach(async () => {
  unmountTestApp();
  await act(async () => {
    closeWorkspaceInspector();
    if (currentScreen() === "workspace") leaveWorkspace();
    clearWorkspacePendingReveal();
    closeTestDialogs();
    disposeNoticeLifecycle();
    attachLiveSession(null);
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES }, []);
    setScreen("home");
    seedRestorer.restore();
    await Promise.resolve();
  });
  appRoot().replaceChildren();
  expect(inspectorOpen()).toBeFalse();
});

describe("the files tab in the column", () => {
  test("the filter and what the computer found are there again after a result was opened and closed", async () => {
    await boot();
    await type(filter(), "app");
    await answered();
    expect(searches).toEqual(["app"]);
    expect(results()).toEqual(["apply.ts"]);

    // The list leaves the column for the file.
    await press(inColumn(".workspace-row.is-search .workspace-row-main"));
    expect(workspaceModel.view).toBe("file");
    expect(column().querySelector(".workspace-filter-input")).toBeNull();

    await press(inColumn(".inspector-back"));
    expect(workspaceModel.view).toBe("browser");
    expect(filter().value).toBe("app");
    // The same rows at once, and the computer was not asked a second time for them.
    expect(results()).toEqual(["apply.ts"]);
    await answered();
    expect(searches).toEqual(["app"]);
    // Coming back does not put the keyboard in the field.
    expectDifferentNode(document.activeElement, filter());
  });

  test("Escape in an open file closes its find row first, then the file, then the column", async () => {
    await boot();
    await press(inColumn(".workspace-row-main"));
    expect(workspaceModel.view).toBe("file");
    await press(inColumn(".workspace-find-toggle"));
    const field = inColumn<HTMLInputElement>(".workspace-find-field");
    await type(field, "alpha");
    expect(column().querySelectorAll(".workspace-code-line.is-found")).toHaveLength(2);

    // From a line of the source, where the reader's focus is after a click on it.
    const source = inColumn(".workspace-code-stage");
    let escape = await key("Escape", source);
    expect(escape.defaultPrevented).toBeTrue();
    expect(column().querySelector(".workspace-find")).toBeNull();
    expect(workspaceModel.view).toBe("file");

    // From the field: the keyboard goes back to the button that opened the row.
    await press(inColumn(".workspace-find-toggle"));
    await key("Escape", inColumn(".workspace-find-field"));
    expect(column().querySelector(".workspace-find")).toBeNull();
    expectSameNode(document.activeElement, inColumn(".workspace-find-toggle"));

    escape = await key("Escape", inColumn(".workspace-find-toggle"));
    expect(workspaceModel.view).toBe("browser");
    expect(inspectorOpen()).toBeTrue();
  });
});
