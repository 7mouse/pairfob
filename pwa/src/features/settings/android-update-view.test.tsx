import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resetBoardTestDOM } from "../../../test-support/dom";
import * as platform from "../../lib/platform";
import type { NativeMessagePort } from "../../lib/native-app";
import { setLang, t } from "../../lib/i18n";
import { cacheAndroidRelease, markChecked } from "./android-update";
import { AndroidUpdateCard } from "./android-update-view";

type Request = { id: string; method: string; url?: string };
const release = { channel: "beta", versionCode: 13, versionName: "1.0.0-beta.13",
  url: "/android/beta/pairfob-1.0.0-beta.13-13.apk", sha256: "a".repeat(64), size: 1000 };
let root: Root | null, host: HTMLElement, port: NativeMessagePort;
let native: { mockRestore(): void };
let requests: Request[];
let infoFailure: "rejected" | "malformed" | null;
let failCheck: boolean, failOpen: boolean, holdInfo: boolean, holdOpen: boolean;
const info = (code = 12) => ({ name: "Pairfob", id: "com.pairfob.app", version: `1.0.0-beta.${code}`, build: String(code) });
const reply = (request: Request, value: unknown, ok = true) => port.onmessage?.({ data: JSON.stringify({ id: request.id, value, ok }) });
const calls = (method: string) => requests.filter(request => request.method === method);

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
  cacheAndroidRelease(null);
  localStorage.removeItem("pairfob-android-check-at");
  infoFailure = null; failCheck = failOpen = holdInfo = holdOpen = false;
  requests = [];
  native = spyOn(platform, "nativePlatform").mockReturnValue({ kind: "android", pushChannels: [] });
  port = { onmessage: null, postMessage(text) {
    const request: Request = JSON.parse(text);
    requests.push(request);
    if (request.method === "getInfo" && holdInfo || request.method === "openUrl" && holdOpen) return;
    queueMicrotask(() => {
      if (request.method === "getInfo") reply(request, infoFailure === "malformed" ? { version: "bad", build: "invalid" } : info(), infoFailure !== "rejected");
      else if (request.method === "fetchText") reply(request, JSON.stringify(release), !failCheck);
      else reply(request, "", !failOpen);
    });
  } };
  (window as Window & { PairfobNative?: NativeMessagePort }).PairfobNative = port;
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount()); root = null; host.remove();
  delete (window as Window & { PairfobNative?: NativeMessagePort }).PairfobNative;
  native.mockRestore();
  cacheAndroidRelease(null); localStorage.removeItem("pairfob-android-check-at");
});

async function render(strict = false) {
  await act(async () => { root!.render(strict ? createElement(StrictMode, null, createElement(AndroidUpdateCard)) : createElement(AndroidUpdateCard)); });
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector)!;
  expect(button).not.toBeNull(); expect(button.disabled).toBeFalse();
  await act(async () => { button.click(); });
}

test.each(["rejected", "malformed"] as const)("a %s version read can be retried and checks the channel even within its cache interval", async (failure) => {
  markChecked(); infoFailure = failure;
  await render();
  expect(host.textContent).toContain(t("set.androidNoBridge"));
  expect(host.querySelector(".set-action")?.textContent).toBe(t("set.androidRetry"));
  infoFailure = null;
  await click(".set-action");
  expect(calls("getInfo")).toHaveLength(2);
  expect(calls("fetchText")).toHaveLength(1);
  expect(host.querySelector(".android-update-install")).not.toBeNull();
  expect(host.textContent).toContain("已安装 1.0.0-beta.12");
});

test("a browser launch failure keeps the release and retries the same download without another network check", async () => {
  await render(); failOpen = true;
  await click(".android-update-install");
  expect(host.querySelector("[role=status]")?.textContent).toBe(t("set.androidOpenError"));
  expect(host.querySelector(".android-update-target")?.textContent).toContain(release.versionName);
  expect(host.querySelector(".android-update-install")?.textContent).toBe(t("set.androidRetryDownload"));
  expect(host.textContent).not.toContain(t("set.androidError"));
  failOpen = false; failCheck = true;
  await click(".android-update-install");
  expect(calls("fetchText")).toHaveLength(1);
  expect(calls("getInfo")).toHaveLength(1);
  expect(calls("openUrl").map(request => request.url)).toEqual(Array(2).fill(`https://dl.pairfob.com${release.url}`));
  expect(host.querySelector("[data-error]")).toBeNull();
});

test("a failed channel check retries the channel without rereading the installed version", async () => {
  markChecked();
  await render(); failCheck = true;
  await click(".set-action");
  expect(host.querySelector("[role=status]")?.textContent).toBe(t("set.androidError"));
  const reads = calls("getInfo").length;
  failCheck = false;
  await click(".set-action");
  expect(calls("getInfo")).toHaveLength(reads);
  expect(host.querySelector(".android-update-install")).not.toBeNull();
});

test("a bridge that appears after the initial read can be retried", async () => {
  delete (window as Window & { PairfobNative?: NativeMessagePort }).PairfobNative;
  await render();
  expect(host.textContent).toContain(t("set.androidNoBridge"));
  (window as Window & { PairfobNative?: NativeMessagePort }).PairfobNative = port;
  await click(".set-action");
  expect(calls("getInfo")).toHaveLength(1);
  expect(host.querySelector(".android-update-install")).not.toBeNull();
});

test("a pending browser launch disables its action and coalesces repeated taps", async () => {
  await render(); holdOpen = true;
  const button = host.querySelector<HTMLButtonElement>(".android-update-install")!;
  await act(async () => { button.click(); button.click(); });
  expect(calls("openUrl")).toHaveLength(1);
  expect(button.disabled).toBeTrue();
  expect(button.textContent).toBe(t("set.androidOpening"));
  await act(async () => { reply(calls("openUrl")[0], ""); });
  expect(button.disabled).toBeFalse();
});

test("a retired Strict Mode version read cannot overwrite the current installed version", async () => {
  holdInfo = true;
  await render(true);
  expect(calls("getInfo")).toHaveLength(2);
  await act(async () => { reply(calls("getInfo")[1], info(13)); });
  expect(host.textContent).toContain("已安装 1.0.0-beta.13");
  await act(async () => { reply(calls("getInfo")[0], info(12)); });
  expect(host.textContent).toContain("已安装 1.0.0-beta.13");
  expect(host.textContent).toContain(t("set.androidCurrent"));
  expect(host.querySelector(".android-update-install")).toBeNull();
});
