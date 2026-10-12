import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { pointerFine } from "../../app/input-mode";
import { showError, showStatus } from "../../app/notices-store";
import { diffNoteTarget } from "../../lib/diff-notes";
import { hasOpenDialog } from "../../lib/dom";
import { t } from "../../lib/i18n";
import { parseDiffLines, type GitLayer } from "../../lib/workspace";
import { Button } from "../../shared/ui/primitives";
import { overlayOrigin } from "../../shared/ui/overlay/origin";
import { composeLive } from "../session/compose-store";
import { appendPaneDraft } from "../session/drafts/compose-drafts";
import { insertCompose } from "../session/guided/compose";
import { useCapabilities } from "../operations/hooks";
import { paneComposeLive } from "../settings/preferences-store";
import { loadGitDiff } from "./actions";
import { layersFor } from "./git-marks";
import type { WorkspaceSnapshot } from "./model";
import { beginNote } from "./note-drafts";
import { openNoteEditorAllowed } from "./notes";
import { activeScope, getWorkspaceSnapshot } from "./store";
import { workspaceBeside } from "./surface";

/**
 * What a reader can do with a line of an open file, or a run of lines: copy
 * it, quote it into the message to the agent, or (for one line that is part of
 * an uncommitted change) write a line note on it in its diff.
 *
 * The line is picked the way a terminal row is, with a press on it, and its
 * actions are the terminal row's own bar (`row-bubble`): across the code under
 * a finger, beside the pointer under a mouse, floating over the code so that
 * opening it never moves a line. A pick grows into a run of lines by each
 * input's own means: Shift and a second press with a mouse, the bar's Select
 * and a second tap under a finger, Shift and the arrows from the keyboard.
 */

/** Air between the picked line and the bar, and between the bar and the code's edge. */
const BAR_GAP_PX = 6;
const BAR_EDGE_PX = 8;
/** How long the bar stays to say "copied" on the pressed action before it closes. */
export const LINE_COPIED_MS = 900;

/**
 * What is picked: the line the pick began on and the line it reaches (the same
 * one until it grows), and where a mouse pressed it (null for a finger or the
 * keyboard: the bar spans the code). `by` is the input that made the pick;
 * `growing` says the next tap moves its end, which is how a finger extends it.
 */
export type PickedLine = { line: number; to: number; x: number | null; by: "mouse" | "touch" | "keys"; growing?: boolean };

/** The picked lines in file order. */
export const pickedRange = (picked: Pick<PickedLine, "line" | "to">): [number, number] =>
  [Math.min(picked.line, picked.to), Math.max(picked.line, picked.to)];

/** `4` or `4-9`: how a reference names the lines. */
export const lineRef = (from: number, to: number): string => from === to ? String(from) : `${from}-${to}`;

/** The lines of the file that an uncommitted change touches or shows, and the layer whose diff has them. */
export type NoteLines = { layer: GitLayer; lines: ReadonlySet<number> };

/**
 * The lines of the open file a note can be written on: those its diff shows,
 * while the daemon takes prompts. The working tree's diff is the file as it is
 * on disk; a file that is only staged is the same as its index.
 */
export function useNoteLines(snapshot: WorkspaceSnapshot, path: string): NoteLines | null {
  const capabilities = useCapabilities();
  const prompts = capabilities.operationCapabilities.prompt_agent;
  const layers = layersFor(snapshot.status?.changes ?? [], path);
  const layer: GitLayer | null = !snapshot.descriptor?.features.git_diff || !layers.length ? null
    : layers.includes("worktree") ? "worktree" : layers[0];
  const revision = snapshot.file?.path === path ? snapshot.file.revision : "";
  const [found, setFound] = useState<{ key: string; lines: ReadonlySet<number> } | null>(null);
  const key = prompts && layer && revision ? `${snapshot.paneId}\n${path}\n${layer}\n${revision}` : "";
  useEffect(() => {
    if (!key || !layer) return;
    let alive = true;
    const scope = activeScope();
    void scope?.diff(path, layer).value.then((diff) => {
      if (!alive || diff.binary || diff.truncated || !diff.patch) return;
      const lines = new Set<number>();
      for (const line of parseDiffLines(diff.patch)) {
        if ((line.kind === "add" || line.kind === "context") && line.newLine !== null) lines.add(line.newLine);
      }
      setFound({ key, lines });
    }, () => undefined);
    return () => { alive = false; };
  }, [key, layer, path]);
  return key && layer && found?.key === key ? { layer, lines: found.lines } : null;
}

