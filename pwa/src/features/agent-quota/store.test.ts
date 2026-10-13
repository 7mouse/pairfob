import { describe, expect, test } from "bun:test";
import { quotaAccount, quotaReport } from "../../../test-support/quota";
import type { QuotaAccount } from "../../lib/agent-quota-v2";
import type { QuotaReport } from "../../lib/agent-quota-report";
import type { LiveSession } from "../../lib/protocol/session-types";
import { quotaSnapshot, setQuotaSnapshot, subscribeQuota, views } from "./store";

/**
 * The quota store replaced a mutable WeakMap entry, so these pin the two
 * properties the new ownership depends on: a published snapshot never changes
 * under a reader, and a late answer stays on the session that asked for it.
 */

const session = (id: string) => ({ daemonId: id } as unknown as LiveSession);
const items = (plan: string): QuotaAccount[] => [quotaAccount({ plan })];

describe("quota snapshot store", () => {
  test("a write replaces the snapshot instead of mutating the published one", () => {
    const live = session("replace");
    setQuotaSnapshot(live, { loading: true, items: null, error: "" });
    const published = quotaSnapshot(live);
    setQuotaSnapshot(live, { loading: false, items: items("pro"), error: "" });
    expect(published).toEqual({ loading: true, items: null, error: "" });
    expect(quotaSnapshot(live)).toEqual({ loading: false, items: items("pro"), error: "" });
    expect(quotaSnapshot(live)).not.toBe(published);
  });

  test("subscribers hear a write once and stop hearing it after unsubscribe", () => {
    const live = session("notify");
    let heard = 0;
    const unsubscribe = subscribeQuota(() => { heard += 1; });
    setQuotaSnapshot(live, { loading: false, items: items("pro"), error: "" });
    expect(heard).toBe(1);
    unsubscribe();
    setQuotaSnapshot(live, { loading: false, items: null, error: "gone" });
    expect(heard).toBe(1);
  });

  test("a retired session's late answer stays on its own entry", () => {
    const retired = session("retired");
    const current = session("current");
    setQuotaSnapshot(current, { loading: false, items: null, error: "" });
    setQuotaSnapshot(retired, { loading: true, items: null, error: "" });
    setQuotaSnapshot(retired, { loading: false, items: items("late"), error: "" });
    expect(quotaSnapshot(retired)?.items?.[0]?.plan).toBe("late");
    expect(quotaSnapshot(current)?.items).toBeNull();
  });

  test("the historical views seam reads and writes the same snapshots", () => {
    const live = session("seam");
    views.set(live, { loading: false, items: items("seam"), error: "" });
    expect(views.get(live)).toBe(quotaSnapshot(live));
    expect(views.get(null)).toBeUndefined();
  });
});

/**
 * Snapshot ownership. These are the reviewer's probes kept as regressions: the
 * store adopts what it is given and publishes a frozen, read-only value, so no
 * caller — and no reader — holds a write path into published quota data.
 */
import { attachLiveSession } from "../../features/computers/catalog-store";
import { refreshAgentQuota } from "./actions";
import type { QuotaSnapshotInput } from "./store";

const liveSession = (id: string, read: () => Promise<QuotaReport>) =>
  ({ daemonId: id, isConnected: () => true, agentQuota: read } as unknown as LiveSession);

