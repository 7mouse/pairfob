import { describe, expect, test } from "bun:test";

const worker = await Bun.file(new URL("../public/sw.js", import.meta.url)).text();

type URLSanitizer = (value: unknown) => string;
type ShellStrategy = (
  event: { waitUntil: (promise: Promise<unknown>) => void },
  request: Request,
  fallback: string,
) => Promise<Response>;

function loadURLSanitizer(): URLSanitizer {
  const scope = {
    location: { origin: "https://pairfob.com" },
    addEventListener: () => undefined,
  };
  return new Function("self", `${worker}\nreturn safeNotificationURL;`)(scope) as URLSanitizer;
}

function loadShellStrategy(options: {
  cached: Response;
  fetchImpl: () => Promise<Response>;
  setTimer?: (callback: () => void) => number;
}): ShellStrategy {
  const scope = { location: { origin: "https://pairfob.com" }, addEventListener: () => undefined };
  const caches = {
    match: async () => options.cached,
    open: async () => ({ addAll: async () => undefined, put: async () => undefined, match: async () => options.cached }),
    keys: async () => [],
    delete: async () => true,
  };
  const setTimer = options.setTimer || (() => 1);
  return new Function(
    "self",
    "caches",
    "fetch",
    "setTimeout",
    "clearTimeout",
    `${worker}\nreturn shellNetworkFirst;`,
  )(scope, caches, options.fetchImpl, setTimer, () => undefined) as ShellStrategy;
}

describe("notification service worker", () => {
  test("shows a notification and revalidates its same-origin deep link on click", () => {
    expect(worker).toContain('self.addEventListener("push"');
    expect(worker).toContain('self.addEventListener("notificationclick"');
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain('url.pathname !== "/pair"');
    expect(worker).toContain("safeNotificationURL(event.notification.data?.url)");
  });

  test("serves the repeat-load shell immediately and caches immutable assets first", () => {
    expect(worker).toContain('const CACHE = "pairfob-shell-v13"');
    expect(worker).toContain("precacheShell()");
    expect(worker).toContain("shellAssetPaths(html)");
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain("shellNetworkFirst(event, request, fallback)");
    expect(worker).toContain("SHELL_NETWORK_GRACE_MS = 750");
    expect(worker).toContain('url.pathname.startsWith("/assets/")');
    expect(worker).toContain("cacheFirst(request)");
    expect(worker).toContain("cacheShellResponse(request, response)");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname === "/doc" || url.pathname.startsWith("/doc/")');
  });

  test("uses a fresh shell on a healthy network", async () => {
    const strategy = loadShellStrategy({
      cached: new Response("cached"),
      fetchImpl: async () => new Response("fresh"),
    });
    const response = await strategy({ waitUntil: () => undefined }, new Request("https://pairfob.com/pair"), "/pair");
    expect(await response.text()).toBe("fresh");
  });

  test("falls back to the cached shell after the mobile grace period", async () => {
    let backgrounded = false;
    const strategy = loadShellStrategy({
      cached: new Response("cached"),
      fetchImpl: () => new Promise<Response>(() => undefined),
      setTimer: (callback) => { callback(); return 1; },
    });
    const response = await strategy({ waitUntil: () => { backgrounded = true; } }, new Request("https://pairfob.com/pair"), "/pair");
    expect(await response.text()).toBe("cached");
    expect(backgrounded).toBeTrue();
  });

  test("keeps the working cache when shell revalidation returns an error", async () => {
    const strategy = loadShellStrategy({
      cached: new Response("cached"),
      fetchImpl: async () => new Response("temporary failure", { status: 503 }),
    });
    const response = await strategy({ waitUntil: () => undefined }, new Request("https://pairfob.com/pair"), "/pair");
    expect(await response.text()).toBe("cached");
  });

  test("localizes push titles from kind or fallback copy", () => {
    const scope = {
      location: { origin: "https://pairfob.com" },
      addEventListener: () => undefined,
    };
    const copy = new Function("self", `${worker}\nreturn notificationCopy;`)(scope) as (
      data: Record<string, string>,
      lang: string,
    ) => { title: string; body: string };
    expect(copy({ kind: "needs_you", body: "claude · lab" }, "en")).toEqual({
      title: "Pairfob · Waiting for you",
      body: "claude · lab",
    });
    expect(copy({ kind: "done" }, "zh").title).toBe("Pairfob · 本轮结束");
    expect(copy({ title: "Pairfob · 等待确认" }, "en").title).toBe("Pairfob · Waiting for you");
    expect(copy({}, "en").body).toBe("Agent status updated");
    expect(copy({}, "zh").body).toBe("Agent 状态已更新");
  });

  test("accepts only the exact private fragment target", () => {
    const sanitize = loadURLSanitizer();
    const valid = "/pair#d=d_0123456789abcdefabcd&notify=1&pane=w0%3Ap1";
    expect(sanitize(valid)).toBe(valid);
    expect(sanitize("https://evil.example/pair#d=d_0123456789abcdefabcd&notify=1&pane=w0:p1")).toBe("/pair");
    expect(sanitize("/other#d=d_0123456789abcdefabcd&notify=1&pane=w0:p1")).toBe("/pair");
    expect(sanitize("/pair?next=/other#d=d_0123456789abcdefabcd&notify=1&pane=w0:p1")).toBe("/pair");
    expect(sanitize("/pair#d=d_0123456789abcdefabcd&notify=1&notify=1&pane=w0:p1")).toBe("/pair");
    expect(sanitize("/pair#d=d_0123456789abcdefabcd&notify=1&pane=/private/path")).toBe("/pair");
  });
});