/** `path:lines`, then the lines themselves as a quotation, on lines of their own. */
function quotation(ref: string, text: string): string {
  const quoted = text.split("\n").map((line) => line.trimEnd()).filter((line, index, all) => line.trim() || (index > 0 && index < all.length - 1));
  // One line is quoted without its indentation; a run keeps it, since it is what gives the lines their shape.
  if (quoted.length === 1) return `${ref}\n> ${quoted[0].trim()}\n`;
  return quoted.length ? `${ref}\n${quoted.map((line) => `> ${line}`).join("\n")}\n` : `${ref}\n`;
}

/**
 * Put a reference to the line, or to the lines `line` to `to`, into the message
 * to the agent. A field in live input types what it holds straight to the
 * program, newlines included, so there the reference goes in alone, on one
 * line: a quotation's `> text` would be a shell redirection.
 *
 * Beside the session its field is on the page and takes the words. From the
 * files screen the field is not mounted: the words go into the draft the
 * session opens with, live input or not as that pane is set, and the reader is
 * told where they went. A draft with no room left for them refuses them whole
 * instead of keeping a part.
 */
export function quoteFileLine(path: string, line: number, text: string, to = line): void {
  const snapshot = getWorkspaceSnapshot();
  const ref = `${path}:${lineRef(line, to)}`;
  if (workspaceBeside()) {
    insertCompose(composeLive() ? `${ref} ` : quotation(ref, text));
    return;
  }
  const mode = snapshot.returnView === "agent" ? "agent" : snapshot.returnView === "full" ? "full" : "guided";
  // The agent chat's field is a message; the terminal views' field follows the pane's live-input choice.
  const live = mode !== "agent" && paneComposeLive(snapshot.paneId);
  if (!appendPaneDraft(snapshot.paneId, mode, live ? `${ref} ` : quotation(ref, text), !live)) {
    showError(t("workspace.quoteNoRoom"));
    return;
  }
  showStatus(t(live ? "workspace.quotedLive" : "workspace.quoted", { ref }));
}

/** Open the file's diff and begin a note on this line of it. */
export async function noteFileLine(path: string, layer: GitLayer, line: number): Promise<void> {
  await loadGitDiff(path, layer);
  const snapshot = getWorkspaceSnapshot();
  const diff = snapshot.diff;
  if (snapshot.view !== "diff" || !diff || diff.path !== path || snapshot.diffLayer !== layer || diff.truncated) return;
  const shown = parseDiffLines(diff.patch).find((item) => item.newLine === line && (item.kind === "add" || item.kind === "context"));
  const target = shown ? diffNoteTarget(path, layer, shown) : null;
  if (target && openNoteEditorAllowed(target)) beginNote(`${path}:${layer}`, target);
}

/**
 * Which input a press on the code came from. Only some engines put a pointer
 * type on a click; an untyped one belongs to whatever the page saw last
 * (`overlayOrigin`), and with nothing seen, to the pointer the device has.
 */
function pressedBy(pointerType: string | undefined): "mouse" | "touch" {
  const input = pointerType || overlayOrigin()?.input;
  if (input === "touch" || input === "pen") return "touch";
  return pointerFine() ? "mouse" : "touch";
}

/** Where a press on the code picked a line, or null when it was not on one. */
export function pressedLine(target: EventTarget | null, pointerType: string | undefined, clientX: number): PickedLine | null {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-source-line]") : null;
  const line = Number(element?.dataset.sourceLine);
  if (!element || !Number.isInteger(line) || line < 1) return null;
  const by = pressedBy(pointerType);
  return { line, to: line, x: by === "mouse" ? clientX : null, by };
}

/**
 * Anchor the bar above the picked lines, or below them when they start at the
 * top of the code's box: it never lies over the lines it is about. While the
 * pick's end is out of view (the run is longer than the box, or scrolled away)
 * the bar is put away with it.
 */
