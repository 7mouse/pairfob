import { useRef } from "react";
import type { WorkspaceSnapshot } from "./model";

/**
 * From one diff to the next without a blank in between.
 *
 * Stepping through the changes, or switching the layer, drops the open diff
 * before the next one is read (`loadGitDiff`). An empty body for that moment
 * would flash on every step of a review, so the body keeps the diff it was
 * showing, dimmed and out of reach, until the next one is here or the wait
 * has lasted long enough for the skeleton to say so (`pendingReveal`); what
 * arrives then fades in.
 *
 * Both answers come from what the body was showing, not from a mount or a
 * paint: `stale` only while a diff this body drew is being replaced for the
 * same pane and repository, `reveal` only for a diff that took the place of
 * something else here (another diff, the skeleton, the empty wait). A body
 * that is first drawn with its diff, a poll, and the same file read again at a
 * new revision all stay as they are.
 */
export type DiffHold = {
  /** Keep what was drawn, dimmed: the next diff is on its way. */
  stale: boolean;
  /** The diff on screen has just taken the place of what was here: it fades in. */
  reveal: boolean;
};

type Shown = {
  /** The pane and repository the body last drew a diff for. */
  owner: string;
  /** That diff's file and layer; empty when the body shows none. */
  diff: string;
  /** The diff, at the revision, that arrived in place of something else. */
  revealed: string;
  /** The body has been drawn before. */
  painted: boolean;
};

export function useDiffHold(snapshot: WorkspaceSnapshot, diffKey: string): DiffHold {
  const shown = useRef<Shown>({ owner: "", diff: "", revealed: "", painted: false });
  const s = shown.current;
  const diff = snapshot.diff;
  const owner = `${snapshot.descriptor?.root ?? ""}\n${snapshot.paneId}`;
  let stale = false;
  let drawn = "";
  if (diff && !snapshot.error) {
    drawn = `${owner}\n${diffKey}\n${diff.revision}`;
    if (s.painted && (s.owner !== owner || s.diff !== diffKey)) s.revealed = drawn;
    s.owner = owner;
    s.diff = diffKey;
  } else {
    stale = s.diff !== "" && s.owner === owner && !diff && !snapshot.error && snapshot.loading && !snapshot.pendingReveal;
    // The skeleton, an error or another pane took its place: there is nothing left to keep.
    if (!stale) s.diff = "";
  }
  s.painted = true;
  return { stale, reveal: drawn !== "" && s.revealed === drawn };
}
