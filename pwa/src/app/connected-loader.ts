import { bindSessionPresentation } from "../features/connection/presentation-ready";
import { installConnectedPresentation } from "./presentation";
import { markAppPerformance } from "../lib/performance-marks";

type Runtime = typeof import("./connected-runtime");
let runtime: Runtime | null = null;
let loading: Promise<Runtime> | null = null;
const listeners = new Set<(runtime: Runtime) => void>();
export const connectedRuntime = () => runtime;

/** One shared read. Browser module-map failures can require an explicit page refresh. */
export function loadConnectedRuntime(): Promise<Runtime> {
  if (runtime) return Promise.resolve(runtime);
  markAppPerformance("connected-load-start");
  return loading ??= import("./connected-runtime").then(value => {
    runtime = value;
    installConnectedPresentation(value.presentation);
    for (const listener of [...listeners]) listener(value);
    markAppPerformance("connected-ready");
    return value;
  }).catch(error => { loading = null; throw error; });
}

/** A page lifetime owns listeners, not the cached module or a late download. */
export function subscribeConnectedRuntime(listener: (runtime: Runtime) => void): () => void {
  listeners.add(listener);
  try { if (runtime) listener(runtime); }
  catch (error) { listeners.delete(listener); throw error; }
  return () => { listeners.delete(listener); };
}

// Headless controllers do not need a UI; a browser lifecycle installs this gate.
bindSessionPresentation(async () => { await loadConnectedRuntime(); }, () => runtime !== null);
