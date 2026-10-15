import { describe, expect, test } from "bun:test";
import { Direction, DIR_C, DIR_S } from "./aead.ts";
import { connectionDiagnostics } from "./connection-diagnostics.ts";
import { DataFrameChannel } from "./data-channel.ts";
import { decodeUTF8, Typ, type Frame } from "./envelope.ts";
import { ProtocolError } from "./errors.ts";
import type { FrameChannel } from "./frame-channel.ts";
import { directFailureDiagnostic } from "./direct-peer.ts";
import { commitDirectSession, restartDirectSession, type PreparedDirectSession } from "./session-upgrade.ts";
import { SessionTransport } from "./session-transport.ts";

class DirectLoopback implements FrameChannel {
  readonly kind = "p2p" as const;
  private handler: ((frame: Frame) => void) | null = null;
  private closeHandlers = new Set<(error: ProtocolError) => void>();
  private readonly fromClient: Direction;
  private readonly toClient: Direction;

  constructor(private readonly routeId: Uint8Array, c2sKey: Uint8Array, s2cKey: Uint8Array, private readonly mute = false) {
    this.fromClient = new Direction(c2sKey, DIR_C);
    this.toClient = new Direction(s2cKey, DIR_S);
  }

  send(frame: Frame): void {
    if (frame.typ === Typ.PING) {
      queueMicrotask(() => this.handler?.({ ...frame, typ: Typ.PONG }));
      return;
    }
    if (this.mute) return;
    const request = JSON.parse(decodeUTF8(this.fromClient.open(this.routeId, frame.payload))) as { id: string };
    const body = new TextEncoder().encode(JSON.stringify({ v: 1, id: request.id, ok: true, result: { pong: true } }));
    const payload = this.toClient.seal(this.routeId, body);
    queueMicrotask(() => this.handler?.({ version: 1, typ: Typ.FWD, flags: 0, routeId: this.routeId, payload }));
  }

  close(): void {
    for (const handler of this.closeHandlers) handler(new ProtocolError("closed", "closed"));
  }

  next(): Promise<Frame> { return Promise.reject(new Error("unused")); }
  use(handler: (frame: Frame) => void): void { this.handler = handler; }
  onClose(handler: (error: ProtocolError) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
}

function directCandidate(mute = false): PreparedDirectSession {
  const routeId = new Uint8Array(16);
  routeId[0] = 7;
  const c2sKey = new Uint8Array(32).fill(3);
  const s2cKey = new Uint8Array(32).fill(5);
  const channel = new DirectLoopback(routeId, c2sKey.slice(), s2cKey.slice(), mute);
  return {
    attemptId: "p2p_0123456789abcdef",
    iceGathering: "complete",
    channel,
    epoch: {
      routeId,
      c2s: new Direction(c2sKey, DIR_C),
      s2c: new Direction(s2cKey, DIR_S),
    },
    close: () => channel.close(),
  };
}

describe("atomic direct commit", () => {
  test("commits once and proves the new encrypted route", async () => {
    const calls: string[] = [];
    const relay = {
      kind: "relay",
      rpc: async (op: string, params: unknown) => {
        calls.push(op);
        const request = params as { attempt_id: string; route_id: string };
        return { attempt_id: request.attempt_id, route_id: request.route_id, transport: "webrtc" };
      },
      carryOut: () => { calls.push("carryOut"); return { pending: new Map(), late: new Map() }; },
    } as unknown as SessionTransport;
    const result = await commitDirectSession(relay, directCandidate(), () => undefined);
    expect(calls).toEqual(["TransportCommit", "carryOut"]);
    expect(result.transport.kind).toBe("p2p");
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
    result.transport.close();
  });

  test("an uncertain relay reply is resolved by probing direct without replaying commit", async () => {
    let calls = 0;
    const relay = {
      kind: "relay",
      rpc: async () => {
        calls++;
        throw new ProtocolError("timeout", "reply lost");
      },
    } as unknown as SessionTransport;
    const result = await commitDirectSession(relay, directCandidate(), () => undefined);
    expect(calls).toBe(1);
    expect(result.transport.kind).toBe("p2p");
    result.transport.close();
  });

  test("rejects a non-exact commit acknowledgment", async () => {
    const relay = {
      kind: "relay",
      rpc: async () => ({ attempt_id: "p2p_0123456789abcdef", route_id: "00".repeat(16), transport: "webrtc", extra: true }),
    } as unknown as SessionTransport;
    const error = await commitDirectSession(relay, directCandidate(), () => undefined).catch((caught) => caught);
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe("bad_message");
    expect(directFailureDiagnostic(error)).toBe("commit");
  });
});

describe("a candidate whose relay dropped under the commit", () => {
  const lostRelay = {
    kind: "relay",
    rpc: async () => { throw new ProtocolError("disconnected", "relay lost"); },
  } as unknown as SessionTransport;

  test("is given up the moment its replacement is ready, without waiting out the Ping", async () => {
    const abandon = new AbortController();
    const events: string[] = [];
    const started = performance.now();
    const pending = commitDirectSession(lostRelay, directCandidate(true), (event) => events.push(event.type), abandon.signal)
      .catch((caught) => caught);
    await Bun.sleep(10);
    abandon.abort();
    const error = await pending;
    expect(directFailureDiagnostic(error)).toBe("cancelled");
    expect(performance.now() - started).toBeLessThan(500);
    expect(events).toEqual([]);
    expect(connectionDiagnostics().at(-1)).toMatchObject({ event: "session_close", transport: "p2p", reason: "standby_ready" });
  });

  test("is given up at once when the replacement was ready before the commit failed", async () => {
    const abandon = new AbortController();
    abandon.abort();
    const started = performance.now();
    const error = await commitDirectSession(lostRelay, directCandidate(true), () => undefined, abandon.signal).catch((caught) => caught);
    expect(directFailureDiagnostic(error)).toBe("cancelled");
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("carries the session when it answers first, whatever happens to the replacement later", async () => {
    const abandon = new AbortController();
    const result = await commitDirectSession(lostRelay, directCandidate(), () => undefined, abandon.signal);
    abandon.abort();
    await expect(result.transport.rpc("Ping", { t_ms: 1 }, 200)).resolves.toBeDefined();
    result.transport.close();
  });
});

describe("in-band ICE restart", () => {
  test("treats an unknown_op daemon as unsupported without closing the channel", async () => {
    const transport = {
      kind: "p2p",
      rpc: async () => {
        throw new ProtocolError("unknown_op", "TransportRestart");
      },
    } as unknown as SessionTransport;
    const channel = {
      pauseIceWatch() {},
      resumeIceWatch() {},
      peerConnection() {
        return {
          createOffer: async () => ({ type: "offer", sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" }),
          setLocalDescription: async () => undefined,
          setRemoteDescription: async () => undefined,
          localDescription: { sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 UDP 1 192.0.2.1 5000 typ host\r\n" },
          iceGatheringState: "complete",
          addEventListener() {},
          removeEventListener() {},
        };
      },
    } as unknown as DataFrameChannel;
    await expect(restartDirectSession(transport, channel)).resolves.toBe("unsupported");
  });
});
