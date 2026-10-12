import { changedRanges, type WordRange } from "../../lib/diff-words";
import { HUNK_HEADER, type DiffLine } from "../../lib/workspace";

/**
 * A patch as the review reads it: hunks with a place in the file, the
 * unchanged stretch that separates each from the one before, the replaced
 * lines paired with what replaced them, and rows for the two sides shown next
 * to each other. Pure projections over the parsed patch lines; the same
 * `DiffLine` objects come back, so a line is the same line in every view.
 */

export type DiffHunk = {
  index: number;
  /** The lines of the file the hunk covers: on the new side, or the old one when it only removes. */
  from: number;
  to: number;
  side: "new" | "old";
  /** What Git names after the range (the enclosing function, by its own rules); "" when it names nothing. */
  context: string;
  /** Unchanged lines between the previous hunk (or the file's first line) and this one. */
  gap: number;
  /** The new-side line that stretch starts at: where the file opens to show it. */
  gapLine: number;
  /** The hunk's own lines, without its header. */
  lines: DiffLine[];
  /** How many content lines stand before this hunk in the patch. */
  offset: number;
};

type Range = { oldStart: number; oldCount: number; newStart: number; newCount: number };

/** The first new-side line of the hunk; a hunk that adds nothing sits after the line it names. */
const newFirst = (range: Range): number => range.newCount > 0 ? range.newStart : range.newStart + 1;
/** The first new-side line after the hunk. */
const newAfter = (range: Range): number => range.newCount > 0 ? range.newStart + range.newCount : range.newStart + 1;

/**
 * The patch's hunks in order. Lines before the first header (none, once the
 * file header is dropped) are left out, and so is a hunk of nothing: the
 * header an empty new file is given, which has no line to show.
 */
export function diffHunks(lines: readonly DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let previous: Range | null = null;
  let open: DiffHunk | null = null;
  let offset = 0;
  for (const line of lines) {
    if (line.kind === "hunk") {
      // `parseDiffLines` names a line a hunk only when this reads it.
      const match = HUNK_HEADER.exec(line.text);
      open = null;
      if (!match) continue;
      const range: Range = { oldStart: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]), newStart: Number(match[3]), newCount: match[4] === undefined ? 1 : Number(match[4]) };
      if (range.oldCount === 0 && range.newCount === 0) continue;
      const removalOnly = range.newCount === 0;
      const gapLine: number = previous ? newAfter(previous) : 1;
      open = {
        index: hunks.length,
        side: removalOnly ? "old" : "new",
        from: removalOnly ? range.oldStart : range.newStart,
        to: removalOnly ? range.oldStart + range.oldCount - 1 : range.newStart + range.newCount - 1,
        context: (match[5] ?? "").trim(),
        gap: Math.max(0, newFirst(range) - gapLine),
        gapLine,
        lines: [],
        offset,
      };
      hunks.push(open);
      previous = range;
      continue;
    }
    if (!open) continue;
    open.lines.push(line);
    offset++;
  }
  return hunks;
}

/** Runs of removed lines directly followed by added lines: each removed line with the added line in its place. */
function replacements(lines: readonly DiffLine[]): Array<[DiffLine, DiffLine]> {
  const pairs: Array<[DiffLine, DiffLine]> = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].kind !== "delete") {
      index++;
      continue;
    }
    let added = index;
    while (added < lines.length && lines[added].kind === "delete") added++;
    let end = added;
    while (end < lines.length && lines[end].kind === "add") end++;
    for (let pair = 0; pair < Math.min(added - index, end - added); pair++) pairs.push([lines[index + pair], lines[added + pair]]);
    index = end;
  }
  return pairs;
}

/** For each replaced or replacing line, the stretch of it that changed (`diff-words`). */
export function changedWords(lines: readonly DiffLine[]): Map<DiffLine, WordRange> {
  const ranges = new Map<DiffLine, WordRange>();
  for (const [before, after] of replacements(lines)) {
    const changed = changedRanges(before.text, after.text);
    if (!changed) continue;
    if (changed.before.end > changed.before.start) ranges.set(before, changed.before);
    if (changed.after.end > changed.after.start) ranges.set(after, changed.after);
  }
  return ranges;
}

/** One row of the two-sided view: the old file's line and the new file's, either of which may be absent. */
export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/**
 * A hunk's lines as rows of two sides. An unchanged line stands on both; a run
 * of removals stands beside the additions that follow it, line for line, and
 * what is left over on either side stands alone.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === "delete") {
      let added = index;
      while (added < lines.length && lines[added].kind === "delete") added++;
      let end = added;
      while (end < lines.length && lines[end].kind === "add") end++;
      for (let row = 0; row < Math.max(added - index, end - added); row++) {
        rows.push({ left: index + row < added ? lines[index + row] : null, right: added + row < end ? lines[added + row] : null });
      }
      index = end;
      continue;
    }
    rows.push(line.kind === "add" ? { left: null, right: line } : { left: line, right: line });
    index++;
  }
  return rows;
}
