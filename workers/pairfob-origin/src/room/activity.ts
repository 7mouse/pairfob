import { ACTIVITY_INTERVAL_MS, RECORD_ACTIVITY_SQL } from "../conversion.ts";

type Checkpoint = { first: number; written: number };
type Storage = Pick<DurableObjectStorage, "get" | "put">;
const KEY = "conversion_activity";

/** Throttling survives hibernation. A pending first observation survives D1
 * failures; failures never break a phone session and the next activity retries. */
export class RoomActivity {
  private checkpoint: Checkpoint | undefined;
  private running: Promise<void> | undefined;
  private retryAt = 0;

  constructor(private storage: Storage, private db: D1Database, private daemonId: string) {}

  touch(now: number): Promise<void> {
    if (this.running) return this.running;
    if (now < this.retryAt || (this.checkpoint?.written && now - this.checkpoint.written < ACTIVITY_INTERVAL_MS)) {
      return Promise.resolve();
    }
    this.running = this.write(now).catch(() => {
      this.retryAt = now + 30_000;
      console.error(JSON.stringify({ kind: "pairfob", event: "conversion_write_failed" }));
    }).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async write(now: number): Promise<void> {
    this.checkpoint ??= await this.storage.get<Checkpoint>(KEY);
    if (this.checkpoint?.written && now - this.checkpoint.written < ACTIVITY_INTERVAL_MS) return;
    if (!this.checkpoint) {
      const pending = { first: now, written: 0 };
      await this.storage.put(KEY, pending);
      this.checkpoint = pending;
    }
    const first = this.checkpoint.first;
    const result = await this.db.prepare(RECORD_ACTIVITY_SQL).bind(first, first, now, now, this.daemonId).run();
    if (!result.success || result.meta.changes !== 1) throw new Error("activity row unavailable");
    const next = { first, written: now };
    await this.storage.put(KEY, next);
    this.checkpoint = next;
  }
}
