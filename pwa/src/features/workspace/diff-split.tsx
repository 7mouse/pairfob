import type { WordRange } from "../../lib/diff-words";
import type { DiffLine } from "../../lib/workspace";
import type { SplitRow } from "./diff-hunks";
import { LINE_SIGN, LineHint, LineNumber, LineText, lineClass, useLineNote, type HeldLine, type LineNotes } from "./diff-line";

/**
 * The two sides of a change next to each other: the file as it was on the
 * left, as it is on the right. An unchanged line stands on both and is one
 * line: its note is pinned on the right, where the file's own numbers are. A
 * note's form and cards run under the whole row.
 */

function SplitCell({ line, held, side, words }: { line: DiffLine | null; held: HeldLine; side: "old" | "new"; words?: WordRange }) {
  if (!line) return <div className="workspace-diff-line diff-split-cell is-blank" />;
  return <div className={`${lineClass(line, held)} diff-split-cell`} title={held.label} onClick={held.press}>
    <LineNumber line={line} held={held} side={side} />
    <span className="diff-line-sign" aria-hidden="true">{LINE_SIGN[line.kind] ?? ""}</span>
    <LineText line={line} words={words} />
    {held.target && <LineHint />}
  </div>;
}

export function SplitLineRow({ row, words, notes }: { row: SplitRow; words: ReadonlyMap<DiffLine, WordRange>; notes: LineNotes }) {
  const same = row.left !== null && row.left === row.right;
  // The unchanged line is the right side's; pressing its left half opens the same note.
  const right = useLineNote(row.right, notes);
  const left = useLineNote(same ? null : row.left, notes);
  const leftHeld: HeldLine = same ? { ...right, target: null, under: null } : left;
  return <>
    <div className="diff-split-row">
      {same && row.left
        ? <div className={`${lineClass(row.left, right)} diff-split-cell`} onClick={right.press}>
          <LineNumber line={row.left} held={leftHeld} side="old" />
          <span className="diff-line-sign" aria-hidden="true" />
          <LineText line={row.left} />
        </div>
        : <SplitCell line={row.left} held={left} side="old" words={row.left ? words.get(row.left) : undefined} />}
      <SplitCell line={row.right} held={right} side="new" words={row.right && !same ? words.get(row.right) : undefined} />
    </div>
    {left.under}
    {right.under}
  </>;
}
