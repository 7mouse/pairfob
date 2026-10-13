import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../public/sw.js", import.meta.url)).text();
const origin = "https://pairfob.com";
const graphURL = "/assets/pwa-assets-0123456789abcdef.json";
const html = `<script src="/assets/app-a.js"></script><meta name="pairfob-assets" content="${graphURL}" />`;
const graph = {
  schema: 1,
  startup: ["/assets/app-a.js", "/assets/base-b.css"],
  chunks: {
    "/assets/app-a.js": ["/assets/app-a.js", "/assets/base-b.css"],
    "/assets/session-c.js": ["/assets/app-a.js", "/assets/base-b.css", "/assets/session-c.js", "/assets/session-c.css"],
  },
};
function basic(body: string): Response {
  const response = new Response(body);
  // Native SW fetches are basic; Node's synthetic Responses have type default.
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}
function harness() {
  const cached = new Map<string, Response>();
  const previous = new Map<string, Response>();
  const network = new Map<string, string>([
    [graphURL, JSON.stringify(graph)], ["/assets/app-a.js", "app"], ["/assets/base-b.css", "base"],
    ["/assets/session-c.js", "session"], ["/assets/session-c.css", "session styles"],
  ]);
  const requests: string[] = [];
  const key = (request: string | Request) => new URL(typeof request === "string" ? request : request.url, origin).pathname;
  const cache = {
    match: async (request: string | Request) => cached.get(key(request))?.clone(),
    put: async (request: string | Request, response: Response) => { cached.set(key(request), response.clone()); },
    keys: async () => [...cached.keys()].map(path => new Request(origin + path)),
  };
  const read = async (request: string | Request) => {
    const path = key(request);
    requests.push(path);
    if (!network.has(path)) throw new Error(`Offline: ${path}`);
    return basic(network.get(path)!);
  };
  const scope = { location: { origin }, addEventListener() {} };
  const stores = { open: async () => cache, match: async (request: string | Request) =>
    (cached.get(key(request)) ?? previous.get(key(request)))?.clone() };
  const create = () => new Function("self", "caches", "fetch", `${source}\nreturn { cacheShellResponse, cacheFirst, readAssetGraph };`)(scope, stores, read) as {
    cacheShellResponse(request: string, response: Response): Promise<Response>;
    cacheFirst(request: Request): Promise<Response>;
    readAssetGraph(value: unknown): string[];
  };
  return { cached, previous, network, requests, create };
}

test("reused assets belong to the new shell before an older cache is deleted", async () => {
  const h = harness();
  h.previous.set("/assets/app-a.js", basic("old shared bytes"));
  h.network.delete("/assets/app-a.js");
  await h.create().cacheShellResponse("/pair", basic(html));
  h.previous.clear();
  h.network.clear();
  expect(await (await h.create().cacheFirst(new Request(origin + "/assets/app-a.js"))).text()).toBe("old shared bytes");
  expect(h.requests).not.toContain("/assets/app-a.js");
});

test("publishing a shell caches the startup graph without downloading deferred features", async () => {
  const h = harness();
  await h.create().cacheShellResponse("/pair", basic(html));
  expect([...h.cached.keys()].sort()).toEqual(["/pair", graphURL, "/assets/app-a.js", "/assets/base-b.css"].sort());
  expect(h.requests).not.toContain("/assets/session-c.js");
});

test("a failed startup dependency cannot replace the working cached HTML", async () => {
  const h = harness();
  h.cached.set("/pair", basic("old working shell"));
  h.network.delete("/assets/base-b.css");
  await expect(h.create().cacheShellResponse("/pair", basic(html))).rejects.toThrow();
  expect(await h.cached.get("/pair")!.text()).toBe("old working shell");
});

test("a restarted worker restores the graph and caches a visited feature's CSS before answering", async () => {
  const h = harness();
  await h.create().cacheShellResponse("/pair", basic(html));
  const worker = h.create();
  expect(await (await worker.cacheFirst(new Request(origin + "/assets/session-c.js"))).text()).toBe("session");
  expect(h.cached.has("/assets/session-c.css")).toBe(true);
  h.network.clear();
  expect(await (await h.create().cacheFirst(new Request(origin + "/assets/session-c.js"))).text()).toBe("session");
});

test("an unvisited feature fails offline without replacing a cached shell", async () => {
  const h = harness();
  const worker = h.create();
  await worker.cacheShellResponse("/pair", basic(html));
  h.network.clear();
  await expect(worker.cacheFirst(new Request(origin + "/assets/session-c.js"))).rejects.toThrow();
  expect(await h.cached.get("/pair")!.text()).toBe(html);
});

test("asset metadata cannot authorize API, traversal or external requests", () => {
  const worker = harness().create();
  for (const path of ["/api/config", "/assets/../api/config", "https://elsewhere.test/a.js"]) {
    expect(() => worker.readAssetGraph({ ...graph, startup: [path] })).toThrow();
    expect(() => worker.readAssetGraph({ ...graph, chunks: { "/assets/app-a.js": [path] } })).toThrow();
  }
});

test("an icon face is cached when a page first asks for it, and served offline after", async () => {
  const face = "/assets/symbols-nerd-font-bmp-BZeCxFc0.woff2";
  const h = harness();
  h.network.set(face, "glyphs");
  await h.create().cacheShellResponse("/pair", basic(html));
  expect(h.requests).not.toContain(face);
  expect(await (await h.create().cacheFirst(new Request(origin + face))).text()).toBe("glyphs");
  h.network.clear();
  expect(await (await h.create().cacheFirst(new Request(origin + face))).text()).toBe("glyphs");
  expect(h.requests.filter(path => path === face)).toEqual([face]);
});
