import { useLayoutEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { PenLine } from "lucide-react";
import { diffNoteForPin, diffNoteScope, diffNoteTarget, type DiffNoteTarget } from "../../lib/diff-notes";
import { sentDiffNoteAt } from "../../lib/diff-notes-sent";
import type { WordRange } from "../../lib/diff-words";
import { t } from "../../lib/i18n";
import type { DiffLine, GitLayer } from "../../lib/workspace";
import { deskPresentation } from "../../shared/ui/overlay/popover";
import { Button } from "../../shared/ui/primitives";
import type { InlineNote } from "./note-inline";
import type { ParkedNote } from "./note-parked";
import { NotesUnder } from "./note-under";
import { diffNoteLineLabel, diffNotePinKey, openNoteEditorAllowed } from "./notes";

/**
 * One line of a patch, and the note it can take. The same line is drawn alone
 * across the diff, or as one side of a row of two (`diff-split`); either way
 * its number is the keyboard's way to it, a press anywhere on it opens the
 * note's form, and what the note leaves (the form, its card, a draft set
 * aside) stands under it (`note-under`).
 */

/** What every line of one diff is given: whether it takes notes, and the note being written. */
export type LineNotes = {
  noteable: boolean;
  path: string;
  layer: GitLayer;
  onEdit: (target: DiffNoteTarget) => void;
  inline?: InlineNote;
  parked?: ParkedNote | null;
};

export type HeldLine = {
  target: DiffNoteTarget | null;
  noted: boolean;
  label: string | undefined;
  numberRef: RefObject<HTMLButtonElement | null>;
  open(): void;
  /** A press on the line opens its note, unless it ended a selection of the line's text. */
  press(event: MouseEvent<HTMLElement>): void;
  /** The form, the saved note's card, or the draft set aside; null where the line has none. */
  under: ReactNode;
};

/** The note of `line` in this diff; a null line (the empty side of a row of two) takes none. */
export function useLineNote(line: DiffLine | null, notes: LineNotes): HeldLine {
  const { path, layer, onEdit, inline, parked } = notes;
  const target = line && notes.noteable ? diffNoteTarget(path, layer, line) : null;
  const saved = target ? diffNoteForPin(target) : undefined;
  const sent = target && !saved ? sentDiffNoteAt(diffNoteScope(), target) : undefined;
  const noted = saved !== undefined;
  const label = target ? t(noted ? "diffNotes.editTitle" : "diffNotes.addTitle", { line: target.line }) : undefined;
  const note = target && inline?.note && diffNotePinKey(inline.note.target) === diffNotePinKey(target) ? inline.note : null;
  const editing = note !== null;
  const numberRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // The editor took the keyboard from this line and hands it back here when it
  // closes, so focus never drops out of the column. If the reader has already
  // moved on to another control, it stays with them: one still in the form as
  // it folds shut, out of reach, is not that. On the workspace screen
  // that is for a mouse or the keyboard beside the list: a finger, and a phone,
  // are left where focus fell, as after any other answer (`note-line-focus`).
  useLayoutEffect(() => {
    const closed = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (!closed) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !active.closest("[inert]")) return;
    const number = numberRef.current;
    if (!number || (!number.closest(".workspace-inspector") && !deskPresentation())) return;
    number.focus({ preventScroll: true });
  }, [editing]);
  const open = () => {
    if (!target || !openNoteEditorAllowed(target)) return;
    onEdit(target);
  };
  const waiting = target && parked && diffNotePinKey(parked.note.target) === diffNotePinKey(target) ? parked : null;
  return {
    target,
    noted,
    label,
    numberRef,
    open,
    press(event) {
      if (!target) return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
      open();
    },
    under: !target ? null : <NotesUnder target={target} saved={saved} sent={sent} note={note} inline={inline} waiting={waiting} onEdit={onEdit} />,
  };
}

const SIGN: Partial<Record<DiffLine["kind"], string>> = { add: "+", delete: "−" };

/**
 * The gutter. Across the whole diff it is one number: the new line, or the old
 * one for a removal; where there is room for two columns the style sheet draws
 * the old number of an unchanged line beside the new one (`data-old`), so the
 * element's own text is always the one number a note is pinned by. In a row of
 * two each side shows its own.
 */
export function LineNumber({ line, held, side }: { line: DiffLine; held: HeldLine; side?: "old" | "new" }) {
  const number = side === "old" ? line.oldLine : side === "new" ? line.newLine : line.newLine ?? line.oldLine;
  const text = number === null ? "" : String(number);
  const old = !side && line.kind === "context" && line.oldLine !== null ? String(line.oldLine) : undefined;
  const target = held.target;
  // Which line of which file this is, however it is drawn: what keeps the reader's place when the drawing changes.
  const at = line.kind === "delete" ? `old:${line.oldLine ?? ""}` : `new:${line.newLine ?? ""}`;
  if (!target) return <span className="diff-line-number" data-old={old} data-at={at}>{text}</span>;
  // Named for its pin, so what closes under the line finds the line again (`note-line-focus`).
  return <Button ref={held.numberRef} className="diff-comment-btn diff-line-number" aria-label={held.label} title={diffNoteLineLabel(target)}
    data-note-line={diffNotePinKey(target)} data-old={old} data-at={at} onClick={(event) => {
      event.stopPropagation();
      held.open();
    }}>{text}</Button>;
}

/**
 * The line's text, with the stretch that changed against its counterpart marked
 * (`diff-hunks`). A last line without a line break says so: that alone can be
 * the whole change.
 */
export function LineText({ line, words }: { line: DiffLine; words?: WordRange }) {
  const text = line.text;
  const noEol = line.noEol ? <span className="diff-noeol">{t("workspace.diffNoEol")}</span> : null;
  if (!words || words.end <= words.start) return <code className="diff-line-text">{text || " "}{noEol}</code>;
  return <code className="diff-line-text">
    {text.slice(0, words.start)}<mark className="diff-word">{text.slice(words.start, words.end)}</mark>{text.slice(words.end)}{noEol}
  </code>;
}

/** What says the line takes a note: the pencil a saved note's card carries. The whole line is the control. */
export function LineHint() {
  return <span className="diff-line-hint" aria-hidden="true"><PenLine size={12} /></span>;
}

export const lineClass = (line: DiffLine, held: HeldLine): string =>
  `workspace-diff-line diff-${line.kind}${held.target ? " diff-noteable" : ""}${held.noted ? " has-note" : ""}`;

/** A line across the whole diff: number, sign, text. */
export function DiffLineRow({ line, words, notes }: { line: DiffLine; words?: WordRange; notes: LineNotes }) {
  const held = useLineNote(line, notes);
  return <>
    <div className={lineClass(line, held)} title={held.label} onClick={held.press}>
      <LineNumber line={line} held={held} />
      <span className="diff-line-sign" aria-hidden="true">{SIGN[line.kind] ?? ""}</span>
      <LineText line={line} words={words} />
      {held.target && <LineHint />}
    </div>
    {held.under}
  </>;
}

export { SIGN as LINE_SIGN };
