/**
 * Diff annotation notes: comments pinned to concrete git-diff lines, kept in
 * memory until they are batched into ONE PromptAgent call. Composing all
 * notes into a single prompt keeps the revision coherent (one request, one
 * reply); there is deliberately no one-comment-per-RPC path.
 *
 * A note belongs to a place: the connection to a computer, the Herdr session
 * on it, the pane, and the workspace root the pane's files were read at. Pane
 * ids repeat across Herdr sessions and a pane can move to another repository,
 * so a place is all four. Within its place a note is shown on the revision of
 * the diff it is pinned on. A send only removes the notes captured for that
 * request.
 *
 * Nothing here keeps a connection alive: notes are held by their session
 * object and go when it does.
 */
import { t } from "./i18n";
import { fitOperationPrompt } from "./operations";
import type { DiffLine, GitLayer } from "./workspace";
import { clearSentDiffNotes } from "./diff-notes-sent";

export type DiffNoteSide = "old" | "new";

/** Where a note is pinned. At most one note per pin inside one owner. */
export type DiffNotePin = {
  path: string;
  layer: GitLayer;
  side: DiffNoteSide;
  line: number;
};

/** A pin plus the quoted source line, captured when the note is written. */
export type DiffNoteTarget = DiffNotePin & { snippet: string };

/** Whose notes: a connection, a Herdr session on it, a pane and the root its files are read at. */
export type DiffNotePlace = {
  session: object;
  /** Absent or null is the default Herdr session. */
  herd?: string | null;
  paneId: string;
  /** Absent is a root nobody named: notes written there are only met there. */
  root?: string;
};

/** A place and the GitDiff.revision a note is pinned on. */
export type DiffNoteScope = DiffNotePlace & { revision: string };

export type DiffNote = DiffNoteTarget & DiffNoteScope & {
  id: string;
  body: string;
  /**
   * The lines before and after the one the note was written on, as they read
   * then. A line that reads the same in several places (a closing brace) is
   * told apart by them when the note is pinned again.
   */
  around?: readonly [string, string];
  /**
   * The file changed after the note was written and the line it was written on
   * could not be found again for certain: the note stands at the nearest
   * place, and its `snippet` is still the line as it was (`carryDiffNotes`).
   */
  drifted?: boolean;
};

/** One comment stays well under the 32 KiB prompt budget even in UTF-8. */
export const DIFF_NOTE_BODY_LIMIT = 2000;
export const DIFF_NOTE_SNIPPET_LIMIT = 120;

let bySession = new WeakMap<object, DiffNote[]>();
/** The root each pane's files were last read at, by connection. */
let roots = new WeakMap<object, Map<string, string>>();
let noteSerial = 0;
let scope: DiffNoteScope | null = null;
/** The lines of the diff on screen: where a note written now takes its surroundings from. */
let openLines: { scope: DiffNoteScope; path: string; layer: GitLayer; targets: DiffNoteTarget[] } | null = null;
const sendingIds = new Set<string>();

const notesOf = (session: object): DiffNote[] => bySession.get(session) ?? [];

function keep(session: object, list: DiffNote[]): void {
  if (list.length) bySession.set(session, list);
  else bySession.delete(session);
}

function herdOf(session: object): string | null {
  const read = (session as { herdSession?: unknown }).herdSession;
  const name = typeof read === "function" ? read.call(session) : null;
  return typeof name === "string" ? name : null;
}

const paneKey = (herd: string | null | undefined, paneId: string) => `${herd ?? ""}\0${paneId}`;

export function sameDiffNotePlace(left: DiffNotePlace, right: DiffNotePlace): boolean {
  return left.session === right.session && (left.herd ?? null) === (right.herd ?? null)
    && left.paneId === right.paneId && (left.root ?? "") === (right.root ?? "");
}

export function sameDiffNoteScope(left: DiffNoteScope | null, right: DiffNoteScope | null): boolean {
  return Boolean(left && right && sameDiffNotePlace(left, right) && left.revision === right.revision);
}

/** A place as a key, for what is kept beside the notes by place (a note being written). */
export function diffNotePlaceKey(place: DiffNotePlace): string {
  return `${paneKey(place.herd, place.paneId)}\0${place.root ?? ""}`;
}

