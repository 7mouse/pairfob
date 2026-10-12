const CACHE = "pairfob-shell-v11";
const PREVIOUS_CACHE = "pairfob-shell-v10";
const PREF = "pairfob-pref";
const NOTIFY_DIAGNOSTICS = "pairfob-notification-diagnostics-v1";
const NOTIFY_LOG = "/__pairfob_notification_diagnostics__";
const SHELL = ["/", "/pair", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const SHELL_NETWORK_GRACE_MS = 750;

// Content-free evidence survives a worker restart and is exported by Settings.
// Storage work never gates focus/navigation, whose user activation is short-lived.
let diagnosticWrite = Promise.resolve();
function recordNotificationDiagnostic(event, details = {}) {
  const record = { at: Date.now(), event, ...details };
  diagnosticWrite = diagnosticWrite.then(async () => {
    const cache = await caches.open(NOTIFY_DIAGNOSTICS);
    const response = await cache.match(NOTIFY_LOG);
    let previous = [];
    try { previous = response ? await response.json() : []; } catch { /* Replace corrupt evidence. */ }
    const recent = Array.isArray(previous) ? previous.filter(row =>
      row && Number.isFinite(row.at) && row.at >= record.at - 86400000 && row.at <= record.at + 60000) : [];
    await cache.put(NOTIFY_LOG, Response.json([...recent.slice(-99), record]));
  }).catch(() => { /* Diagnostics must never break notification delivery. */ });
  return diagnosticWrite;
}

function detectLang() {
  const nav = self.navigator;
  const list = nav && nav.languages && nav.languages.length ? nav.languages : [nav?.language || ""];
  for (const item of list) {
    const tag = String(item || "").toLowerCase();
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

async function readLang() {
  try {
    const cached = await caches.open(PREF).then((cache) => cache.match("lang"));
    const value = cached ? await cached.text() : "";
    if (value === "en" || value === "zh") return value;
  } catch {
    /* private mode */
  }
  return detectLang();
}

function notificationCopy(data, lang) {
  const kind = typeof data.kind === "string" ? data.kind : "";
  const title = typeof data.title === "string" ? data.title : "";
  const blocked = kind === "needs_you" || title.includes("等待确认") || /waiting for you/i.test(title);
  const done = kind === "done" || title.includes("任务已完成") || title.includes("本轮结束") || /task complete|turn finished/i.test(title);
  const en = lang === "en";
  const copy = {
    blocked: en ? "Pairfob · Waiting for you" : "Pairfob · 等待确认",
    done: en ? "Pairfob · Turn finished" : "Pairfob · 本轮结束",
    body: en ? "Agent status updated" : "Agent 状态已更新",
    need: en ? "An agent needs you" : "Agent 需要你处理",
  };
  return {
    title: blocked ? copy.blocked : done ? copy.done : title || "Pairfob",
    body: typeof data.body === "string" && data.body ? data.body : blocked ? copy.need : copy.body,
  };
}

function shellAssetPaths(html) {
  return [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)["']/g)].map((match) => match[1]);
}

// Hashed dependency graphs belong to the HTML that named them. Download only
// its startup closure; visiting a deferred feature caches that feature's closure.
const chunkDependencies = new Map();
let graphRead;
const assetPath = value => typeof value === "string" && /^\/assets\/[A-Za-z0-9_.-]+$/.test(value);
function readAssetGraph(graph) {
  if (graph?.schema !== 1 || !Array.isArray(graph.startup) || !graph.startup.every(assetPath)
    || !graph.chunks || typeof graph.chunks !== "object" || Array.isArray(graph.chunks)) throw new Error("Invalid asset graph");
  for (const [file, dependencies] of Object.entries(graph.chunks)) {
    if (!assetPath(file) || !Array.isArray(dependencies) || !dependencies.every(assetPath)
      || !dependencies.includes(file)) throw new Error("Invalid chunk dependencies");
  }
  for (const [file, dependencies] of Object.entries(graph.chunks)) chunkDependencies.set(file, dependencies);
  return graph.startup;
}
function graphPath(html) {
  return html.match(/<meta name="pairfob-assets" content="(\/assets\/pwa-assets-[0-9a-f]{16}\.json)"\s*\/>/)?.[1];
}
async function restoreAssetGraphs() {
  if (!graphRead) graphRead = (async () => {
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      if (!/\/assets\/pwa-assets-[0-9a-f]{16}\.json$/.test(request.url)) continue;
      try { readAssetGraph(await (await cache.match(request)).json()); } catch { /* A corrupt graph cannot authorize dependencies. */ }
    }
  })();
  await graphRead;
}
async function precacheShell() {
  for (const path of SHELL) {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Shell unavailable");
    if (path === "/" || path === "/pair") await cacheShellResponse(path, response);
    else await cacheSuccessful(path, response);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("pairfob-shell-") && key !== CACHE && key !== PREVIOUS_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => recordNotificationDiagnostic("notify_sw_active")),
  );
});

async function cacheSuccessful(request, response) {
  if (response.ok && response.type === "basic") {
    await caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
  }
  return response;
}

async function cacheShellResponse(request, response) {
  if (!response.ok || response.type !== "basic") return response;
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  const assets = new Set(shellAssetPaths(html));
  const graphURL = graphPath(html);
  if (graphURL) {
    const graphResponse = await caches.match(graphURL) || await fetch(graphURL);
    if (!graphResponse.ok || graphResponse.type !== "basic") throw new Error("Asset graph unavailable");
    for (const file of readAssetGraph(await graphResponse.clone().json())) assets.add(file);
    await cache.put(graphURL, graphResponse);
  }
  // Publish HTML only once all files required to start THAT build are available.
  await Promise.all([...assets].map(cacheAsset));
  await cache.put(request, response.clone());
  return response;
}

const assetReads = new Map();
async function cacheAsset(request) {
  const key = new URL(typeof request === "string" ? request : request.url, self.location.origin).href;
  const cache = await caches.open(CACHE);
  const current = await cache.match(request);
  if (current) return current;
  const previous = await caches.match(request);
  if (previous) {
    // Own reused bytes before the older generation can be removed on upgrade.
    await cache.put(request, previous.clone());
    return previous;
  }
  let pending = assetReads.get(key);
  if (!pending) {
    pending = fetch(request).then(response => {
      if (!response.ok || response.type !== "basic") throw new Error("Asset unavailable");
      return cacheSuccessful(request, response);
    }).finally(() => assetReads.delete(key));
    assetReads.set(key, pending);
  }
  return (await pending).clone();
}

async function cacheFirst(request) {
  await restoreAssetGraphs();
  const path = new URL(typeof request === "string" ? request : request.url, self.location.origin).pathname;
  // Await static imports and CSS together. No dynamic children are prefetched.
  await Promise.all((chunkDependencies.get(path) || [path]).map(cacheAsset));
  return cacheAsset(request);
}

async function shellNetworkFirst(event, request, fallback) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request) || await cache.match(fallback)
    || await caches.match(request) || await caches.match(fallback);
  // Cache referenced hashed assets before publishing a newer HTML shell, so an
  // offline load never observes a half-updated app version.
  const network = fetch(request).then((response) => cacheShellResponse(request, response));
  if (!cached) return network.catch(() => Response.error());
  let timer;
  const grace = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SHELL_NETWORK_GRACE_MS); });
  const fresh = await Promise.race([network.catch(() => null), grace]);
  clearTimeout(timer);
  if (fresh?.ok) return fresh;
  event.waitUntil(network.catch(() => undefined));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/v2/")) return;
  // Runner owns a distinct sandbox/CSP; never substitute a cached app shell.
  if (url.pathname.startsWith("/preview/")) return;
  // Homepage Docs links to /doc/. Falling back to the cached marketing shell
  // makes that click look like it never left the landing page.
  if (url.pathname === "/doc" || url.pathname.startsWith("/doc/")) return;
  // Release checks must report network failure instead of a cached release.
  if (url.pathname === "/dl/VERSION") return;
  if (request.mode === "navigate") {
    const fallback = url.pathname.startsWith("/pair") ? "/pair" : "/";
    event.respondWith(shellNetworkFirst(event, request, fallback));
    return;
  }
  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
    event.respondWith(cacheFirst(request).catch(() => Response.error()));
    return;
  }
  event.respondWith(fetch(request).then((response) => cacheSuccessful(request, response)).catch(() => caches.match(request).then((hit) => hit || Response.error())));
});

