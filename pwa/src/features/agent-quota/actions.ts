import { liveSession } from "../computers/catalog-store";
import { goToScreen } from "../../app/navigation-store";
import { ProtocolError } from "../../lib/protocol/errors";
import { commitView } from "../../app/host";
import { quotaSnapshot, setQuotaSnapshot } from "./store";

/**
 * Quota controller — the feature's one connected adapter.
 *
 * It reads the computers domain for the established session and navigates
 * through the navigation action.
 *
 * Data updates deliberately do NOT repaint the app: the snapshot store notifies
 * its own subscribers, so a mounted quota page or settings summary refreshes on
 * its own — and a refresh that finishes after a computer switch notifies nobody
 * who is looking at it, because the answer landed on the retired session.
 *
 * Navigation commits through the application port (`commitView`): the installed
 * App composes the arriving screen synchronously. With no host installed the
 * controller is headless and mounts nothing.
 */

/** In-flight read guard: one outstanding quota request per session. */
function alreadyLoading(): boolean {
  const session = liveSession();
  return !!session && quotaSnapshot(session)?.loading === true;
}

/**
 * How a refresh ended, for the control that asked: `unchanged` is an answer
 * that says what the page already shows (the computer keeps a read for a
 * minute), which would otherwise look like a press that did nothing.
 */
export type QuotaRefresh = "skipped" | "updated" | "unchanged" | "failed";

export async function refreshAgentQuota(): Promise<QuotaRefresh> {
  const session = liveSession();
  if (!session || !session.isConnected() || alreadyLoading()) return "skipped";
  const previous = quotaSnapshot(session);
  const kept = { items: previous?.items ?? null, legacy: previous?.legacy, unknown: previous?.unknown };
  setQuotaSnapshot(session, { loading: true, ...kept, error: "" });
  try {
    const report = await session.agentQuota();
    const unchanged = !!previous?.items && !previous.error && sameSample(previous.items, report.accounts);
    setQuotaSnapshot(session, { loading: false, items: report.accounts, legacy: report.legacy, unknown: report.unknown, error: "" });
    return unchanged ? "unchanged" : "updated";
  } catch (error) {
    // What was read before stays on the page under the error: a failed read
    // says nothing about the accounts, and each card shows how old it is.
    const upgrade = error instanceof ProtocolError && error.code === "unknown_op";
    setQuotaSnapshot(session, upgrade ? { loading: false, items: null, error: "quota.upgrade" } : { loading: false, ...kept, error: "quota.failed" });
    return "failed";
  }
}

type Sampled = { readonly id: string; readonly state: string; readonly reason: string; readonly observed_at: number };

/** Whether two answers are the same reads: the same accounts, in the same state, sampled at the same time. */
function sameSample(left: readonly Sampled[], right: readonly Sampled[]): boolean {
  return left.length === right.length && left.every((account, index) => {
    const other = right[index];
    return other.id === account.id && other.state === account.state && other.reason === account.reason && other.observed_at === account.observed_at;
  });
}

/**
 * Navigation, so it repaints through the application port: the quota page has
 * to be composed first. Opening from one account's row lands on its card.
 */
export function openQuota(id?: string): void {
  goToScreen("quota");
  commitView();
  void refreshAgentQuota();
  if (id) focusQuotaCard(id);
}

function focusQuotaCard(id: string): void {
  const card = document.getElementById(`quota-${id}`);
  if (!card) return;
  card.scrollIntoView({ block: "start" });
  card.classList.add("is-focused");
  globalThis.setTimeout(() => card.classList.remove("is-focused"), 1_600);
}