/** The pane's files are read at this root from now on: its notes are the ones written there. */
export function placeDiffNotes(place: DiffNotePlace): void {
  let panes = roots.get(place.session);
  if (!panes) roots.set(place.session, panes = new Map());
  panes.set(paneKey(place.herd, place.paneId), place.root ?? "");
}

/**
 * Where a pane's notes are right now: the Herdr session its connection is on
 * and the root its files were last read at. Null without a session or a pane.
 */
export function diffNotePlace(session: object | null, paneId: string): DiffNotePlace | null {
  if (!session || !paneId) return null;
  const herd = herdOf(session);
  return { session, herd, paneId, root: roots.get(session)?.get(paneKey(herd, paneId)) ?? "" };
}

export function adoptDiffNoteScope(next: DiffNoteScope | null): void {
  scope = next && next.paneId && next.revision ? next : null;
  if (scope) placeDiffNotes(scope);
  if (openLines && !sameDiffNoteScope(openLines.scope, scope)) openLines = null;
}

export function diffNoteScope(): DiffNoteScope | null {
  return scope;
}

function sameScope(note: DiffNote, owner: DiffNoteScope): boolean {
  return sameDiffNotePlace(note, owner) && note.revision === owner.revision;
}

function visibleNotes(): DiffNote[] {
  return scope ? notesOf(scope.session).filter((note) => sameScope(note, scope!)) : [];
}

export function diffNotes(): readonly DiffNote[] {
  return visibleNotes();
}

/** Every pending note of one place, whatever revision of its file it was written on. */
export function diffNotesAt(place: DiffNotePlace | null): DiffNote[] {
  return place ? notesOf(place.session).filter((note) => sameDiffNotePlace(note, place)) : [];
}

export function diffNotesFor(path: string, layer: GitLayer): DiffNote[] {
  return visibleNotes().filter((note) => note.path === path && note.layer === layer);
}

function samePin(note: DiffNotePin, target: DiffNotePin): boolean {
  return note.path === target.path && note.layer === target.layer && note.side === target.side && note.line === target.line;
}

/**
 * Pending notes per `${layer}:${path}` where the pane is now (`diffNotePlace`),
 * across diff revisions, so lists can show where unsent comments are waiting.
 */
