import { expect, test } from "bun:test";
import { handleFetch } from "./worker";
import { testEnv } from "./testutil/make-room";

test("only successful hashed static files receive immutable caching", async () => {
  for (const [path, status, contentType, immutable] of [
    ["/assets/index-Bh3-XL1N.js", 200, "text/javascript", true],
    ["/assets/pwa-assets-1656704f509b6663.json", 200, "application/json", true],
    ["/assets/index-Bq1RtsGh.css", 200, "text/css", true],
    ["/assets/index.js", 200, "text/javascript", false],
    ["/assets/index-missing0.js", 404, "text/plain", false],
    ["/assets/index-fallback.js", 200, "text/html", false],
    ["/sw.js", 200, "text/javascript", false],
  ] as const) {
    const env = testEnv({ assets: { fetch: async () => new Response("body", { status, headers: { "Content-Type": contentType } }) } as Fetcher });
    const response = await handleFetch(new Request("https://pairfob.com" + path), env);
    expect(response.headers.get("Cache-Control")?.includes("immutable") ?? false, path).toBe(immutable);
  }
});
