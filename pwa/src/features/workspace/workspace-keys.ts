import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { macPlatform, useHardwareKeyboard } from "../../app/input-mode";
import { currentScreen } from "../../app/navigation-store";
import { workspaceBreadcrumbs } from "../../lib/workspace";
import { loadDirectory, stepWorkspaceDiff, workspaceDiffStep } from "./actions";
import { diffWrap, setDiffWrap } from "./diff-reading";
import { setWorkspaceWrap, workspaceWrap } from "./prefs";
import { getWorkspaceSnapshot } from "./store";

/**
 * The keys of the files and changes, for a reader with a keyboard:
 *
 *   ↑ ↓      along the rows of the list (and from the filter into them)
 *   ←        up one folder, on the files tab
 *   [ ]      the previous and the next changed file, in an open diff
 *   Alt+Z    wrap long lines, in an open file or diff
 *   ⌘/Ctrl+Shift+Enter   send the open diff's notes, as its Send button does
 *
 * The lines of a diff, the lines of a file and the tabs have keys of their own
 * where they are drawn (`diff-line-stops`, `file-source`, `tab-strip`). All of
 * these count only where the files are: anywhere on the files screen, and in
 * the column only while focus is in it, since the session beside it types into
 * a running program. A field being typed in keeps its keys.
 *
 * The control a key stands for says so (`useKeyHint`), once the reader has
 * shown a keyboard.
 */

/** A row of either list, and the staged tag of a row that carries one: every diff is a stop. */
const ROW = ".workspace-row-main, .workspace-change, .workspace-change-layer";
const OVERLAYS = "dialog, [popover], [role='dialog'], [role='menu'], [role='listbox']";
/** The form a note is written in, under its line (`note-inline`). */
const NOTE_FORM = "form.diff-note-inline";

