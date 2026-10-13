import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { langRevision, subscribeLang, resolveCopy, t } from "../../../lib/i18n";
import { fullTerminalStateTitle } from "./full-terminal-state";
import { getFullTerminalView, subscribeFullTerminalView } from "./full-terminal-view";
import { usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";

/**
 * What stands over the terminal until it is live: opening, or the reason it
 * could not open. It covers the screen and takes no room in it, so the
 * terminal's box is the same with and without it. Once the terminal is live
 * the cover fades off the screen already drawn under it (`is-leaving`),
 * saying what it said, and is then put away. `data-stage` is the terminal's
 * stage throughout, the cover's own way out included.
 */
export function FullTerminalStateLayer({ onRetry }: { onRetry: () => void }) {
  useSyncExternalStore(subscribeLang, langRevision);
  const now = useSyncExternalStore(subscribeFullTerminalView, getFullTerminalView);
  const live = now.stage === "live";
  const cover = usePresence(!live, MOTION_MS.element);
  const covered = useRef(now);
  if (!live) covered.current = now;
  const view = cover.leaving ? covered.current : now;
  const Icon = view.stage === "error" ? CircleAlert : LoaderCircle;
  return (
    <section
      className={cover.leaving ? "full-terminal-state is-leaving" : "full-terminal-state"}
      hidden={!cover.mounted}
      inert={cover.leaving}
      data-stage={now.stage}
      role={view.stage === "error" ? "alert" : "status"}
      aria-live={view.stage === "error" ? "assertive" : "polite"}
    >
      <Icon className="full-terminal-state-spinner" aria-hidden="true" />
      <div className="full-terminal-state-copy">
        <strong className="full-terminal-state-title">{fullTerminalStateTitle(view.stage)}</strong>
        <p className="full-terminal-state-detail">{resolveCopy(view.detail)}</p>
      </div>
      <button
        type="button"
        className="full-terminal-state-retry"
        hidden={!view.retry}
        disabled={view.busy}
        onClick={onRetry}
      >
        {t("ft.retry")}
      </button>
    </section>
  );
}
