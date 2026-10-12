import { screenWake } from "../../features/session/screen-wake-lifecycle";
import { SCREEN_WAKE_MODES, setScreenWake, type ScreenWakeMode } from "../../features/settings/preferences-store";
import { t } from "../../lib/i18n";
import { SegmentedControl, SegmentedOption, SetAction, SetItem } from "../../shared/ui/primitives";

/**
 * When this device keeps its screen awake, chosen once on the row. Nothing on
 * the other screens says the screen is being held: a screen that stays lit says
 * so itself. Only a refusal needs words, and they sit here with the way to ask
 * again. A browser that cannot hold the screen has no row at all.
 */

export type ScreenWakeRowInput = {
  /** This device's choice, or its kind's default before one is made. */
  mode: ScreenWakeMode;
  supported: boolean;
  /** The system refused the last request. */
  denied: boolean;
};

export function ScreenWakeItem({ input }: { input: ScreenWakeRowInput }) {
  if (!input.supported) return null;
  const denied = input.denied && input.mode !== "off";
  return <SetItem className="wake-item" label={t("set.wake")}
    sub={denied ? t("set.wakeDenied") : t(`set.wakeDesc.${input.mode}`)} subTone={denied ? "warn" : undefined}
    trailing={<>
      {denied ? <SetAction onClick={screenWake.retry}>{t("retry")}</SetAction> : null}
      <SegmentedControl className="set-seg" aria-label={t("set.wake")}>
        {SCREEN_WAKE_MODES.map(id => <SegmentedOption key={id} selected={input.mode === id}
          onClick={() => { if (input.mode !== id) setScreenWake(id); }}>{t(`set.wake.${id}`)}</SegmentedOption>)}
      </SegmentedControl>
    </>} />;
}
