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

type PairfobNative = {
  versionName(): string;
  versionCode(): number;
  openUrl(url: string): void;
  fetch(url: string, requestId: string): void;
};

type NativeWindow = Window & {
  PairfobNative?: PairfobNative;
  __pairfobNativeFetch?: (id: string, ok: boolean, body: string) => void;
};

let counter = 0;
let installed = false;
const pending = new Map<string, { resolve: (body: string) => void; reject: (error: Error) => void }>();

function installCallback(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  (window as NativeWindow).__pairfobNativeFetch = (id, ok, body) => {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (ok) waiter.resolve(body);
    else waiter.reject(new Error("native fetch failed"));
  };
}

/** The native bridge, or null in the hosted web build. */
export function nativeApp(): NativeAppBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as NativeWindow).PairfobNative;
  if (!bridge) return null;
  installCallback();
  return {
    getInfo: async () => ({
      name: "Pairfob",
      id: "com.pairfob.app",
      version: String(bridge.versionName()),
      build: String(bridge.versionCode()),
    }),
    openUrl: async ({ url }) => {
      bridge.openUrl(url);
    },
    fetchText: (url) => new Promise<string>((resolve, reject) => {
      const id = String(++counter);
      pending.set(id, { resolve, reject });
      try {
        bridge.fetch(url, id);
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error("native fetch failed"));
      }
    }),
  };
}
