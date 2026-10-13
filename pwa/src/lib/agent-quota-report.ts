import { parseAgentQuota, type AgentQuota, type QuotaStatus } from "./agent-quota";
import { parseQuotaAccounts, type QuotaAccount, type QuotaMeter, type QuotaReason, type QuotaState } from "./agent-quota-v2";
import { ProtocolError } from "./protocol/errors";

/**
 * One quota read as the app holds it, whichever operation the computer
 * answered: `legacy` says the computer only knows the first one, and `unknown`
 * counts accounts of providers this build cannot show.
 */
export interface QuotaReport {
  accounts: QuotaAccount[];
  legacy: boolean;
  unknown: number;
}

const LEGACY_STATES: Record<QuotaStatus, [QuotaState, QuotaReason]> = {
  ok: ["ok", ""],
  // An older computer marks a passed reset or an old sample itself; here each
  // meter and the sample's age are judged when they are shown.
  stale: ["ok", ""],
  unavailable: ["failed", "unavailable"],
  setup_required: ["needs_action", "setup"],
  // It cannot tell an expired login from one that was never there, so this is
  // not raised as something to act on.
  auth_required: ["not_configured", "sign_in"],
  not_logged_in: ["not_configured", "no_login"],
  not_installed: ["not_configured", "not_installed"],
  not_running: ["not_configured", "not_running"],
  unsupported: ["not_configured", "unsupported_login"],
};

/** A pool token from a window's own name, as the computer derives it. */
function pool(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "other";
}

/**
 * Which of an older computer's windows stand for the plan. It sent no marks, so
 * this repeats what a current one sends: Claude's five-hour and seven-day
 * windows, Copilot's premium interactions, and every window of the others.
 */
function legacyHeadline(provider: AgentQuota["provider"], name: string): boolean {
  const plain = name.replaceAll("_", " ");
  if (provider === "claude") return plain === "five hour" || plain === "seven day";
  if (provider === "copilot") return plain === "premium interactions";
  return true;
}

/** The first operation's items in the shape of the second's. */
export function legacyQuotaAccounts(items: readonly AgentQuota[]): QuotaAccount[] {
  return items.map((q): QuotaAccount => {
    const [state, reason] = LEGACY_STATES[q.status];
    const meters: QuotaMeter[] = state === "ok" ? q.windows.map((w): QuotaMeter => {
      const headline = legacyHeadline(q.provider, w.name);
      const base = { name: w.name, pool: headline ? "plan" : pool(w.name), headline, window_minutes: w.window_minutes, resets_at: w.resets_at };
      return w.unlimited ? { ...base, kind: "unlimited" } : { ...base, kind: "quota", used_percent: w.used_percent, count: null };
    }) : [];
    return {
      id: q.provider, provider: q.provider, plan: q.plan, scope: "", region: "", label: "", source: q.source,
      state, reason, observed_at: meters.length ? q.observed_at : 0, retry_at: 0, meters,
    };
  });
}

/**
 * Read quota over one connection. A computer that answers `unknown_op` to the
 * second operation is asked the first from then on; `wire` is that connection's
 * memory of it. A timeout, a refused login or a malformed answer is an error of
 * the read and never a reason to fall back.
 */
export async function readQuotaReport(rpc: (op: "AgentQuotaV2" | "AgentQuota") => Promise<unknown>, wire: { legacy: boolean }): Promise<QuotaReport> {
  if (!wire.legacy) {
    try {
      return { ...parseQuotaAccounts(await rpc("AgentQuotaV2")), legacy: false };
    } catch (error) {
      if (!(error instanceof ProtocolError && error.code === "unknown_op")) throw error;
      wire.legacy = true;
    }
  }
  return { accounts: legacyQuotaAccounts(parseAgentQuota(await rpc("AgentQuota"))), legacy: true, unknown: 0 };
}
