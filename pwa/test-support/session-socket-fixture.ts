/**
 * In-memory relay + daemon peer with real DeviceHello and AEAD; close events are
 * deliberately withheld. Replies keep wire order: nothing overtakes a held frame.
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { Direction, DIR_C, DIR_S } from "../src/lib/protocol/aead";
import { b64url, b64urlDecode, bytesToHex } from "../src/lib/protocol/bytes";
import { decode, encode, jsonFrame, parseJSON, Typ, type Frame } from "../src/lib/protocol/envelope";
import { fingerprint16, proof, transcriptD, transcriptP } from "../src/lib/protocol/hello";
import { sessionKeys } from "../src/lib/protocol/kdf";
import type { PairResult } from "../src/lib/protocol/pair-ws";

export type HoldStage = "bound" | "hello" | "established" | "ping" | "none";
export type SocketScript = {
  /** The bind lands after frames already sent behind the attach: "refuse" them as unbound or "drop" them. */
  bindLate?: "refuse" | "drop";
  refuseHello?: string;
  dropAhead?: boolean;
  /** SESSION_ESTABLISHED arrives after the answers to requests sent behind DeviceHello3. */
  establishLate?: boolean;
  forgeSignature?: boolean;
  failOps?: string[];
  /** Answer TransportCommit as a computer that moved the session would. */
  answerCommit?: boolean;
  /** Requests the computer is still working on: recorded, not answered here. */
  slowOps?: string[];
};
const secret = new Uint8Array(32).fill(7);
const pk = ed25519.getPublicKey(secret);
export const socketPair = {
  daemonId: "d_" + "a".repeat(20), deviceId: "dev_12345678", daemonPk: pk,
  psk: new Uint8Array(32).fill(9), fp: fingerprint16(pk), relayOrigin: "https://pairfob.test",
} as PairResult;

