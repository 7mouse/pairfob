// Serve web fixtures on 5199 and native fixtures on 5198, with separate Vite cache directories. Set
// globalThis.PAIRFOB_QA_SPACE to an owned ego-browser space before importing.
// Uses real touch/mouse/keyboard input with fixture transport and native bridge.
const page = (await taskSpace(Number(globalThis.PAIRFOB_QA_SPACE))).page("p1");
const artifacts = globalThis.PAIRFOB_QA_ARTIFACTS || "/tmp/pairfob-settings-update-qa";
// Cold Vite compilation on a busy development machine is not an app latency test.
const startupTimeout = 120_000;
await (await import("node:fs/promises")).mkdir(artifacts, { recursive: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
await page.cdp("Network.setBypassServiceWorker", { bypass: true });
// Native dev HTML needs Vite's inline preamble; production CSP is unchanged.
await page.cdp("Page.setBypassCSP", { enabled: true });
await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
window.nativeRequests=[];window.nativeInfoFailures=1;window.nativeFailOpen=false;window.nativeFailFetch=false;window.nativeReleaseCode=13;
window.PairfobNative={postMessage(text){
 const req=JSON.parse(text);nativeRequests.push(req);
 const value=req.method==='getInfo'?{name:'Pairfob',id:'com.pairfob.app',version:'1.0.0-beta.12',build:'12'}:
 req.method==='fetchText'?JSON.stringify({channel:'beta',versionCode:nativeReleaseCode,versionName:'1.0.0-beta.'+nativeReleaseCode,url:'/android/beta/pairfob-1.0.0-beta.'+nativeReleaseCode+'-'+nativeReleaseCode+'.apk',sha256:'a'.repeat(64),size:5000000,notes:'Restricted native update bridge, reliable update retries, reconnect read-state recovery, and source-verified release builds.'}):'';
 const ok=!(req.method==='getInfo'&&nativeInfoFailures-- > 0)&&!(req.method==='openUrl'&&nativeFailOpen)&&!(req.method==='fetchText'&&nativeFailFetch);
 queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id:req.id,ok,value})}));
},onmessage:null};` });

async function activate(selector, touch, keyboard = false) {
  if (keyboard) { await page.focus(selector); return page.keyboard.press("Enter"); }
  if (!touch) return page.click(selector, { label: "check settings update action" });
  const point = await page.evaluate(selector => {
    const el = document.querySelector(selector);
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
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
  await page.goto("http://127.0.0.1:5199/qa/?scene=settings&lang=zh");
  await page.waitForFunction(() => window.qa?.snapshot().ready, undefined, { timeout: startupTimeout });
  assert(await page.evaluate(() => !document.querySelector(".android-update")), "Web must not offer an APK update");
  await activate(".cp-main", touch);
  await page.waitForSelector(".daemon-update-version-row");
  await page.evaluate(async () => {
    window.qa.setDaemonUpdate({ build: "v2.4.0", completedTarget: "v2.3.9" });
    const { refreshDaemonUpdate } = await import("/src/features/settings/daemon-update.ts");
    await refreshDaemonUpdate();
  });
  await page.waitForSelector('.daemon-update[data-stage="current"]');
  assert(await page.evaluate(() => !document.querySelector(".daemon-update").textContent.includes("v2.3.9")), "Stale target leaked into current version card");
  await activate(".daemon-update-check", touch, !touch);
  await page.waitForFunction(() => document.querySelector(".daemon-update-feedback")?.textContent.includes("已是最新版本"));
  await page.evaluate(async () => {
    window.qa.setDaemonUpdate({ build: "v2.4.0", completedTarget: "v2.4.1" });
    const { refreshDaemonUpdate } = await import("/src/features/settings/daemon-update.ts");
    await refreshDaemonUpdate();
  });
  await page.waitForSelector('.daemon-update[data-stage="waiting"]');
  assert(await page.evaluate(() => {
    const text = document.querySelector(".daemon-update-feedback").textContent;
    return text.includes("已安装 v2.4.1") && text.includes("当前运行 v2.4.0");
  }), "Pending update must distinguish installed and running versions");

  for (const lang of ["zh", "en"]) {
    await page.goto(`http://127.0.0.1:5198/qa/?scene=settings&lang=${lang}`);
    await page.waitForSelector(".android-update-status[data-error]", { timeout: startupTimeout });
    assert(await page.evaluate(() => !document.querySelector(".android-update .set-action").disabled), "Version read retry must stay enabled");
    await activate(".android-update .set-action", touch, !touch);
    await page.waitForSelector(".android-update-install");
    assert(await page.evaluate(() => window.nativeRequests.filter(x => x.method === "getInfo").length === 2), "Retry must reread the installed version");
    const initial = await page.evaluate(() => {
      const group = document.querySelector(".android-update");
      const card = group.querySelector(".set-card");
      const button = group.querySelector(".android-update-install").getBoundingClientRect();
      const target = group.querySelector(".android-update-target").getBoundingClientRect();
      return { beforeQuotas: document.querySelector(".computer-panel").nextElementSibling === group,
        languageSeparate: !card.querySelector(".language-item"), notesClosed: !group.querySelector("details").open,
        hasInstalled: group.querySelector(".set-item-sub").textContent.includes("1.0.0-beta.12"),
        hasAvailable: group.querySelector(".android-update-target").textContent.includes("1.0.0-beta.13"),
        separateAction: button.top >= target.bottom, targetHeight: button.height,
        overflow: window.qa.snapshot().overflow, errors: window.qa.snapshot().errors };
    });
    assert(initial.beforeQuotas && initial.languageSeparate && initial.notesClosed && initial.hasInstalled && initial.hasAvailable && initial.separateAction && initial.targetHeight >= 44 && !initial.overflow.documentX && initial.errors.length === 0, JSON.stringify(initial));
    await activate(".android-update-notes summary", touch, !touch);
    await page.waitForSelector(".android-update-notes[open]");
    await activate(".android-update-notes summary", touch, !touch);
    const checksBeforeOpen = await page.evaluate(() => {
      window.nativeFailOpen = true;
      return window.nativeRequests.filter(x => x.method === "fetchText").length;
    });
    await activate(".android-update-install", touch);
    await page.waitForSelector(".android-update-status[data-error]");
    assert(await page.evaluate(lang => document.querySelector(".android-update-status").textContent === (lang === "zh" ? "无法打开下载，请重试。" : "Could not open the download. Try again."), lang), "Browser failure must not be called a release-check failure");
    await page.evaluate(() => { window.nativeFailOpen = false; window.nativeFailFetch = true; });
    await activate(".android-update-install", touch, !touch);
    await page.waitForFunction(() => window.nativeRequests.filter(x => x.method === "openUrl").length === 2);
    await page.waitForFunction(() => !document.querySelector(".android-update-status[data-error]"));
    assert(await page.evaluate(() => window.nativeRequests.filter(x => x.method === "fetchText").length) === checksBeforeOpen, "Retrying the download must not depend on another channel fetch");
    assert(await page.evaluate(() => window.nativeRequests.filter(x => x.method === "openUrl").every(x => x.url === "https://dl.pairfob.com/android/beta/pairfob-1.0.0-beta.13-13.apk")), "Wrong APK destination");
    await page.evaluate(() => document.querySelector(".android-update").scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${artifacts}/settings-update-${surface}-${lang}.png` });
  }
  results.push({ surface, passed: true, languages: ["zh", "en"], input: touch ? "touch" : "mouse and keyboard" });
}
console.log(JSON.stringify(results, null, 2));
