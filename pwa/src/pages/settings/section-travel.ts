import { flushSync } from "react-dom";
import { withSynchronousTransition } from "../../app/transition";
import { setSettingsSection, settingsSection, type SettingsSection } from "../../features/settings/settings-section";

/**
 * Move between Settings pages from inside Settings, as a navigation.
 *
 * The computer page sits one level under the overview, so going in is a push
 * and coming back a pop, of the page alone: on a phone layout it travels like
 * a screen while the tab bar it stands on stays, beside the list it only
 * cross-fades (`app/transition` decides which). The page is drawn inside the declared transition, so the
 * arriving one is what moves.
 *
 * `setSettingsSection` stays the plain write for everything that is not this
 * move: an entry from another screen, which travels as that screen change, and
 * the reset when Settings is left.
 */
export function travelSettingsSection(next: SettingsSection): void {
  if (settingsSection() === next) return;
  withSynchronousTransition(next === "overview" ? "page-pop" : "page-push", () => flushSync(() => setSettingsSection(next)));
}
