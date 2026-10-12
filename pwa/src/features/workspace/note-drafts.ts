import { useSyncExternalStore } from "react";
import {
  carryDiffNoteTarget,
  diffNoteCarryKey,
  diffNoteForPin,
  diffNotePlaceKey,
  diffNoteScope,
  diffNoteSurroundings,
  sameDiffNoteScope,
  upsertDiffNote,
  type DiffNotePlace,
  type DiffNoteScope,
  type DiffNoteTarget,
} from "../../lib/diff-notes";
import type { DiffLine } from "../../lib/workspace";

/**
 * Line notes being written, kept by the place and diff they are written on.
 *
 * A diff is shown in two places: in the inspector beside the session and on
 * the workspace screen. Both edit a note in place under its line
 * (`note-inline`). Which of the two the reader is looking at changes with the
 * window's width, a rotation and the files button, and the diff itself changes
 * with every step through the review. What they were typing must not go with
 * any of that, so it lives here and neither place owns it: each shows the note
 * this module holds for the diff on screen, and saving or cancelling in either
 * one lets go of it for both.
 *
 * Each diff has at most one, and it belongs to the note scope it was opened in
 * (connection, Herdr session, pane, root and file revision), so it never shows
 * up on another pane's diff. When the file is read again at another revision
 * the note goes along to the line that is still its own (`carryOpenNote`), as
 * saved notes do. Notes are held by their connection and go when it does;
 * another computer's are left alone, since its connection can come back.
 */
export type OpenNote = {
  owner: DiffNoteScope;
  target: DiffNoteTarget;
  /** What the reader typed; null until they type. */
  draft: string | null;
  /** Opened in place by a press just now, so the field takes focus when it mounts. */
  fresh: boolean;
  /**
   * Left with Escape while it held words: the editor is closed and the note
   * waits under its line as a card until the reader presses it.
   */
  aside: boolean;
  /** The lines around the one it was opened on, for finding that line again. */
  around?: readonly [string, string];
};

/** By connection, then by place and diff. */
let openNotes = new WeakMap<object, Map<string, OpenNote>>();
/** The connection a key belongs to. Keys are handed out as plain text; this never keeps a connection alive. */
const keyOwners = new Map<string, WeakRef<object>>();
const serials = new WeakMap<object, number>();
let lastSerial = 0;
let version = 0;
const listeners = new Set<() => void>();

