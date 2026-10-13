import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { DiffNote, DiffNoteTarget } from "../../lib/diff-notes";
import type { SentDiffNote } from "../../lib/diff-notes-sent";
import { useKeptList } from "../../shared/react/use-presence";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { Fold } from "../../shared/ui/primitives";
import type { OpenNote } from "./note-drafts";
import { InlineNoteEditor, type InlineNote } from "./note-inline";
import { ParkedNoteCard, type ParkedNote } from "./note-parked";
import { DiffNoteCards } from "./notes";
import { Still } from "./still";

/**
 * What stands under a diff line: the note's form while it is written, its
 * card once it is saved (or the record of one that was sent), and a
 * half-written note set aside.
 *
 * Each of them takes its room and gives it back by height (`Fold`), so the
 * lines below move over to make way instead of jumping: the form opens under
 * the line that was pressed, saving folds it shut while the card opens in its
 * place, and a deleted note's card fades and then lets the lines close up.
 *
 * Only what the reader did moves. A piece that joins a line already on screen
 * opens; one that was there when the line was drawn (a diff read again, a hunk
 * unfolded, the column coming back with a note in it) is simply there. A piece
 * that left is kept for its way out as it was last drawn, out of reach.
 *
 * The form opens from the start, never shut first: a shut fold is `inert`,
 * and the field has to take the keyboard in the press that opened it.
 */

type Piece = { key: string; node: ReactNode };
const pieceKey = (piece: Piece): string => piece.key;

/** A piece on its way out: found by this, to take the keyboard out of it. */
const LEAVING = ".diff-note-fold.is-shut";

export function NotesUnder({ target, saved, sent, note, inline, waiting, onEdit }: {
  target: DiffNoteTarget;
  /** The note saved on this line, and the record of one sent from it. Read by the line, so what is kept here stays as the line last drew it. */
  saved: DiffNote | undefined;
  sent: SentDiffNote | undefined;
  /** The note being written on this line, with what answers its form. */
  note: OpenNote | null;
  inline: InlineNote | undefined;
  /** The half-written note set aside on this line. */
  waiting: ParkedNote | null;
  onEdit: (target: DiffNoteTarget) => void;
}) {
  const writing = note !== null && inline !== undefined;
  // Each time the form opens it is another form: one reopened while the last is still folding shut takes the keyboard as any does.
  const opened = useRef({ writing: false, turn: 0 });
  if (opened.current.writing !== writing) {
    opened.current.writing = writing;
    if (writing) opened.current.turn += 1;
  }
  // The card is its note's, sent or not: the next note written on this line has a card of its own.
  const kept = saved ?? sent;
  const pieces: Piece[] = [];
  if (note && inline) {
    pieces.push({ key: `form:${opened.current.turn}`, node: <InlineNoteEditor note={note} onClose={inline.close} onSetAside={inline.setAside} /> });
  } else if (kept) {
    pieces.push({ key: `card:${kept.id}`, node: <DiffNoteCards target={target} note={saved} sent={saved ? undefined : sent} onEdit={onEdit} /> });
  }
  if (waiting) pieces.push({ key: "draft", node: <ParkedNoteCard parked={waiting} onResume={onEdit} /> });
  const shown = useKeptList(pieces, pieceKey, MOTION_MS.panel);

  // A piece that leaves with the keyboard in it gives the keyboard up at once, as it did when it
  // left the page in one frame: the line takes it back from there (`useLineNote`, `note-line-focus`).
  const leaving = shown.filter((piece) => piece.leaving).map((piece) => piece.key).join(" ");
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (leaving && active instanceof HTMLElement && active.closest(LEAVING)) active.blur();
  }, [leaving]);

  return shown.map(({ item, key, leaving: out, entering }) => <Fold key={key} className="diff-note-fold" open={!out} appear={entering}>
    <Still still={out}>{item.node}</Still>
  </Fold>);
}
