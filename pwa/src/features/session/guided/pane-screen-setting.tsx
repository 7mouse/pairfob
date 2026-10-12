import { useId, useSyncExternalStore } from "react";
import { t } from "../../../lib/i18n";
import { Button } from "../../../shared/ui/primitives";
import { MenuGroup, MenuRow, MenuSetting } from "../../../shared/ui/overlay/menu-controls";
import { screenWake } from "../screen-wake-lifecycle";

export function PaneScreenSetting() {
  const wake = useSyncExternalStore(screenWake.subscribe, screenWake.get);
  const id = useId();
  return <MenuGroup label={t("pm.wakeLabel")}>
    <MenuSetting label={t("pm.wakeLabel")} hint={t(`pm.wake.${wake.status}`)} hintProps={{ id, role: "status" }}>
      <Button className="menu-switch" role="switch" aria-checked={wake.enabled}
        aria-label={t("pm.wakeLabel")} aria-describedby={id}
        disabled={!wake.eligible || wake.status === "unsupported"}
        onClick={() => screenWake.setEnabled(!wake.enabled)} />
    </MenuSetting>
    {wake.status === "unavailable" && <MenuRow label={t("pm.wakeRetry")} onClick={screenWake.retry} />}
  </MenuGroup>;
}