function placeBar(bar: HTMLElement, code: HTMLElement, picked: PickedLine): void {
  const stage = bar.offsetParent ?? bar.parentElement;
  const [from, to] = pickedRange(picked);
  const first = code.querySelector<HTMLElement>(`[data-source-line="${from}"]`);
  const last = code.querySelector<HTMLElement>(`[data-source-line="${to}"]`);
  const reached = code.querySelector<HTMLElement>(`[data-source-line="${picked.to}"]`);
  if (!stage || !first || !last || !reached) {
    bar.dataset.offscreen = "";
    return;
  }
  const origin = stage.getBoundingClientRect();
  const view = code.getBoundingClientRect();
  const line = reached.getBoundingClientRect();
  if (line.bottom <= view.top || line.top >= view.bottom) {
    bar.dataset.offscreen = "";
    return;
  }
  delete bar.dataset.offscreen;
  if (picked.x === null) {
    delete bar.dataset.anchor;
    bar.style.left = "";
  } else {
    bar.dataset.anchor = "pointer";
    const width = bar.offsetWidth;
    const least = view.left + BAR_EDGE_PX;
    const most = Math.max(least, view.right - BAR_EDGE_PX - width);
    bar.style.left = `${Math.round(Math.min(most, Math.max(least, picked.x - width / 2)) - origin.left)}px`;
  }
  const height = bar.offsetHeight;
  const top = first.getBoundingClientRect().top;
  const bottom = last.getBoundingClientRect().bottom;
  const above = top - BAR_GAP_PX - height >= view.top;
  bar.dataset.side = above ? "above" : "below";
  // Below a run that ends under the box's foot, the bar keeps to the foot.
  const under = Math.min(bottom + BAR_GAP_PX, view.bottom - BAR_EDGE_PX - height);
  bar.style.top = `${Math.round((above ? top - BAR_GAP_PX - height : under) - origin.top)}px`;
}

/**
 * The bar for the picked line. It follows its line while the code scrolls and
 * closes on a press anywhere else, or on Escape, which then closes nothing
 * under it: the reader is putting away what they opened.
 */
export function FileLineBar({ code, path, text, picked, notes, onClose, onGrow }: {
  code: RefObject<HTMLElement | null>; path: string; text: string; picked: PickedLine; notes: NoteLines | null; onClose: () => void;
  /** Under a finger: the next tap moves the pick's end, or (again) no longer does. */
  onGrow?: (growing: boolean) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (bar.current && code.current) placeBar(bar.current, code.current, picked);
  });

  useEffect(() => {
    const box = code.current;
    const own = bar.current;
    if (!box || !own) return;
    const place = () => placeBar(own, box, picked);
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      // A press on the code is the code's own: another line, or the same one to put the bar away.
      if (target instanceof Node && (own.contains(target) || box.contains(target))) return;
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.isComposing || hasOpenDialog() || "offscreen" in own.dataset) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    box.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      box.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [code, picked]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => close.current(), LINE_COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true), () => {
      showError(t("err.copyDenied"));
      close.current();
    });
  };
  const [from, to] = pickedRange(picked);
  const lines = lineRef(from, to);
  const one = from === to;
  // A note is pinned on one line; a run of lines is quoted instead.
  const noteable = one && (notes?.lines.has(from) ?? false);
  return <div ref={bar} className="row-bubble workspace-line-bar" role="toolbar"
    aria-label={t(one ? "workspace.lineActions" : "workspace.linesActions", { line: lines })}>
    <Button className="row-act" data-copied={copied ? "" : undefined} data-reserve={t(copied ? "rowbar.copy" : "rowbar.copied")}
      aria-label={t(copied ? "row.copiedLine" : one ? "rowbar.copyAria" : "workspace.linesCopyAria", { line: lines })} onClick={copy}>
      {t(copied ? "rowbar.copied" : "rowbar.copy")}
    </Button>
    <Button className="row-act" aria-label={t(one ? "workspace.lineQuoteAria" : "workspace.linesQuoteAria", { line: lines })} onClick={() => {
      quoteFileLine(path, from, text, to);
      close.current();
    }}>{t("rowbar.quote")}</Button>
    {noteable && notes && <Button className="row-act" aria-label={t("workspace.lineNoteAria", { line: from })} onClick={() => {
      close.current();
      void noteFileLine(path, notes.layer, from);
    }}>{t("workspace.lineNote")}</Button>}
    {/* A mouse has Shift and the keyboard its arrows; a finger grows the pick from here. */}
    {picked.by === "touch" && onGrow && <Button className="row-act" aria-pressed={picked.growing === true}
      aria-label={t("workspace.lineSelectAria")} onClick={() => onGrow(!picked.growing)}>
      {t(picked.growing ? "workspace.lineSelectDone" : "rowbar.select")}
    </Button>}
  </div>;
}
