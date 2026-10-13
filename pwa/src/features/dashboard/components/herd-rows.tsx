import { Fold } from "../../../shared/ui/primitives";
import type { HerdActions } from "../actions";
import { AgentCard } from "./agent-card";
import type { RosterRow } from "./roster";

/**
 * The rows of one group. Each stands in a fold of its own, open and still for
 * as long as its session is in the list: a new session's row opens into its
 * place and a closed one's shuts there (`roster.ts` says which), so the rows
 * around it are pushed apart or drawn together instead of jumping.
 */
export function HerdRows({ rows, actions, hoverActions, listed }: {
  rows: readonly RosterRow[];
  actions: HerdActions;
  /** Handed on to the rows; see `AgentCard`. */
  hoverActions: boolean;
  /** The rows are items of a counted list: each fold is the item. */
  listed: boolean;
}) {
  return rows.map(({ card, entering, leaving }) => (
    <Fold key={card.paneId} className={`herd-row${entering ? " is-entering" : ""}${leaving ? " is-leaving" : ""}`}
      role={listed ? "listitem" : undefined} open={!leaving} appear={entering}>
      <AgentCard card={card} actions={actions} hoverActions={hoverActions} listed={listed} />
    </Fold>
  ));
}
