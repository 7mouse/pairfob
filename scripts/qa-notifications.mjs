// Start `cd pwa && bun run dev -- --port 5183`, then run:
// Prepend `globalThis.PAIRFOB_QA_SPACE = <existing ego task id>;` to this script
// and pipe it to `ego-browser nodejs`. The space belongs to the caller.
// Fixtures deny permission locally. This does not verify a real push provider.
const assert = (value, message) => { if (!value) throw new Error(message); };
const task = await taskSpace(Number(globalThis.PAIRFOB_QA_SPACE));
const page = task.page("p1");
const base = process.env.PAIRFOB_QA_URL || "http://127.0.0.1:5183";
const out = "/tmp/pairfob-notifications-qa";
await (await import("node:fs/promises")).mkdir(out, { recursive: true });
const desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const touchUA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

async function target(selector) {
  return page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    const r = element.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
}
async function activate(selector, touch) {
  if (!touch) { await page.click(selector, { label: "activate notification control" }); return; }
  const point = await target(selector);
  await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
  await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function scene(name = "home-notifications") {
  await page.goto(`${base}/qa/?scene=${name}&lang=zh`);
  await page.waitForFunction(() => window.qa?.snapshot().ready);
}
const results = [];
for (const [name, width, height, touch] of [
  ["phone", 390, 844, true], ["tablet", 1024, 768, true],
  ["tablet-middle", 820, 768, true], ["desktop", 1440, 900, false],
]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch, screenWidth: width, screenHeight: height });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await page.cdp("Emulation.setUserAgentOverride", { userAgent: touch ? touchUA : desktopUA, platform: touch ? "Linux armv8l" : "MacIntel" });
  await scene();
  await page.waitForSelector(".notification-prompt .btn-primary");
  const before = await page.evaluate(() => {
    const card = document.querySelector(".notification-prompt").getBoundingClientRect();
    return { left: card.left, right: card.right, bottom: card.bottom, width: innerWidth, height: innerHeight,
      heights: [...document.querySelectorAll(".notification-prompt button")].map(el => el.getBoundingClientRect().height),
      focused: document.querySelector(".notification-prompt").contains(document.activeElement),
      permissions: window.qa.calls.filter(c => c.method === "Notification.requestPermission").length };
  });
  assert(before.left >= 0 && before.right <= before.width && before.bottom <= before.height, `${name}: overflow`);
  assert(before.heights.every(h => h >= 44) && !before.focused && before.permissions === 0, `${name}: target/focus/consent regression`);
  await page.screenshot({ path: `${out}/${name}.png` });
  // Actual finger / mouse input. No DOM .click() is used.
  await activate(".notification-prompt .btn-primary", touch);
  await page.waitForFunction(() => window.qa.calls.some(c => c.method === "Notification.requestPermission"));
  const calls = await page.evaluate(() => window.qa.calls);
  assert(calls.filter(c => c.method === "Notification.requestPermission").length === 1, `${name}: permission count`);
  assert(!calls.some(c => c.method === "pushSubscribe"), `${name}: denied permission subscribed`);
  if (touch) await activate(".notification-prompt button:first-child", true);
  else {
    await page.focus(".notification-prompt button:first-child");
    await page.keyboard.press("Enter");
  }
  await page.waitForFunction(() => !document.querySelector(".notification-prompt"));
  await page.evaluate(async () => { window.qa.setConnected(false); window.qa.setConnected(true); await window.qa.render(); });
  assert(await page.evaluate(() => !document.querySelector(".notification-prompt")), `${name}: invitation repeated on reconnect`);
  results.push({ surface: name, ...before, interaction: touch ? "touch" : "mouse + keyboard", passed: true });
}

// iPhone browser: installation guidance, with no permission button.
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await page.cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await scene();
await page.waitForSelector(".notification-prompt");
assert(await page.evaluate(() => document.querySelector(".notification-prompt").textContent.includes("添加到主屏幕") && !document.querySelector(".notification-prompt .btn-primary")), "iPhone installation guidance missing");
await page.screenshot({ path: `${out}/iphone-install.png` });
await activate(".notification-prompt button", true);

// The invitation floats over the complete terminal without changing its box.
await page.cdp("Emulation.setUserAgentOverride", { userAgent: touchUA, platform: "Linux armv8l" });
await scene("terminal-frame");
await page.waitForSelector(".xterm-screen");
const terminalBefore = await page.evaluate(() => ({ box: document.querySelector(".xterm-screen").getBoundingClientRect().toJSON(),
  resizeCalls: window.qa.calls.filter(c => c.method === "terminalResize").length }));
await page.evaluate(async () => {
  const { liveSession, credential } = await import("/src/features/computers/catalog-store.ts");
  const { setPushEnabled } = await import("/src/features/connection/runtime-store.ts");
  const { offerNotifications } = await import("/src/features/settings/notification-onboarding.ts");
  const { rememberPushConfig } = await import("/src/features/settings/push-config.ts");
  rememberPushConfig(liveSession(), { push_enabled: true, vapid_public: "AA" });
  setPushEnabled(true);
  offerNotifications(credential().daemonId);
});
await page.waitForSelector(".notification-prompt");
await activate(".notification-prompt button:first-child", true);
const terminalAfter = await page.evaluate(() => ({ box: document.querySelector(".xterm-screen").getBoundingClientRect().toJSON(),
  resizeCalls: window.qa.calls.filter(c => c.method === "terminalResize").length }));
assert(JSON.stringify(terminalBefore) === JSON.stringify(terminalAfter), "invitation resized the computer terminal");
assert(await page.evaluate(() => window.qa.snapshot().errors.length === 0), "fixture errors");
console.log(JSON.stringify({ results, iphoneGuidance: true, terminalSizeStable: true, screenshots: out }, null, 2));
