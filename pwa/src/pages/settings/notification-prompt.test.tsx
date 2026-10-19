import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { installFakeServiceWorkers, type FakeServiceWorkers } from "../../../test-support/service-workers";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { attachLiveSession, setCredential } from "../../features/computers/catalog-store";
import { setPhase } from "../../features/connection/connection-store";
import { setScreen } from "../../app/navigation-store";
import { resetRuntime, setPushEnabled, setPushSubscribed } from "../../features/connection/runtime-store";
import { dismissNotifications, notificationsPending, offerNotifications } from "../../features/settings/notification-onboarding";
import { rememberPushConfig } from "../../features/settings/push-config";
import { computerPushScope } from "../../features/settings/push-registrations";
import { enablePush } from "../../features/settings/actions";
import type { LiveSession, PairResult } from "../../lib/protocol/client";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { t } from "../../lib/i18n";
import { NotificationPrompt } from "./notification-prompt";

const config = { protocol: 1, build: "1.0.0", daemon_id: "d_aaaaaaaaaaaaaaaaaaaa", hostname: "host", runtime: "herdr",
  vapid_public: "AA", submit_keys: ["Enter"], idle_pause_ms: 30_000, push_delivery: "webpush", push_enabled: true,
  capabilities: { ...NO_OPERATION_CAPABILITIES }, agent_kinds: [] };
let serial = 0;
let daemonId: string;
let permissionCalls: number;
let writes: number;
let reads: number;
let session: LiveSession;
let workers: FakeServiceWorkers;
let permissionResult: NotificationPermission;
let restore: Array<() => void>;

function property(object: object, key: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(object, key);
  restore.push(() => { if (previous) Object.defineProperty(object, key, previous); else Reflect.deleteProperty(object, key); });
  Object.defineProperty(object, key, { value, configurable: true });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  restore = [];
  daemonId = `prompt-test-${++serial}`;
  permissionCalls = writes = reads = 0;
  permissionResult = "denied";
  workers = installFakeServiceWorkers();
  restore.push(workers.restore);
  property(window, "PushManager", class {});
  const notification = { permission: "default", requestPermission: () => { permissionCalls++; return Promise.resolve(permissionResult); } };
  property(window, "Notification", notification);
  property(globalThis, "Notification", notification);
  session = { isConnected: () => true, getConfig: async () => { reads++; return config; },
    listDevices: async () => ({ devices: [] }), pushSubscribe: async () => { writes++; return {}; } } as unknown as LiveSession;
  attachLiveSession(session);
  setCredential({ daemonId } as PairResult);
  setPhase("live");
  resetRuntime();
  setPushEnabled(true);
  setPushSubscribed(false);
  rememberPushConfig(session, config);
  offerNotifications(daemonId);
});

afterEach(() => {
  unmountReact();
  setScreen("home");
  dismissNotifications(daemonId);
  attachLiveSession(null);
  setCredential(null);
  resetRuntime();
  for (const undo of restore.reverse()) undo();
});

test("pair invitation never requests permission by itself; Later persists across reconnect and another offer", () => {
  renderReact(<NotificationPrompt />);
  expect(document.querySelector(".notification-prompt")).not.toBeNull();
  expect(permissionCalls).toBe(0);
  const later = [...document.querySelectorAll(".notification-prompt button")].find(el => el.textContent === t("push.later")) as HTMLButtonElement;
  act(() => later.click());
  expect(notificationsPending(daemonId)).toBeFalse();
  act(() => { setPhase("resuming"); setPhase("live"); offerNotifications(daemonId); });
  expect(document.querySelector(".notification-prompt")).toBeNull();
  expect(permissionCalls).toBe(0);
});

test("permission request happens in the clicking task before a network wait; denial writes no subscription", async () => {
  const work = enablePush();
  expect(permissionCalls).toBe(1);
  expect(reads).toBe(0);
  expect(await work).toBeFalse();
  expect(writes).toBe(0);
});

test("a successful subscription is saved once and the invitation is dismissed", async () => {
  permissionResult = "granted";
  renderReact(<NotificationPrompt />);
  const enable = [...document.querySelectorAll(".notification-prompt button")].find(el => el.textContent === t("set.pushEnable")) as HTMLButtonElement;
  await act(async () => { enable.click(); });
  expect(writes).toBe(1);
  expect(notificationsPending(daemonId)).toBeFalse();
  expect(document.querySelector(".notification-prompt")).toBeNull();
});

test("another computer's subscription stays; this computer gets its own and saves it once", async () => {
  permissionResult = "granted";
  const other = workers.subscribe(workers.app, 1);
  expect(await enablePush()).toBeTrue();
  expect(writes).toBe(1);
  expect(workers.app.subscription).toBe(other);
  expect(workers.at(computerPushScope(config.daemon_id))!.subscription!.key).toBe(0);
});

test("a browser that cannot hold another subscription writes nothing and keeps the other computer's", async () => {
  permissionResult = "granted";
  const other = workers.subscribe(workers.app, 1);
  workers.failRegister = new Error("SecurityError");
  expect(await enablePush()).toBeFalse();
  expect(writes).toBe(0);
  expect(workers.app.subscription).toBe(other);
});

test("the invitation readies this computer's worker without asking for permission", async () => {
  workers.subscribe(workers.app, 1);
  renderReact(<NotificationPrompt />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(workers.registerCalls).toEqual([computerPushScope(config.daemon_id)]);
  expect(permissionCalls).toBe(0);
});

test("unsupported, disabled, already subscribed and unpaired surfaces have no invitation", () => {
  setPushEnabled(false);
  renderReact(<NotificationPrompt />);
  expect(document.querySelector(".notification-prompt")).toBeNull();
  act(() => { setPushEnabled(true); setPushSubscribed(true); });
  expect(document.querySelector(".notification-prompt")).toBeNull();
  act(() => { setPushSubscribed(false); setPhase("connect"); });
  expect(document.querySelector(".notification-prompt")).toBeNull();
});

test("Settings shows its own notification row, so the floating invitation steps aside there", () => {
  renderReact(<NotificationPrompt />);
  expect(document.querySelector(".notification-prompt")).not.toBeNull();
  act(() => setScreen("settings"));
  expect(document.querySelector(".notification-prompt")).toBeNull();
  act(() => setScreen("home"));
  expect(document.querySelector(".notification-prompt")).not.toBeNull();
  expect(notificationsPending(daemonId)).toBeTrue();
});
