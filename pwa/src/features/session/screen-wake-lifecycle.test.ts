import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { setScreen } from "../../app/navigation-store";
import { prepareFrame } from "../../app/frame-prepare";
import { publishAllDomains } from "../../app/domain-publication";
import { emptyEnvironment } from "../../shared/model/domain-environment";
import { focusBoard, selectBoardTab } from "../board/layout-store";
import { setPhase } from "../connection/connection-store";
import { attachLiveSession, credential, setCredential } from "../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { setOperationBusy } from "../operations/capabilities-store";
import { SCREEN_WAKE_KEY, hydratePreferences, setScreenWake } from "../settings/preferences-store";
import { selectPane, setAgentChat, setFullTerminal } from "./session-store";
import { bindScreenWake, screenWake, screenWakeMode } from "./screen-wake-lifecycle";

const foreign = new WorkspaceSnapshotRestorer();
let stop = () => {};
let savedCredential: ReturnType<typeof credential>;
let requestDescriptor: PropertyDescriptor | undefined;
let secureDescriptor: PropertyDescriptor | undefined;
let calls = 0;
let releases = 0;
let refuse = false;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const paint = () => { publishAllDomains(); prepareFrame(); };
/** p1 and p2 share tab t1; p3 is alone on t2. */
function seed(p1 = "idle", p2 = "idle") {
  replaceAgentsFromSnapshot({ session: "default", workspaces: [{ workspace_id: "w" }], panes: [
    { pane_id: "p1", workspace_id: "w", tab_id: "t1", agent: "codex", agent_status: p1, agent_instance_id: "agent-1", terminal_id: "term-1" },
    { pane_id: "p2", workspace_id: "w", tab_id: "t1", agent: "codex", agent_status: p2, agent_instance_id: "agent-2" },
    { pane_id: "p3", workspace_id: "w", tab_id: "t2", agent: "codex", agent_status: "idle", agent_instance_id: "agent-3" },
  ] });
  paint();
}
const status = () => screenWake.get().status;

beforeEach(async () => {
  await resetBoardTestDOM();
  await (await import("../../app/connected-loader")).loadConnectedRuntime();
  savedCredential = credential();
  foreign.capture();
  requestDescriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { async request() {
    calls++;
    if (refuse) throw new Error("denied");
    return { released: false, async release() { releases++; }, addEventListener() {}, removeEventListener() {} };
  } } });
  calls = releases = 0;
  refuse = false;
  setCredential({ daemonId: "wake-test", deviceId: "device", psk: new Uint8Array(), daemonPk: new Uint8Array() } as never);
  setPhase("live"); setScreen("pane"); selectPane("p1"); setFullTerminal(false); setAgentChat(false);
  attachLiveSession({ isConnected: () => true, herdSession: () => "default" } as never);
  setScreenWake("working");
  seed();
  stop = bindScreenWake();
});
afterEach(() => {
  stop();
  if (requestDescriptor) Object.defineProperty(navigator, "wakeLock", requestDescriptor);
  else Reflect.deleteProperty(navigator, "wakeLock");
  if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
  else Reflect.deleteProperty(window, "isSecureContext");
  setOperationBusy(false);
  setScreen("home"); selectPane(""); setAgentChat(false); setFullTerminal(false); attachLiveSession(null);
  setCredential(savedCredential);
  localStorage.removeItem(SCREEN_WAKE_KEY);
  hydratePreferences(emptyEnvironment());
  foreign.restore();
  publishAllDomains();
});

test("the open session holds the screen while its agent works; its chat and files share the hold, the list does not", async () => {
  expect(status()).toBe("off");
  expect(calls).toBe(0);
  seed("working"); await tick();
  expect(status()).toBe("active");
  setAgentChat(true); paint();
  setScreen("workspace"); paint();
  expect(status()).toBe("active");
  expect(calls).toBe(1);
  setScreen("pane"); paint();
  seed("done");
  expect(status()).toBe("off");
  expect(releases).toBe(1);
  seed("working"); await tick();
  expect(calls).toBe(2);
  setScreen("home"); paint();
  expect(status()).toBe("off");
  expect(releases).toBe(2);
});

test("another session's work does not hold the one on screen", async () => {
  seed("idle", "working"); await tick();
  expect(status()).toBe("off");
  selectPane("p2"); paint(); await tick();
  expect(status()).toBe("active");
});

test("the board holds while any pane on its tab works", async () => {
  setScreen("board"); focusBoard("w", "t1"); paint();
  expect(status()).toBe("off");
  seed("idle", "working"); await tick();
  expect(status()).toBe("active");
  selectBoardTab("t2"); paint();
  expect(status()).toBe("off");
  expect(releases).toBe(1);
});

test("always holds for any open session or board, never for the list or Settings", async () => {
  setScreenWake("always"); paint(); await tick();
  expect(status()).toBe("active");
  setScreen("board"); focusBoard("w", "t2"); paint();
  expect(status()).toBe("active");
  expect(calls).toBe(1);
  for (const screen of ["home", "settings"] as const) {
    setScreen(screen); paint();
    expect(status()).toBe("off");
    setScreen("board"); paint(); await tick();
    expect(status()).toBe("active");
  }
});

test("off holds for no work, yet a wait for a result holds whatever the choice", async () => {
  setScreenWake("off"); seed("working"); await tick();
  expect(status()).toBe("off");
  expect(calls).toBe(0);
  setScreen("home"); paint();
  setOperationBusy(true); paint(); await tick();
  expect(status()).toBe("active");
  setOperationBusy(false); paint();
  expect(status()).toBe("off");
  setPhase("pairing"); paint(); await tick();
  expect(status()).toBe("active");
  setPhase("live"); paint();
  expect(status()).toBe("off");
  expect(releases).toBe(2);
});

test("a replacement transport for the same session keeps the lock", async () => {
  seed("working"); await tick();
  attachLiveSession({ isConnected: () => true, herdSession: () => "default" } as never);
  paint();
  expect(status()).toBe("active");
  expect(calls).toBe(1);
});

test("a refusal stays known after the work is left, and the retry from Settings clears it once the system allows", async () => {
  refuse = true;
  seed("working"); await tick();
  expect(screenWake.get()).toEqual({ status: "unavailable", denied: true });
  setScreen("settings"); paint();
  expect(screenWake.get()).toEqual({ status: "off", denied: true });
  refuse = false;
  screenWake.retry(); await tick();
  expect(screenWake.get()).toEqual({ status: "off", denied: false });
  expect(releases).toBe(1);
});

test("before a choice the device's kind decides: a finger follows the work, a mouse leaves the display alone", () => {
  const original = window.matchMedia;
  try {
    window.matchMedia = ((query: string) => ({ matches: query.includes("pointer: fine") }) as MediaQueryList);
    expect(screenWakeMode(null)).toBe("off");
    window.matchMedia = (() => ({ matches: false }) as MediaQueryList);
    expect(screenWakeMode(null)).toBe("working");
    expect(screenWakeMode("always")).toBe("always");
  } finally {
    window.matchMedia = original;
  }
});