export function diffNoteCounts(session: object | null, paneId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of diffNotesAt(diffNotePlace(session, paneId))) {
    const key = `${note.layer}:${note.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function diffNoteForPin(target: DiffNotePin): DiffNote | undefined {
  return visibleNotes().find((note) => samePin(note, target));
}

export function diffNoteSending(id: string): boolean {
  return sendingIds.has(id);
}

export function diffNoteSendOpen(): boolean {
  return sendingIds.size > 0;
}

/** The lines before and after a pin in the diff on screen, when it is that diff's. */
function surroundings(target: DiffNotePin): readonly [string, string] | undefined {
  if (!openLines || !scope || !sameDiffNoteScope(openLines.scope, scope) || openLines.path !== target.path || openLines.layer !== target.layer) return undefined;
  return around(openLines.targets, openLines.targets.findIndex((line) => samePin(line, target)));
}

function around(targets: readonly DiffNoteTarget[], index: number): readonly [string, string] | undefined {
  return index < 0 ? undefined : [targets[index - 1]?.snippet ?? "", targets[index + 1]?.snippet ?? ""];
}

/** Add or replace the note at the pin. Refuses without a bound owner or during send. */
export function upsertDiffNote(target: DiffNoteTarget, body: string, expectedScope?: DiffNoteScope | null): DiffNote | null {
  if (!scope) return null;
  if (expectedScope && !sameDiffNoteScope(expectedScope, scope)) return null;
  const trimmed = body.trim().slice(0, DIFF_NOTE_BODY_LIMIT);
  if (!trimmed) return null;
  const existing = diffNoteForPin(target);
  const near = surroundings(target);
  if (existing) {
    if (sendingIds.has(existing.id)) return existing;
    existing.body = trimmed;
    existing.snippet = target.snippet;
    if (near) existing.around = near;
    // Saved again on the line as it is now.
    delete existing.drifted;
    return existing;
  }
  const note: DiffNote = {
    ...target, session: scope.session, herd: scope.herd ?? null, paneId: scope.paneId, root: scope.root ?? "", revision: scope.revision,
    body: trimmed, id: `diff-note-${++noteSerial}`, ...(near ? { around: near } : {}),
  };
  keep(scope.session, [...notesOf(scope.session), note]);
  return note;
}

export function removeDiffNote(id: string): void {
  if (sendingIds.has(id) || !scope) return;
  keep(scope.session, notesOf(scope.session).filter((note) => note.id !== id));
}

/** Drop only the captured notes. In-flight additions are other notes and survive. */
export function removeDiffNotes(list: readonly DiffNote[]): void {
  const drop = new Set(list.map((note) => note.id));
  for (const session of new Set(list.map((note) => note.session))) {
    keep(session, notesOf(session).filter((note) => !drop.has(note.id)));
  }
}

export function beginDiffNoteSend(ids: readonly string[]): void {
  sendingIds.clear();
  for (const id of ids) sendingIds.add(id);
}

export function endDiffNoteSend(): void {
  sendingIds.clear();
}

export function clearDiffNotes(path: string, layer: GitLayer): void {
  if (!scope) return;
  keep(scope.session, notesOf(scope.session).filter((note) => !sameScope(note, scope!) || note.path !== path || note.layer !== layer));
}

/** A pane that is gone takes its notes with it, wherever its files were read. */
export function forgetPaneDiffNotes(session: object, herd: string | null, paneId: string): void {
  keep(session, notesOf(session).filter((note) => (note.herd ?? null) !== herd || note.paneId !== paneId));
  roots.get(session)?.delete(paneKey(herd, paneId));
}

/** The panes of one connection and Herdr session that still hold notes. */
export function diffNotePanes(session: object | null, herd: string | null): string[] {
  if (!session) return [];
  return [...new Set(notesOf(session).filter((note) => (note.herd ?? null) === herd).map((note) => note.paneId))];
}

/** Start over: a test, or a QA scene that builds its own session. */
export function clearAllDiffNotes(): void {
  clearSentDiffNotes();
  bySession = new WeakMap();
  roots = new WeakMap();
  sendingIds.clear();
  scope = null;
  openLines = null;
}

function diffSnippet(text: string): string {
  const compact = text.trim();
  if (compact.length <= DIFF_NOTE_SNIPPET_LIMIT) return compact;
  return `${compact.slice(0, DIFF_NOTE_SNIPPET_LIMIT)}…`;
}

/**
 * Only add / delete / context lines are noteable. Hunk and meta lines carry
 * no file content, and a null line number cannot be pinned.
 */
export function diffNoteTarget(path: string, layer: GitLayer, line: DiffLine): DiffNoteTarget | null {
  if (line.kind === "delete") {
    return line.oldLine === null ? null : { path, layer, side: "old", line: line.oldLine, snippet: diffSnippet(line.text) };
  }
  if (line.kind === "add" || line.kind === "context") {
    return line.newLine === null ? null : { path, layer, side: "new", line: line.newLine, snippet: diffSnippet(line.text) };
  }
  return null;
}

export type DiffNoteCarry = {
  /** Notes found again on a line with the same text, at the same number or another. */
  followed: number;
  /** Of those, the ones whose line number changed. */
  moved: number;
  /** Notes whose line is gone, reads differently now or cannot be told from another, left at the nearest place. */
  drifted: number;
  /** Notes left without any line: the new patch has none to pin on. They keep their old place and wait to be sent or discarded. */
  orphaned: number;
  /** Where each carried note stood before, as `diffNoteCarryKey`, and where it stands now. */
  pins: Map<string, DiffNoteTarget>;
};

type Repinned = { target: DiffNoteTarget; found: boolean; around?: readonly [string, string] };

const pinKey = (target: Pick<DiffNotePin, "side" | "line">) => `${target.side}:${target.line}`;

/** A note's pin on the revision it was carried from: the key of `DiffNoteCarry.pins`. */
export function diffNoteCarryKey(revision: string, target: Pick<DiffNotePin, "side" | "line">): string {
  return `${revision}\n${pinKey(target)}`;
}

/**
 * Where something written on one patch stands on another: the line that still
 * reads as its own. One such line is the answer. Several (a closing brace, a
 * blank line) are told apart by the lines around them; when those do not
 * decide either, the nearest is taken and the answer is not certain. A line
 * that is gone or rewritten is answered by the same number, then the nearest.
 */
function repin(
  was: Pick<DiffNote, "side" | "line" | "snippet" | "around">, targets: readonly DiffNoteTarget[], taken: ReadonlySet<string>,
): Repinned | null {
  const free = targets.filter((target) => !taken.has(pinKey(target)));
  const nearest = (list: readonly DiffNoteTarget[]) => [...list].sort((a, b) => Math.abs(a.line - was.line) - Math.abs(b.line - was.line))[0];
  const sameSide = free.filter((target) => target.side === was.side);
  const alike = sameSide.filter((target) => target.snippet === was.snippet);
  const at = (target: DiffNoteTarget): Repinned => ({ target, found: true, around: around(targets, targets.indexOf(target)) });
  if (alike.length === 1) return at(alike[0]);
  if (alike.length > 1) {
    const score = (target: DiffNoteTarget) => {
      const near = around(targets, targets.indexOf(target));
      return !was.around || !near ? 0 : Number(near[0] === was.around[0]) + Number(near[1] === was.around[1]);
    };
    const best = Math.max(...alike.map(score));
    const top = alike.filter((target) => score(target) === best);
    if (best > 0 && top.length === 1) return at(top[0]);
    return { target: nearest(top), found: false };
  }
  const place = sameSide.find((target) => target.line === was.line) ?? nearest(sameSide) ?? nearest(free);
  return place ? { target: place, found: false } : null;
}

/**
 * A newer patch of a file was read while notes on an older one were still
 * waiting to be sent. They are the reader's words and are not dropped with the
 * revision: each is pinned again on the new patch, on the line that still
 * reads as the one it was written on (`repin`), and takes the new revision so
 * it shows and can be sent. A note whose line is gone, was rewritten or cannot
 * be told from another stays at the nearest free line on its side and is
 * marked `drifted`, keeping the line as it was for the reader to judge by.
 *
 * A patch with no line to pin on (the change was committed, reverted or
 * staged, or the patch is cut short) orphans them: they keep the place they
 * had, marked `drifted`, and take the revision all the same, so they are still
 * counted where they can be sent or discarded. Notes being sent are left alone.
 */
export function carryDiffNotes(owner: DiffNoteScope, path: string, layer: GitLayer, lines: readonly DiffLine[]): DiffNoteCarry {
  const result: DiffNoteCarry = { followed: 0, moved: 0, drifted: 0, orphaned: 0, pins: new Map() };
  const all = notesOf(owner.session);
  const here = (note: DiffNote) => sameDiffNotePlace(note, owner) && note.path === path && note.layer === layer;
  const stale = all.filter((note) => here(note) && note.revision !== owner.revision && !sendingIds.has(note.id)).sort(noteOrder);
  if (!stale.length) return result;
  const targets = lines.flatMap((line) => diffNoteTarget(path, layer, line) ?? []);
  const taken = new Set(all.filter((note) => here(note) && note.revision === owner.revision).map(pinKey));
  for (const note of stale) {
    const from = diffNoteCarryKey(note.revision, note);
    if (!targets.length) {
      // Two notes from different revisions on one line: the second waits where it was written.
      if (taken.has(pinKey(note))) continue;
      taken.add(pinKey(note));
      note.revision = owner.revision;
      note.drifted = true;
      result.orphaned += 1;
      result.pins.set(from, { path, layer, side: note.side, line: note.line, snippet: note.snippet });
      continue;
    }
    const place = repin(note, targets, taken);
    // Every line already has a note: this one waits on the revision it was written on.
    if (!place) continue;
    taken.add(pinKey(place.target));
    if (place.found && place.target.line !== note.line) result.moved += 1;
    note.revision = owner.revision;
    note.side = place.target.side;
    note.line = place.target.line;
    result.pins.set(from, place.target);
    if (place.found) {
      delete note.drifted;
      if (place.around) note.around = place.around;
      result.followed += 1;
    } else {
      note.drifted = true;
      result.drifted += 1;
    }
  }
  keep(owner.session, [...all]);
  return result;
}

/**
 * The diff on screen: its lines are where a note written on it takes its
 * surroundings from, and what says whether it has a line for a note to stand
 * under at all (`diffHoldsNotes`).
 */
export function openDiffNoteLines(owner: DiffNoteScope, path: string, layer: GitLayer, lines: readonly DiffLine[]): void {
  openLines = { scope: owner, path, layer, targets: lines.flatMap((line) => diffNoteTarget(path, layer, line) ?? []) };
}

/**
 * False when the diff on screen is known to have no line to show this file's
 * notes under. A diff whose lines were never said holds them as far as anyone
 * knows.
 */
export function diffHoldsNotes(path: string, layer: GitLayer): boolean {
  const known = openLines && scope && sameDiffNoteScope(openLines.scope, scope) && openLines.path === path && openLines.layer === layer;
  return !known || openLines!.targets.length > 0;
}

/**
 * Where a note still being written stands on a newer patch of its file: the
 * same matching as a saved note's, among the lines no saved note stands on.
 * Null when the patch has no line for it.
 */
export function carryDiffNoteTarget(
  owner: DiffNoteScope, target: DiffNoteTarget & { around?: readonly [string, string] }, lines: readonly DiffLine[],
): { target: DiffNoteTarget; found: boolean } | null {
  const targets = lines.flatMap((line) => diffNoteTarget(target.path, target.layer, line) ?? []);
  const taken = new Set(notesOf(owner.session)
    .filter((note) => sameScope(note, owner) && note.path === target.path && note.layer === target.layer).map(pinKey));
  const place = repin(target, targets, taken);
  return place ? { target: place.target, found: place.found } : null;
}

/** The lines around a pin in the diff on screen, for a note that is only being written yet. */
export function diffNoteSurroundings(target: DiffNotePin): readonly [string, string] | undefined {
  return surroundings(target);
}

export type ComposedDiffNotes = { text: string; truncated: boolean; count: number };

function noteOrder(left: DiffNote, right: DiffNote): number {
  if (left.line !== right.line) return left.line - right.line;
  if (left.side !== right.side) return left.side === "old" ? -1 : 1;
  return left.id < right.id ? -1 : 1;
}

/** The notes of one file and layer, as the part of a prompt that is about them. */
function notesSection(path: string, layer: GitLayer, list: readonly DiffNote[]): string {
  const ordered = [...list].sort(noteOrder);
  const layerLabel = layer === "staged" ? t("workspace.staged") : t("workspace.worktree");
  const parts: string[] = [t("diffNotes.promptHeader", { path, layer: layerLabel }), ""];
  for (const note of ordered) {
    const side = note.side === "old" ? t("diffNotes.sideOld") : t("diffNotes.sideNew");
    parts.push(t("diffNotes.promptLine", { line: note.line, side }));
    // The quoted line is the one the comment was written on; say so when the file has moved on since.
    if (note.drifted) parts.push(t("diffNotes.promptDrifted"));
    if (note.snippet) parts.push(`> ${note.snippet}`);
    parts.push(note.body, "");
  }
  return parts.join("\n").replace(/\n+$/u, "");
}

/**
 * Batch every note for one path/layer into a single prompt. Callers must
 * refuse when `truncated` is true instead of sending a clipped prompt.
 */
export function composeDiffNotesPrompt(
  path: string,
  layer: GitLayer,
  list: readonly DiffNote[] = diffNotesFor(path, layer),
): ComposedDiffNotes {
  const fitted = fitOperationPrompt(notesSection(path, layer, list));
  return { text: fitted.text, truncated: fitted.truncated, count: list.length };
}

/**
 * The notes of several files as one prompt: a section for each file and layer,
 * files by path, the staged layer before the working tree. The same refusal
 * applies when it does not fit.
 */
export function composeAllDiffNotesPrompt(list: readonly DiffNote[]): ComposedDiffNotes {
  const groups = new Map<string, DiffNote[]>();
  for (const note of list) {
    const key = `${note.path}\n${note.layer}`;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const sections = [...groups.values()]
    .sort((left, right) => left[0].path.localeCompare(right[0].path) || (left[0].layer === right[0].layer ? 0 : left[0].layer === "staged" ? -1 : 1))
    .map((group) => notesSection(group[0].path, group[0].layer, group));
  const fitted = fitOperationPrompt(sections.join("\n\n"));
  return { text: fitted.text, truncated: fitted.truncated, count: list.length };
}