function typing(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * `[` and `]` as the reader's own layout types them. Where they are on a third
 * level (AltGr+8 and AltGr+9 on a German keyboard, Option+5 and Option+6 on a
 * Mac's) the key arrives with Alt, or with Ctrl and Alt for AltGr: still a
 * bracket and nothing else. Command, or Ctrl alone, makes it another shortcut.
 */
function bracket(event: KeyboardEvent): -1 | 1 | 0 {
  if (event.key !== "[" && event.key !== "]") return 0;
  if (event.metaKey || event.shiftKey || (event.ctrlKey && !event.altKey)) return 0;
  return event.key === "[" ? -1 : 1;
}

/**
 * Where Z is on this keyboard, by the key's position. Alt changes what a key
 * types on some systems (Option+Z is Ω on a Mac), so the letter cannot always
 * be read from the event; where the browser can say which key types "z", that
 * key is asked for, and the US position otherwise.
 */
let zCode = "KeyZ";
type LayoutMap = { entries(): Iterable<[string, string]> };
const board = typeof navigator === "undefined" ? undefined
  : (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;
void board?.getLayoutMap?.().then((map) => {
  for (const [code, typed] of map.entries()) if (typed === "z") zCode = code;
}).catch(() => { /* the US position stands */ });

/** Alt+Z: by the letter where Alt leaves it alone, by the key that types it otherwise. */
function wrapKey(event: KeyboardEvent): boolean {
  if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
  return /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === "z" : event.code === zCode;
}

/** The keys this module answers, by the control they stand for. */
const KEY_HINTS = {
  wrap: { keys: "Alt+Z", mac: "⌥Z", other: "Alt+Z" },
  prevFile: { keys: "[", mac: "[", other: "[" },
  nextFile: { keys: "]", mac: "]", other: "]" },
  parentFolder: { keys: "ArrowLeft", mac: "←", other: "←" },
  sendNotes: { keys: "Meta+Shift+Enter Control+Shift+Enter", mac: "⌘⇧↩", other: "Ctrl+Shift+Enter" },
} as const;

/**
 * What a control says about its key: `aria-keyshortcuts`, and its label with
 * the key after it for the tooltip. Nothing until the reader has shown a
 * keyboard: a finger is not told about keys it has not got.
 */
export function useKeyHint(name: keyof typeof KEY_HINTS): { keys: string | undefined; shown: string | undefined; title(label: string): string } {
  const keyboard = useHardwareKeyboard();
  const hint = KEY_HINTS[name];
  if (!keyboard) return { keys: undefined, shown: undefined, title: (label) => label };
  const shown = macPlatform() ? hint.mac : hint.other;
  return { keys: hint.keys, shown, title: (label) => `${label} (${shown})` };
}

/** Answer `event` for the files drawn in `root`. True when the key was one of theirs. */
export function workspaceKey(event: KeyboardEvent, root: ParentNode): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const snapshot = getWorkspaceSnapshot();
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(OVERLAYS)) return false;
  const mod = event.metaKey || event.ctrlKey;

  // Sent from wherever the reader is in the diff, the note they are typing included: Save is ⌘Enter, Send is this.
  if (mod && event.shiftKey && !event.altKey && event.key === "Enter") {
    if (snapshot.view !== "diff") return false;
    // What is being typed goes with the rest: saved first, as its own Save would, then sent.
    const writing = target?.closest<HTMLFormElement>(NOTE_FORM) ?? null;
    if (writing && root.contains(writing)) {
      flushSync(() => writing.requestSubmit());
      // An empty note is not saved and says so in its form: nothing is sent past it.
      // A saved one's form is on its way out by now, folding shut and out of reach.
      if (writing.isConnected && !writing.closest("[inert]")) return true;
    }
    // A bar on its way out has nothing left to send.
    const send = root.querySelector<HTMLButtonElement>(".workspace-notes-bar:not(.is-leaving) .workspace-notes-send:not(:disabled)");
    if (!send) return writing !== null;
    send.click();
    return true;
  }

  const step = snapshot.view === "diff" && !typing(target) ? bracket(event) : 0;
  if (step) {
    const place = workspaceDiffStep();
    if (!(step < 0 ? place.prev : place.next)) return false;
    if (!snapshot.loading && !event.repeat) stepWorkspaceDiff(step);
    return true;
  }
  if (mod) return false;

  // From the filter into the rows it filtered.
  if (target?.matches(".workspace-filter-input") && event.key === "ArrowDown" && !event.altKey && !event.shiftKey) {
    const first = root.querySelector<HTMLElement>(ROW);
    if (!first) return false;
    first.focus();
    return true;
  }
  if (typing(target)) return false;

  if (event.altKey) {
    if (!wrapKey(event)) return false;
    // A diff's wrap is its own; two sides next to each other never wrap.
    if (snapshot.view === "diff") {
      if (!root.querySelector(".workspace-diff:not(.is-split) .workspace-diff-line")) return false;
      setDiffWrap(!diffWrap());
      return true;
    }
    if (snapshot.view !== "file" || !root.querySelector(".workspace-code")) return false;
    setWorkspaceWrap(!workspaceWrap());
    return true;
  }
  if (event.shiftKey) return false;

  if (snapshot.view !== "browser") return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!target?.matches(ROW)) return false;
    const rows = [...root.querySelectorAll<HTMLElement>(ROW)];
    const to = rows[rows.indexOf(target as HTMLElement) + (event.key === "ArrowDown" ? 1 : -1)];
    // At either end the key is still the list's: it does not scroll the page under the row.
    to?.focus();
    return true;
  }
  if (event.key === "ArrowLeft" && snapshot.tab === "files" && snapshot.directory && target?.matches(ROW)) {
    void loadDirectory(workspaceBreadcrumbs(snapshot.directory).at(-2)?.path ?? "");
    return true;
  }
  return false;
}

/** The column's own handler: a sheet opened from it is portalled out but still bubbles here through React. */
export function keysFromColumn(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!event.currentTarget.contains(event.target as Node)) return;
  if (workspaceKey(event.nativeEvent, event.currentTarget)) event.preventDefault();
}

/** The files screen has the page to itself, so its keys count wherever focus is. */
export function useScreenKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (currentScreen() !== "workspace" || document.querySelector("dialog[open]") || document.fullscreenElement) return;
      const shell = document.querySelector(".workspace-shell");
      if (shell && workspaceKey(event, shell)) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
