import { t } from "../../lib/i18n";
import { subscriptionMatches } from "./push-config";

/**
 * Which service worker registration holds which computer's push subscription.
 *
 * A browser keeps one push subscription per registration, bound to one VAPID
 * key, and every computer signs with its own key. The app's registration serves
 * the first computer that turns notifications on, exactly as before; each
 * further computer gets the same worker registered at a scope of its own that
 * no page ever loads.
 */

const DAEMON_ID = /^d_[0-9a-f]{20}$/;
const WORKER = "/sw.js";
const ACTIVATION_TIMEOUT_MS = 15_000;

export const computerPushScope = (daemonId: string) => `/pair/push/${daemonId}/`;

export function vapidKey(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

async function computerRegistration(daemonId: string): Promise<ServiceWorkerRegistration | undefined> {
  if (!DAEMON_ID.test(daemonId)) return undefined;
  const scope = new URL(computerPushScope(daemonId), location.origin).href;
  // getRegistration(url) falls back to an enclosing scope; only an exact match is this computer's.
  return (await navigator.serviceWorker.getRegistrations()).find(registration => registration.scope === scope);
}

function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.reject(new Error("push worker missing"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("push worker did not activate")), ACTIVATION_TIMEOUT_MS);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve(registration);
      } else if (worker.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("push worker became redundant"));
      }
    });
  });
}

/** This computer's subscription in this browser, or null when none was made with its key. */
export async function computerSubscription(
  app: ServiceWorkerRegistration, daemonId: string, key: string,
): Promise<PushSubscription | null> {
  for (const registration of [await computerRegistration(daemonId), app]) {
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription && subscriptionMatches(subscription, key)) return subscription;
  }
  return null;
}

/**
 * Register this computer's worker before the tap that subscribes it: WebKit
 * gives a tap a short activation window, and installing a worker can outlast
 * it. Only a computer that cannot use the app's registration needs one. An
 * existing one is asked to update, since no page load ever does that for it.
 */
export async function preparePushRegistration(app: ServiceWorkerRegistration, daemonId: string, key: string): Promise<void> {
  if (!DAEMON_ID.test(daemonId)) return;
  const existing = await computerRegistration(daemonId);
  if (existing) {
    await existing.update();
    return;
  }
  const taken = await app.pushManager.getSubscription();
  if (!taken || subscriptionMatches(taken, key)) return;
  await navigator.serviceWorker.register(WORKER, { scope: computerPushScope(daemonId) });
}

/**
 * This computer's subscription, made if it has none: on the app's registration
 * while that is free, otherwise on the computer's own. When the browser cannot
 * hold a second subscription, the app's subscription is left alone and the
 * caller gets a message that says so.
 */
export async function subscribeComputer(app: ServiceWorkerRegistration, daemonId: string, key: string): Promise<PushSubscription> {
  const existing = await computerSubscription(app, daemonId, key);
  if (existing) return existing;
  const options = { userVisibleOnly: true, applicationServerKey: vapidKey(key) };
  if (!(await app.pushManager.getSubscription())) return app.pushManager.subscribe(options);
  if (!DAEMON_ID.test(daemonId)) throw new Error(t("push.otherComputer"));
  try {
    const registration = await activated((await computerRegistration(daemonId))
      ?? await navigator.serviceWorker.register(WORKER, { scope: computerPushScope(daemonId) }));
    // A subscription here under another key is from before this computer's key changed; it can no longer deliver.
    await (await registration.pushManager.getSubscription())?.unsubscribe();
    return await registration.pushManager.subscribe(options);
  } catch (error) {
    throw new Error(t("push.otherComputer"), { cause: error });
  }
}

/** Unregistering a forgotten computer's worker drops its subscription with it. */
export async function forgetComputerPush(daemonId: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await (await computerRegistration(daemonId))?.unregister();
}
