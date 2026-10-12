import {
  adoptDiffNoteScope,
  carryDiffNotes,
  diffNoteScope,
  diffNotesAt,
  openDiffNoteLines,
  placeDiffNotes,
  sameDiffNoteScope,
  type DiffNoteCarry,
  type DiffNotePlace,
} from "../../lib/diff-notes";
import { t } from "../../lib/i18n";
import { parseDiffLines, type DiffLine, type GitDiff } from "../../lib/workspace";
import { showStatus } from "../../app/notices-store";
import { carryOpenNote, type OpenNoteCarry } from "./note-drafts";
import { activeScope, bumpWorkspaceNotes, getWorkspaceSnapshot } from "./store";

/**
 * Notes follow their file from one reading of its diff to the next.
 *
 * A diff is read again whenever the reader comes back to it, and it is another
 * revision as soon as the agent has edited the file or something was
 * committed. What the reader wrote on the old one, saved or still being typed,
 * is pinned again on the new one (`carryDiffNotes`, `carryOpenNote`), and they
 * are told when that moved a note, left one on a line that changed, or left
 * the file with no line to hold its notes at all.
 */

/** The Herdr session a connection is on; pane ids repeat across them. */
function herdOf(session: object): string | null {
  const name = (session as { herdSession?: () => string | null }).herdSession?.();
  return typeof name === "string" ? name : null;
}

/** The lines notes can stand on. A patch cut short has lines missing, so none of them is taken for the note's own. */
function noteLines(diff: GitDiff): DiffLine[] {
  return diff.patch && !diff.truncated ? parseDiffLines(diff.patch) : [];
}

function tell(carried: Pick<DiffNoteCarry, "orphaned" | "drifted" | "moved">, open: OpenNoteCarry = null): void {
  const orphaned = carried.orphaned + (open === "saved" ? 1 : 0);
  const drifted = carried.drifted + (open === "drifted" ? 1 : 0);
  if (orphaned) showStatus(t("diffNotes.carriedOrphaned", { count: orphaned }));
  else if (drifted) showStatus(t("diffNotes.carriedDrifted", { count: drifted }));
  else if (carried.moved || open === "followed") showStatus(t("diffNotes.carriedFollowed"));
}

/**
 * The pane's files are read at `root` from here on: its notes are the ones
 * written there, under the Herdr session its connection is on now.
 */
export function placeWorkspaceNotes(session: object, paneId: string, root: string): DiffNotePlace {
  const place: DiffNotePlace = { session, herd: herdOf(session), paneId, root };
  placeDiffNotes(place);
  return place;
}

/**
 * The open diff owns the notes written on it. Notes still waiting on an older
 * patch of the same file come along to this one, and so does the one being
 * written. A binary diff takes no notes and carries none.
 */
export function bindDiffNotes(session: object, paneId: string, root: string, diff: GitDiff | null): void {
  const place = placeWorkspaceNotes(session, paneId, root);
  const scope = diff?.revision ? { ...place, revision: diff.revision } : null;
  if (!scope || !diff || diff.binary) {
    adoptDiffNoteScope(scope);
    return;
  }
  const lines = noteLines(diff);
  const carried = carryDiffNotes(scope, diff.path, diff.layer, lines);
  openDiffNoteLines(scope, diff.path, diff.layer, lines);
  adoptDiffNoteScope(scope);
  tell(carried, carryOpenNote(`${diff.path}:${diff.layer}`, scope, lines, carried.pins));
}

/**
 * Before the notes of every file go to the agent as one prompt, each file
 * that is not the one on screen is read again and its notes are pinned on what
 * it reads now: a note is sent with the line number its line has today, and
 * says so when that line has changed or is gone. False when the diff on screen
 * went away meanwhile and nothing should be sent; a read that fails is thrown.
 */
export async function settleWaitingNotes(): Promise<boolean> {
  const open = diffNoteScope();
  const scope = activeScope();
  const shown = getWorkspaceSnapshot().diff;
  if (!open || !scope) return false;
  const others = new Map<string, { path: string; layer: GitDiff["layer"] }>();
  for (const note of diffNotesAt(open)) {
    if (shown && note.path === shown.path && note.layer === shown.layer) continue;
    others.set(`${note.layer}:${note.path}`, { path: note.path, layer: note.layer });
  }
  const total = { orphaned: 0, drifted: 0, moved: 0 };
  for (const { path, layer } of others.values()) {
    const diff = await scope.diff(path, layer).value;
    if (activeScope() !== scope || !sameDiffNoteScope(diffNoteScope(), open)) return false;
    const carried = carryDiffNotes({ ...open, revision: diff.revision }, path, layer, diff.binary ? [] : noteLines(diff));
    total.orphaned += carried.orphaned;
    total.drifted += carried.drifted;
    total.moved += carried.moved;
  }
  if (total.orphaned || total.drifted || total.moved) bumpWorkspaceNotes();
  return true;
}
