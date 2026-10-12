import { getAppFrame, subscribeAppFrame } from "../../app/frame";
import { navigationStore } from "../../app/navigation-store";
import { computersStore } from "../computers/catalog-store";
import { dashboardStore } from "../dashboard/catalog-store";
import { sessionStore } from "./session-store";
import { createScreenWake, type WakeSnapshot } from "./screen-wake";

type Controller = ReturnType<typeof createScreenWake>;
let controller: Controller | null = null;
const off: WakeSnapshot = { enabled: false, eligible: false, status: "off" };
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export const screenWake = {
  get: () => controller?.get() ?? off,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  setEnabled: (enabled: boolean) => controller?.setEnabled(enabled),
  retry: () => controller?.retry(),
};

/** A transport reconnect keeps the scope; another runtime/terminal/agent does not. */
export function screenWakeScope(): string | null {
  const screen = navigationStore.get().screen;
  const frame = getAppFrame();
  if (screen !== "pane" && screen !== "workspace") return null;
  if (!frame.session && frame.layout?.mode !== "workspace") return null;
  const paneId = sessionStore.get().paneId;
  const computer = computersStore.get();
  const agent = dashboardStore.get().agents.find(item => item.paneId === paneId);
  if (!paneId || !agent || !computer.credential) return null;
  const herd = computer.live?.herdSession ? computer.live.herdSession() : agent.runtimeSession;
  return JSON.stringify([computer.credential.daemonId, herd ?? null,
    paneId, agent.terminalId ?? null, agent.agentInstanceId ?? null]);
}

/** Installed with the application, including QA; the parent page owns the lock. */
export function bindScreenWake(): () => void {
  const owned = createScreenWake(window.isSecureContext && navigator.wakeLock
    ? () => navigator.wakeLock.request("screen") : null);
  controller = owned;
  const stopNotify = owned.subscribe(notify);
  let hidden = false;
  const sync = () => {
    owned.setScope(screenWakeScope());
    owned.setVisible(!hidden && document.visibilityState === "visible");
  };
  const hide = () => { hidden = true; sync(); };
  const show = () => { hidden = false; sync(); };
  const stops = [subscribeAppFrame(sync), ...[navigationStore, computersStore, dashboardStore, sessionStore].map(store => store.subscribe(sync))];
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
