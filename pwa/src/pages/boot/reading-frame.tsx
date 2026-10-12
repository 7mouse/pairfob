import { t } from "../../lib/i18n";
import { StatusDot } from "../../shared/ui/primitives/status";
import { HerdSkeleton } from "../../features/dashboard/components/herd-skeleton";

/** The same list-sized boot frame, available before connection features load. */
export function ReadingFrame() {
  return <div className="page herd-page boot-shell">
    <h1 className="sr-only">{t("tabs.sessions")}</h1>
    <header className="herd-head"><div className="herd-head-row">
      <div className="host-title is-pending" role="status">
        <StatusDot tone="pending" />
        <span className="host-title-text">
          <span className="herd-sk boot-shell-name" aria-hidden="true" />
          <span className="host-title-line">{t("boot.reading")}</span>
        </span>
      </div>
    </div></header>
    <HerdSkeleton />
  </div>;
}
