import { scopeHerdSession } from "./herd-sessions.ts";
import type { FlightRead, SessionTransport } from "./session-transport.ts";

/** How long an answer that arrived ahead of its caller may wait to be claimed. */
export const FIRST_READ_KEEP_MS = 2_000;

/** A read is asked ahead until this many connections in a row went by without the app issuing it. */
const UNREAD_ROUNDS = 2;

type Held = { op: string; key: string; answer: Promise<unknown>; settledAt: number | null; failed: boolean };

function isScreenRead(params: unknown): params is { format: "ansi" } {
  return typeof params === "object" && params !== null && (params as { format?: unknown }).format === "ansi";
}

/**
 * The reads a screen issues the moment a connection is ready (config, then
 * snapshot, then the open pane) are known before it is ready. A dial sends
 * them with DeviceHello3, a foreground probe sends them with its Ping, and
 * their answers wait here. The caller still asks in its own order and applies
 * each answer where it always did; it only stops paying a round trip per
 * question.
 *
 * An answer is handed out once, to the exact read it was sent for, on the
 * transport it arrived on, and only while nothing could have changed what a
 * fresh read would return.
 */
export class FirstReads {
  // A session nobody is looking at stops asking: it learns from the reads the
  // app issues once a connection is ready. One connection that went unread
  // (the page was hidden, say) is not yet a reason to stop.
  private config = UNREAD_ROUNDS;
  private snapshot = UNREAD_ROUNDS;
  private pane: { params: unknown; snapshots: number } | null = null;
  private owner: SessionTransport | null = null;
  private held: Held[] = [];
  private drops = 0;
  private plannedAt = 0;

  /** Remember what the app reads, to ask for the same on the next dial. */
  note(op: string, params: unknown): void {
    if (op === "GetConfig") this.config = UNREAD_ROUNDS;
    else if (op === "Snapshot") {
      this.snapshot = UNREAD_ROUNDS;
      // The pane screen reads many times per snapshot; two snapshots without a
      // pane read mean the screen has moved on.
      if (this.pane && ++this.pane.snapshots > 1) this.pane = null;
    } else if (op === "PaneRead" && isScreenRead(params)) this.pane = { params, snapshots: 0 };
  }

  /** The reads the next dial sends ahead, in the order the computer must run them. */
  plan(herdSession: string | null): FlightRead[] {
    this.plannedAt = this.drops;
    const reads: FlightRead[] = [];
    const add = (op: string, params: unknown) => reads.push({ op, params: scopeHerdSession(op, params, herdSession) });
    if (this.config) add("GetConfig", {});
    if (this.snapshot) add("Snapshot", { session: null });
    if (this.pane) add("PaneRead", this.pane.params);
    return reads;
  }

  /** Send the planned reads on a live transport, beside the probe that will declare it ready. */
  send(transport: SessionTransport, herdSession: string | null): void {
    this.hold(transport, this.plan(herdSession).map((read) => ({ ...read, answer: transport.rpc(read.op, read.params) })));
  }

  /** These answers belong to this transport and nothing later. */
  hold(transport: SessionTransport, sent: ReadonlyArray<FlightRead & { answer: Promise<unknown> }>): void {
    this.owner = transport;
    // Something changed while these were on their way (a Poke during the dial,
    // the page hiding): they would answer for a state that is already old.
    this.held = (this.drops === this.plannedAt ? sent : []).map((read) => {
      const held: Held = { op: read.op, key: JSON.stringify(read.params), answer: read.answer, settledAt: null, failed: false };
      read.answer.then(() => { held.settledAt = Date.now(); }, () => { held.failed = true; });
      return held;
    });
  }

  /** The connection is ready: from here on, learn what its screen reads. */
  ready(): void {
    this.config = Math.max(0, this.config - 1);
    this.snapshot = Math.max(0, this.snapshot - 1);
  }

  /** The answer sent ahead for exactly this read, or null: then the caller reads normally. */
  take(transport: SessionTransport | null, op: string, params: unknown, now = Date.now()): Promise<unknown> | null {
    if (!transport || transport !== this.owner || !this.held.length) return null;
    const key = JSON.stringify(params);
    const index = this.held.findIndex((held) => held.op === op && held.key === key);
    if (index < 0) return null;
    const [held] = this.held.splice(index, 1);
    if (held.failed || (held.settledAt !== null && now - held.settledAt > FIRST_READ_KEEP_MS)) return null;
    return held.answer;
  }

  /** Something may have changed what a fresh read returns: answer nothing from here. */
  drop(): void {
    this.held = [];
    this.drops++;
  }

  /** The Herdr session changed: neither the answers nor the pane belong to the new one. */
  retarget(): void {
    this.drop();
    this.pane = null;
    this.config = UNREAD_ROUNDS;
    this.snapshot = UNREAD_ROUNDS;
  }
}
