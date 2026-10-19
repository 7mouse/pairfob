import { expect, test } from "bun:test";
import { ZERO_ROUTE, routeHex, sha256Hex } from "../crypto.ts";
import { Typ } from "../envelope.ts";
import { encodeJSON, encodeRaw } from "../frames.ts";
import { lastJSON, makeRoom } from "../testutil/make-room.ts";
import { onMessage } from "./ws.ts";

test("only authenticated phone sessions count: daemon keepalive, attach and forged established do not", async () => {
  const h = makeRoom();
  const observations: number[] = [];
  h.core.deps.activity = now => { observations.push(now); };
  const token = "rt_" + "22".repeat(16);
  h.core.enroll({ reconnect_hash: await sha256Hex(token), grant_id: "g_" + "22".repeat(8) });
  const daemon = h.accept("daemon").ws!;
  await onMessage(h.core, daemon, encodeJSON(Typ.HELLO_DAEMON, ZERO_ROUTE, {
    v: 2, op: "RegisterDaemon", daemon_id: h.core.daemonId, reconnect_token: token,
  }));
  const ping = encodeRaw(Typ.PING, ZERO_ROUTE, new Uint8Array(8));
  await onMessage(h.core, daemon, ping);
  const phone = h.accept("phone").ws!;
  await onMessage(h.core, phone, encodeJSON(Typ.HELLO_CLIENT, ZERO_ROUTE, { v: 2, protocol: 2 }));
  await onMessage(h.core, phone, encodeJSON(Typ.SESSION_ATTACH, ZERO_ROUTE, { v: 2, daemon_id: h.core.daemonId }));
  const rid = lastJSON(phone).routeId;
  const established = encodeJSON(Typ.SESSION_ESTABLISHED, rid, { v: 2, route_id: routeHex(rid) });
  await onMessage(h.core, phone, established);
  await onMessage(h.core, phone, ping);
  await onMessage(h.core, daemon, encodeRaw(Typ.FWD, rid, new Uint8Array(4)));
  expect(observations).toEqual([]);
  await onMessage(h.core, daemon, established);
  expect(observations).toEqual([h.clock.t]);
  h.core.rebuildMaps();
  expect(h.core.routeIsEstablished(routeHex(rid))).toBeTrue();
  h.clock.t += 600_000;
  await onMessage(h.core, phone, ping);
  await onMessage(h.core, phone, encodeRaw(Typ.FWD, rid, new Uint8Array(4)));
  await onMessage(h.core, daemon, encodeRaw(Typ.FWD, rid, new Uint8Array(4)));
  expect(observations).toEqual([h.clock.t - 600_000, h.clock.t, h.clock.t, h.clock.t]);
  h.core.closeBind(phone, "closed", "test");
  expect(h.core.routeIsEstablished(routeHex(rid))).toBeFalse();
});
