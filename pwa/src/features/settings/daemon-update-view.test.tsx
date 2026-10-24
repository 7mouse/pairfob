import { expectSameNode } from "../../../test-support/node-identity";
import { expect, test, beforeEach, afterEach } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProtocolError } from "../../lib/protocol/errors";
import type { LiveSession } from "../../lib/protocol/session-types";

const { setCredential, attachLiveSession } = await import("../computers/catalog-store");
const { currentDaemonId } = await import("../computers/catalog-store");
const { setScreen, currentScreen } = await import("../../app/navigation-store");
const {
  acceptDaemonVersion, daemonVersion, refreshDaemonUpdate, startDaemonUpdate, checkDaemonRelease, markDaemonConfigIncompatible,
  UNCERTAIN_WAIT_MS,
} = await import("./daemon-update");
const { DaemonUpdate, DaemonUpdateRow, ManualUpdateHelp } = await import("./daemon-update-view");
const { setLang, t } = await import("../../lib/i18n");
const { operationCapabilities } = await import("../operations/capabilities-store");
const { pushEnabled } = await import("../connection/runtime-store");

/** Private owned root: no global renderer, no state facade. */
let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactNode): void {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
  }
  if (!root) root = createRoot(host);
  act(() => root!.render(node as React.ReactElement));
}
function paintDaemon(detailed = false): void {
  render(createElement(DaemonUpdate, { compact: !detailed }));
}
function paintManualHelp(): void {
  render(createElement(ManualUpdateHelp));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  setLang("zh");
  globalThis.fetch = (async () => new Response("1.1.0")) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
});
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
function visibility(value: string) {
  Object.defineProperty(happy.document, "visibilityState", { value, configurable: true });
  happy.document.dispatchEvent(new happy.Event("visibilitychange"));
}
afterEach(async () => {
  act(() => { visibility("hidden"); });
  Date.now = originalNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.fetch = originalFetch;
  act(() => {
    attachLiveSession(null);
    setCredential(null);
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  });
  setLang("zh");
  await act(async () => { await Promise.resolve(); });
});
let serial = 0;
function connect(rpc: Partial<LiveSession>, build = "1.0.0"): void {
  act(() => {
    setCredential({ daemonId: `update-test-${++serial}` } as never);
    setScreen("settings");
    attachLiveSession({ isConnected: () => true, ...rpc } as LiveSession);
    acceptDaemonVersion({ build });
  });
  globalThis.fetch = (async () => new Response("1.1.0")) as typeof fetch;
}
const idle = { available: true, phase: "idle", target: "", operation_id: "" };

test("legacy daemon offers a command, never an unsupported remote update", async () => {
  connect({ daemonUpdateStatus: async () => { throw new ProtocolError("unknown_op"); } }, "0.1.0");
  await act(async () => { await checkDaemonRelease(); });
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.textContent).toContain("pairfob update");
  expect(host!.querySelector(".daemon-update-version")?.textContent).toContain("无法确认实际版本");
  expect(host!.querySelector(".daemon-update-version")?.textContent).not.toContain("0.1.0");
  expect([...host!.querySelectorAll("button")].some(e => e.textContent === "更新电脑端")).toBeFalse();
});

test("concurrent clicks and unknown outcome do not replay the mutation", async () => {
  let writes = 0; let reject!: (e: Error) => void;
  connect({
    daemonUpdateStatus: async () => idle,
    daemonUpdate: async () => { writes += 1; return new Promise((_, r) => { reject = r; }); },
  });
  await act(async () => { await refreshDaemonUpdate(); });
  const first = startDaemonUpdate();
  await Promise.resolve();
  await act(async () => { await startDaemonUpdate(); });
  expect(writes).toBe(1);
  reject(new ProtocolError("unknown_outcome"));
  await first;
  await act(async () => { await refreshDaemonUpdate(); });
  await act(async () => { await startDaemonUpdate(); });
  expect(writes).toBe(1);
  expect(daemonVersion()?.uncertain).toBeTrue();
});

test("completion requires the target to be running", async () => {
  connect({ daemonUpdateStatus: async () => ({ ...idle, phase: "complete", target: "1.1.0", operation_id: "op_abcdefghijklmnop" }), getConfig: async () => ({ build: "1.0.0" }) });
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.textContent).toContain(t("update.waitConfirm", { version: "1.1.0", current: "1.0.0" }));
  expect(host!.textContent).not.toContain(t("update.complete", { version: "1.1.0" }));
});

