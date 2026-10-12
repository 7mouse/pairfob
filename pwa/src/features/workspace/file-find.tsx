import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";

/**
 * Find in the open file. The reader types a few letters and steps through the
 * lines that hold them; the lines are marked in the source, the one they are on
 * more strongly, and brought into view. It works on what was read: a file cut
 * short at the preview's limit is searched as far as it was read.
 *
 * It is found by line, not by letter: the source is drawn as syntax tokens, and
 * a line is what the reader goes to, quotes and notes.
 */

/** The 1-based lines of `content` that hold `query`, letter case aside. */
export function findLines(content: string, query: string): number[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const found: number[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].toLowerCase().includes(needle)) found.push(index + 1);
  }
  return found;
}

export type FileFind = {
  open: boolean;
  query: string;
  /** The lines that match, in order. */
  lines: readonly number[];
  /** Which of them the reader is on; -1 when none match. */
  at: number;
  /** The same for the source to mark: one object for as long as the matches and the place stand. */
  found: FoundLines | null;
  /** The lines answer what is in the field now, not a query a few keys back. */
  settled: boolean;
  toggle(): void;
  close(): void;
  setQuery(query: string): void;
  step(offset: -1 | 1): void;
};

/** What the source is told to mark: every matching line, and the one the reader is on. */
export type FoundLines = { lines: ReadonlySet<number>; current: number | null };

type State = { of: string; open: boolean; query: string; at: number };

/** The open find row's own close, while one is open: what Escape closes before the file under it. */
let closeShown: (() => void) | null = null;

/** Close the find row if one is open. Says whether it did, so the key that asked goes no further. */
export function closeOpenFind(): boolean {
  if (!closeShown) return false;
  closeShown();
  return true;
}

/**
 * The row leaves with whatever in it had the keyboard. The button that opened
 * it takes the keyboard back, so the reader's place is not lost to the page;
 * focus elsewhere (a line of the source) stays where it is.
 */
function handBackFocus(): void {
  if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.closest(".workspace-find")) return;
  document.querySelector<HTMLElement>(".workspace-find-toggle")?.focus();
}

/** Bring the line the reader is on back into view: Enter with one match goes nowhere new, and must still show it. */
function showCurrentLine(): void {
  document.querySelector(".workspace-code-line.is-found-current")?.scrollIntoView?.({ block: "center" });
}

/** The find of one file's text; another file, or the same one read again, starts closed. */
export function useFileFind(path: string, content: string | null): FileFind {
  const of = `${path}\n${content?.length ?? -1}`;
  const [state, setState] = useState<State>({ of, open: false, query: "", at: 0 });
  const current = state.of === of ? state : { of, open: false, query: "", at: 0 };
  // The field follows the keys at once; the lines, and every row of the source they mark, follow when there is time.
  const asked = useDeferredValue(current.query);
  const lines = useMemo(() => current.open && content !== null ? findLines(content, asked) : [], [current.open, asked, content]);
  const at = lines.length ? Math.min(current.at, lines.length - 1) : -1;
  const found = useMemo<FoundLines | null>(() => lines.length ? { lines: new Set(lines), current: lines[at] ?? null } : null, [lines, at]);
  const close = () => {
    handBackFocus();
    setState({ ...current, open: false });
  };
  useEffect(() => {
    if (!current.open) return;
    closeShown = close;
    return () => { if (closeShown === close) closeShown = null; };
  });
  return {
    open: current.open,
    query: current.query,
    lines,
    at,
    found,
    settled: asked === current.query,
    toggle: () => setState({ ...current, open: !current.open }),
    close,
    setQuery: (query) => setState({ ...current, query, at: 0 }),
    step: (offset) => {
      if (!lines.length) return;
      const next = (Math.max(at, 0) + offset + lines.length) % lines.length;
      if (next === at) showCurrentLine();
      else setState({ ...current, at: next });
    },
  };
}

export function foundLines(find: FileFind): FoundLines | null {
  return find.open ? find.found : null;
}

/**
 * The row under the info bar. The reader opened it to type, so the field has
 * the keyboard on arrival. Enter goes on to the next match and Shift+Enter
 * back; Escape closes the row and nothing under it.
 */
export function FileFindBar({ find }: { find: FileFind }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find.open) field.current?.focus();
  }, [find.open]);
  if (!find.open) return null;
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      find.step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      find.close();
    }
  };
  // "No results" is said of what was searched: while the lines catch up with the keys, nothing is claimed.
  const none = find.query !== "" && !find.lines.length && find.settled;
  return <div className="workspace-find" role="search">
    {/* The label is as high as the row: a finger's press beside the field is the field's. */}
    <label className="workspace-find-box">
      <input ref={field} className="workspace-find-field" type="search" enterKeyHint="search" autoComplete="off" autoCapitalize="off"
        autoCorrect="off" spellCheck={false} placeholder={t("workspace.findInFile")} aria-label={t("workspace.findInFile")}
        value={find.query} onChange={(event) => find.setQuery(event.currentTarget.value)} onKeyDown={onKey} />
    </label>
    <span className={`workspace-find-count${none ? " is-none" : ""}`} aria-live="polite">
      {none ? t("workspace.findNone") : find.lines.length ? t("workspace.findPosition", { index: find.at + 1, total: find.lines.length }) : ""}
    </span>
    <Button className="icon-btn workspace-tool" aria-label={t("workspace.findPrev")} title={t("workspace.findPrev")}
      disabled={find.lines.length < 2} onClick={() => find.step(-1)}><ChevronUp size={16} aria-hidden="true" /></Button>
    <Button className="icon-btn workspace-tool" aria-label={t("workspace.findNext")} title={t("workspace.findNext")}
      disabled={find.lines.length < 2} onClick={() => find.step(1)}><ChevronDown size={16} aria-hidden="true" /></Button>
    <Button className="icon-btn workspace-tool" aria-label={t("workspace.findClose")} title={t("workspace.findClose")}
      onClick={find.close}><X size={16} aria-hidden="true" /></Button>
  </div>;
}
