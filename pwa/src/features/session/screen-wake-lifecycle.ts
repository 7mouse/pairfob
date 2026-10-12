import { getAppFrame, subscribeAppFrame } from "../../app/frame";
import { pointerFine } from "../../app/input-mode";
import { navigationStore } from "../../app/navigation-store";
import { updateInProgress } from "../../lib/daemon-update-status";
import { boardStore } from "../board/layout-store";
import { computersStore } from "../computers/catalog-store";
import { connectionStore } from "../connection/connection-store";
import { dashboardStore } from "../dashboard/catalog-store";
import { capabilitiesStore } from "../operations/capabilities-store";
import { daemonVersion, subscribeDaemonUpdates } from "../settings/daemon-update";
import { preferencesStore, type ScreenWakeMode } from "../settings/preferences-store";
import { sessionStore } from "./session-store";
import { createScreenWake, type WakeSnapshot } from "./screen-wake";

type Controller = ReturnType<typeof createScreenWake>;
let controller: Controller | null = null;
// Nothing can hold a lock before the application binds one.
const unbound: WakeSnapshot = { status: "unsupported", denied: false };
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export const screenWake = {
  get: () => controller?.get() ?? unbound,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  retry: () => controller?.retry(),
};

/**
 * This device's choice, or its kind's default before one is made. A screen
 * worked by a finger sleeps in the hand or on a stand, so it follows the work;
 * a display driven by a mouse is left to its owner's own settings.
 */
export function screenWakeMode(chosen: ScreenWakeMode | null = preferencesStore.get().screenWake): ScreenWakeMode {
  return chosen ?? (pointerFine() ? "off" : "working");
}

/** The session on screen: the pane itself, its chat, or its files. */
function openAgent() {
  const screen = navigationStore.get().screen;
  const frame = getAppFrame();
  if (screen !== "pane" && screen !== "workspace") return null;
  if (!frame.session && frame.layout?.mode !== "workspace") return null;
  const paneId = sessionStore.get().paneId;
  if (!paneId || !computersStore.get().credential) return null;
  return dashboardStore.get().agents.find(item => item.paneId === paneId) ?? null;
}

/** A result the reader is waiting on: pairing, a requested mutation, the computer's update. */
function awaitingResult(): boolean {
  const update = daemonVersion();
  return connectionStore.get().phase === "pairing" || capabilitiesStore.get().operationBusy
    || update?.requesting === true || updateInProgress(update?.status);
}

/**
 * Whether what is on screen is being watched. The session and the board are
 * where work is watched; the list is passed through, and notifications say who
 * needs the reader there. A short wait for a result holds the screen whatever
 * the choice, and ends with the wait.
 */
export function screenWakeWanted(mode: ScreenWakeMode = screenWakeMode()): boolean {
  if (awaitingResult()) return true;
  if (mode === "off") return false;
  if (navigationStore.get().screen === "board") {
    const tabId = boardStore.get().boardTabId;
    return mode === "always" || (!!tabId && dashboardStore.get().agents.some(agent => agent.tabId === tabId && agent.status === "working"));
  }
  const agent = openAgent();
  return !!agent && (mode === "always" || agent.status === "working");
}

/** Installed with the application, including QA; the parent page owns the lock. */
export function bindScreenWake(): () => void {
  const owned = createScreenWake(window.isSecureContext && navigator.wakeLock
    ? () => navigator.wakeLock.request("screen") : null);
  controller = owned;
  const stopNotify = owned.subscribe(notify);
  let hidden = false;
  const sync = () => {
    // Visibility first: a request made from a hidden page is refused, and that is not the system's answer.
    owned.setVisible(!hidden && document.visibilityState === "visible");
    owned.setWanted(screenWakeWanted());
  };
  const hide = () => { hidden = true; sync(); };
  const show = () => { hidden = false; sync(); };
  const stops = [subscribeAppFrame(sync), subscribeDaemonUpdates(sync),
    ...[navigationStore, computersStore, dashboardStore, sessionStore, boardStore, connectionStore, capabilitiesStore, preferencesStore]
      .map(store => store.subscribe(sync))];
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  sync();
  notify();
  return () => {
    for (const stop of stops) stop();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    owned.dispose();
    stopNotify();
    if (controller === owned) controller = null;
    notify();
  };
}