test("release metadata bypasses offline cache fallback", () => {
  let handler: ((event: unknown) => void) | undefined;
  const scope = {location:{origin:"https://pairfob.com"},addEventListener:(name:string,fn:(event:unknown)=>void)=>{if(name==="fetch")handler=fn}};
  new Function("self", worker)(scope);
  let intercepted=false;
  handler!({request:new Request("https://pairfob.com/dl/VERSION"),respondWith:()=>{intercepted=true}});
  expect(intercepted).toBeFalse();
});


test("preview navigation bypasses shell caching and fallback", () => {
  let handler: ((event: unknown) => void) | undefined;
  const scope = { location: { origin: "https://pairfob.com" }, addEventListener: (name: string, fn: (event: unknown) => void) => { if (name === "fetch") handler = fn; } };
  new Function("self", worker)(scope);
  let intercepted = false;
  handler!({ request: new Request("https://pairfob.com/preview/runner.html"), respondWith: () => { intercepted = true; } });
  expect(intercepted).toBeFalse();
});

type DownloadHarness = {
  response: (url: string) => Response;
  channels: Array<{ messages: any[]; onmessage: ((event: { data: any }) => void) | null; closed: boolean }>;
  disposition: (name: string) => string;
};
function downloadHarness(): DownloadHarness {
  const channels: DownloadHarness["channels"] = [];
  class FakeChannel {
    messages: any[] = [];
    onmessage: ((event: { data: any }) => void) | null = null;
    closed = false;
    constructor(_name: string) { channels.push(this as any); }
    postMessage(data: any) { this.messages.push(data); }
    close() { this.closed = true; }
  }
  const scope = { location: { origin: "https://pairfob.com" }, addEventListener: () => undefined };
  const loaded = new Function(
    "self",
    "BroadcastChannel",
    "setTimeout",
    "clearTimeout",
    `${worker}\nreturn { downloadStreamResponse, downloadDisposition };`,
  )(scope, FakeChannel, () => 1, () => undefined) as {
    downloadStreamResponse: (url: URL) => Response;
    downloadDisposition: (name: string) => string;
  };
  return {
    response: (url) => loaded.downloadStreamResponse(new URL(url)),
    channels,
    disposition: loaded.downloadDisposition,
  };
}

test("the service worker serves a page-driven download stream", async () => {
  const harness = downloadHarness();
  const id = "a".repeat(32);
  const response = harness.response(`https://pairfob.com/__pairfob_download__/${id}?name=app.zip&size=3&mime=application/zip`);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-length")).toBe("3");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  const reader = response.body!.getReader();
  const pending = reader.read();
  await Promise.resolve();
  const channel = harness.channels[0];
  expect(channel.messages.some((message) => message.type === "need")).toBe(true);
  channel.onmessage!({ data: { type: "chunk", id, bytes: new Uint8Array([1, 2, 3]).buffer, eof: true } });
  const first = await pending;
  expect(first.done).toBe(false);
  expect([...first.value!]).toEqual([1, 2, 3]);
  expect(channel.messages.some((message) => message.type === "done")).toBe(true);
  expect((await reader.read()).done).toBe(true);
});

test("the download route rejects malformed sizes and escapes the filename header", async () => {
  const harness = downloadHarness();
  expect(harness.response("https://pairfob.com/__pairfob_download__/short?name=a&size=1").status).toBe(400);
  const disposition = harness.disposition('报告"\\\n.bin');
  expect(disposition).toContain('filename="');
  expect(disposition).toContain("filename*=UTF-8''");
  expect(disposition).not.toContain("\n");
});

for (const type of ["cancel", "error"] as const) {
  for (const queued of [false, true]) {
    test(`download ${type} errors the stream with ${queued ? "a queued chunk" : "a pending pull"}`, async () => {
      const harness = downloadHarness();
      const id = "c".repeat(32);
      const response = harness.response(`https://pairfob.com/__pairfob_download__/${id}?name=a.bin&size=2`);
      // Let the stream request its first chunk without a reader consuming it.
      await Promise.resolve();
      const channel = harness.channels[0];
      expect(channel.messages.filter((message) => message.type === "need")).toHaveLength(1);
      if (queued) {
        channel.onmessage!({ data: { type: "chunk", id, bytes: new Uint8Array([1]), eof: false } });
        await Promise.resolve();
        expect(channel.messages.filter((message) => message.type === "need")).toHaveLength(1);
      }
      channel.onmessage!({ data: { type, id, message: "source failed" } });
      expect(channel.closed).toBe(true);
      const reader = response.body!.getReader();
      const message = type === "cancel" ? "download canceled" : "source failed";
      try {
        await expect(reader.read()).rejects.toThrow(message);
        await expect(reader.closed).rejects.toThrow(message);
        expect(channel.messages.filter((message) => message.type === "need")).toHaveLength(1);
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    });
  }
}

test("the service worker recognizes a download route inside its /pair scope", async () => {
  const harness = downloadHarness();
  const id = "b".repeat(32);
  const response = harness.response(`https://pairfob.com/pair/__pairfob_download__/${id}?name=app.zip&size=1&mime=application/zip`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const pending = reader.read();
  await Promise.resolve();
  const channel = harness.channels[0];
  channel.onmessage!({ data: { type: "chunk", id, bytes: new Uint8Array([9]).buffer, eof: true } });
  expect([...(await pending).value!]).toEqual([9]);
  await reader.cancel();
});
