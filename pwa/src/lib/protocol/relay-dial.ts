import type { RecoveryClock } from "./recovery-diagnostics";
import { recordConnectionDiagnostic } from "./connection-diagnostics.ts";
import { jsonFrame, Typ } from "./envelope.ts";
import { ProtocolError } from "./errors.ts";
import { openWS, Z16, type FrameSocket } from "./frame-socket.ts";
import { helloClientBody, muxProtocolFromRelayURL, muxSubprotocol, sessionAttachBody } from "./mux.ts";
import type { PairResult } from "./pair-ws.ts";
import type { HelloBudget } from "./reconnect-policy.ts";
import { awaitSessionBound, beginSessionEpoch, type SessionHello } from "./session-handshake.ts";
import { sendFlightReads, SessionTransport, type FlightRead, type SentRead } from "./session-transport.ts";
import type { SessionEvent } from "./session-types.ts";

let nextConnectID = Date.now();
export function connectionTrace(warm = false, recovery?: RecoveryClock): (event: string, code?: string) => void {
  const connectID = ++nextConnectID;
  const started = performance.now();
  const trace = (event: string, code?: string) => recordConnectionDiagnostic({
    ...recovery?.(), event, code, transport: "relay", connect_id: connectID, elapsed_ms: performance.now() - started,
  });
  trace(warm ? "warmup_start" : "connect_start");
  return trace;
}

/**
 * How one logical session orders its dials. Both start true; each falls back
 * for the rest of the session when a relay or computer refuses the faster
 * order, so a refusal costs one dial instead of every later one.
 */
export type DialStyle = {
  /** DeviceHello1 rides with SESSION_ATTACH instead of waiting for SESSION_BOUND. */
  helloAhead: boolean;
  /** The first reads ride with DeviceHello3 instead of waiting for SESSION_ESTABLISHED. */
  readsAhead: boolean;
};

export type DialContext = { relayWS: string; pair: PairResult; style: DialStyle; budget?: HelloBudget };
export type RelayConnection = { transport: SessionTransport; reads: readonly SentRead[] };

/**
 * One relay dial in two flights: HELLO_CLIENT + SESSION_ATTACH + DeviceHello1,
 * then DeviceHello3 + the first reads. It can rest between them: the computer
 * keeps the device's established route until DeviceHello3 arrives.
 */
export class RelayDial {
  private hello: Promise<SessionHello> | null = null;
  private bound = false;

  constructor(readonly socket: FrameSocket, readonly trace: ReturnType<typeof connectionTrace>) {}

  static async open(relayWS: string, trace: ReturnType<typeof connectionTrace>, signal?: AbortSignal): Promise<RelayDial> {
    const socket = await openWS(relayWS, muxSubprotocol(muxProtocolFromRelayURL(relayWS)), signal);
    trace("ws_open");
    return new RelayDial(socket, trace);
  }

  /** First flight, sent once. Nothing in it replaces the device's live route. */
  async start(context: DialContext): Promise<void> {
    if (!this.hello) {
      const { relayWS, pair, style, budget } = context;
      const protocol = muxProtocolFromRelayURL(relayWS);
      const begin = (routeId: Uint8Array | null) => {
        budget?.spend();
        const hello = beginSessionEpoch(this.socket, routeId, pair, protocol, (stage) => {
          if (stage === "route_bound") this.bound = true;
          this.trace(stage);
        });
        this.trace("hello_sent");
        return hello;
      };
      try {
        this.socket.send(jsonFrame(Typ.HELLO_CLIENT, Z16, helloClientBody(protocol)));
        this.socket.send(jsonFrame(Typ.SESSION_ATTACH, Z16, sessionAttachBody(protocol, pair.daemonId)));
        this.hello = style.helloAhead
          ? Promise.resolve(begin(null))
          : awaitSessionBound(this.socket).then((routeId) => { this.trace("route_bound"); return begin(routeId); });
      } catch (error) {
        this.hello = Promise.reject(error);
      }
      this.hello.catch(() => undefined);
    }
    try {
      await (await this.hello).verified;
    } catch (error) {
      // A DeviceHello1 that overtook the bind is refused as unbound, or forwarded
      // to a computer that does not know the route yet and never answered.
      const code = error instanceof ProtocolError ? error.code : "";
      if (code === "unbound" || (code === "timeout" && this.bound)) context.style.helloAhead = false;
      throw error;
    }
  }

  /** Second flight. DeviceHello3 replaces the device's previous route on the computer. */
  async establish(
    context: DialContext,
    emit: (event: SessionEvent) => void,
    reads: readonly FlightRead[],
    recovery?: RecoveryClock,
  ): Promise<RelayConnection> {
    await this.start(context);
    const hello = await this.hello!;
    const { style } = context;
    let sent: SentRead[] = [];
    const epoch = await hello.finish(style.readsAhead
      ? (epoch) => { sent = sendFlightReads(this.socket, epoch, [{ op: "Ping", params: { t_ms: Date.now() } }, ...reads]); }
      : undefined).catch((error) => {
      // An answer that overtook SESSION_ESTABLISHED is not a frame the handshake accepts.
      if (sent.length && error instanceof ProtocolError && error.code === "bad_message") style.readsAhead = false;
      throw error;
    });
    const transport = new SessionTransport(this.socket, epoch.routeId, epoch.c2s, epoch.s2c, emit, sent);
    transport.recoveryDiagnostic = recovery;
    try {
      // A fresh encrypted response is still required before enabling operations.
      await (sent[0]?.answer ?? transport.rpc("Ping", { t_ms: Date.now() }, 8_000));
    } catch (error) {
      // Established, yet the reads sent ahead of it went unanswered.
      if (sent.length && error instanceof ProtocolError && error.code === "timeout") style.readsAhead = false;
      transport.close();
      throw error;
    }
    return { transport, reads: sent.slice(1) };
  }

  close(reason = "session handshake failed"): void {
    this.socket.close(1000, reason);
  }
}
