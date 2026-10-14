import type { FixtureCall } from "./types";

export const FIXED_NOW = Date.UTC(2026, 8, 8, 4, 0, 0);
let clock = FIXED_NOW;

/**
 * Run one synchronous action with the fixture clock at another instant, for a
 * scene that seeds stamps the application takes from `Date.now()` itself (the
 * order sessions were opened in). The clock is back at `FIXED_NOW` on return.
 */
export function clockAt<T>(time: number, action: () => T): T {
  const before = clock;
  clock = time;
  try {
    return action();
  } finally {
    clock = before;
  }
}
/**
 * Move the fixture clock on and leave it there, for a probe that waits on
 * time the application measures itself (how long an update request has gone
 * unanswered). The next scene starts at `FIXED_NOW` again.
 */
export function advanceClock(ms: number): number {
  clock += ms;
  return clock;
}
export function resetClock(): void { clock = FIXED_NOW; }
export const calls: FixtureCall[] = [];
export const errors: string[] = [];
export function record(kind: FixtureCall["kind"], method: string, args: unknown[] = []): void {
  const safe = JSON.parse(JSON.stringify(args, (_key, value) => value instanceof Uint8Array ? [...value] : value));
  calls.push({ sequence: calls.length + 1, kind, method, args: safe });
}

function isolatedStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
}

/** Installed before production imports; fixture clicks cannot contact a daemon. */
export function installEnvironment(): void {
  const NativeDate = Date;
  globalThis.Date = new Proxy(NativeDate, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); },
    apply() { return new NativeDate(clock).toString(); },
    get(target, property) { return property === "now" ? () => clock : Reflect.get(target, property); },
  });
  Object.defineProperty(window, "localStorage", { configurable: true, value: isolatedStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: isolatedStorage() });
  // No credential or push subscription writes in a test origin shared with development.
  Object.defineProperty(window, "indexedDB", { configurable: true, value: {
    open() { throw new Error("QA fixture does not open persistent credential storage"); },
  } });
  window.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    record("network", "fetch", [url.pathname]);
    if (url.pathname === "/dl/VERSION") return new Response("v2.4.0\n");
    if (url.pathname === "/api/config") return Response.json({ protocol: 2, p2p: true });
    throw new Error(`Unmocked QA fetch blocked: ${url.pathname}`);
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => { throw new DOMException("QA camera permission denied", "NotAllowedError"); },
    enumerateDevices: async () => [],
  } });
  if ("Notification" in window) Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => "denied" });
  const NativeSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args) {
      // Vite's own HMR client may reconnect after the fixture is installed.
      if (args[1] === "vite-hmr" && new URL(String(args[0])).host === location.host) return Reflect.construct(target, args);
      record("network", "WebSocket.blocked", [String(args[0])]);
      throw new Error("QA fixture blocks session WebSockets");
    },
  });
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (...args: unknown[]) => {
    record("network", "sendBeacon", args.map((arg) => typeof arg === "string" ? arg : "<body>"));
    return true;
  } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    readText: async () => "ABCD-EFGH-JKMPQR",
    writeText: async (text: string) => { record("lifecycle", "clipboard.writeText", [text]); },
  } });
  window.addEventListener("error", (event) => errors.push(event.message));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
}

export function installStablePaint(): void {
  const style = document.createElement("style");
  style.dataset.qaStable = "true";
  // Keep normal motion preference and layout; freeze decorative animation only.
  style.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important; }`;
  document.head.append(style);
  // What the page moves from script stands still with it: nothing is kept on
  // screen for an exit and no measured move is played, so a capture taken
  // right after a change shows where it ends. Only script's question is
  // answered here; the style sheet's own motion preference is untouched.
  const match = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
    if (!/prefers-reduced-motion:\s*reduce/.test(query)) return match(query);
    const still = new EventTarget() as MediaQueryList;
    return Object.assign(still, { matches: true, media: query, onchange: null, addListener() {}, removeListener() {} });
  };
}

export async function settlePaint(): Promise<void> {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