function published(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function keyOf(place: DiffNotePlace, diffKey: string): string {
  let serial = serials.get(place.session);
  if (!serial) serials.set(place.session, serial = ++lastSerial);
  return `${serial}\n${diffNotePlaceKey(place)}\n${diffKey}`;
}

function heldAt(key: string): OpenNote | undefined {
  const session = keyOwners.get(key)?.deref();
  return session ? openNotes.get(session)?.get(key) : undefined;
}

function hold(key: string, note: OpenNote): void {
  for (const [stale, owner] of keyOwners) if (!owner.deref()) keyOwners.delete(stale);
  note.around ??= diffNoteSurroundings(note.target);
  let held = openNotes.get(note.owner.session);
  if (!held) openNotes.set(note.owner.session, held = new Map());
  held.set(key, note);
  keyOwners.set(key, new WeakRef(note.owner.session));
}

function letGo(key: string): void {
  const session = keyOwners.get(key)?.deref();
  if (session) openNotes.get(session)?.delete(key);
  keyOwners.delete(key);
}

/** The typed text differs from what the pin has saved. */
export function unsaved(note: OpenNote): boolean {
  return note.draft !== null && note.draft.trim() !== (diffNoteForPin(note.target)?.body ?? "").trim();
}

/** Words the reader would lose: an emptied field holds none. */
export function halfWritten(note: OpenNote): boolean {
  return unsaved(note) && note.draft!.trim() !== "";
}

/** A diff's place in the store and the note open on it (`diffKey` is its file and layer). */
export type HeldNote = {
  key: string;
  /** Null while no diff is on screen to write on. */
  owner: DiffNoteScope | null;
  note: OpenNote | null;
};

export function useHeldNote(diffKey: string): HeldNote {
  useSyncExternalStore(subscribe, () => version);
  const owner = diffKey ? diffNoteScope() : null;
  const key = owner ? keyOf(owner, diffKey) : "";
  const held = key ? heldAt(key) : undefined;
  return { key, owner, note: held && sameDiffNoteScope(held.owner, owner) ? held : null };
}

/** Open a note on this diff, in place of the one it held. */
export function openNote(key: string, note: OpenNote): void {
  hold(key, note);
  published();
}

/**
 * Begin a note on a line of the diff that has just been opened for it (the
 * file view's "comment" on one of its lines). The diff's own note in progress
 * is never dropped for it: a half-written one is brought back instead, as a
 * press on another line would. False when no diff is on screen to write on.
 */
export function beginNote(diffKey: string, target: DiffNoteTarget): boolean {
  const owner = diffNoteScope();
  if (!owner) return false;
  const key = keyOf(owner, diffKey);
  const held = heldAt(key);
  if (held && sameDiffNoteScope(held.owner, owner) && halfWritten(held)) {
    held.aside = false;
    held.fresh = true;
    published();
    return true;
  }
  openNote(key, { owner, target, draft: null, fresh: true, aside: false });
  return true;
}

/**
 * Escape: the editor closes without an answer. Words the reader would lose
 * stay and wait under their line, like a note the column or the screen went
 * away under; an editor with nothing new in it has nothing to keep.
 */
export function setNoteAside(key: string): void {
  const held = heldAt(key);
  if (held && halfWritten(held)) {
    held.aside = true;
    held.fresh = false;
  } else letGo(key);
  published();
}

/** A press on the waiting note: back into the editor, with the keyboard. */
export function resumeNote(key: string): void {
  const held = heldAt(key);
  if (!held) return;
  held.aside = false;
  held.fresh = true;
  published();
}

/** Saved or cancelled: the diff has no note in progress any more, wherever it is shown. */
export function dropNote(key: string): void {
  letGo(key);
  published();
}

/** What became of a note being written when its file was read at another revision. */
export type OpenNoteCarry = "followed" | "drifted" | "saved" | null;

/**
 * The file a note is being written on was read again and is another revision
 * now (the agent edited it, something was committed, the reader refreshed).
 * The words being typed are the reader's as much as a saved note's and go
 * along: the editor moves to the line that is still the one it was opened on,
 * found the way a saved note's is, and to the nearest one when that line is
 * gone (`drifted`). An editor open on a saved note follows that note (`pins`
 * is where the saved ones went, `DiffNoteCarry.pins`).
 *
 * A patch with no line left to write under cannot show an editor. Words
 * already typed are then saved as the note they were becoming (`saved`): it
 * waits with the file's other notes to be sent or discarded, instead of in an
 * editor nobody can reach. Call after the new scope is adopted.
 */
export function carryOpenNote(diffKey: string, owner: DiffNoteScope, lines: readonly DiffLine[], pins: ReadonlyMap<string, DiffNoteTarget>): OpenNoteCarry {
  const key = keyOf(owner, diffKey);
  const held = heldAt(key);
  if (!held || sameDiffNoteScope(held.owner, owner)) return null;
  const followed = pins.get(diffNoteCarryKey(held.owner.revision, held.target));
  const place = followed ? { target: followed, found: true } : carryDiffNoteTarget(owner, { ...held.target, around: held.around }, lines);
  const hasLines = lines.some((line) => line.kind === "add" || line.kind === "delete" || line.kind === "context");
  if (!hasLines || !place) {
    const saved = halfWritten(held) ? upsertDiffNote(held.target, held.draft ?? "", owner) : null;
    if (saved) saved.drifted = true;
    letGo(key);
    published();
    return saved ? "saved" : null;
  }
  // An editor with nothing typed in it has nothing to keep: it does not move to a line it was not opened on.
  if (!place.found && !halfWritten(held)) {
    letGo(key);
    published();
    return null;
  }
  held.owner = owner;
  held.target = place.target;
  held.fresh = false;
  if (place.found) held.around = diffNoteSurroundings(place.target) ?? held.around;
  published();
  return place.found ? "followed" : "drifted";
}

/** The panes of one connection and Herdr session with a note being written. */
export function openNotePanes(session: object, herd: string | null): string[] {
  return [...new Set([...(openNotes.get(session)?.values() ?? [])]
    .filter((note) => (note.owner.herd ?? null) === herd).map((note) => note.owner.paneId))];
}

/** A pane that is gone takes the notes being written on it with it. */
export function dropPaneOpenNotes(session: object, herd: string | null, paneId: string): void {
  const held = openNotes.get(session);
  if (!held) return;
  let dropped = false;
  for (const [key, note] of held) {
    if ((note.owner.herd ?? null) !== herd || note.owner.paneId !== paneId) continue;
    held.delete(key);
    keyOwners.delete(key);
    dropped = true;
  }
  if (dropped) published();
}

/** Start over: a test, or a QA scene that builds its own session. */
export function clearOpenNotes(): void {
  openNotes = new WeakMap();
  keyOwners.clear();
  published();
}
