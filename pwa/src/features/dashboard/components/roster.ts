import { useKeptList } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import type { HerdCardView, HerdGroupView } from "../model/herd-view";

/**
 * The rows of one list, across the polls that redraw it.
 *
 * A session that turns up in a list already on screen is a new row and enters
 * alone; one that is gone was closed and is kept where it was for its exit.
 * Both are told from the list's pane ids, never from a mount: the first paint,
 * a list built again (`HerdViewModel.epoch` remounts the reader of this hook)
 * and a poll with the same sessions all draw their rows still. A row that only
 * changed group (a pin) is in both lists and is neither.
 */

/** A leaving row fades (`--dur-2`), then gives up its height (`--dur-3`); see `.herd-row.is-leaving`. */
const ROW_EXIT_MS = MOTION_MS.element + MOTION_MS.panel;

export type RosterRow = { card: HerdCardView; entering: boolean; leaving: boolean };

export type RosterGroup = {
  group: HerdGroupView;
  /** The group's last session was closed: it is drawn once more, as it was, for that row's exit. */
  leaving: boolean;
  rows: RosterRow[];
};

type Placed = { card: HerdCardView; group: HerdGroupView };

const paneOf = (placed: Placed) => placed.card.paneId;

export function useRoster(groups: readonly HerdGroupView[]): RosterGroup[] {
  const kept = useKeptList(groups.flatMap(group => group.cards.map((card): Placed => ({ card, group }))), paneOf, ROW_EXIT_MS);
  const drawn: RosterGroup[] = groups.map(group => ({ group, leaving: false, rows: [] }));
  const byId = new Map(drawn.map(entry => [entry.group.id, entry]));
  // A leaver stands after whatever stood before it, so its group does too.
  let before = -1;
  for (const { item, entering, leaving } of kept) {
    let entry = byId.get(item.group.id);
    if (!entry) {
      entry = { group: item.group, leaving: true, rows: [] };
      drawn.splice(before + 1, 0, entry);
      byId.set(item.group.id, entry);
    }
    entry.rows.push({ card: item.card, entering, leaving });
    before = drawn.indexOf(entry);
  }
  return drawn;
}
