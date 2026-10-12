import { afterEach, beforeEach, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { setScreen } from "../../app/navigation-store";
import { prepareFrame } from "../../app/frame-prepare";
import { publishAllDomains } from "../../app/domain-publication";
import { setPhase } from "../connection/connection-store";
import { attachLiveSession, credential, setCredential } from "../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { selectPane, setAgentChat, setFullTerminal } from "./session-store";
import { bindScreenWake, screenWake, screenWakeScope } from "./screen-wake-lifecycle";

const foreign = new WorkspaceSnapshotRestorer();
let stop = () => {};
let savedCredential: ReturnType<typeof credential>;
let requestDescriptor: PropertyDescriptor | undefined;
let secureDescriptor: PropertyDescriptor | undefined;
let calls = 0;
let releases = 0;
let herd = "default";
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const paint = () => { publishAllDomains(); prepareFrame(); };
function seed(instance = "agent-1", terminal = "term-1") {
  replaceAgentsFromSnapshot({ session: herd, workspaces: [{ workspace_id: "w" }], panes: [
    { pane_id: "p1", workspace_id: "w", agent: "codex", agent_instance_id: instance, terminal_id: terminal },
    { pane_id: "p2", workspace_id: "w", agent: "codex", agent_instance_id: "agent-2" },
  ] });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  savedCredential = credential();
  foreign.capture();
  requestDescriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { async request() {
    calls++;
    return { released: false, async release() { releases++; }, addEventListener() {}, removeEventListener() {} };
  } } });
  calls = releases = 0;
  herd = "default";
  setCredential({ daemonId: "wake-test", deviceId: "device", psk: new Uint8Array(), daemonPk: new Uint8Array() } as never);
  setPhase("live"); setScreen("pane"); selectPane("p1"); setFullTerminal(false); setAgentChat(false);
  attachLiveSession({ isConnected: () => true, herdSession: () => herd } as never);
  seed(); paint();
  stop = bindScreenWake();
});
afterEach(() => {
  stop();
  if (requestDescriptor) Object.defineProperty(navigator, "wakeLock", requestDescriptor);
  else Reflect.deleteProperty(navigator, "wakeLock");
  if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
  else Reflect.deleteProperty(window, "isSecureContext");
  setScreen("home"); selectPane(""); setAgentChat(false); setFullTerminal(false); attachLiveSession(null);
  setCredential(savedCredential);
  foreign.restore();
  publishAllDomains();
});

test("chat and files share the current visit; leaving for a root ends it even with a selected desktop pane", async () => {
  screenWake.setEnabled(true); await tick();
  expect(screenWake.get().status).toBe("active");
  const scope = screenWakeScope();
  setAgentChat(true); paint();
  expect(screenWakeScope()).toBe(scope);
  setScreen("workspace"); paint();
  expect(screenWake.get().status).toBe("active");
  expect(calls).toBe(1);
  setScreen("pane"); paint();
  happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
  setScreen("home"); paint();
  expect(screenWake.get().enabled).toBeFalse();
  expect(releases).toBe(1);
  setScreen("pane"); paint();
  expect(screenWake.get().status).toBe("off");
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

test("another computer, runtime, pane or occupant never inherits a lock", async () => {
  for (const change of [
    () => setCredential({ ...credential()!, daemonId: "wake-other" }),
    () => { herd = "another"; },
    () => seed("replacement"),
    () => seed("replacement", "replacement-terminal"),
    () => selectPane("p2"),
  ]) {
    screenWake.setEnabled(true); await tick();
    expect(screenWake.get().status).toBe("active");
    change(); paint();
    expect(screenWake.get().enabled).toBeFalse();
  }
  expect(releases).toBe(5);
});

test("a replacement transport for the same runtime and pane retains the lock", async () => {
  screenWake.setEnabled(true); await tick();
  attachLiveSession({ isConnected: () => true, herdSession: () => herd } as never);
  paint();
  expect(screenWake.get().status).toBe("active");
  expect(calls).toBe(1);
});
