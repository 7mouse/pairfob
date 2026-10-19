import { useState, useSyncExternalStore } from "react";
import { useConnection, useRuntime } from "../../features/connection/hooks";
import { useComputers } from "../../features/computers/hooks";
import { enablePush, supportsWebPush } from "../../features/settings/actions";
import { dismissNotifications, notificationPromptRevision, notificationsPending, subscribeNotificationPrompt } from "../../features/settings/notification-onboarding";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives/button";
import "./notification-prompt.scss";

export function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches
    && !(navigator as Navigator & { standalone?: boolean }).standalone;
}

/** A floating invitation never resizes the computer's terminal or takes focus. */
export function NotificationPrompt() {
  const { phase } = useConnection();
  const { credential, live } = useComputers();
  const { pushEnabled, pushSubscribed } = useRuntime();
  useSyncExternalStore(subscribeNotificationPrompt, notificationPromptRevision);
  const daemonId = credential?.daemonId ?? "";
  const install = needsHomeScreen();
  if (phase !== "live" || !live || !daemonId || !notificationsPending(daemonId)
    || pushEnabled !== true || pushSubscribed === true
    || (!install && !supportsWebPush()) || ("Notification" in window && Notification.permission === "denied")) return null;
  return <NotificationInvitation key={daemonId} daemonId={daemonId} install={install} />;
}

function NotificationInvitation({ daemonId, install }: { daemonId: string; install: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return <aside className="notification-prompt" aria-label={t("push.inviteTitle")}>
    <strong>{t("push.inviteTitle")}</strong>
    <p>{t(install ? "push.homeScreen" : "push.inviteBody")}</p>
    {failed && <p role="status">{t("push.inviteFailed")}</p>}
    <div>
      <Button className="btn" onClick={() => dismissNotifications(daemonId)}>{t("push.later")}</Button>
      {!install && <Button className="btn btn-primary" disabled={busy} onClick={() => {
        setBusy(true);
        // enablePush requests permission synchronously, before any network wait.
        void enablePush().then(ok => {
          if (ok) dismissNotifications(daemonId);
          else setFailed(true);
        }).finally(() => setBusy(false));
      }}>{t(busy ? "set.pushEnabling" : "set.pushEnable")}</Button>}
    </div>
  </aside>;
}
