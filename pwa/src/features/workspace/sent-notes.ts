import { diffNotePanes, forgetPaneDiffNotes } from "../../lib/diff-notes";
import {
  forgetPaneSentDiffNotes,
  noteSentAgentState,
  SENT_SETTLE_MS,
  sentDiffNotePanes,
  sentDiffNotesWaiting,
} from "../../lib/diff-notes-sent";
import { currentHerdSession, liveSession } from "../computers/catalog-store";
import { dashboardStore } from "../dashboard/catalog-store";
import { dropPaneOpenNotes, openNotePanes } from "./note-drafts";
import { bumpWorkspaceNotes } from "./store";

/**
 * Follows the sessions that notes were written for and sent to.
 *
 * Each sent note says under its line whether its agent has it, is working, or
 * has answered (`diff-notes-sent`). The list of sessions already knows what
 * every agent is doing, so this only reads it as it changes, for the Herdr
 * session on screen: pane ids repeat across them, and another one's agents say
 * nothing about these notes.
 *
 * The same list says which panes are gone. A closed pane has no agent to send
 * to and its id may be given to the next pane opened: what was written for it,
 * sent to it or being typed on it goes with it.
 */
let watching = false;
let settling: number | undefined;

/** An agent waiting on the reader (a permission, a question) is in the middle of its turn. */
const atWork = (status: string): boolean => status === "working" || status === "blocked";

function follow(): void {
  const session = liveSession();
  if (!session) return;
  const herd = currentHerdSession();
  const { agents, snapshotLoaded } = dashboardStore.get();
  // Until a snapshot is read an empty list means "not read yet", not "no sessions".
  if (!snapshotLoaded) return;
  let moved = false;
  const live = new Set(agents.map((agent) => agent.paneId));
  for (const paneId of new Set([...diffNotePanes(session, herd), ...sentDiffNotePanes(session, herd), ...openNotePanes(session, herd)])) {
    if (live.has(paneId)) continue;
    forgetPaneDiffNotes(session, herd, paneId);
    forgetPaneSentDiffNotes(session, herd, paneId);
    dropPaneOpenNotes(session, herd, paneId);
    moved = true;
  }
  if (sentDiffNotesWaiting(session, herd)) {
    let held = false;
    for (const agent of agents) {
      const seen = noteSentAgentState(session, herd, agent.paneId, atWork(agent.status));
      if (seen.moved) moved = true;
      if (seen.held) held = true;
    }
    // An idle heard too soon after a send was set aside: look again once the send has settled.
    if (held && settling === undefined) {
      settling = window.setTimeout(() => {
        settling = undefined;
        follow();
      }, SENT_SETTLE_MS);
    }
  }
  if (moved) bumpWorkspaceNotes();
}

/** Start following, once for the page. */
export function watchSentNotes(): void {
  if (watching) return;
  watching = true;
  dashboardStore.subscribe(follow);
}