function safeNotificationURL(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/pair", self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/pair" || url.search) return "/pair";
    if (!url.hash) return "/pair";
    const params = new URLSearchParams(url.hash.slice(1));
    const keys = [...params.keys()];
    const exactKeys = keys.length === 3 && new Set(keys).size === 3 && keys.every((key) => ["notify", "d", "pane"].includes(key));
    const validDaemon = /^d_[0-9a-f]{20}$/.test(params.get("d") || "");
    const validPane = /^[A-Za-z0-9._:-]{1,256}$/.test(params.get("pane") || "");
    return exactKeys && params.get("notify") === "1" && validDaemon && validPane ? url.pathname + url.hash : "/pair";
  } catch {
    return "/pair";
  }
}

self.addEventListener("message", (event) => {
  const lang = event.data && event.data.lang;
  if (!event.data || event.data.type !== "pairfob_lang") return;
  if (lang !== "en" && lang !== "zh" && lang !== "auto") return;
  event.waitUntil(caches.open(PREF).then((cache) => cache.put("lang", new Response(lang === "auto" ? "" : lang))));
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
    const copy = notificationCopy(data, await readLang());
    await self.registration.showNotification(copy.title, {
      body: copy.body,
      tag: typeof data.tag === "string" ? data.tag : "herd",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: safeNotificationURL(data.url) },
    });
    await recordNotificationDiagnostic("notify_sw_shown");
  })());
});

