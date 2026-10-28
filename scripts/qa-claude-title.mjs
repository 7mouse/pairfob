// Serve the PWA on port 5179. Prepend globalThis.PAIRFOB_QA_SPACE = <ego space id>
// and pipe to ego-browser nodejs. This checks QA fixtures, not live transport.
const task = await taskSpace(Number(globalThis.PAIRFOB_QA_SPACE));
const page = task.page("p1");
const assert = (value, message) => { if (!value) throw new Error(message); };

async function publishTitle(task, label) {
  await page.evaluate(async ({ task, label }) => {
    const { snapshot } = await import("/qa/data.ts");
    const { replaceAgentsFromSnapshot } = await import("/src/features/dashboard/catalog-store.ts");
    const base = snapshot();
    base.tabs = base.tabs.map(tab => ({ ...tab, label: "" }));
    base.panes = [{ ...base.panes[0], label, agent: "claude", terminal_title: "Claude Code", tokens: task ? { task } : {} }];
    replaceAgentsFromSnapshot(base);
    await window.qa.render();
  }, { task, label });
}

async function activate(selector, touch) {
  if (!touch) return page.click(selector, { label: "open Claude session" });
  const point = await page.evaluate(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  await page.cdp("Input.synthesizeTapGesture", { ...point, gestureSourceType: "touch", duration: 50 });
}

const results = [];
for (const [surface, width, height, touch] of [
  ["phone", 390, 844, true], ["tablet", 1024, 768, true],
  ["tablet-middle", 820, 768, true], ["desktop", 1440, 900, false],
]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch, screenWidth: width, screenHeight: height });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await page.goto("http://127.0.0.1:5179/qa/?scene=home-populated&lang=zh");
  await page.waitForFunction(() => window.qa?.snapshot().ready, undefined, { timeout: 45000 });
  assert(await page.evaluate(() => innerWidth) === width, `${surface}: wrong viewport`);
  await publishTitle();
  const generic = await page.evaluate(() => document.querySelector(".card-main")?.textContent);
  await publishTitle("检查会话标题");
  await page.waitForFunction(() => document.querySelector(".card-main")?.textContent.includes("检查会话标题"));
  assert(generic !== await page.evaluate(() => document.querySelector(".card-main")?.textContent), `${surface}: generic name did not refresh`);
  await activate('.card-main[data-pane-id="w1:p1"]', touch);
  await page.waitForFunction(() => window.qa.snapshot().screen === "pane");
  await page.waitForFunction(() => document.querySelector(".chrome-title")?.textContent.includes("检查会话标题"));
  await publishTitle("修复 Claude 会话标题");
  await page.waitForFunction(() => document.querySelector(".chrome-title")?.textContent.includes("修复 Claude 会话标题"));
  if (touch) {
    assert(await page.evaluate(() => document.activeElement?.tagName !== "TEXTAREA"), `${surface}: title update raised keyboard`);
  } else {
    await page.keyboard.press("F6");
    assert(await page.evaluate(() => document.querySelector(".chrome-title")?.textContent.includes("修复 Claude 会话标题")), "keyboard navigation lost title");
  }
  await publishTitle("自动会话名", "我的 Claude 任务");
  await page.waitForFunction(() => document.querySelector(".chrome-title")?.textContent.includes("我的 Claude 任务"));
  if (width < 720) {
    await activate('button[aria-label="返回会话列表"]', touch);
    await page.waitForFunction(() => window.qa.snapshot().screen === "home");
  }
  assert(await page.evaluate(() => document.querySelector(".card-main")?.textContent.includes("我的 Claude 任务")), `${surface}: list disagrees with session`);
  assert(await page.evaluate(() => window.qa.snapshot().errors.length === 0), `${surface}: fixture errors`);
  results.push({ surface, width, height, input: touch ? "touch" : "mouse + keyboard", passed: true });
}
console.log(JSON.stringify(results, null, 2));
