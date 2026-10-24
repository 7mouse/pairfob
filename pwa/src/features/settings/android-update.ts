/**
 * The self-hosted beta channel for the Android shell. The relay serves one
 * manifest at a fixed path; the app compares its versionCode with the manifest
 * and sends the user to the versioned APK. The installer enforces the signing
 * key, so this module never decides trust, only which file to offer.
 */

import { nativeApp } from "../../lib/native-app";
import { nativePlatform } from "../../lib/platform";
import { downloadOrigin, downloadURL } from "../../lib/runtime-config";

export type AndroidRelease = {
  channel: "beta";
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  size: number;
  notes: string;
};

export type AndroidBuild = {
  version: string;
  code: number;
};

export const RELEASE_PATH = "/android/beta/latest.json";
const APK_PATH = /^\/android\/beta\/[A-Za-z0-9._-]+\.apk$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_KEY = "pairfob-android-check-at";
const MAX_NOTES = 500;

function positiveInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) return null;
  return value;
}

/** Parse a manifest. Any missing or malformed field rejects the whole release. */
export function parseAndroidRelease(value: unknown): AndroidRelease | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.channel !== "beta") return null;
  const versionCode = positiveInt(raw.versionCode, 2_147_483_647);
  const size = positiveInt(raw.size, 50 * 1024 * 1024);
  if (versionCode === null || size === null) return null;
  if (typeof raw.versionName !== "string" || !raw.versionName.trim() || raw.versionName.length > 64) return null;
  if (typeof raw.url !== "string" || !APK_PATH.test(raw.url)) return null;
  if (typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256)) return null;
  if (raw.notes !== undefined && typeof raw.notes !== "string") return null;
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, MAX_NOTES) : "";
  return {
    channel: "beta",
    versionCode,
    versionName: raw.versionName.trim(),
    url: raw.url,
    sha256: raw.sha256.toLowerCase(),
    size,
    notes,
  };
}

/** Parse Capacitor App.getInfo() into the integer the channel compares. */
export function parseAndroidBuild(version: unknown, build: unknown): AndroidBuild | null {
  if (typeof version !== "string" || !version.trim()) return null;
  const code = typeof build === "string" && /^\d+$/.test(build)
    ? Number(build)
    : typeof build === "number" ? build : Number.NaN;
  const checked = positiveInt(code, 2_147_483_647);
  if (checked === null) return null;
  return { version: version.trim(), code: checked };
}

export function hasNewerRelease(installed: number, release: AndroidRelease): boolean {
  return release.versionCode > installed;
}

/**
 * Resolve the manifest's APK path against the relay origin. Absolute URLs,
 * foreign hosts, traversal and non-APK paths are rejected here, not trusted to
 * the browser.
 */
export function resolveReleaseURL(path: string): string | null {
  if (!APK_PATH.test(path)) return null;
  const origin = downloadOrigin();
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return null;
  }
  return url.origin === origin ? url.href : null;
}

export async function fetchAndroidRelease(fetchText: (url: string) => Promise<string>): Promise<AndroidRelease> {
  const text = await fetchText(downloadURL(RELEASE_PATH));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("invalid release manifest");
  }
  const release = parseAndroidRelease(raw);
  if (!release) throw new Error("invalid release manifest");
  return release;
}

export function dueForCheck(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(CHECK_KEY));
    return !Number.isFinite(last) || last <= 0 || now - last >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markChecked(now = Date.now()): void {
  try {
    localStorage.setItem(CHECK_KEY, String(now));
  } catch {
    /* A blocked storage must not block an update. */
  }
}

const RELEASE_KEY = "pairfob-android-release";

/** The last release found by any check, so a remount still shows it. */
export function cachedAndroidRelease(): AndroidRelease | null {
  try {
    const raw = localStorage.getItem(RELEASE_KEY);
    return raw ? parseAndroidRelease(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function cacheAndroidRelease(release: AndroidRelease | null): void {
  try {
    if (release) localStorage.setItem(RELEASE_KEY, JSON.stringify(release));
    else localStorage.removeItem(RELEASE_KEY);
  } catch {
    /* A blocked storage must not block an update. */
  }
}

let backgroundRun: Promise<void> | null = null;

/**
 * The app-level check. Bootstrap calls it at boot and when the page becomes
 * visible again; the Settings row calls the same channel on demand. The six
 * hour throttle and the cached release live in this module, not in the row.
 */
export function backgroundAndroidUpdateCheck(): Promise<void> {
  if (backgroundRun) return backgroundRun;
  if (nativePlatform()?.kind !== "android" || !dueForCheck()) return Promise.resolve();
  const app = nativeApp();
  if (!app) return Promise.resolve();
  backgroundRun = (async () => {
    try {
      const info = await app.getInfo();
      const build = parseAndroidBuild(info.version, info.build);
      if (!build) return;
      const release = await fetchAndroidRelease(app.fetchText);
      markChecked();
      cacheAndroidRelease(hasNewerRelease(build.code, release) ? release : null);
    } catch {
      /* A background check never surfaces a notice. */
    } finally {
      backgroundRun = null;
    }
  })();
  return backgroundRun;
}
