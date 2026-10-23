/**
 * The native shell's update bridge. MainActivity exposes it as
 * `window.PairfobNative`; the hosted web build has no bridge, so every caller
 * gets null and the update row stays out of Settings.
 */

export type NativeAppInfo = {
  name: string;
  id: string;
  /** versionName, such as 1.0.0-beta.4. */
  version: string;
  /** versionCode, as a string. */
  build: string;
};

export type NativeAppBridge = {
  getInfo(): Promise<NativeAppInfo>;
  openUrl(options: { url: string }): Promise<void>;
  /** One allowlisted HTTPS GET through the native network stack. */
  fetchText(url: string): Promise<string>;
};

export type NativeMessagePort = {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
};

type NativeWindow = Window & { PairfobNative?: NativeMessagePort };

/** Correlate replies and bound failed requests, including a missing native reply. */
export function createNativeApp(port: NativeMessagePort, timeoutMs = 25_000): NativeAppBridge {
  let counter = 0;
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  port.onmessage = (event) => {
    let reply: { id?: unknown; ok?: unknown; value?: unknown };
    try { reply = JSON.parse(event.data); } catch { return; }
    if (!reply || typeof reply.id !== "string") return;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    clearTimeout(waiter.timer);
    if (reply.ok === true) waiter.resolve(reply.value);
    else waiter.reject(new Error("native update request failed"));
  };
  function request(method: string, url?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(++counter);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("native update request timed out"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage(JSON.stringify({ id, method, url }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("native update request failed"));
      }
    });
  }
  return {
    getInfo: async () => {
      const info = await request("getInfo") as NativeAppInfo | null;
      if (!info || typeof info.version !== "string" || typeof info.build !== "string") {
        throw new Error("invalid native app info");
      }
      return info;
    },
    openUrl: async ({ url }) => { await request("openUrl", url); },
    fetchText: async (url) => {
      const text = await request("fetchText", url);
      if (typeof text !== "string") throw new Error("invalid native response");
      return text;
    },
  };
}

let cachedPort: NativeMessagePort | undefined;
let cachedApp: NativeAppBridge | null = null;

/** The origin-restricted native bridge, or null in the hosted web build. */
export function nativeApp(): NativeAppBridge | null {
  if (typeof window === "undefined") return null;
  const port = (window as NativeWindow).PairfobNative;
  if (!port || typeof port.postMessage !== "function") return null;
  if (port !== cachedPort) {
    cachedPort = port;
    cachedApp = createNativeApp(port);
  }
  return cachedApp;
}
