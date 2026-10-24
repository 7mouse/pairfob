import { describe, expect, test } from "bun:test";
import {
  dueForCheck,
  fetchAndroidRelease,
  hasNewerRelease,
  markChecked,
  parseAndroidBuild,
  parseAndroidRelease,
  releaseNotes,
  resolveReleaseURL,
} from "./android-update";

function withMemoryStorage(run: (memory: Map<string, string>) => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, String(value)); },
      removeItem: (key: string) => { memory.delete(key); },
      clear: () => { memory.clear(); },
      key: () => null,
      get length() { return memory.size; },
    },
  });
  try {
    run(memory);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

const valid = {
  channel: "beta",
  versionCode: 5,
  versionName: "1.0.0-beta.5",
  url: "/android/beta/pairfob-1.0.0-beta.5.apk",
  sha256: "a".repeat(64),
  size: 5_000_000,
  notes: "Fixes the terminal keyboard.",
};

describe("android beta release", () => {
  test("accepts a complete beta manifest", () => {
    expect(parseAndroidRelease(valid)).toEqual({
      channel: "beta",
      versionCode: 5,
      versionName: "1.0.0-beta.5",
      url: valid.url,
      sha256: "a".repeat(64),
      size: 5_000_000,
      notes: valid.notes,
      notesZh: "",
    });
  });

  test("localizes release notes and falls back to the default note", () => {
    const localized = parseAndroidRelease({ ...valid, notesZh: "修复终端键盘。" })!;
    expect(localized.notesZh).toBe("修复终端键盘。");
    expect(releaseNotes(localized, "zh")).toBe("修复终端键盘。");
    expect(releaseNotes(localized, "en")).toBe(valid.notes);
    const fallback = parseAndroidRelease(valid)!;
    expect(releaseNotes(fallback, "zh")).toBe(valid.notes);
  });

  test("rejects malformed manifests", () => {
    const cases: Array<Record<string, unknown>> = [
      { ...valid, channel: "stable" },
      { ...valid, versionCode: 0 },
      { ...valid, versionCode: "5" },
      { ...valid, versionName: "" },
      { ...valid, url: "https://evil.example/pairfob.apk" },
      { ...valid, url: "/android/beta/../pairfob.apk" },
      { ...valid, url: "/android/beta/pairfob.zip" },
      { ...valid, sha256: "abc" },
      { ...valid, size: 0 },
      { ...valid, notes: 42 },
      { ...valid, notesZh: 42 },
    ];
    for (const item of cases) expect(parseAndroidRelease(item)).toBeNull();
  });

  test("compares versionCode, never the version name", () => {
    const release = parseAndroidRelease(valid)!;
    expect(hasNewerRelease(4, release)).toBe(true);
    expect(hasNewerRelease(5, release)).toBe(false);
    expect(hasNewerRelease(6, release)).toBe(false);
  });

  test("parses the Capacitor build string", () => {
    expect(parseAndroidBuild("1.0.0-beta.4", "4")).toEqual({ version: "1.0.0-beta.4", code: 4 });
    expect(parseAndroidBuild("1.0.0-beta.4", "")).toBeNull();
    expect(parseAndroidBuild("", "4")).toBeNull();
    expect(parseAndroidBuild("1.0.0-beta.4", "4.5")).toBeNull();
  });

  test("resolves only same-origin beta APK paths", () => {
    expect(resolveReleaseURL(valid.url)).toBe("https://dl.pairfob.com/android/beta/pairfob-1.0.0-beta.5.apk");
    expect(resolveReleaseURL("https://evil.example/pairfob.apk")).toBeNull();
    expect(resolveReleaseURL("//evil.example/pairfob.apk")).toBeNull();
    expect(resolveReleaseURL("/android/beta/../../etc/passwd.apk")).toBeNull();
    expect(resolveReleaseURL("/android/beta/pairfob.apk?next=https://evil.example")).toBeNull();
  });

  test("reads the manifest over the relay and rejects a bad status", async () => {
    const ok = async () => JSON.stringify(valid);
    expect((await fetchAndroidRelease(ok)).versionCode).toBe(5);
    const failing = async () => { throw new Error("native fetch failed"); };
    await expect(fetchAndroidRelease(failing)).rejects.toThrow();
    const invalid = async () => "not json";
    await expect(fetchAndroidRelease(invalid)).rejects.toThrow();
    const bad = async () => JSON.stringify({ versionCode: 6 });
    await expect(fetchAndroidRelease(bad)).rejects.toThrow();
  });

  test("throttles background checks to six hours", () => {
    withMemoryStorage(() => {
      const key = "pairfob-android-check-at";
      expect(dueForCheck(1_000)).toBe(true);
      markChecked(1_000);
      expect(dueForCheck(1_000 + 60_000)).toBe(false);
      expect(dueForCheck(1_000 + 6 * 60 * 60 * 1000)).toBe(true);
      localStorage.removeItem(key);
    });
  });
});
