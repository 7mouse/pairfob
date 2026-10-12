import { resetTestDOM } from "../../../test-support/boot-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bindScreenWake } from "../../features/session/screen-wake-lifecycle";
import { SCREEN_WAKE_KEY, hydratePreferences, preferencesStore, setScreenWake } from "../../features/settings/preferences-store";
import { setLang } from "../../lib/i18n";
import { emptyEnvironment } from "../../shared/model/domain-environment";
import { SettingsContent } from "./settings-page";
import { ScreenWakeItem, type ScreenWakeRowInput } from "./settings-screen-wake";

let root: Root | null = null;
let host: HTMLElement | null = null;
let stop = () => {};
let calls = 0;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function mount(node: Parameters<Root["render"]>[0]): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const row = (input: ScreenWakeRowInput) => mount(createElement(ScreenWakeItem, { input }));
const options = (within: HTMLElement) => [...within.querySelectorAll<HTMLElement>(".wake-item .seg-item")];

beforeEach(async () => {
  await resetTestDOM();
  setLang("zh");
  calls = 0;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  stop();
  stop = () => {};
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(window, "isSecureContext");
  localStorage.removeItem(SCREEN_WAKE_KEY);
  hydratePreferences(emptyEnvironment());
});

test("a browser that cannot hold the screen has no row", () => {
  expect(row({ mode: "working", supported: false, denied: false }).children.length).toBe(0);
});

test("the row names the choice, says what it means, and a pick is kept on this device", () => {
  const view = row({ mode: "working", supported: true, denied: false });
  expect(view.querySelector(".set-item-label")?.textContent).toBe("屏幕常亮");
  expect(options(view).map(option => option.textContent)).toEqual(["关闭", "Agent 工作时", "始终"]);
  expect(view.querySelector(".seg-item.on")?.textContent).toBe("Agent 工作时");
  expect(view.querySelector(".set-item-sub")?.textContent).toBe("会话或画板上有 Agent 在工作时保持常亮，停下后随系统熄灭。");
  expect(view.querySelector(".set-action")).toBeNull();
  act(() => options(view)[2].click());
  expect(preferencesStore.get().screenWake).toBe("always");
  expect(localStorage.getItem(SCREEN_WAKE_KEY)).toBe("always");
});

test("a refusal is said on the row with a retry, and not at all once the choice is off", async () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { async request() {
    calls++;
    return { released: false, async release() {}, addEventListener() {}, removeEventListener() {} };
  } } });
  // The page is in front: a hidden one may not ask the system at all.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  stop = bindScreenWake();
  const view = row({ mode: "working", supported: true, denied: true });
  const sub = view.querySelector(".set-item-sub")!;
  expect(sub.textContent).toBe("系统没有允许常亮，省电模式下常见。");
  expect(sub.classList.contains("is-warn")).toBeTrue();
  act(() => view.querySelector<HTMLElement>(".set-action")!.click());
  await tick();
  expect(calls).toBe(1);
  act(() => root!.render(createElement(ScreenWakeItem, { input: { mode: "off", supported: true, denied: true } })));
  expect(view.querySelector(".set-item-sub")?.textContent).toBe("屏幕随系统设置熄灭。");
  expect(view.querySelector(".set-action")).toBeNull();
});

test("Settings shows the row among this device's own, between notifications and language, only where the screen can be held", () => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  const bare = mount(createElement(SettingsContent, { withBack: false }));
  expect(bare.querySelector(".wake-item")).toBeNull();
  act(() => root!.unmount());
  bare.remove();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { async request() { throw new Error("unused"); } } });
  stop = bindScreenWake();
  setScreenWake("always");
  const view = mount(createElement(SettingsContent, { withBack: false }));
  const item = view.querySelector(".wake-item")!;
  expect(item.previousElementSibling?.classList.contains("notification-item")).toBeTrue();
  expect(item.nextElementSibling?.classList.contains("language-item")).toBeTrue();
  expect(view.querySelector(".wake-item .seg-item.on")?.textContent).toBe("始终");
});
