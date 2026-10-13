import type { RecoveryClock } from "./recovery-diagnostics";
import { ProtocolError } from "./errors.ts";
import type { PairResult } from "./pair-ws.ts";
import type { HelloBudget } from "./reconnect-policy.ts";
import { connectionTrace, RelayDial, type DialStyle, type RelayConnection } from "./relay-dial.ts";
import type { RelayWarmup } from "./relay-warmup.ts";
import type { SessionTransport, FlightRead } from "./session-transport.ts";
import type { SessionEvent } from "./session-types.ts";

export type FirstFlight = {
  /** Reads sent with DeviceHello3; their answers come back with the transport. */
  reads?: readonly FlightRead[];
  style?: DialStyle;
  budget?: HelloBudget;
};

/** One authenticated relay attempt; timing includes speculative preparation, if any. */
export async function connectSession(
  relayWS: string,
  pair: PairResult,
  emit: (event: SessionEvent) => void,
  signal?: AbortSignal,
  warmup?: RelayWarmup,
  recovery?: RecoveryClock,
  first: FirstFlight = {},
): Promise<RelayConnection> {
  const context = { relayWS, pair, style: first.style ?? { helloAhead: true, readsAhead: true }, budget: first.budget };
  let dial = await warmup?.take(signal) ?? undefined;
  const trace = dial?.trace ?? connectionTrace(false, recovery);
  let transport: SessionTransport | undefined;
  const abort = () => dial?.close("connection cancelled");
  try {
    dial ??= await RelayDial.open(relayWS, trace, signal);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) throw new ProtocolError("disconnected", "连接已取消");
    const connection = await dial.establish(context, emit, first.reads ?? [], recovery);
    transport = connection.transport;
    if (signal?.aborted) throw new ProtocolError("disconnected", "连接已取消");
    trace("session_ready");
    return connection;
  } catch (error) {
    trace("connect_failed", error instanceof ProtocolError ? error.code : "error");
    if (transport) transport.close();
    else dial?.close();
    throw error;
  } finally { signal?.removeEventListener("abort", abort); }
}
