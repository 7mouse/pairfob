import { expect, test } from "bun:test";
import worker from "./index";

const env = (status = 200) => ({ ASSETS: { fetch: async () => new Response("asset", { status }) } });
const request = (path: string, origin?: string) => new Request(`https://dl.pairfob.com${path}`, {
  headers: origin ? { Origin: origin } : {},
});

test("manifests never cache and only grant CORS to the bundled app", async () => {
  for (const origin of ["https://localhost", "https://untrusted.example", undefined]) {
    const response = await worker.fetch(request("/android/beta/latest.json", origin), env());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin === "https://localhost" ? origin : null);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  }
});

test("only successful APK responses are immutable", async () => {
  for (const status of [200, 404, 500]) {
    const response = await worker.fetch(request("/android/beta/pairfob-1.0.0-beta.13-13.apk"), env(status));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe(status === 200
      ? "public, max-age=31536000, immutable" : "no-store");
    expect(response.headers.get("Content-Type")).toBe("application/vnd.android.package-archive");
  }
});

test("preflight grants only the app origin and does not read assets", async () => {
  const response = await worker.fetch(new Request("https://dl.pairfob.com/android/beta/latest.json", {
    method: "OPTIONS", headers: { Origin: "https://localhost" },
  }), { ASSETS: { fetch: async () => { throw new Error("unexpected asset request"); } } });
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
});
