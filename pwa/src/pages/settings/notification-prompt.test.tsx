import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { attachLiveSession, setCredential } from "../../features/computers/catalog-store";
import { setPhase } from "../../features/connection/connection-store";
import { resetRuntime, setPushEnabled, setPushSubscribed } from "../../features/connection/runtime-store";
import { dismissNotifications, notificationsPending, offerNotifications } from "../../features/settings/notification-onboarding";
import { rememberPushConfig } from "../../features/settings/push-config";
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
let subscription: PushSubscription | null;
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
  subscription = null;
  const registration = { pushManager: {
    getSubscription: async () => subscription,
    subscribe: async () => {
      subscription = { options: { applicationServerKey: new Uint8Array([0]).buffer },
        toJSON: () => ({ endpoint: "https://push.example/id" }) } as PushSubscription;
      return subscription;
    },
  } };
  property(navigator, "serviceWorker", { ready: Promise.resolve(registration), getRegistration: async () => registration });
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

test("an existing subscription for another computer is not replaced or reported enabled", async () => {
  permissionResult = "granted";
  subscription = { options: { applicationServerKey: new Uint8Array([1]).buffer } } as PushSubscription;
  expect(await enablePush()).toBeFalse();
  expect(writes).toBe(0);
  expect(new Uint8Array(subscription.options.applicationServerKey!)[0]).toBe(1);
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
