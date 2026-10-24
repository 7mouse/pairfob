// Serve the PWA on port 5197. Prepend globalThis.PAIRFOB_QA_SPACE = <ego space id>
// and pipe to ego-browser nodejs. Exercises fixtures, not a live relay/device.
const task = await taskSpace(Number(globalThis.PAIRFOB_QA_SPACE));
const page = task.page("p1");
const assert = (value, message) => { if (!value) throw new Error(message); };

async function activate(selector, touch) {
  if (!touch) return page.click(selector, { label: "mark completed tasks read" });
  const point = await page.evaluate(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const results = [];
for (const [surface, width, height, touch] of [
  ["phone", 390, 844, true], ["tablet", 1024, 768, true],
  ["tablet-middle", 820, 768, true], ["desktop", 1440, 900, false],
]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch, screenWidth: width, screenHeight: height });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await page.goto("http://127.0.0.1:5197/qa/?scene=attention-rich&lang=zh");
  await page.waitForFunction(() => window.qa?.snapshot().ready);
  assert(await page.evaluate(() => document.querySelectorAll(".card.is-unread").length === 2), `${surface}: initial completions`);
  if (width < 720) {
    await activate(".attn-strip-label", touch);
    await page.waitForSelector(".attn-sheet-foot button");
    await activate(".attn-sheet-foot button", touch);
  } else {
    await activate(".attn-read-all", touch);
  }
  await page.waitForFunction(() => document.querySelectorAll(".card.is-unread").length === 0 && !document.querySelector("dialog[open]"));
  const seen = await page.evaluate(async () => {
    const { loadCompletionSeen } = await import("/src/features/dashboard/catalog-store.ts");
    return loadCompletionSeen();
  });
  assert(Object.keys(seen).length === 2, `${surface}: read receipts saved`);

  // A reconnect's first snapshot cannot yet confirm any agent's status.
  await page.evaluate(async () => {
    const { attentionSnapshot } = await import("/qa/data.ts");
    const { replaceAgentsFromSnapshot } = await import("/src/features/dashboard/catalog-store.ts");
    window.qa.setConnected(false);
    await window.qa.render();
    window.qa.setConnected(true);
    const snapshot = attentionSnapshot();
    replaceAgentsFromSnapshot({ ...snapshot, panes: snapshot.panes.map(pane => ({ ...pane, agent_status: "unknown" })) });
    await window.qa.render();
  });
  const gap = await page.evaluate(async () => {
    const { loadCompletionSeen } = await import("/src/features/dashboard/catalog-store.ts");
    return { seen: loadCompletionSeen(), unread: document.querySelectorAll(".card.is-unread").length,
      unknown: [...document.querySelectorAll('.card-main[data-pane-id^="attention-done-"] .card-status')]
        .filter(el => el.textContent === "未知").length };
  });
  assert(JSON.stringify(gap.seen) === JSON.stringify(seen) && gap.unread === 0 && gap.unknown === 2, `${surface}: unknown must preserve receipts without claiming idle`);

  // Another page/session recovery reloads those receipts before the full snapshot.
  await page.evaluate(async () => {
    const { attentionSnapshot } = await import("/qa/data.ts");
    const { resetDashboard, reloadCompletionSeen, replaceAgentsFromSnapshot } = await import("/src/features/dashboard/catalog-store.ts");
    resetDashboard();
    reloadCompletionSeen();
    replaceAgentsFromSnapshot(attentionSnapshot());
    await window.qa.render();
  });
  assert(await page.evaluate(() => document.querySelectorAll(".card.is-unread").length === 0 && document.querySelectorAll(".card.is-blocked").length === 1), `${surface}: recovered read state`);
  await page.evaluate(async () => {
    const { attentionSnapshot } = await import("/qa/data.ts");
    const { replaceAgentsFromSnapshot } = await import("/src/features/dashboard/catalog-store.ts");
    replaceAgentsFromSnapshot(attentionSnapshot(true));
    await window.qa.render();
  });
  assert(await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".card.is-unread .card-main")];
    return rows.length === 1 && rows[0].dataset.paneId === "attention-done-new";
  }), `${surface}: a genuinely newer completion must still need reading`);
  if (!touch) {
    const selector = '.card-main[data-pane-id="attention-done-new"]';
    await page.hover(selector);
    const read = '.card.is-unread .card-action.is-read';
    await page.focus(read);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".card.is-unread").length === 0);
  }
  assert(await page.evaluate(() => window.qa.snapshot().errors.length === 0), `${surface}: fixture errors`);
  results.push({ surface, width, height, input: touch ? "touch" : "mouse + keyboard", passed: true });
}
console.log(JSON.stringify(results, null, 2));
