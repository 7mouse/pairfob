import { expect, test } from "bun:test";
import { pairOverWS } from "../src/lib/protocol/pair-ws";

test("cancelling while pairing code loads never opens a WebSocket", async () => {
  const original = globalThis.WebSocket;
  let opened = 0;
  globalThis.WebSocket = class { constructor() { opened++; throw new Error("Unexpected transport"); } } as typeof WebSocket;
  try {
    const abort = new AbortController();
    const result = pairOverWS("wss://pairfob.com/v2/ws?role=client", { pair_ref: "a".repeat(32) }, "ABCDEFGH", {
      protocol: 2, signal: abort.signal,
    });
    abort.abort();
    await expect(result).rejects.toMatchObject({ code: "pairing_cancelled" });
    expect(opened).toBe(0);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("invalid input is rejected before loading or opening a transport", async () => {
  await expect(pairOverWS("wss://pairfob.com/v2/ws", {}, "bad", { protocol: 2 }))
    .rejects.toMatchObject({ code: "invalid_pair_code" });
});
