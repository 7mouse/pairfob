// Serve the PWA on 5179. Set PAIRFOB_QA_SPACE to an existing ego task space.
// These are snapshot-boundary fixtures, not native CLI integration acceptance.
const task = await taskSpace(Number(globalThis.PAIRFOB_QA_SPACE));
const page = task.page("p1");
const kinds = ["pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "opencode", "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "qwen", "letta", "maki", "muse"];
const results = [];
for (const [width, height, touch] of [[390, 844, true], [1024, 768, true], [820, 768, true], [1440, 900, false]]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch, screenWidth: width, screenHeight: height });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await page.goto("http://127.0.0.1:5179/qa/?scene=home-populated&lang=zh");
  await page.waitForFunction(() => window.qa?.snapshot().ready, undefined, { timeout: 45000 });
  for (const agent of kinds) {
    await page.evaluate(async agent => {
      const { snapshot } = await import("/qa/data.ts");
      const { replaceAgentsFromSnapshot } = await import("/src/features/dashboard/catalog-store.ts");
      const base = snapshot();
      base.tabs = base.tabs.map(tab => ({ ...tab, label: "" }));
      base.panes = [{ ...base.panes[0], agent, label: undefined, tokens: { task: `${agent} 的任务` },
        activity: { type: "tool", name: "Read", label: "src/main.ts", state: "running", at: Date.now() } }];
      replaceAgentsFromSnapshot(base);
      await window.qa.render();
    }, agent);
    await page.waitForFunction(agent => {
      const text = document.querySelector(".card-main")?.textContent;
      return text?.includes(`${agent} 的任务`) && text.includes("main.ts");
    }, agent);
  }
  const selector = '.card-main[data-pane-id="w1:p1"]';
  if (touch) {
    const point = await page.evaluate(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
    await page.cdp("Input.synthesizeTapGesture", { ...point, duration: 50, gestureSourceType: "touch" });
  } else {
    await page.click(selector, { label: "open observed agent task" });
    await page.keyboard.press("F6");
  }
  await page.waitForFunction(() => document.querySelector(".chrome-title")?.textContent.includes("muse 的任务"));
  const errors = await page.evaluate(() => window.qa.snapshot().errors);
  if (errors.length) throw new Error(JSON.stringify(errors));
  results.push({ width, height, input: touch ? "touch" : "mouse + keyboard", kinds: kinds.length, passed: true });
}
console.log(results);
