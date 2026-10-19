import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { ACTIVITY_INTERVAL_MS, ACTIVE_WINDOW_MS, conversionStats } from "./conversion.ts";
import { RoomActivity } from "./room/activity.ts";
import { handleAdmin } from "./admin.ts";
import type { Env } from "./env.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const sql = new Database(":memory:");
  databases.push(sql);
  sql.exec("CREATE TABLE daemons (daemon_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, kicked_at INTEGER)");
  sql.exec("INSERT INTO daemons VALUES ('old', 1, NULL), ('new', 2, NULL), ('unused', 3, NULL)");
  sql.exec(readFileSync(new URL("../migrations/0007_conversion.sql", import.meta.url), "utf8"));
  let writes = 0;
  let fail = false;
  const db = { prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind(...values: unknown[]) { args = values; return statement; },
      async first() { return sql.prepare(query).get(...args); },
      async run() {
        if (fail) throw new Error("D1 unavailable");
        writes++;
        const result = sql.prepare(query).run(...args);
        return { success: true, meta: { changes: result.changes, last_row_id: 0 } };
      },
    };
    return statement;
  } } as unknown as D1Database;
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
  } as Pick<DurableObjectStorage, "get" | "put">;
  return { sql, db, storage, writes: () => writes, fail: (next: boolean) => { fail = next; } };
}

test("migration does not invent historical pairing; first observation and activity survive reconnect and hibernation", async () => {
  const f = fixture();
  const now = Date.now();
  expect((await conversionStats(f.db, now)).paired).toBe(0);
  const writer = new RoomActivity(f.storage, f.db, "old");
  await Promise.all([writer.touch(now), writer.touch(now + 1)]);
  expect(f.writes()).toBe(1);
  // A new instance models a wake from hibernation, with only durable storage.
  const awake = new RoomActivity(f.storage, f.db, "old");
  await awake.touch(now + 10);
  expect(f.writes()).toBe(1);
  await awake.touch(now + ACTIVITY_INTERVAL_MS);
  expect(f.writes()).toBe(2);
  expect(f.sql.query("SELECT first_session_at, last_active_at FROM daemons WHERE daemon_id='old'").get())
    .toEqual({ first_session_at: now, last_active_at: now + ACTIVITY_INTERVAL_MS });
  f.sql.exec("UPDATE daemons SET kicked_at=4 WHERE daemon_id='old'");
  const stats = await conversionStats(f.db, now + ACTIVITY_INTERVAL_MS);
  expect(stats.installed).toBe(3);
  expect(stats.paired).toBe(1);
  expect(stats.active_7d).toBe(1);
  expect((await conversionStats(f.db, now + ACTIVITY_INTERVAL_MS + ACTIVE_WINDOW_MS + 1)).active_7d).toBe(0);
});

test("D1 failure leaves the first observation durable and retries without interrupting the session", async () => {
  const f = fixture();
  const now = Date.now();
  f.fail(true);
  const writer = new RoomActivity(f.storage, f.db, "old");
  await writer.touch(now);
  f.fail(false);
  await new RoomActivity(f.storage, f.db, "old").touch(now + 60_000);
  expect(f.sql.query("SELECT first_session_at FROM daemons WHERE daemon_id='old'").get()).toEqual({ first_session_at: now });
  expect((await conversionStats(f.db, now)).paired).toBe(1);
});

test("funnel is admin-only, no-store, and fails closed before migration", async () => {
  const f = fixture();
  const env = { DB: f.db, OPERATOR_TOKEN: "test-operator", BUILD: "test" } as Env;
  const url = "https://pairfob.com/v2/admin/funnel";
  expect((await handleAdmin(new Request(url), env))?.status).toBe(401);
  expect((await handleAdmin(new Request(url, { headers: { Authorization: "Bearer wrong" } }), env))?.status).toBe(401);
  const request = () => new Request(url, { headers: { Authorization: "Bearer test-operator" } });
  const response = await handleAdmin(request(), env);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response?.json()).toMatchObject({ ok: true, installed: 3, paired: 0, active_7d: 0 });
  f.sql.exec("DROP TABLE conversion_tracking");
  expect((await handleAdmin(request(), env))?.status).toBe(503);
});
