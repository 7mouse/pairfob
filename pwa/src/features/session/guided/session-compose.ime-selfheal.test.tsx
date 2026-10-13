import { resetBoardTestDOM, happy } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../../app/dom-root";
import { bindInputMode, resetInputMode } from "../../../app/input-mode";
import { setScreen } from "../../../app/navigation-store";
import { clearNotice } from "../../../app/notices-store";
import { setLang } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import { ProtocolError } from "../../../lib/protocol/errors";
import { attachLiveSession } from "../../computers/catalog-store";
import { setPhase } from "../../connection/connection-store";
import { bindPaneRefresh } from "../../connection/refresh-request";
import { applySnapshot } from "../../dashboard/catalog-store";
import { bindSessionOwnerFromLive } from "../bind-live";
import { composeDraft, composeIME, composeLive, setComposeDraft, setComposeFocused, setComposeLive } from "../compose-store";
import { clearModifiers } from "../keypad/keypad";
import { applyPaneRead, openPaneId, selectPane, setAgentChat, setFullTerminal, setTermSelect } from "../session-store";
import { handlePaneKey, setComposeLive as switchComposeLive } from "./compose";
import { guidedScrollController } from "./guided-scroll";
import { dropQueuedKeys, sendPage } from "./keys";
import { sendGuidedTuiScroll } from "./term";
import type { PaneModel } from "./pane-model";
import { SessionDock } from "./session-dock";
import { SessionPane } from "./session-pane";
import { cancelStop } from "./session-stop";

/**
 * Live input and IME composition: a composition always reaches the program
 * once, as the committed text. An input method that drops compositionend must
 * not leave text buffered forever, and composition text reported without
 * isComposing must not leak partial pinyin into the PTY.
 */
const handlers = { onBack() {}, onMenu() {}, onWorkspace() {} };
const parts = {
  Terminal: ({ model }: { model: PaneModel }) => <div data-testid="buffer">{model.texts.join("\n")}</div>,
  RowBar: () => null,
  Dock: SessionDock,
};
const snapshotRestorer = new WorkspaceSnapshotRestorer();
/** What was written to the session, in order: `T` text, `K` keys. */
let wire: string[] = [];
/** Text writes not acknowledged yet, oldest first. */
let slow: Array<{ ack: () => void; fail: (error: unknown) => void }> = [];
/** The wheel bridge's open, answered by the test. */
let opened: Array<(value: { terminalId: string }) => void> = [];
let release = () => {};

function paint(): HTMLTextAreaElement {
  happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
  bindSessionOwnerFromLive();
  act(() => {
    renderReact(<SessionPane key={openPaneId()} includeBack={false} handlers={handlers}
      scroll={{ top: 0, left: 0, bottom: true }} parts={parts} />);
  });
  return appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
}

function press(name: string, init: Record<string, unknown> = {}): void {
  const event = new happy.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }) as unknown as KeyboardEvent;
  act(() => { handlePaneKey(event, false); });
}

const settle = () => act(async () => { for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setTimeout(resolve, 0)); });
/** Acknowledge the oldest unacknowledged text write. */
const ack = async (): Promise<void> => { slow.shift()?.ack(); await settle(); };

beforeEach(async () => {
  await resetBoardTestDOM();
  resetInputMode();
  setLang("zh");
  wire = [];
  slow = [];
  opened = [];
  snapshotRestorer.capture();
  release = bindInputMode(document);
  bindPaneRefresh(async () => null);
  act(() => {
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    applyPaneRead("first output", "hash");
    setTermSelect(false);
    setAgentChat(false);
    setFullTerminal(false);
    setComposeLive(false);
    attachLiveSession({
      isConnected: () => true,
      sendText: (_pane: string, text: string) => {
        wire.push(`T${text}`);
        return Promise.resolve();
      },
      sendKeys: async (_pane: string, keys: string[]) => { wire.push(`K${keys.join(",")}`); },
      terminalOpen: () => new Promise<{ terminalId: string }>((resolve) => { opened.push(resolve); }),
      terminalScroll: async (_id: string, _sequence: number, direction: string, lines: number) => { wire.push(`W${direction}${lines}`); },
      terminalClose: async () => undefined,
    } as unknown as LiveSession);
    applySnapshot({
      workspaces: [{ workspace_id: "w1", label: "demo", cwd: "/repo/project" }],
      tabs: [{ tab_id: "t1", workspace_id: "w1", label: "main" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "t1", cwd: "/repo/project", agent: "codex", agent_status: "idle" }],
    });
  });
});

afterEach(async () => {
  for (const write of slow.splice(0)) write.ack();
  for (const open of opened.splice(0)) open({ terminalId: "t-end" });
  await settle();
  guidedScrollController.dispose();
  act(() => { unmountReact(); });
  release();
  resetInputMode();
  cancelStop();
  dropQueuedKeys();
  clearModifiers();
  act(() => { setComposeDraft(""); setComposeFocused(false); setComposeLive(false); clearNotice(); });
  setScreen("home");
  attachLiveSession(null);
  snapshotRestorer.restore();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});


const texts = () => wire.filter((w) => w.startsWith("T"));
function fire(field: HTMLTextAreaElement, type: string, init: Record<string, unknown> = {}): void {
  const W = window as unknown as Record<string, any>;
  const Ctor = type === "input" ? W.InputEvent : W.CompositionEvent ?? W.Event;
  act(() => { field.dispatchEvent(new Ctor(type, { bubbles: true, ...init })); });
}
async function live(): Promise<HTMLTextAreaElement> {
  paint();
  act(() => { setComposeLive(true); });
  await settle();
  return appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
}

test("a lost compositionend: the next non-composing input sends the text once and clears the field", async () => {
  const f = await live();
  fire(f, "compositionstart");
  f.value = "你好";
  fire(f, "input", { isComposing: false, inputType: "insertText", data: "你好" });
  await settle();
  expect(texts()).toEqual(["T你好"]);
  expect(composeIME()).toBe(false);
  expect(f.value).toBe("");
});

test("a normal composition is sent exactly once, at compositionend", async () => {
  const f = await live();
  fire(f, "compositionstart");
  f.value = "你好";
  fire(f, "input", { isComposing: true, inputType: "insertCompositionText", data: "你好" });
  fire(f, "compositionend", { data: "你好" });
  await settle();
  expect(texts()).toEqual(["T你好"]);
});

test("input while composing sends nothing", async () => {
  const f = await live();
  fire(f, "compositionstart");
  f.value = "ni";
  fire(f, "input", { isComposing: true, inputType: "insertCompositionText", data: "ni" });
  await settle();
  expect(texts()).toEqual([]);
  expect(f.value).toBe("ni");
});

test("composition text reported without isComposing never leaks partial pinyin", async () => {
  const f = await live();
  fire(f, "compositionstart");
  f.value = "n";
  fire(f, "input", { isComposing: false, inputType: "insertCompositionText", data: "n" });
  f.value = "ni";
  fire(f, "input", { isComposing: false, inputType: "insertCompositionText", data: "ni" });
  f.value = "你";
  fire(f, "compositionend", { data: "你" });
  await settle();
  expect(texts()).toEqual(["T你"]);
});

test("a late compositionend after the self-heal does not send twice", async () => {
  const f = await live();
  fire(f, "compositionstart");
  f.value = "你好";
  fire(f, "input", { isComposing: false, inputType: "insertText", data: "你好" });
  fire(f, "compositionend", { data: "你好" });
  await settle();
  expect(texts()).toEqual(["T你好"]);
});
