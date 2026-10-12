/**
 * Which part of a changed line actually changed.
 *
 * A removed line and the added line that replaces it usually share most of
 * their text. Marking the stretch between their common beginning and common
 * end shows the edit itself instead of two whole lines. It is one stretch per
 * line, found by trimming whole words from both ends: cheap, never wrong about
 * what is marked as unchanged, and enough for the common one-edit line. Lines
 * that share nothing, or differ only in how much they share, are left unmarked.
 */

/** The changed stretch of a line, as character offsets into its text. */
export type WordRange = { start: number; end: number };

const CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}";
/** What follows a character and is drawn as part of it: combining marks, variation selectors, skin tones. */
const JOINED = "\\p{M}\\uFE00-\\uFE0F\\u{1F3FB}-\\u{1F3FF}";
const PIECES = new RegExp([
  "\\s+",
  // Scripts written without spaces: one character is what an edit moves.
  `[${CJK}][${JOINED}]*`,
  `[\\p{L}\\p{N}_](?:(?![${CJK}])[\\p{L}\\p{N}\\p{M}_])*`,
  // A pictograph with what is joined to it, so a family or a flag is never marked by halves.
  `\\p{Extended_Pictographic}[${JOINED}]*(?:\\u200D\\p{Extended_Pictographic}[${JOINED}]*)*`,
  `\\S[${JOINED}\\u200D]*`,
].join("|"), "gu");

/**
 * Words, runs of white space and single punctuation marks: what an edit moves
 * as a unit. A piece never ends inside what is drawn as one glyph (a letter
 * and its accent, a joined pictograph), so a mark never splits one.
 */
function words(text: string): string[] {
  return text.match(PIECES) ?? [];
}

/** At least this much of the shorter line has to be shared for the pair to read as one edit. */
const MIN_SHARED = 0.3;

/**
 * The changed stretch of `before` and of `after`, or null when marking it
 * would say nothing: the lines are equal, or too different to be one edit.
 */
export function changedRanges(before: string, after: string): { before: WordRange; after: WordRange } | null {
  if (before === after) return null;
  const left = words(before);
  const right = words(after);
  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head++;
  let tail = 0;
  while (tail < left.length - head && tail < right.length - head && left[left.length - 1 - tail] === right[right.length - 1 - tail]) tail++;
  const length = (list: string[], from: number, to: number) => list.slice(from, to).reduce((sum, word) => sum + word.length, 0);
  const shared = length(left, 0, head) + length(left, left.length - tail, left.length);
  // Leading white space alone is not something the two lines have in common.
  const sharedInk = (left.slice(0, head).join("") + left.slice(left.length - tail).join("")).replace(/\s+/g, "").length;
  if (!sharedInk || shared < Math.min(before.length, after.length) * MIN_SHARED) return null;
  const startBefore = length(left, 0, head);
  const startAfter = length(right, 0, head);
  return {
    before: { start: startBefore, end: before.length - length(left, left.length - tail, left.length) },
    after: { start: startAfter, end: after.length - length(right, right.length - tail, right.length) },
  };
}
