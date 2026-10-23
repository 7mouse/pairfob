import { isNativeRuntime } from "./runtime-config";

/**
 * How notifications reach this build. Web Push is the existing path; a native
 * shell must register a device push channel instead, globally FCM and per OEM
 * in mainland China. The scaffold declares the shape but wires no channel yet.
 */
export type PushChannel = "web" | "fcm" | "hms" | "mipush" | "oppo" | "vivo" | "honor" | "aggregator";

export type NativePlatform = {
  kind: "android" | "ios";
  /** Empty until the native push phase registers a channel. */
  pushChannels: PushChannel[];
};

function nativeKind(): NativePlatform["kind"] {
  const agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPhone|iPad|iPod/i.test(agent) ? "ios" : "android";
}

/** The native shell's platform facts, or null in the hosted web build. */
export function nativePlatform(): NativePlatform | null {
  if (!isNativeRuntime()) return null;
  return { kind: nativeKind(), pushChannels: [] };
}

/**
 * Whether this build has a native push path to call. A future FCM/OEM
 * implementation fills `pushChannels`; until then the settings UI stays off
 * instead of pretending Web Push works inside a WebView.
 */
export function nativePushAvailable(platform: NativePlatform | null = nativePlatform()): boolean {
  return platform !== null && platform.pushChannels.length > 0;
}

export function supportsWebPush(): boolean {
  if (isNativeRuntime()) return false;
  return typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/**
 * A native app is already installed, so the iOS Add to Home Screen detour and
 * its Web Push requirement never apply there.
 */
export function needsHomeScreen(): boolean {
  if (isNativeRuntime()) return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches
    && !(navigator as Navigator & { standalone?: boolean }).standalone;
}
