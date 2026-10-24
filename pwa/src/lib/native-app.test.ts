import { expect, test } from "bun:test";
import { createNativeApp, type NativeMessagePort } from "./native-app";

function fixture(timeout = 1000) {
  const sent: Array<{ id: string; method: string; url?: string }> = [];
  const port: NativeMessagePort = {
    postMessage: (message) => { sent.push(JSON.parse(message)); },
    onmessage: null,
  };
  const app = createNativeApp(port, timeout);
  const reply = (index: number, value: unknown, ok = true) => {
    port.onmessage?.({ data: JSON.stringify({ id: sent[index].id, ok, value }) });
  };
  return { app, port, sent, reply };
}

test("native replies correlate out of order without evaluating page code", async () => {
  const { app, sent, reply } = fixture();
  const info = app.getInfo();
  const manifest = app.fetchText("https://dl.pairfob.com/android/beta/latest.json");
  expect(sent.map((item) => item.method)).toEqual(["getInfo", "fetchText"]);
  reply(1, "{\"versionCode\":13}");
  reply(0, { name: "Pairfob", id: "com.pairfob.app", version: "1.0.0-beta.13", build: "13" });
  expect((await info).build).toBe("13");
  expect(await manifest).toBe('{"versionCode":13}');
});

test("native denial and browser intent failures reject the caller", async () => {
  const { app, reply } = fixture();
  const opened = app.openUrl({ url: "https://untrusted.example/a.apk" });
  reply(0, "blocked", false);
  await expect(opened).rejects.toThrow("native update request failed");
});

test("startup and Settings share an in-flight check and can retry after failure", async () => {
  const { app, sent, reply } = fixture();
  const startup = app.fetchText("manifest");
  const settings = app.fetchText("manifest");
  expect(sent).toHaveLength(1);
  reply(0, "failed", false);
  expect((await Promise.allSettled([startup, settings])).map((result) => result.status))
    .toEqual(["rejected", "rejected"]);
  const retry = app.fetchText("manifest");
  expect(sent).toHaveLength(2);
  reply(1, "release");
  expect(await retry).toBe("release");
});

test("missing native replies time out and late replies cannot settle another request", async () => {
  const { app, port, reply } = fixture(10);
  const missing = app.fetchText("https://dl.pairfob.com/android/beta/latest.json");
  port.onmessage?.({ data: "not JSON" });
  port.onmessage?.({ data: "null" });
  await expect(missing).rejects.toThrow("timed out");
  const next = app.fetchText("https://dl.pairfob.com/android/beta/latest.json");
  reply(0, "old");
  reply(1, "new");
  expect(await next).toBe("new");
});

test("synchronous transport failures and malformed responses reject", async () => {
  const { app, port, reply } = fixture();
  const invalid = app.getInfo();
  reply(0, null);
  await expect(invalid).rejects.toThrow("invalid native app info");
  const text = app.fetchText("url");
  reply(1, { wrong: true });
  await expect(text).rejects.toThrow("invalid native response");
  port.postMessage = () => { throw new Error("bridge gone"); };
  await expect(app.getInfo()).rejects.toThrow("bridge gone");
});
