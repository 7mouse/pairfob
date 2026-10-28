import { expect, test } from "bun:test";
import {
  downloadBasePath,
  SERVICE_WORKER_DOWNLOAD_ROUTE,
  startServiceWorkerDownload,
  type DownloadChannel,
  type DownloadFrame,
} from "./download-pump";

const id = "a".repeat(32);

function harness(source: () => Promise<{ bytes: Uint8Array; eof: boolean }>, base?: string) {
  const messages: Array<{ data: Record<string, unknown>; transfer?: Transferable[] }> = [];
  let closed = false;
  const channel: DownloadChannel = {
    onmessage: null,
    postMessage(data, transfer) { messages.push({ data: data as Record<string, unknown>, transfer }); },
    close() { closed = true; },
  };
  const frame: DownloadFrame & { removed: boolean } = {
    src: "", removed: false, remove() { this.removed = true; },
  };
  const download = startServiceWorkerDownload(
    { name: "artifact.bin", size: 3, mime: "application/octet-stream" },
    source,
    { channel, frame, id, origin: "https://pairfob.test", base: base ?? "/", timeoutMs: 10_000 },
  );
  return { channel, frame, download, messages, closed: () => closed };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the worker pulls one chunk at a time and the page posts it back", async () => {
  let reads = 0;
  const h = harness(async () => {
    reads += 1;
    return { bytes: new Uint8Array([1, 2, 3]), eof: true };
  });
  expect(h.frame.src).toBe(`https://pairfob.test${SERVICE_WORKER_DOWNLOAD_ROUTE}${id}?name=artifact.bin&size=3&mime=application%2Foctet-stream`);

  h.channel.onmessage!({ data: { type: "need", id: "other" } });
  await flush();
  expect(reads).toBe(0);

  h.channel.onmessage!({ data: { type: "need", id } });
  await flush();
  expect(reads).toBe(1);
  const chunk = h.messages.find((message) => message.data.type === "chunk");
  expect(chunk?.data.eof).toBe(true);
  expect(chunk?.transfer?.length).toBe(1);

  h.channel.onmessage!({ data: { type: "done", id } });
  await h.download.promise;
  expect(h.frame.removed).toBe(true);
  expect(h.closed()).toBe(true);
});

test("a cancel tells the worker and rejects without reading again", async () => {
  let release!: (value: { bytes: Uint8Array; eof: boolean }) => void;
  const h = harness(() => new Promise((resolve) => { release = resolve; }));
  h.channel.onmessage!({ data: { type: "need", id } });
  await flush();
  h.download.cancel();
  await expect(h.download.promise).rejects.toThrow("取消下载");
  expect(h.messages.some((message) => message.data.type === "cancel")).toBe(true);
  expect(h.frame.removed).toBe(true);
  release({ bytes: new Uint8Array(), eof: true });
  await flush();
});

test("a source failure posts an error and rejects", async () => {
  const h = harness(async () => { throw new Error("session lost"); });
  h.channel.onmessage!({ data: { type: "need", id } });
  await expect(h.download.promise).rejects.toThrow("session lost");
  expect(h.messages.some((message) => message.data.type === "error")).toBe(true);
  expect(h.frame.removed).toBe(true);
});

test("the download route follows the page's /pair service-worker scope", async () => {
  expect(downloadBasePath("/")).toBe("/");
  expect(downloadBasePath("/pair")).toBe("/pair/");
  expect(downloadBasePath("/pair/")).toBe("/pair/");
  expect(downloadBasePath("/qa/index.html")).toBe("/");
  const h = harness(async () => ({ bytes: new Uint8Array(), eof: true }), "/pair/");
  expect(h.frame.src).toBe(`https://pairfob.test/pair${SERVICE_WORKER_DOWNLOAD_ROUTE}${id}?name=artifact.bin&size=3&mime=application%2Foctet-stream`);
  h.download.cancel();
  await expect(h.download.promise).rejects.toThrow("取消下载");
});
