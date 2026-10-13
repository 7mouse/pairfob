import { MoreHorizontal, Plus } from "lucide-react";
import { t } from "../../../lib/i18n";
import { usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { Button, Chevron, Fold } from "../../../shared/ui/primitives";
import { useObjectPress } from "../../../shared/ui/overlay";
import { contextOrigin, noteOverlayOrigin } from "../../../shared/ui/overlay/origin";
import type { HerdActions } from "../actions";
import type { HerdGroupView } from "../model/herd-view";
import { HerdRows } from "./herd-rows";
import { indexedStyle } from "./indexed";
import type { RosterRow } from "./roster";

/**
 * One accordion section: a workspace or agent group, or the pinned group.
 *
 * The heading folds the section: its body shuts and opens by height, with the
 * chevron, and stays in the tree shut (`inert`, so neither the keyboard nor a
 * screen reader finds its rows). A workspace heading also shows its root path,
 * the rows inside that need the reader (so a folded section still reports
 * them), a + that opens the create sheet on this workspace and a visible menu
 * button; the hold on the heading still opens the same menu.
 *
 * With `hoverActions` the + and the menu button come before the marks: there
 * they lie over the end of the heading's text and show on hover (`desk-rail.scss`),
 * and the keyboard walks the heading's controls in the order they are drawn.
 *
 * With `createInMenu` (the desktop rail under a finger) the + is left to the
 * menu, whose first row is the same create: two always-visible 44px tools and
 * two marks would leave the workspace two letters of its name.
 */
export function HerdGroup({
  group,
  rows,
  leaving = false,
  groupIds,
  actions,
  hoverActions = false,
  createInMenu = false,
  createDisabled = false,
  listed = false,
}: {
  group: HerdGroupView;
  /** The group's rows as the list draws them now, one that is leaving included (`roster.ts`). */
  rows: readonly RosterRow[];
  /** Drawn once more for its last row's exit: seen fading, not reachable. */
  leaving?: boolean;
  groupIds: string[];
  actions: HerdActions;
  /** Handed on to the rows; see `AgentCard`. */
  hoverActions?: boolean;
  createInMenu?: boolean;
  /** A session cannot be started right now (`HerdViewModel.creatable`): the + is drawn and does not answer. */
  createDisabled?: boolean;
  /** Handed on to the rows, and the body is the list that holds them; see `AgentCard`. */
  listed?: boolean;
}) {
  const press = useObjectPress(() => actions.openWorkspaceMenu(group.menuAgent), group.hasMenu);
  const marked = group.blockedCount > 0 || group.doneCount > 0;
  // The fold's own box clips while the body is shut or still opening. Open and
  // at rest it must not: a row's focus ring reaches past the body's edge.
  const folding = usePresence(group.collapsed, MOTION_MS.panel).mounted;
  const tools = <>
    {group.canCreateTab && !createInMenu ? (
      <Button className="icon-btn group-tool" aria-label={t("list.newTabIn", { workspace: group.title })} disabled={createDisabled}
        data-trigger-of={`${group.id}:create`} onClick={() => actions.createInWorkspace(group.menuAgent)}>
        <Plus size={18} aria-hidden="true" />
      </Button>
    ) : null}
    {group.hasMenu ? (
      <Button className="icon-btn group-tool" aria-haspopup="menu" aria-label={t("list.workspaceMenu", { workspace: group.title })}
        data-trigger-of={group.id} onClick={() => actions.openWorkspaceMenu(group.menuAgent)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </Button>
    ) : null}
  </>;
  return (
    <section className={`herd-group${leaving ? " is-leaving" : ""}`} inert={leaving}>
      {/* With a mouse the whole heading takes the right-click, not only its title; the title's own press handles it first.
          Wherever it landed (a mark, the path) the menu is the heading's: it still opens at the pointer, and the title is
          what it belongs to and where focus returns. */}
      <div className="group-head" style={indexedStyle(group.index)}
        onContextMenu={hoverActions && group.hasMenu ? (event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          noteOverlayOrigin({ ...contextOrigin(event.nativeEvent), target: press.current });
          actions.openWorkspaceMenu(group.menuAgent);
        } : undefined}>
        <Button
          ref={press}
          className="group-title"
          data-trigger-of={group.id}
          aria-expanded={!group.collapsed}
          aria-haspopup={group.hasMenu ? "menu" : undefined}
          onClick={() => actions.toggleGroup(group.id, groupIds)}
        >
          <Chevron className="group-chev" />
          <span className="group-name">{group.title}</span>
        </Button>
        {hoverActions ? tools : null}
        <span className="group-marks">
          {group.blockedCount > 0 ? (
            <Button className="group-mark is-blocked"
              aria-label={t("list.markBlockedAria", { count: String(group.blockedCount) })}
              onClick={() => actions.revealAttention(group.id, "blocked")}>
              {t("list.markBlocked", { count: String(group.blockedCount) })}
            </Button>
          ) : null}
          {group.doneCount > 0 ? (
            <Button className="group-mark is-done"
              aria-label={t("list.markDoneAria", { count: String(group.doneCount) })}
              onClick={() => actions.revealAttention(group.id, "done")}>
              {t("list.markDone", { count: String(group.doneCount) })}
            </Button>
          ) : null}
          {!marked && group.count > 0 ? <span className="section-count">{group.count}</span> : null}
        </span>
        {hoverActions ? null : tools}
        {/* The inner span is what the rail hides when the heading's line leaves the path no room. */}
        {group.path ? <span className="group-path"><span>{group.path}</span></span> : null}
      </div>
      <Fold className={`herd-group-fold${folding ? " is-folding" : ""}`} open={!group.collapsed}>
        <div className="herd-group-body" role={listed ? "list" : undefined} aria-label={listed ? group.title : undefined}>
          <HerdRows rows={rows} actions={actions} hoverActions={hoverActions} listed={listed} />
        </div>
      </Fold>
    </section>
  );
}
