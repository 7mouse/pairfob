/**
 * A numbered choice an agent shows in its terminal while it waits on the reader
 * (Claude Code and Codex approvals, AskUserQuestion lists, Grok questions).
 * Pure: parses the visible pane text the daemon also hashes for its guarded send.
 *
 * Only a list that is the live prompt counts: it sits at the bottom of the
 * screen (below it only blank lines, rules or key hints) and either one option
 * carries the selection marker, or every option wears Grok's radio "(○)". A
 * numbered list in the agent's prose does neither.
 */
export type DialogOption = { number: number; label: string; selected: boolean };
export type TerminalDialog = {
  /** The line above the options, verbatim from the screen; the daemon checks it is still visible. */
  question: string;
  /** Lines above the question, for context (what will run, which file). */
  context: string[];
  options: DialogOption[];
  /**
   * The option's digit answers it (Grok). Grok marks its cursor with colour
   * alone, so the text cannot say where arrows would start from.
   */
  direct: boolean;
};

/** Box borders Claude Code draws around a prompt. */
const BORDER_LEFT = /^\s*[│┃|]\s?/u;
const BORDER_RIGHT = /\s*[│┃|]\s*$/u;
const RULE = /^[\s─━═╭╮╰╯┌┐└┘-]*$/u;
/** A scrollbar thumb a TUI draws at its right edge (Grok: a column of █ after the text). */
const SCROLLBAR = /(?:^|\s+)[█▐▌▕▏▊▋▍▎]$/u;
const OPTION = /^(?:([❯›>▸▶])\s*)?(\d{1,2})[.)]\s+(.+?)\s*$/u;
/** Grok: "1 (○) Label   description". The digit key picks it, so one digit only. */
const RADIO_OPTION = /^(\d)\s+\([○●]\)\s+(.+?)\s*$/u;
/** Grok's free-text row under its options ("z (○) Type your answer here"); not offered here. */
const RADIO_FREE_TEXT = /^[a-z]\s+\([○●]\)\s/u;
/** Key hints a TUI prints under its list ("Press enter to confirm or esc to cancel"). */
const HINT = /\b(esc|enter|cancel|confirm|navigate|select|tab)\b|[↑↓]/iu;
const MAX_HINT_LINES = 3;
/** Transcript entries: Codex • › ■ ✗, Claude ⏺ >, Grok ◆ ◈. */
const ENTRY = /^[•›❯>■⏺✗✓◆◈]\s/u;
/** At most this many context lines above the question are kept. */
const CONTEXT_LINES = 8;

type Parsed = { number: number; label: string; selected: boolean; radio: boolean };

function inner(line: string): string {
  return line.trimEnd().replace(SCROLLBAR, "").replace(BORDER_LEFT, "").replace(BORDER_RIGHT, "").trimEnd();
}

function option(trimmed: string): Parsed | null {
  const radio = RADIO_OPTION.exec(trimmed);
  // Grok sets the label and its description apart by a column gap.
  if (radio) return { number: Number(radio[1]), label: radio[2].split(/\s{2,}/u)[0], selected: false, radio: true };
  const match = OPTION.exec(trimmed);
  return match ? { number: Number(match[2]), label: match[3], selected: Boolean(match[1]), radio: false } : null;
}

/** Index of the last option line, if everything below it is blank, a rule or a key hint. */
function bottomOption(lines: string[]): number {
  let hints = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (option(trimmed)) return index;
    if (!trimmed || RULE.test(trimmed) || RADIO_FREE_TEXT.test(trimmed)) continue;
    if (!HINT.test(trimmed) || ++hints > MAX_HINT_LINES) return -1;
  }
  return -1;
}

export function parseTerminalDialog(text: string): TerminalDialog | null {
  const lines = text.split(/\r?\n/).map(inner);
  const end = bottomOption(lines);
  if (end < 0) return null;
  // Walk up through the option run. Indented lines between options continue the
  // option below them (a label wrapped onto several lines).
  const found: Parsed[] = [];
  let top = end;
  for (let index = end; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    const parsed = option(trimmed);
    if (parsed) {
      found.unshift(parsed);
      top = index;
      if (parsed.number === 1) break;
      continue;
    }
    if (!trimmed || RULE.test(trimmed) || /^\s{2,}\S/u.test(lines[index])) continue;
    return null;
  }
  const ordered = found.length >= 2 && found.every((entry, index) => entry.number === index + 1);
  if (!ordered || found[0].number !== 1) return null;
  const direct = found[0].radio;
  if (found.some((entry) => entry.radio !== direct)) return null;
  if (!direct && found.filter((entry) => entry.selected).length !== 1) return null;
  // Prompts space their lines out (Codex: question, blank, reason, blank, command),
  // so context counts non-empty lines rather than screen rows.
  const above: string[] = [];
  for (let index = top - 1; index >= 0 && above.length <= CONTEXT_LINES; index -= 1) {
    const trimmed = lines[index].trim();
    // A transcript entry above the prompt ends it.
    if (ENTRY.test(trimmed)) break;
    if (trimmed && !RULE.test(trimmed)) above.unshift(trimmed);
  }
  const question = above.pop() ?? "";
  const options = found.map(({ number, label, selected }) => ({ number, label, selected }));
  return { question, context: above, options, direct };
}

/** The daemon's SendKeys cap (internal/daemon maxKeys). */
export const MAX_DIALOG_KEYS = 32;

/** The option's digit where that answers it; otherwise arrow from the highlighted option to `number`, then confirm. */
export function dialogKeys(dialog: TerminalDialog, number: number): string[] {
  if (dialog.direct) return [String(number)];
  const current = dialog.options.find((option) => option.selected)!.number;
  const delta = number - current;
  return [...Array(Math.abs(delta)).fill(delta > 0 ? "down" : "up"), "enter"];
}

/** The last non-empty screen lines, for a prompt that is not a numbered list. */
export function screenExcerpt(text: string, count = 8): string[] {
  return text.split(/\r?\n/).map(inner).map((line) => line.trimEnd())
    .filter((line) => line.trim() && !RULE.test(line.trim())).slice(-count);
}
