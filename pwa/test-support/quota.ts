import type { QuotaAccount, QuotaMeter } from "../src/lib/agent-quota-v2";
import type { QuotaReport } from "../src/lib/agent-quota-report";

/** Quota accounts for tests: one Codex account read just now, a quarter of its five-hour window used. */

type Share = Extract<QuotaMeter, { kind: "quota" }>;

export function quotaShare(patch: Partial<Share> = {}): Share {
  return {
    kind: "quota", name: "codex", pool: "plan", headline: true, used_percent: 25, count: null,
    window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600, ...patch,
  };
}

export function quotaAccount(patch: Partial<QuotaAccount> = {}): QuotaAccount {
  return {
    id: patch.provider ?? "codex", provider: "codex", plan: "pro", scope: "", region: "", label: "", source: "app_server",
    state: "ok", reason: "", observed_at: Math.floor(Date.now() / 1000), retry_at: 0, meters: [quotaShare()], ...patch,
  };
}

/** An account with no numbers: one that needs the reader, or one that is not set up. */
export function quotaOff(provider: QuotaAccount["provider"], state: "needs_action" | "not_configured" | "failed", reason: QuotaAccount["reason"]): QuotaAccount {
  return quotaAccount({ provider, plan: "", state, reason, observed_at: 0, meters: [] });
}

export function quotaReport(...accounts: QuotaAccount[]): QuotaReport {
  return { accounts, legacy: false, unknown: 0 };
}
