import type { RecoveryClock } from "./recovery-diagnostics";
import { ProtocolError } from "./errors.ts";
import { connectionTrace, RelayDial, type DialContext } from "./relay-dial.ts";

export { connectionTrace } from "./relay-dial.ts";

type Attempt = { controller: AbortController; result: Promise<RelayDial | null>; dial?: RelayDial };

/**
 * A relay dial prepared beside the live transport. By default it only opens the
 * socket. A standby also sends the first flight and reports DeviceHello2: that
 * still cannot evict the live route, which the computer keeps until DeviceHello3.
 */
export class RelayWarmup {
  private attempt: Attempt | null = null;
  constructor(
    private readonly url: string,
    private readonly recovery: () => RecoveryClock | undefined = () => undefined,
    private readonly context?: DialContext,
  ) {}

  /**
   * `standby` runs once, when the prepared dial has verified DeviceHello2 and is
   * still unused. False when an earlier preparation is still held: it stays as is.
   */
  start(standby?: () => void): boolean {
    if (this.attempt) return false;
    const controller = new AbortController();
    const trace = connectionTrace(true, this.recovery());
    const attempt: Attempt = { controller, result: Promise.resolve(null) };
    this.attempt = attempt;
    attempt.result = RelayDial.open(this.url, trace, controller.signal).then(dial => {
      if (controller.signal.aborted) { dial.close(); return null; }
      attempt.dial = dial;
      if (standby && this.context) {
        dial.start(this.context).then(() => {
          if (this.attempt === attempt) standby();
        }, error => {
          // Still untaken: a refused standby must not be handed to the next dial.
          if (this.attempt !== attempt) return;
          this.attempt = null;
          trace("connect_failed", error instanceof ProtocolError ? error.code : "error");
          dial.close();
          // The probe now decides alone; keep the plain prepared socket it would have had.
          if (!controller.signal.aborted) this.start();
        });
      }
      return dial;
    }, error => {
      trace(controller.signal.aborted ? "warmup_cancelled" : "connect_failed", error instanceof ProtocolError ? error.code : "error");
      return null;
    });
    return true;
  }

  cancel(): void {
    const attempt = this.attempt;
    this.attempt = null;
    attempt?.controller.abort();
    attempt?.dial?.close();
  }

  async take(signal?: AbortSignal): Promise<RelayDial | null> {
    const attempt = this.attempt;
    this.attempt = null;
    if (!attempt) return null;
    const abort = () => { attempt.controller.abort(); attempt.dial?.close(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) abort();
      const dial = await attempt.result;
      if (signal?.aborted || dial?.socket.ws.readyState !== WebSocket.OPEN) {
        dial?.close();
        return null;
      }
      return dial;
    } finally { signal?.removeEventListener("abort", abort); }
  }
}