// Older pages do not speak the message protocol. Only fall back to navigation
// when capture was not acknowledged; a warm current page never needs a reload.
function deliverNotification(client, url, note) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (captured) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(captured);
    };
    const timer = setTimeout(() => { note("notify_sw_ack", { reason: "timeout" }); finish(false); }, 1000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "pairfob_notify_captured") {
        note("notify_sw_ack", { reason: "captured" });
        finish(true);
      }
    };
    try {
      client.postMessage({ type: "pairfob_notify", url }, [channel.port2]);
      note("notify_sw_message", { reason: "sent" });
    } catch { note("notify_sw_message", { reason: "error" }); finish(false); }
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeNotificationURL(event.notification.data?.url), self.location.origin).href;
  const writes = [];
  const deliveries = [];
  const note = (stage, details) => { writes.push(recordNotificationDiagnostic(stage, details)); };
  note("notify_sw_click", { reason: new URL(target).hash ? "ok" : "invalid_target" });
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      note("notify_sw_clients", { usable_count: clients.filter(client => {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname === "/pair" && "focus" in client;
      }).length, stored_count: clients.length });
      for (const client of clients) {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin || url.pathname !== "/pair" || !("focus" in client)) continue;
        note("notify_sw_selected", { hidden: client.visibilityState === "hidden" });
        const delivered = deliverNotification(client, target, note);
        deliveries.push(delivered);
        // Focus immediately, so a suspended app can receive and capture it.
        try {
          note("notify_sw_focus", { reason: "pending" });
          await client.focus();
          note("notify_sw_focus", { reason: "ok" });
          if (await delivered) return;
          if ("navigate" in client) {
            note("notify_sw_navigate", { reason: "pending" });
            const navigated = await client.navigate(target);
            note("notify_sw_navigate", { reason: navigated ? "ok" : "missing" });
            if (navigated) return;
          }
        } catch {
          note("notify_sw_client_error", { reason: "error" });
        }
      }
      note("notify_sw_open", { reason: "pending" });
      const opened = await self.clients.openWindow(target);
      note("notify_sw_open", { reason: opened ? "ok" : "missing" });
    } catch (error) {
      note("notify_sw_error", { reason: "error" });
      throw error;
    }
    finally {
      await Promise.all(deliveries);
      await Promise.all(writes);
    }
  })());
});
