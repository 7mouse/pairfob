/// <reference types="@cloudflare/vitest-pool-workers" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, expect, inject, it } from "vitest";
import { decode, Typ } from "../../src/envelope.ts";
import { ZERO_ROUTE } from "../../src/crypto.ts";
import { encodeJSON } from "../../src/frames.ts";

beforeAll(() => applyD1Migrations(env.DB, inject("migrations")));
const origin = "https://pairfob.com";

async function connect(role: string, daemonId: string): Promise<WebSocket> {
  const response = await SELF.fetch(`${origin}/v2/ws?role=${role}&daemon_id=${daemonId}`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "pairfob.v2", Origin: origin },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  ws.accept();
  ws.binaryType = "arraybuffer";
  return ws;
}

function receive(ws: WebSocket, type: number): Promise<ReturnType<typeof decode>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener("message", onMessage); reject(new Error("frame timeout")); }, 4000);
    const onMessage = (event: MessageEvent) => {
      const frame = decode(new Uint8Array(event.data as ArrayBuffer));
      if (frame.typ !== type) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve(frame);
    };
    ws.addEventListener("message", onMessage);
  });
}

it("real DO activity writes the migrated D1 row and admin counts without counting attaches", async () => {
  const daemonId = `d_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const reconnectToken = `rt_${crypto.randomUUID().replaceAll("-", "")}`;
  const enrolled = await SELF.fetch(`${origin}/v2/enroll`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 2, daemon_id: daemonId, reconnect_token: reconnectToken }),
  });
  expect(enrolled.status).toBe(200);
  const daemon = await connect("daemon", daemonId);
  let phone: WebSocket | undefined;
  try {
    const registered = receive(daemon, Typ.HELLO_DAEMON);
    daemon.send(encodeJSON(Typ.HELLO_DAEMON, ZERO_ROUTE, { v: 2, op: "RegisterDaemon", daemon_id: daemonId, reconnect_token: reconnectToken }));
    await registered;
    phone = await connect("client", daemonId);
    const bound = receive(phone, Typ.SESSION_BOUND);
    phone.send(encodeJSON(Typ.HELLO_CLIENT, ZERO_ROUTE, { v: 2, protocol: 2 }));
    phone.send(encodeJSON(Typ.SESSION_ATTACH, ZERO_ROUTE, { v: 2, daemon_id: daemonId }));
    const attach = await bound;
    const before = await env.DB.prepare("SELECT first_session_at FROM daemons WHERE daemon_id=?").bind(daemonId).first();
    expect(before.first_session_at).toBeNull();
    const established = receive(phone, Typ.SESSION_ESTABLISHED);
    daemon.send(encodeJSON(Typ.SESSION_ESTABLISHED, attach.routeId, JSON.parse(new TextDecoder().decode(attach.payload))));
    await established;
    let row: { first_session_at: number | null; last_active_at: number | null } | null = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      row = await env.DB.prepare("SELECT first_session_at,last_active_at FROM daemons WHERE daemon_id=?").bind(daemonId).first();
      if (row?.first_session_at) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(row?.first_session_at).toBeGreaterThan(0);
    expect(row?.last_active_at).toBe(row?.first_session_at);
    const response = await SELF.fetch(`${origin}/v2/admin/funnel`, { headers: { Authorization: "Bearer dev-operator" } });
    expect(response.status).toBe(200);
    const stats = await response.json() as { installed: number; paired: number; active_7d: number };
    expect(stats.installed).toBeGreaterThanOrEqual(1);
    expect(stats.paired).toBeGreaterThanOrEqual(1);
    expect(stats.active_7d).toBeGreaterThanOrEqual(1);
  } finally {
    phone?.close(1000);
    daemon.close(1000);
  }
}, 15_000);
