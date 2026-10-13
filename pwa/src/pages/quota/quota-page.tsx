import { RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { computersStore, liveSession } from "../../features/computers/catalog-store";
import { goToScreen } from "../../app/navigation-store";
import { commitView } from "../../app/host";
import { refreshAgentQuota } from "../../features/agent-quota/actions";
import { quotaPanelModel } from "../../features/agent-quota/model";
import { QuotaPanelView } from "../../features/agent-quota/quota-panel-view";
import { quotaSnapshot, subscribeQuota } from "../../features/agent-quota/store";
import { showDaemonUpdate } from "../../features/settings/daemon-update-view";
import { t } from "../../lib/i18n";
import type { LiveSession } from "../../lib/protocol/session-types";
import { useCopied } from "../../shared/react/use-copied";
import { BackBar, Button, TopbarActions } from "../../shared/ui/primitives";
import { quotaOrder } from "./quota-order";

/**
 * Quota page composition.
 *
 * Two subscriptions, both narrow: the computers domain for the established
 * session, and the quota snapshot store for that session's data. A refresh
 * repaints this subtree on its own and never needs the global paint loop.
 *
 * The session snapshot uses the canonical `liveSession()` reader and subscribes
 * to the computers store. Attach/detach publications update the mounted panel.
 *
 * Back commits through the application port (`commitView`), so the installed
 * App composes the arriving settings screen synchronously; ordinary data
 * updates stay on the page's own domain subscriptions.
 */

/** Established session: computers subscription + action-time live-record read. */
export function useEstablishedSession(): LiveSession | null {
  return useSyncExternalStore(computersStore.subscribe, liveSession);
}

export function QuotaContent() {
  const session = useEstablishedSession();
  const snapshot = useSyncExternalStore(subscribeQuota, () => quotaSnapshot(session));
  const panel = quotaPanelModel(snapshot, session?.isConnected() === true, quotaOrder());
  const loading = !!snapshot?.loading;
  // One turn of the mark for each press: a read can come back within a frame,
  // so the turn belongs to the press and not to the time the read takes.
  const [turns, setTurns] = useState(0);
  // The computer keeps a read for a minute. An answer that changed nothing on
  // the page is said on the control, or the press would look like it did nothing.
  const [same, confirmSame] = useCopied<"same">();
  const refresh = () => {
    setTurns(count => count + 1);
    void refreshAgentQuota().then(outcome => { if (outcome === "unchanged") confirmSame("same"); });
  };
  return (
    <>
      <BackBar
        title={t("quota.title")}
        onBack={() => {
          goToScreen("settings");
          commitView();
        }}
      >
        <TopbarActions>
          <Button
            className="topbar-create quota-refresh"
            disabled={loading || session?.isConnected() !== true}
            aria-busy={loading}
            onClick={refresh}
          ><RefreshCw key={turns} className={turns ? "is-turning" : undefined} size={16} aria-hidden="true" />
            <span aria-live="polite">{t(loading ? "quota.loading" : same ? "quota.upToDate" : "quota.refresh")}</span></Button>
        </TopbarActions>
      </BackBar>
      <QuotaPanelView panel={panel} onUpdate={showDaemonUpdate} />
    </>
  );
}

export function QuotaScreen() {
  return (
    <div className="page settings-page quota-page">
      <QuotaContent />
    </div>
  );
}