describe("quota snapshot ownership", () => {
  test("publishing adopts the input, so later caller edits change nothing without a notification", () => {
    const live = session("adopt");
    const input: QuotaSnapshotInput = { loading: true, items: items("owned"), error: "" };
    let heard = 0;
    const stop = subscribeQuota(() => { heard += 1; });
    setQuotaSnapshot(live, input);
    input.loading = false;
    (input.items as QuotaAccount[])[0]!.meters[0]!.name = "edited";
    const actual = {
      loading: quotaSnapshot(live)?.loading,
      used: quotaSnapshot(live)?.items?.[0]?.meters[0]?.name,
      heard,
    };
    stop();
    expect(actual).toEqual({ loading: true, used: "codex", heard: 1 });
  });

  test("a returned snapshot grants no mutable loading authority", () => {
    const live = session("output");
    setQuotaSnapshot(live, { loading: true, items: items("owned"), error: "" });
    const published = quotaSnapshot(live)!;
    // The API types this read-only, so reaching the property takes an explicit
    // cast — and the frozen value refuses the write.
    expect(() => { (published as { loading: boolean }).loading = false; }).toThrow();
    expect(quotaSnapshot(live)?.loading).toBeTrue();
  });

  test("a returned nested meter cannot silently rewrite the displayed allowance", () => {
    const live = session("nested");
    setQuotaSnapshot(live, { loading: false, items: items("owned"), error: "" });
    const published = quotaSnapshot(live)!;
    let heard = 0;
    const stop = subscribeQuota(() => { heard += 1; });
    const meter = published.items?.[0]?.meters[0] as { name: string } | undefined;
    expect(() => { meter!.name = "edited"; }).toThrow();
    expect(() => { (published.items?.[0]?.meters as unknown[]).push(meter); }).toThrow();
    expect({ used: quotaSnapshot(live)?.items?.[0]?.meters[0]?.name, heard })
      .toEqual({ used: "codex", heard: 0 });
    stop();
  });

  test("adopting a snapshot does not freeze or take over the caller-owned input graph", () => {
    const live = session("caller-graph");
    const input: QuotaSnapshotInput = { loading: false, items: items("owned"), error: "" };
    setQuotaSnapshot(live, input);
    expect([
      Object.isFrozen(input), Object.isFrozen(input.items),
      Object.isFrozen(input.items?.[0]), Object.isFrozen(input.items?.[0]?.meters[0]),
    ]).toEqual([false, false, false, false]);
    // The caller still owns its object; the store owns a copy.
    input.loading = true;
    expect(input.loading).toBeTrue();
    expect(quotaSnapshot(live)?.loading).toBeFalse();
  });

  test("a reader cannot clear the in-flight guard and let an older result replace a newer one", async () => {
    const resolvers: Array<(q: QuotaReport) => void> = [];
    let reads = 0;
    const live = liveSession("in-flight", () => {
      reads += 1;
      return new Promise<QuotaReport>(resolve => resolvers.push(resolve));
    });
    attachLiveSession(live);
    const first = refreshAgentQuota();
    const published = quotaSnapshot(live)!;
    try { (published as { loading: boolean }).loading = false; } catch { /* frozen */ }
    const second = refreshAgentQuota();
    const concurrent = reads;
    if (resolvers[1]) {
      resolvers[1](quotaReport(...items("newer")));
      await second;
    }
    resolvers[0]!(quotaReport(...items("older")));
    await first;
    await second;
    attachLiveSession(null);
    expect(concurrent).toBe(1);
    expect(quotaSnapshot(live)?.items?.[0]?.plan).toBe("older");
  });

  test("a reentrant subscriber is deduplicated by the loading snapshot", async () => {
    let reads = 0;
    let entered = false;
    let nested: Promise<unknown> | undefined;
    const live = liveSession("reentrant", async () => {
      reads += 1;
      return quotaReport(...items("owned"));
    });
    attachLiveSession(live);
    const stop = subscribeQuota(() => {
      if (!entered && quotaSnapshot(live)?.loading) {
        entered = true;
        nested = refreshAgentQuota();
      }
    });
    await refreshAgentQuota();
    await nested;
    stop();
    attachLiveSession(null);
    expect(reads).toBe(1);
  });

  test("a subscriber cannot defeat the in-flight guard by editing the published snapshot", async () => {
    const resolvers: Array<(q: QuotaReport) => void> = [];
    let reads = 0;
    let entered = false;
    let nested: Promise<unknown> | undefined;
    const live = liveSession("reentrant-alias", () => {
      reads += 1;
      return new Promise<QuotaReport>(resolve => resolvers.push(resolve));
    });
    attachLiveSession(live);
    const stop = subscribeQuota(() => {
      if (entered) return;
      entered = true;
      try { (quotaSnapshot(live) as { loading: boolean })!.loading = false; } catch { /* frozen */ }
      nested = refreshAgentQuota();
    });
    const first = refreshAgentQuota();
    const concurrent = reads;
    stop();
    for (const resolve of resolvers) resolve(quotaReport(...items("owned")));
    await first;
    await nested;
    attachLiveSession(null);
    expect(concurrent).toBe(1);
  });

  test("a refresh says whether it changed what the page shows, and a failed one keeps what was read", async () => {
    const sample = quotaAccount({ plan: "kept" });
    let answer: () => Promise<QuotaReport> = async () => quotaReport(sample);
    const live = liveSession("outcomes", () => answer());
    attachLiveSession(live);
    expect(await refreshAgentQuota()).toBe("updated");
    // The computer keeps a read for a minute: the same accounts sampled at the same time.
    expect(await refreshAgentQuota()).toBe("unchanged");
    answer = async () => quotaReport({ ...sample, observed_at: sample.observed_at + 61 });
    expect(await refreshAgentQuota()).toBe("updated");
    answer = async () => { throw new Error("offline"); };
    expect(await refreshAgentQuota()).toBe("failed");
    expect(quotaSnapshot(live)).toMatchObject({ loading: false, error: "quota.failed" });
    expect(quotaSnapshot(live)?.items?.[0]?.plan).toBe("kept");
    // The answer after a failure is news even when its numbers are the old ones.
    answer = async () => quotaReport({ ...sample, observed_at: sample.observed_at + 61 });
    expect(await refreshAgentQuota()).toBe("updated");
    expect(quotaSnapshot(live)?.error).toBe("");
    answer = async () => ({ accounts: [sample], legacy: true, unknown: 3 });
    await refreshAgentQuota();
    expect(quotaSnapshot(live)).toMatchObject({ legacy: true, unknown: 3 });
    attachLiveSession(null);
    expect(await refreshAgentQuota()).toBe("skipped");
  });
});