export class SessionSocket extends EventTarget {
  static OPEN = 1;
  static hold: HoldStage = "none";
  static instances: SessionSocket[] = [];
  /** What the next sockets do; each socket copies it when it is constructed. */
  static script: SocketScript = {};
  /** Wire events across every socket, in the order they happened. */
  static log: string[] = [];
  readyState = 1;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  protocol = "pairfob.v2";
  blocked: HoldStage | null = null;
  frames: Frame[] = [];
  operations: string[] = [];
  requests: Array<{ id: string; op: string; params: Record<string, unknown> }> = [];
  /** A path that died silently: frames arrive nowhere and nothing comes back. */
  silent = false;
  readonly serial = SessionSocket.instances.length + 1;
  script = SessionSocket.script;
  private boundSent = false;
  private establishedSent = false;
  closeCalls = 0;
  private route = new Uint8Array(16).fill(2);
  private eph = new Uint8Array(32).fill(3);
  private recv!: Direction;
  private out!: Direction;
  private transcript!: Uint8Array;
  private established = false;
  private held: Frame | null = null;
  // An ordered socket cannot overtake: replies behind a held frame wait for it.
  private behind: Frame[] = [];
  private released = false;
  private hold = SessionSocket.hold;
  constructor(_url?: string, _protocols?: string[]) {
    super(); SessionSocket.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  close(): void { this.closeCalls++; this.readyState = 2; SessionSocket.log.push(`${this.serial}:close`); }
  finishClose(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  reject(code: string): void { this.deliver(jsonFrame(Typ.ERROR, this.route, { code, message: code })); }
  /** The computer's hint that something changed, pushed on the established route. */
  poke(): void {
    const body = new TextEncoder().encode(JSON.stringify({ v: 1, op: "Poke", params: { reason: "agent_status", pane_id: "w1:p1" } }));
    const frame: Frame = { version: 1, typ: Typ.FWD, flags: 0, routeId: this.route, payload: this.out.seal(this.route, body) };
    if (this.held && !this.released) this.behind.push(frame);
    else this.deliver(frame);
  }
  /** Answer, on this socket, a recorded request the computer was still working on. */
  answer(id: string, result: unknown): void {
    const payload = this.out.seal(this.route, new TextEncoder().encode(JSON.stringify({ v: 1, id, ok: true, result })));
    this.reply("none", { version: 1, typ: Typ.FWD, flags: 0, routeId: this.route, payload });
  }
  releaseLate(): void {
    if (!this.held) return;
    this.released = true;
    this.deliver(this.held);
    for (const frame of this.behind.splice(0)) this.deliver(frame);
  }
  private deliver(frame: Frame): void {
    const event = new Event("message");
    Object.assign(event, { data: encode(frame).buffer });
    this.dispatchEvent(event);
  }
  private reply(stage: HoldStage, frame: Frame): void {
    if (this.held && !this.released) { this.behind.push(frame); return; }
    if (this.hold !== "none" && stage === this.hold && !this.released) { this.blocked = stage; this.held = frame; return; }
    queueMicrotask(() => this.deliver(frame));
  }
  send(data: Uint8Array): void {
    if (this.readyState !== 1) throw new Error("send on closing socket");
    const frame = decode(new Uint8Array(data)); this.frames.push(frame);
    if (this.silent) return;
    if (frame.typ === Typ.SESSION_ATTACH) {
      const bound = jsonFrame(Typ.SESSION_BOUND, this.route, { v: 2 });
      // A relay that binds late answers after frames already sent behind the attach.
      if (this.script.bindLate) queueMicrotask(() => { this.boundSent = true; this.reply("bound", bound); });
      else { this.boundSent = true; this.reply("bound", bound); }
    }
    if (frame.typ === Typ.PING) this.reply("none", { ...frame, typ: Typ.PONG });
    if (frame.typ !== Typ.FWD) return;
    if (!this.boundSent) { if (this.script.bindLate === "refuse") this.reject("unbound"); return; }
    if (this.established) {
      const req = JSON.parse(new TextDecoder().decode(this.recv.open(this.route, frame.payload)));
      this.operations.push(req.op); this.requests.push({ id: req.id, op: req.op, params: req.params });
      SessionSocket.log.push(`${this.serial}:${req.op}`);
      // A computer that does not take requests sent ahead of SESSION_ESTABLISHED.
      if (this.script.dropAhead && !this.establishedSent) return;
      if (this.script.slowOps?.includes(req.op)) return;
      const answer = this.script.failOps?.includes(req.op)
        ? { v: 1, id: req.id, ok: false, error: { code: "herdr_offline", message: "fixture" } }
        : req.op === "TransportCommit" && this.script.answerCommit
          ? { v: 1, id: req.id, ok: true, result: { attempt_id: req.params.attempt_id, route_id: req.params.route_id, transport: "webrtc" } }
          : { v: 1, id: req.id, ok: true, result: { t_ms: req.params.t_ms, op: req.op } };
      const payload = this.out.seal(this.route, new TextEncoder().encode(JSON.stringify(answer)));
      this.reply("ping", { ...frame, payload }); return;
    }
    const body = parseJSON(frame);
    SessionSocket.log.push(`${this.serial}:${body.op}`);
    if (body.op === "DeviceHello1" && this.script.refuseHello) {
      this.reply("hello", jsonFrame(Typ.FWD, this.route, { v: 1, op: "DeviceHello2", ok: false, error: { code: this.script.refuseHello } }));
    } else if (body.op === "DeviceHello1") {
      const ephP = b64urlDecode(body.eph_x25519);
      this.transcript = transcriptD(socketPair.daemonId, socketPair.deviceId, ephP, x25519.getPublicKey(this.eph), b64urlDecode(body.nonce), 1n, this.route);
      const keys = sessionKeys(x25519.getSharedSecret(this.eph, ephP), socketPair.psk);
      this.recv = new Direction(keys.c2s, DIR_C); this.out = new Direction(keys.s2c, DIR_S);
      this.reply("hello", jsonFrame(Typ.FWD, this.route, { v: 1, op: "DeviceHello2", ok: true, ts: 1,
        eph_x25519: b64url(x25519.getPublicKey(this.eph)), proof_d: b64url(proof(socketPair.psk, this.transcript)), sig_d: b64url(ed25519.sign(this.transcript, this.script.forgeSignature ? new Uint8Array(32).fill(8) : secret)),
      }));
    } else if (body.op === "DeviceHello3") {
      if (body.proof_p !== b64url(proof(socketPair.psk, transcriptP(this.transcript)))) throw new Error("invalid phone proof");
      this.established = true;
      const established = jsonFrame(Typ.SESSION_ESTABLISHED, this.route, { v: 2, route_id: bytesToHex(this.route) });
      if (this.script.establishLate) setTimeout(() => this.reply("established", established), 0);
      else this.reply("established", established);
      queueMicrotask(() => { this.establishedSent = true; });
    }
  }
}