test.each([false, true])("an older completed update is not a pending restart or fresh success (watched=%s)", async (watched) => {
  connect({ daemonUpdateStatus: async () => ({ ...idle, phase: "complete", target: "v1.4.4" }), getConfig: async () => ({ build: "v1.4.5" }) }, "v1.4.5");
  await act(async () => { await refreshDaemonUpdate(); });
  daemonVersion()!.watched = watched;
  paintDaemon(true);
  expect(host!.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("current");
  expect(host!.textContent).toContain("Pairfob 运行版本");
  expect(host!.textContent).toContain("v1.4.5");
  expect(host!.textContent).not.toContain("v1.4.4");
  expect(host!.textContent).not.toContain(t("update.complete", { version: "v1.4.5" }));
  globalThis.fetch = (async () => new Response("v1.4.6")) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  expect(host!.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("available");
  expect(host!.textContent).toContain(t("update.now", { version: "v1.4.6" }));
});

test("a completed target and release with different v prefixes are recognized as running and current", async () => {
  connect({ daemonUpdateStatus: async () => ({ ...idle, phase: "complete", target: "1.1.0" }), getConfig: async () => ({ build: "v1.1.0" }) }, "v1.1.0");
  await act(async () => { await refreshDaemonUpdate(); });
  daemonVersion()!.watched = true;
  paintDaemon(true);
  expect(host!.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("done");
  daemonVersion()!.watched = false;
  daemonVersion()!.checkedManually = true;
  await act(async () => { await checkDaemonRelease(true); });
  expect(host!.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("current");
  expect(host!.textContent).toContain(t("update.latest"));
});

test("previous computer status cannot overwrite the current view", async () => {
  let resolve!: (x: unknown) => void;
  connect({ daemonUpdateStatus: () => new Promise(r => { resolve = r; }) });
  connect({ daemonUpdateStatus: async () => idle }, "2.0.0");
  await act(async () => { await refreshDaemonUpdate(); });
  resolve({ ...idle, phase: "failed" });
  await Promise.resolve(); await Promise.resolve();
  expect(daemonVersion()?.build).toBe("2.0.0");
  expect(daemonVersion()?.status?.phase).toBe("idle");
});

test("config refresh during a mutation preserves its owner and clears pending state", async () => {
  for (const fails of [false, true]) {
    let finish!: (x: unknown) => void, reject!: (e: Error) => void;
    connect({
      daemonUpdateStatus: async () => idle,
      daemonUpdate: () => new Promise((r, j) => { finish = r; reject = j; }),
    });
    await act(async () => { await refreshDaemonUpdate(); });
    const pending = startDaemonUpdate();
    await Promise.resolve();
    const owner = daemonVersion();
    expect(owner?.requesting).toBeTrue();
    act(() => acceptDaemonVersion({ build: "1.0.0" }));
    expect(daemonVersion()).toBe(owner);
    if (fails) reject(new ProtocolError("unknown_outcome"));
    else finish({ ...idle, phase: "downloading", target: "1.1.0", operation_id: "op_abcdefghijklmnop" });
    await pending;
    expect(daemonVersion()?.requesting).toBeFalse();
    if (fails) expect(daemonVersion()?.uncertain).toBeTrue();
  }
});

test("manual check bypasses release cache and updates a mounted sidebar without repainting the pane", async () => {
  connect({ daemonUpdateStatus: async () => idle });
  await act(async () => { await checkDaemonRelease(true); });
  setScreen("pane");
  render(createElement(Fragment, null,
    createElement("textarea", { defaultValue: "unfinished draft" }),
    createElement(DaemonUpdate, { compact: true }),
  ));
  const input = host!.querySelector("textarea")!;
  globalThis.fetch = (async () => new Response("1.2.0")) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  expect(host!.textContent).toContain("1.2.0");
  expectSameNode(host!.querySelector("textarea"), input);
  expect(input.value).toBe("unfinished draft");
  paintDaemon(true);
  let reads = 0;
  globalThis.fetch = (async () => { reads += 1; return new Response("1.3.0"); }) as typeof fetch;
  const check = [...host!.querySelectorAll("button")].find(b => b.textContent === "检查更新")!;
  act(() => check.click());
  await act(async () => { await checkDaemonRelease(); });
  expect(reads).toBe(1);
  expect(daemonVersion()?.latest).toBe("1.3.0");
});

test("failed release checks retry after one minute instead of waiting six hours", async () => {
  connect({ daemonUpdateStatus: async () => idle });
  await act(async () => { await checkDaemonRelease(true); });
  const now0 = originalNow(); let now = now0;
  Date.now = () => now;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  expect(daemonVersion()?.error).toBeTrue();
  let reads = 0;
  globalThis.fetch = (async () => { reads += 1; return new Response("1.1.0"); }) as typeof fetch;
  await act(async () => { await checkDaemonRelease(); });
  expect(reads).toBe(0);
  now += 60001;
  await act(async () => { await checkDaemonRelease(); });
  expect(reads).toBe(1);
  expect(daemonVersion()?.error).toBeFalse();
});

test("visible pages check periodically and foreground resumes status reads without reconnecting", async () => {
  let statuses = 0;
  connect({ daemonUpdateStatus: async () => { statuses += 1; return { ...idle, phase: "downloading", target: "1.1.0", operation_id: "op_abcdefghijklmnop" }; } });
  await act(async () => { await refreshDaemonUpdate(); });
  await act(async () => { await checkDaemonRelease(true); });
  const timers = new Map<number, { fn: () => void; ms: number }>(); let id = 0;
  globalThis.setTimeout = ((fn: () => void, ms: number) => { timers.set(++id, { fn, ms }); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((tId: number) => { timers.delete(tId); }) as unknown as typeof clearTimeout;
  const now0 = originalNow(); let now = now0;
  Date.now = () => now;
  const before = statuses;
  visibility("visible");
  await act(async () => { await refreshDaemonUpdate(); });
  expect(statuses).toBeGreaterThan(before);
  expect([...timers.values()].some(t => t.ms === 3000)).toBeTrue();
  const periodic = [...timers.values()].find(t => t.ms > 60000)!;
  expect(periodic).toBeDefined();
  let reads = 0;
  globalThis.fetch = (async () => { reads += 1; return new Response("1.2.0"); }) as typeof fetch;
  now += 6 * 60 * 60 * 1000 + 1;
  periodic.fn();
  await act(async () => { await checkDaemonRelease(); });
  expect(reads).toBe(1);
  visibility("hidden");
  const paused = statuses;
  happy.window.dispatchEvent(new happy.Event("focus"));
  await Promise.resolve();
  expect(statuses).toBe(paused);
});

test("real config ingestion distinguishes legacy builds from rejected configs while capabilities fail closed", async () => {
  const { refreshHerdConfig } = await import("../connection/controller");
  for (const config of [null, [], { build: "0.1.0" }, { build: "1.0.0", protocol: 1 }]) {
    connect({ getConfig: async () => config as Record<string, unknown>, daemonUpdateStatus: async () => idle });
    await act(async () => { await refreshHerdConfig(); });
    await act(async () => { await refreshDaemonUpdate(); });
    expect(daemonVersion()?.incompatible).toBeTrue();
    expect(Object.values(operationCapabilities()).every(v => v === false)).toBeTrue();
    // Render with default props (<DaemonUpdate/>) to cover the default
    // compact=false detailed host as a caller would render it.
    render(createElement(DaemonUpdate));
    // The detailed marker is true and the same host carries no legacy marker.
    expect(host!.querySelector(".daemon-update-host")?.getAttribute("data-react-daemon-detailed")).toBe("true");
    expect(host!.querySelector(".daemon-update-host")?.hasAttribute("data-daemon-update")).toBe(false);
    if (config && "build" in config && config.build === "0.1.0") {
      expect(host!.textContent).toContain("pairfob update");
      expect(host!.textContent).not.toContain(t("update.reload"));
    } else {
      expect(host!.textContent).toContain(t("update.incompatibleNote"));
      expect(host!.textContent).toContain(t("update.reload"));
      expect(host!.textContent).not.toContain("pairfob update");
      expect(host!.textContent).not.toContain(t("update.needManual"));
    }
    expect([...host!.querySelectorAll("button")].some(b => b.textContent === "更新电脑端")).toBeFalse();
  }
});

test("a current computer with a rejected config directs every update surface to page recovery", async () => {
  let writes = 0;
  connect({ daemonUpdateStatus: async () => idle, daemonUpdate: async () => { writes++; return idle; } }, "1.1.0");
  await act(async () => { await refreshDaemonUpdate(); });
  act(() => markDaemonConfigIncompatible());
  for (const language of ["zh", "en"] as const) {
    act(() => setLang(language));
    render(createElement(DaemonUpdateRow));
    expect(host!.textContent).toContain(t("update.incompatibleTitle"));
    paintDaemon();
    expect(host!.textContent).toContain(t("update.incompatibleTitle"));
    expect(host!.textContent).toContain(t("update.viewCompatibility"));
    expect(host!.textContent).not.toContain(t("update.legacyTitle"));
    paintDaemon(true);
    expect(host!.textContent).toContain("1.1.0");
    expect(host!.textContent).toContain(t("update.incompatibleNote"));
    expect(host!.textContent).not.toContain(t("update.latest"));
    expect(host!.textContent).not.toContain(t("update.needManual"));
  }
  await act(async () => { await startDaemonUpdate(); });
  expect(writes).toBe(0);
  // A release-fetch failure must not hide an independently known config issue.
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  expect(host!.textContent).toContain(t("update.incompatibleNote"));
});

test("page refresh stays on screen after a network failure and allows a retry", async () => {
  connect({ daemonUpdateStatus: async () => idle }, "1.1.0");
  await act(async () => { await refreshDaemonUpdate(); });
  act(() => markDaemonConfigIncompatible());
  paintDaemon(true);
  let reads = 0;
  let reject!: (error: Error) => void;
  globalThis.fetch = (() => { reads++; return new Promise((_, fail) => { reject = fail; }); }) as typeof fetch;
  const refresh = host!.querySelector<HTMLButtonElement>(".page-refresh button")!;
  const url = window.location.href;
  act(() => { refresh.click(); refresh.click(); });
  expect(reads).toBe(1);
  expect(refresh.disabled).toBeTrue();
  expect(refresh.textContent).toBe(t("update.reloading"));
  await act(async () => { reject(new Error("offline")); });
  expect(window.location.href).toBe(url);
  expect(refresh.disabled).toBeFalse();
  expect(host!.querySelector('[role="alert"]')?.textContent).toBe(t("update.reloadFailed"));
  act(() => refresh.click());
  expect(reads).toBe(2);
  await act(async () => { reject(new Error("offline")); });
});

test("offline settings and computer help offer manual upgrade without claiming a new version", () => {
  act(() => { setCredential({ daemonId: "never-connected" } as never); attachLiveSession(null); });
  paintDaemon(true);
  expect(host!.textContent).toContain("pairfob update");
  expect(host!.textContent).not.toContain("电脑端有更新");
  paintManualHelp();
  expect(host!.textContent).toContain("网络或电脑离线");
});

test("entering settings reads a very old config independently of push capability validation", async () => {
  const { refreshSettings } = await import("./actions");
  connect({
    listDevices: async () => ({ devices: [] }),
    getConfig: async () => ({ build: "0.1.0" }),
    daemonUpdateStatus: async () => { throw new ProtocolError("unknown_op"); },
  });
  await act(async () => { await refreshSettings(); });
  expect(daemonVersion()?.build).toBe("0.1.0");
  expect(daemonVersion()?.incompatible).toBeTrue();
  expect(pushEnabled() === null).toBe(true);
  paintDaemon(true);
  expect(host!.textContent).toContain("pairfob update");
});

test("release check has a visible busy state and explicit success or failure feedback", async () => {
  connect({ daemonUpdateStatus: async () => idle }, "1.1.0");
  await act(async () => { await checkDaemonRelease(true); });
  paintDaemon(true);
  let finish!: (r: Response) => void;
  globalThis.fetch = (() => new Promise(r => { finish = r; })) as typeof fetch;
  act(() => host!.querySelector<HTMLButtonElement>(".daemon-update-check")!.click());
  const pending = checkDaemonRelease();
  const busy = host!.querySelector<HTMLButtonElement>(".daemon-update-check")!;
  expect(busy.disabled).toBeTrue();
  expect(busy.textContent).toContain("正在检查");
  expect(busy.classList.contains("btn-ghost")).toBeFalse();
  // The button says it is checking; the stage stays quiet until there is an answer.
  expect(host!.querySelector(".daemon-update-feedback")).toBeNull();
  await act(async () => { finish(new Response("1.1.0")); await pending; });
  expect(host!.querySelector<HTMLButtonElement>(".daemon-update-check")?.disabled).toBeFalse();
  expect(host!.querySelector('[data-tone="ok"]')?.textContent).toContain("已是最新版本");
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  expect(host!.querySelector('[data-tone="error"]')?.textContent).toContain("检查失败");
  expect(host!.querySelector('[data-tone="ok"]')).toBeNull();
  // After a failed check the reader asked for, the same button offers the retry.
  expect(host!.querySelector(".daemon-update-check")?.textContent).toBe(t("update.retryCheck"));
  paintDaemon(true);
  expect(host!.querySelector('[data-tone="error"]')?.textContent).toContain("检查失败");
});

test("update copy follows the selected language", async () => {
  connect({ daemonUpdateStatus: async () => idle }, "1.1.0");
  await act(async () => { await checkDaemonRelease(true); });
  setLang("en");
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update-check")?.textContent).toBe("Check for updates");
  expect(host!.textContent).toContain("Pairfob running version");
});

test("routine settings version stays compact even when background checks fail", async () => {
  connect({ daemonUpdateStatus: async () => idle }, "ad27e83");
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await act(async () => { await checkDaemonRelease(true); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update-version-row")?.textContent).toContain("ad27e83");
  expect(host!.querySelector(".daemon-update-check")?.textContent).toBe("检查更新");
  expect(host!.querySelector(".daemon-update-feedback")).toBeNull();
  expect(host!.querySelector(".set-card")).toBeNull();
});

test("a compact banner can be postponed without a remote mutation", async () => {
  connect({ daemonUpdateStatus: async () => idle });
  await act(async () => { await checkDaemonRelease(); });
  await act(async () => { await refreshDaemonUpdate(); });
  render(createElement(DaemonUpdate, { compact: true }));
  expect(host!.textContent).toContain("电脑端有更新");
  expect(host!.querySelector(".daemon-update-host")?.getAttribute("data-react-daemon-detailed")).toBe("false");
  // The host carries the typed daemon attribute, never the legacy data- marker.
  expect(host!.querySelector(".daemon-update-host")?.hasAttribute("data-react-daemon-update")).toBe(true);
  expect(host!.querySelector(".daemon-update-host")?.hasAttribute("data-daemon-update")).toBe(false);
  // Capture the exact key this case writes (latest confirmed by the release
  // check above) and its pre-existing value, so cleanup restores only our own
  // record in finally (even on failure) instead of scanning the prefix.
  const ownKey = `pairfob-update-later:${currentDaemonId()}:${daemonVersion()!.latest}`;
  const ownValue = localStorage.getItem(ownKey);
  try {
    // Postponing hides the compact banner synchronously and starts no update.
    const later = [...host!.querySelectorAll("button")].find(b => b.textContent === "明天提醒")!;
    act(() => { later.click(); });
    expect(host!.querySelector("section.daemon-update")).toBeNull();
    expect(host!.querySelector<HTMLElement>(".daemon-update-host")?.hidden).toBeTrue();
    expect(daemonVersion()?.requesting).toBeFalsy();
    expect(localStorage.getItem(ownKey)).not.toBeNull();
  } finally {
    if (ownValue === null) localStorage.removeItem(ownKey); else localStorage.setItem(ownKey, ownValue);
  }
});

test("daemon update subscription preserves the React host across a release check", async () => {
  connect({ daemonUpdateStatus: async () => idle }, "1.1.0");
  await act(async () => { await checkDaemonRelease(true); });
  // Detailed body renders the host with the check button.
  paintDaemon(true);
  const updateHost = host!.querySelector(".daemon-update-host");
  expect(updateHost?.hasAttribute("data-react-daemon-update")).toBe(true);
  expect(updateHost?.hasAttribute("data-daemon-update")).toBe(false);
  const check = updateHost?.querySelector(".daemon-update-check");
  expect(check).toBeTruthy();
  await act(async () => { await checkDaemonRelease(true); });
  // The same host and check node survive the subscription update.
  expectSameNode(host!.querySelector(".daemon-update-host")?.querySelector(".daemon-update-check"), check);
  expect(host!.querySelector("[data-daemon-update]")).toBeNull();
});

test("copying the update command is confirmed in the button's own room; a refusal is said in full", async () => {
  paintManualHelp();
  const button = host!.querySelector<HTMLButtonElement>(".command-copy")!;
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { written.push(text); } }, configurable: true });
  await act(async () => button.click());
  expect(written).toEqual(["pairfob update"]);
  expectSameNode(host!.querySelector(".command-copy"), button);
  expect(button.querySelector(".copy-ack")?.getAttribute("data-state")).toBe("copied");
  expect(button.querySelector('.copy-ack-face[aria-hidden="false"]')?.textContent).toBe(t("update.copied"));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
  await act(async () => button.click());
  expect(button.querySelector(".copy-ack")?.getAttribute("data-state")).toBe("failed");
  expect(button.querySelector('.copy-ack-face[aria-hidden="false"]')?.textContent).toBe(t("update.copyManual"));
});

test("the persistent manual update copy label follows the language on the same node", () => {
  paintManualHelp();
  // The copy button is the ManualUpdateHelp button; its label is the
  // copy-command text (pairfob update lives in the <code> element).
  const before = host!.querySelector("button")!;
  // The button holds its resting label and its confirmation in one cell; the one showing is its label.
  const label = () => before.querySelector('.copy-ack-face[aria-hidden="false"]')?.textContent;
  expect(before.querySelector(".copy-ack")?.getAttribute("data-state")).toBe("idle");
  expect(label()).toBe(t("update.copyCommand"));
  expect(host!.querySelector("code")?.textContent).toContain("pairfob update");
  act(() => setLang("en"));
  act(() => { root!.render(createElement(ManualUpdateHelp)); });
  expectSameNode(host!.querySelector("button"), before);
  expect(label()).toBe(t("update.copyCommand"));
  expect(label()).not.toBe("复制更新命令");
  act(() => setLang("zh"));
  act(() => { root!.render(createElement(ManualUpdateHelp)); });
});

test("the manual update help is a disclosure that says so: its question ends in the family's chevron", () => {
  paintManualHelp();
  const help = host!.querySelector("details.daemon-update-help")!;
  const summary = help.querySelector("summary")!;
  expect(help.hasAttribute("open")).toBe(false);
  expect(summary.textContent).toBe(t("update.helpTitle"));
  // Decoration beside the words: it adds nothing to the summary's name.
  const chevron = summary.querySelector("svg.set-disclosure")!;
  expect(chevron.getAttribute("aria-hidden")).toBe("true");
  expectSameNode(summary.lastElementChild, chevron);
  // The same row inside the computer page's card.
  render(createElement(ManualUpdateHelp, { inline: true }));
  expect(host!.querySelector("details.set-item-block summary svg.set-disclosure")).toBeTruthy();
});

test("compact later hides even when browser storage is unavailable", async () => {
  connect({ daemonUpdateStatus: async () => idle });
  await act(async () => { await checkDaemonRelease(); });
  await act(async () => { await refreshDaemonUpdate(); });
  render(createElement(DaemonUpdate, { compact: true }));
  expect(host!.querySelector("section.daemon-update")).not.toBeNull();
  // Intercept the global localStorage descriptor with a forwarding proxy: only
  // setItem throws (proving the postpone catch path actually runs), while every
  // other method binds to and forwards to the original storage. Happy DOM caches
  // the prototype Storage getter, so replacing the prototype descriptor alone
  // does not take effect.
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  const originalStorage = localStorage;
  const failedWrites: unknown[] = [];
  const failingStorage: Storage = new Proxy(originalStorage, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "setItem") {
        return (...args: unknown[]) => {
          failedWrites.push(args[0]);
          throw new Error("storage unavailable");
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  Object.defineProperty(globalThis, "localStorage", { ...originalStorageDescriptor, value: failingStorage, configurable: true });
  try {
    const later = [...host!.querySelectorAll("button")].find(b => b.textContent === "明天提醒")!;
    act(() => { later.click(); });
    // The write was attempted (the catch path ran) and the banner still hides
    // without starting an update.
    expect(failedWrites).toHaveLength(1);
    expect(host!.querySelector("section.daemon-update")).toBeNull();
    expect(host!.querySelector<HTMLElement>(".daemon-update-host")?.hidden).toBeTrue();
    expect(daemonVersion()?.requesting).toBeFalsy();
  } finally {
    Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
    expect(globalThis.localStorage).toBe(originalStorage);
  }
});

const running = (phase: string) => ({ available: true, phase, target: "1.1.0", operation_id: "op_abcdefghijklmnop" });
const buttons = () => [...host!.querySelectorAll("button")].map(b => b.textContent);

test("an available update says the move, its effect and one action naming the target", async () => {
  connect({ daemonUpdateStatus: async () => idle });
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("available");
  expect(host!.querySelector(".daemon-update-diff")?.textContent).toBe("1.0.0→1.1.0");
  expect(host!.textContent).toContain(t("update.effect"));
  expect(host!.querySelector(".daemon-update-start")?.textContent).toBe(t("update.now", { version: "1.1.0" }));
  // The manual commands are folded, not a second path beside the button.
  const manual = host!.querySelector<HTMLDetailsElement>("details.daemon-update-manual")!;
  expect(manual.open).toBeFalse();
  expect(manual.querySelectorAll(".command-line code").length).toBe(2);
  expect([...manual.querySelectorAll(".command-line code")].map(c => c.textContent)).toEqual(["pairfob update", "pairfob setup --update-herdr"]);
});

test("a running update shows its three steps and no action at all", async () => {
  for (const [phase, done] of [["downloading", 0], ["restarting", 1], ["verifying", 2]] as const) {
    connect({ daemonUpdateStatus: async () => running(phase) });
    await act(async () => { await refreshDaemonUpdate(); });
    paintDaemon(true);
    const steps = [...host!.querySelectorAll(".daemon-update-steps li")];
    expect(steps.map(s => s.getAttribute("data-state"))).toEqual(["done", "done", "done"].map((_, i) => i < done ? "done" : i === done ? "now" : "next"));
    expect(steps[done]!.getAttribute("aria-current")).toBe("step");
    // No update, refresh or check button while it runs: only the folded commands' copy buttons.
    expect(host!.querySelector(".daemon-update-start, .daemon-update-check")).toBeNull();
    expect(buttons().every(label => label?.startsWith(t("update.copyCommand")))).toBeTrue();
  }
});

test("an unconfirmed request only waits and says it will not be sent again", async () => {
  let writes = 0;
  connect({ daemonUpdateStatus: async () => idle, daemonUpdate: async () => { writes++; throw new ProtocolError("unknown_outcome"); } });
  await act(async () => { await refreshDaemonUpdate(); });
  await act(async () => { await startDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("uncertain");
  expect(host!.textContent).toContain(t("update.uncertainNote"));
  expect(host!.querySelector(".daemon-update-start, .daemon-update-check")).toBeNull();
  expect(writes).toBe(1);
});

test("a failed or rolled back update offers a retry and opens the manual commands", async () => {
  for (const phase of ["failed", "rolled_back"] as const) {
    connect({ daemonUpdateStatus: async () => running(phase) });
    await act(async () => { await refreshDaemonUpdate(); });
    paintDaemon(true);
    expect(host!.querySelector('[data-tone="error"]')?.textContent)
      .toBe(phase === "failed" ? t("update.failed") : t("update.rolledBack", { version: "1.0.0" }));
    expect(host!.querySelector(".daemon-update-start")?.textContent).toBe(t("update.retry"));
    expect(host!.querySelector<HTMLDetailsElement>("details.daemon-update-manual")!.open).toBeTrue();
  }
});

test("a finished update is news once: watched, it says so; met later, the card is quiet", async () => {
  let phase = "downloading";
  connect({ daemonUpdateStatus: async () => running(phase), getConfig: async () => ({ build: "1.1.0" }) });
  await act(async () => { await refreshDaemonUpdate(); });
  phase = "complete";
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector('[data-tone="ok"]')?.textContent).toBe(t("update.complete", { version: "1.1.0" }));
  expect(host!.querySelector(".daemon-update-version code")?.textContent).toBe("1.1.0");
  act(() => { root!.unmount(); root = null; });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("current");
  expect(host!.querySelector(".daemon-update-detail")).toBeNull();
  // A computer met already updated, with no update seen here, shows nothing either.
  connect({ daemonUpdateStatus: async () => running("complete") }, "1.1.0");
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update-detail")).toBeNull();
});

test("a computer without the update operation gets the command as the answer, once", async () => {
  connect({ daemonUpdateStatus: async () => { throw new ProtocolError("unknown_op"); } });
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("manual");
  expect(host!.querySelector(".daemon-update-detail .command-line code")?.textContent).toBe("pairfob update");
  // The folded row keeps only Herdr and is named after it.
  const manual = host!.querySelector("details.daemon-update-manual")!;
  expect(manual.querySelector("summary")?.textContent).toBe(t("update.herdrTitle"));
  // The row is named after Herdr already: its one section does not say the name again.
  expect(manual.querySelector(".daemon-update-command-label")?.textContent).toBe(t("update.herdrHint"));
  expect([...host!.querySelectorAll(".command-line code")].filter(c => c.textContent === "pairfob update")).toHaveLength(1);
});

test("the sidebar banner says the update is running and stops offering to postpone it", async () => {
  connect({ daemonUpdateStatus: async () => running("restarting") });
  await act(async () => { await refreshDaemonUpdate(); });
  render(createElement(DaemonUpdate, { compact: true }));
  expect(host!.querySelector("section.daemon-update strong")?.textContent).toBe(t("set.updating"));
  expect(buttons()).toEqual([t("update.viewProgress")]);
});

test("an unanswered request holds the button back, and gives it back once the computer never showed that update", async () => {
  let writes = 0, phase = "idle";
  connect({
    daemonUpdateStatus: async () => (phase === "idle" ? idle : running(phase)),
    daemonUpdate: async () => { writes++; throw new ProtocolError("unknown_outcome"); },
  });
  await act(async () => { await refreshDaemonUpdate(); });
  const now0 = originalNow(); let now = now0;
  Date.now = () => now;
  await act(async () => { await startDaemonUpdate(); });
  paintDaemon(true);
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("uncertain");
  // Inside the wait a status read changes nothing and a second start sends nothing.
  now += UNCERTAIN_WAIT_MS - 1;
  await act(async () => { await refreshDaemonUpdate(); });
  await act(async () => { await startDaemonUpdate(); });
  expect(writes).toBe(1);
  expect(daemonVersion()?.uncertain).toBeTrue();
  // Past it, with no update shown, the reader has the button back and a note saying why.
  now += 2;
  await act(async () => { await refreshDaemonUpdate(); });
  expect(daemonVersion()?.uncertain).toBeFalse();
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("available");
  expect(host!.querySelector('[data-tone="warn"]')?.textContent).toBe(t("update.unconfirmed"));
  expect(host!.querySelector<HTMLButtonElement>(".daemon-update-start")!.disabled).toBeFalse();
  // Nothing went out on its own: the next request is the reader's.
  expect(writes).toBe(1);
  await act(async () => { await startDaemonUpdate(); });
  expect(writes).toBe(2);
  expect(daemonVersion()?.unconfirmed).toBeFalse();
});

test("a late update that does show up ends the wait as progress, not as a fresh offer", async () => {
  let phase = "idle";
  connect({
    daemonUpdateStatus: async () => (phase === "idle" ? idle : running(phase)),
    daemonUpdate: async () => { throw new ProtocolError("unknown_outcome"); },
  });
  await act(async () => { await refreshDaemonUpdate(); });
  const now0 = originalNow(); let now = now0;
  Date.now = () => now;
  await act(async () => { await startDaemonUpdate(); });
  now += UNCERTAIN_WAIT_MS + 1;
  phase = "downloading";
  await act(async () => { await refreshDaemonUpdate(); });
  paintDaemon(true);
  expect(daemonVersion()?.uncertain).toBeFalse();
  expect(daemonVersion()?.unconfirmed).toBeFalsy();
  expect(host!.querySelector(".daemon-update")?.getAttribute("data-stage")).toBe("busy");
});
