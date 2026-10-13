import { WorktreeProgressList } from "../../operations/worktree-progress";
// Not this slice: the daemon update banner stays with its own owner. The phone
// shows it in Settings; the desktop rail keeps the compact notice.
import { DaemonUpdate } from "../../settings/daemon-update-view";
import type { HerdActions } from "../actions";
import type { HerdViewModel } from "../model/herd-view";
import { HerdGroup } from "./herd-group";
import { HerdRows } from "./herd-rows";
import { HerdSkeleton } from "./herd-skeleton";
import { HerdEmpty } from "./herd-empty";
import { indexedStyle } from "./indexed";
import { useRoster } from "./roster";
import { usePointerFine } from "./use-pointer-fine";

/**
 * The sections of one list. Keyed by the list's epoch where it is drawn, so a
 * list built again starts over with nothing entering and nothing kept, and its
 * whole entrance (`.herd-list.enter`) plays on rows that are new with it.
 */
function HerdSections({ view, actions, hoverActions, railed }: {
  view: HerdViewModel;
  actions: HerdActions;
  hoverActions: boolean;
  railed: boolean;
}) {
  const roster = useRoster(view.groups);
  return (
    <div className={`herd-list${view.stagger ? " enter" : ""}`}>
      {roster.map(({ group, rows, leaving }) => view.grouped ? (
        <HerdGroup key={group.id} group={group} rows={rows} leaving={leaving} groupIds={view.groupIds} actions={actions}
          hoverActions={hoverActions} createInMenu={railed && !hoverActions} createDisabled={!view.creatable} listed={railed} />
      ) : (
        <section key={group.id} className={`herd-group${leaving ? " is-leaving" : ""}`} inert={leaving}>
          <h2 className="section-title" style={indexedStyle(group.index)}>
            <span className="herd-section-name">{group.title}</span>
            {group.count > 0 && <span className="section-count">{group.count}</span>}
          </h2>
          <div className="herd-group-body" role={railed ? "list" : undefined} aria-label={railed ? group.title : undefined}>
            <HerdRows rows={rows} actions={actions} hoverActions={hoverActions} listed={railed} />
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The herd list: pending worktree jobs, then either the empty state or the
 * projected sections. The desktop rail also carries the compact daemon update,
 * which the phone shows in Settings. Under a precise pointer the rail's rows
 * offer their actions on hover instead of behind a swipe.
 */
export function HerdList({ view, actions, variant = "page" }: {
  view: HerdViewModel;
  actions: HerdActions;
  variant?: "page" | "rail";
}) {
  const hoverActions = usePointerFine() && variant === "rail";
  // The rail's rows are items of a list a screen reader counts; the phone page keeps the markup it has.
  const railed = variant === "rail";
  return (
    <>
      {variant === "rail" ? <DaemonUpdate compact /> : null}
      <WorktreeProgressList />
      {view.loading ? <HerdSkeleton /> : view.empty ? <HerdEmpty empty={view.empty} actions={actions} beside={railed} />
        : <HerdSections key={view.epoch} view={view} actions={actions} hoverActions={hoverActions} railed={railed} />}
    </>
  );
}
