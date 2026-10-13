import { describe, expect, test } from "bun:test";
import type { AgentQuota } from "./agent-quota";
import { legacyQuotaAccounts, readQuotaReport } from "./agent-quota-report";
import { ProtocolError } from "./protocol/errors";

const window = { name: "codex", used_percent: 25, window_minutes: 300, resets_at: 1800001000 };
const legacy = (patch: Partial<AgentQuota>): AgentQuota =>
  ({ provider: "codex", plan: "pro", status: "ok", source: "app_server", observed_at: 1800000000, windows: [window], ...patch });
const v2 = { items: [{ id: "codex", provider: "codex", plan: "pro", state: "ok", observed_at: 1800000000,
  meters: [{ kind: "quota", name: "codex", pool: "plan", headline: true, used_percent: 25 }] }] };

describe("quota from a computer that only knows the first operation", () => {
  test("its items become accounts with the marks a current computer sends", () => {
    const [codex, claude, copilot] = legacyQuotaAccounts([
      legacy({}),
      legacy({ provider: "claude", source: "oauth", windows: [{ ...window, name: "five hour" }, { ...window, name: "seven_day", resets_at: 0 }, { ...window, name: "seven day opus", window_minutes: 10080 }] }),
      legacy({ provider: "copilot", source: "github_api", windows: [{ ...window, name: "chat", unlimited: true, used_percent: 0, window_minutes: 0 }, { ...window, name: "premium interactions" }] }),
    ]);
    expect(codex).toMatchObject({ id: "codex", state: "ok", reason: "", observed_at: 1800000000, source: "app_server" });
    expect(codex!.meters).toEqual([{ kind: "quota", name: "codex", pool: "plan", headline: true, used_percent: 25, count: null, window_minutes: 300, resets_at: 1800001000 }]);
    expect(claude!.meters.map(meter => [meter.name, meter.headline, meter.pool])).toEqual([
      ["five hour", true, "plan"], ["seven_day", true, "plan"], ["seven day opus", false, "seven-day-opus"],
    ]);
    expect(copilot!.meters.map(meter => [meter.kind, meter.headline])).toEqual([["unlimited", false], ["quota", true]]);
  });

  test("its statuses map to a state and a reason, and a login it cannot explain is not raised as a task", () => {
    const state = (status: AgentQuota["status"]) => {
      const [account] = legacyQuotaAccounts([legacy({ status, ...(status === "ok" || status === "stale" ? {} : { observed_at: 0, windows: [] }) })]);
      return [account!.state, account!.reason, account!.meters.length, account!.observed_at];
    };
    expect(state("ok")).toEqual(["ok", "", 1, 1800000000]);
    // Its own "stale" is judged again here, per meter and by the sample's age.
    expect(state("stale")).toEqual(["ok", "", 1, 1800000000]);
    expect(state("unavailable")).toEqual(["failed", "unavailable", 0, 0]);
    expect(state("setup_required")).toEqual(["needs_action", "setup", 0, 0]);
    expect(state("auth_required")).toEqual(["not_configured", "sign_in", 0, 0]);
    expect(state("not_logged_in")).toEqual(["not_configured", "no_login", 0, 0]);
    expect(state("not_installed")).toEqual(["not_configured", "not_installed", 0, 0]);
    expect(state("not_running")).toEqual(["not_configured", "not_running", 0, 0]);
    expect(state("unsupported")).toEqual(["not_configured", "unsupported_login", 0, 0]);
  });
});

describe("which quota operation a connection uses", () => {
  test("a current computer answers the second operation and is never asked the first", async () => {
    const ops: string[] = [];
    const wire = { legacy: false };
    const report = await readQuotaReport(async op => { ops.push(op); return v2; }, wire);
    expect(report).toMatchObject({ legacy: false, unknown: 0 });
    expect(report.accounts[0]!.id).toBe("codex");
    expect(ops).toEqual(["AgentQuotaV2"]);
    expect(wire.legacy).toBeFalse();
  });

  test("unknown_op falls back once and the connection remembers it", async () => {
    const ops: string[] = [];
    const wire = { legacy: false };
    const rpc = async (op: string) => {
      ops.push(op);
      if (op === "AgentQuotaV2") throw new ProtocolError("unknown_op", "old");
      return { items: [legacy({})] };
    };
    const first = await readQuotaReport(rpc, wire);
    expect(first.legacy).toBeTrue();
    expect(first.accounts[0]).toMatchObject({ id: "codex", state: "ok" });
    await readQuotaReport(rpc, wire);
    expect(ops).toEqual(["AgentQuotaV2", "AgentQuota", "AgentQuota"]);
  });

  test("a timeout, a refusal or a malformed answer is the read's error and never a fallback", async () => {
    for (const failure of [new ProtocolError("timeout"), new ProtocolError("unpaired"), new ProtocolError("rate_limited"), new Error("network")]) {
      const ops: string[] = [];
      const wire = { legacy: false };
      await expect(readQuotaReport(async op => { ops.push(op); throw failure; }, wire)).rejects.toBe(failure);
      expect(ops).toEqual(["AgentQuotaV2"]);
      expect(wire.legacy).toBeFalse();
    }
    const ops: string[] = [];
    await expect(readQuotaReport(async op => { ops.push(op); return { items: [{ provider: "codex" }] }; }, { legacy: false })).rejects.toMatchObject({ code: "bad_frame" });
    expect(ops).toEqual(["AgentQuotaV2"]);
    // A computer too old for either operation says so on the first as well.
    const old = new ProtocolError("unknown_op");
    await expect(readQuotaReport(async () => { throw old; }, { legacy: false })).rejects.toBe(old);
  });
});
