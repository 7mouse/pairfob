import type { GitLayer } from "./workspace";

/** Where a note is pinned (`DiffNotePin`), said here so the notes' own module can end this record with them. */
type Pin = { path: string; layer: GitLayer; side: "old" | "new"; line: number };
/** Whose notes (`DiffNotePlace`): a connection, a Herdr session on it, a pane and the root its files are read at. */
type Place = { session: object; herd?: string | null; paneId: string; root?: string };
/** A pending note as it was when sent (`DiffNote`). */
type Sendable = Pin & Place & { id: string; snippet: string; body: string };

/**
 * The notes that were sent to the agent, kept after they left the list of
 * pending ones: where each was pinned, what it said, and how far the agent is
 * with them. A note sent is no longer the reader's to edit; it stays as a
 * record under its line and in the receipt of its file until the reader
 * dismisses it, sends that file's notes again, the pane closes or the
 * connection ends (records are held by their session object and go with it).
 *
 * They belong to a place, not to one revision of a file: the answer to a note
 * is usually a change to the file it was written on.
 */
export type SentNoteState = "sent" | "working" | "answered";

export type SentDiffNote = Pin & {
  id: string;
  session: object;
  herd: string | null;
  paneId: string;
  root: string;
  /** The line the note was written on, as it was. */
  snippet: string;
  body: string;
  sentAt: number;
  state: SentNoteState;
  /** When the agent was first seen done with it; it may be seen at work again shortly after. */
  answeredAt?: number;
};

/** More than a review holds; the oldest go first. */
export const SENT_NOTE_LIMIT = 200;

/**
 * A send shows its agent as working at once, before the computer says so. The
 * next word from the computer may still be from before the prompt arrived and
 * say idle: for this long after a send, idle is not yet an answer.
 */
export const SENT_SETTLE_MS = 4000;

/** An agent seen at work again this soon after it looked done was not done. */
export const SENT_ANSWER_GRACE_MS = 15_000;

let bySession = new WeakMap<object, SentDiffNote[]>();

const sentOf = (session: object): SentDiffNote[] => bySession.get(session) ?? [];

function keep(session: object, list: SentDiffNote[]): void {
  if (list.length) bySession.set(session, list);
  else bySession.delete(session);
}

const samePin = (left: Pin, right: Pin): boolean =>
  left.path === right.path && left.layer === right.layer && left.side === right.side && left.line === right.line;

const samePlace = (left: Place, right: Place): boolean =>
  left.session === right.session && (left.herd ?? null) === (right.herd ?? null)
  && left.paneId === right.paneId && (left.root ?? "") === (right.root ?? "");

/**
 * The notes just sent. They are the record of their files now: what was sent
 * for the same file and layer before is replaced, so a receipt counts one send.
 */
export function recordSentDiffNotes(list: readonly Sendable[], now = Date.now()): void {
  for (const session of new Set(list.map((note) => note.session))) {
    const fresh: SentDiffNote[] = list.filter((note) => note.session === session).map((note) => ({
      id: note.id, session, herd: note.herd ?? null, paneId: note.paneId, root: note.root ?? "",
      path: note.path, layer: note.layer, side: note.side, line: note.line,
      snippet: note.snippet, body: note.body, sentAt: now, state: "sent",
    }));
    const kept = sentOf(session).filter((old) => !fresh.some((note) => samePlace(note, old) && note.path === old.path && note.layer === old.layer));
    keep(session, [...kept, ...fresh].slice(-SENT_NOTE_LIMIT));
  }
}

export function sentDiffNotesFor(place: Place | null, path: string, layer: GitLayer): SentDiffNote[] {
  if (!place) return [];
  return sentOf(place.session).filter((note) => samePlace(note, place) && note.path === path && note.layer === layer);
}

/**
 * The sent note on this line, if the line is still the one it was written on.
 * A line that changed since is the agent's answer, or someone's: the note is
 * not shown on words it was not written about.
 */
export function sentDiffNoteAt(place: Place | null, pin: Pin & { snippet: string }): SentDiffNote | undefined {
  if (!place) return undefined;
  return sentOf(place.session).find((note) => samePlace(note, place) && samePin(note, pin) && note.snippet === pin.snippet);
}

/** How far the notes of one file are, as one answer: the least advanced of them. */
export function sentNoteState(notes: readonly SentDiffNote[]): SentNoteState | null {
  if (!notes.length) return null;
  if (notes.some((note) => note.state === "sent")) return "sent";
  return notes.some((note) => note.state === "working") ? "working" : "answered";
}

/**
 * What a pane's agent is doing now, for the notes it was sent wherever the
 * pane's files were read. A note is answered once the agent has been seen at
 * work after it was sent and is at work no longer. Two things keep that from
 * being said too soon: idle heard right after the send is from before it
 * (`SENT_SETTLE_MS`), and an agent seen working again shortly after it looked
 * done is still on the same turn (`SENT_ANSWER_GRACE_MS`). After that an
 * answer stays one: later turns are about something else.
 *
 * `moved` is whether a note's state changed; `held` whether an idle was set
 * aside as too early, so the caller looks again once the send has settled.
 */
export function noteSentAgentState(
  session: object | null, herd: string | null, paneId: string, working: boolean, now = Date.now(),
): { moved: boolean; held: boolean } {
  const result = { moved: false, held: false };
  if (!session) return result;
  const next = sentOf(session).map((note) => {
    if ((note.herd ?? null) !== herd || note.paneId !== paneId) return note;
    if (note.state === "answered") {
      if (!working || note.answeredAt === undefined || now - note.answeredAt > SENT_ANSWER_GRACE_MS) return note;
      result.moved = true;
      return { ...note, state: "working" as const, answeredAt: undefined };
    }
    if (working) {
      if (note.state === "working") return note;
      result.moved = true;
      return { ...note, state: "working" as const };
    }
    if (note.state !== "working") return note;
    if (now - note.sentAt < SENT_SETTLE_MS) {
      result.held = true;
      return note;
    }
    result.moved = true;
    return { ...note, state: "answered" as const, answeredAt: now };
  });
  if (result.moved) keep(session, next);
  return result;
}

/** The reader put the record away: one file's, or everything sent from one place. */
export function forgetSentDiffNotes(place: Place | null, path?: string, layer?: GitLayer): void {
  if (!place) return;
  keep(place.session, sentOf(place.session).filter((note) => !samePlace(note, place)
    || (path !== undefined && (note.path !== path || note.layer !== layer))));
}

/** A pane that is gone takes the record of what it was sent with it. */
export function forgetPaneSentDiffNotes(session: object, herd: string | null, paneId: string): void {
  keep(session, sentOf(session).filter((note) => note.herd !== herd || note.paneId !== paneId));
}

/** The panes of one connection and Herdr session that hold a record of what they were sent. */
export function sentDiffNotePanes(session: object | null, herd: string | null): string[] {
  if (!session) return [];
  return [...new Set(sentOf(session).filter((note) => note.herd === herd).map((note) => note.paneId))];
}

/**
 * Whether anything sent on this connection and Herdr session can still change
 * state: it waits on its agent, or was answered so recently that the agent may
 * be seen at work again. What a watcher goes on watching.
 */
export function sentDiffNotesWaiting(session: object | null, herd: string | null, now = Date.now()): boolean {
  return Boolean(session) && sentOf(session!).some((note) => note.herd === herd
    && (note.state !== "answered" || (note.answeredAt !== undefined && now - note.answeredAt <= SENT_ANSWER_GRACE_MS)));
}

/** Start over: a test, or a QA scene that builds its own session. */
export function clearSentDiffNotes(): void {
  bySession = new WeakMap();
}
