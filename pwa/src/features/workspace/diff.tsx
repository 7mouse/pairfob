import { Columns2, FileText } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { diffNoteTarget, diffNotesFor, type DiffNoteTarget } from "../../lib/diff-notes";
import type { WordRange } from "../../lib/diff-words";
import { useHardwareKeyboard } from "../../app/input-mode";
import { parseDiffLines, type DiffLine, type GitChangeKind, type GitLayer } from "../../lib/workspace";
import { t } from "../../lib/i18n";
import { MOTION_MS, motionMs } from "../../shared/ui/dom/motion";
import { Button, Fold } from "../../shared/ui/primitives";
import { useCapabilities } from "../operations/hooks";
import { loadGitDiff, loadWorkspaceFile, refreshWorkspace } from "./actions";
import { GapRow, HunkHead, HunkNav, hunkTitle, topIn, type DiffPort } from "./diff-hunk";
import { changedWords, diffHunks, splitRows, type DiffHunk } from "./diff-hunks";
import { setSplitChosen, useSplitChosen, useSplitOffered } from "./diff-layout";
import { useDiffHold, type DiffHold } from "./diff-hold";
import { DiffLineRow, type LineNotes } from "./diff-line";
import { diffStops, useLineStops } from "./diff-line-stops";
import { SplitLineRow } from "./diff-split";
import { DiffStepper } from "./diff-stepper";
import { DetailIdentity, DetailMoreButton } from "./file-detail";
import { changeKindLabel } from "./format";
import { GitMark } from "./git-mark";
import { changeSections, layersFor } from "./git-marks";
import type { WorkspaceSnapshot } from "./model";
import { setOpenNoteAside, useInlineNote, useScreenNote, type InlineNote } from "./note-inline";
import type { ParkedNote } from "./note-parked";
import { DiffNotesBar, diffNotePinKey } from "./notes";
import { DiffPending, ReservedStat } from "./pending";
import { markReviewed } from "./review-progress";
import { useListBeside } from "./list-beside";
import { Still } from "./still";
import { thumbAt } from "./thumb";

/**
 * A long patch is drawn a stretch at a time: this many lines at first, and as
 * many again whenever the reader comes near the end of what is drawn.
 */
export const DIFF_BATCH_LINES = 400;
/** About one unwrapped line of the diff, for guessing a hunk's height before it is drawn. */
const TALL_LINE_PX = 19;
/** Past the end of a fold's move, for what reads the layout once it has settled. */
const SETTLE_SLACK_MS = 20;

type DiffScrollMemory = { key: string; top: number; left: number };
let diffScrollMemory: DiffScrollMemory | null = null;

function rememberDiffScroll(el: HTMLElement, key: string): void {
  diffScrollMemory = { key, top: el.scrollTop, left: el.scrollLeft };
}

/** How far the reader had the open diff drawn and which hunks they folded: kept with its scroll position. */
type DiffShape = { key: string; shown: number; folded: ReadonlySet<number> };
let diffShape: DiffShape | null = null;
const NONE: ReadonlySet<number> = new Set();

/** Tests: no diff was open before this one. */
export function resetDiffMemory(): void {
  diffScrollMemory = null;
  diffShape = null;
}

/** How close to the bottom counts as having read the diff to its end. */
const END_SLACK_PX = 24;
/** How close to the bottom the next stretch of a long patch is drawn. */
const NEAR_END_PX = 1200;

/**
 * `onEnd` hears when the reader is at the last line drawn: on arrival when the
 * diff fits its box, otherwise once they have scrolled there. `onNear` hears a
 * little earlier, in time to draw more. Both are asked again whenever what is
 * drawn changes (`content`), since folding a hunk can bring the end into view.
 */
export function DiffScroller({ diffKey, children, onEnd, onNear, scroller, split = false, content = "", memory = diffKey, reveal = false }: {
  diffKey: string; children: ReactNode; onEnd?: () => void; onNear?: () => void; scroller?: RefObject<HTMLDivElement | null>;
  split?: boolean; content?: string;
  /** What the scroll position is remembered by: the diff, and whose it is. */
  memory?: string;
  /** These lines took the place of what the body was showing: they fade in (`diff-hold`). */
  reveal?: boolean;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = scroller ?? own;
  const stops = useLineStops(ref);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  const near = useRef(onNear);
  near.current = onNear;
  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (left <= NEAR_END_PX) near.current?.();
    if (left <= END_SLACK_PX) ended.current?.();
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mountedKey = memory;
    const same = diffScrollMemory?.key === mountedKey;
    el.scrollTop = same ? diffScrollMemory!.top : 0;
    el.scrollLeft = same ? diffScrollMemory!.left : 0;
    rememberDiffScroll(el, mountedKey);
    const onScroll = () => { rememberDiffScroll(el, mountedKey); check(); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rememberDiffScroll(el, mountedKey);
      el.removeEventListener("scroll", onScroll);
    };
  }, [memory, ref, check]);

  // A hunk folds over a moment (`Fold`): where the end is, is asked again once it has.
  useLayoutEffect(() => {
    check();
    const settle = motionMs(MOTION_MS.panel);
    if (!settle) return;
    const timer = window.setTimeout(check, settle + SETTLE_SLACK_MS);
    return () => window.clearTimeout(timer);
  }, [memory, content, check]);

  return <div ref={ref} className={`workspace-diff${split ? " is-split" : ""}${reveal ? " workspace-reveal" : ""}`} data-diff-key={diffKey}
    onFocus={stops.onFocus} onKeyDown={stops.onKeyDown}>
    {children}
  </div>;
}

export function LayerSwitch({ snapshot, layers }: { snapshot: WorkspaceSnapshot; layers: GitLayer[] }) {
  return <div className="workspace-layer-switch" role="group" aria-label={t("workspace.layerSwitch")} style={thumbAt(layers.indexOf(snapshot.diffLayer), layers.length)}>
    {layers.map((layer) => <Button key={layer} aria-pressed={snapshot.diffLayer === layer}
      onClick={() => { if (snapshot.diffLayer !== layer) void loadGitDiff(snapshot.detailPath, layer); }}>
      {layer === "staged" ? t("workspace.staged") : t("workspace.worktree")}
    </Button>)}
  </div>;
}

/** The open diff, derived once for whichever arrangement shows it: the page or the inspector. */
export type DiffView = {
  diff: WorkspaceSnapshot["diff"];
  path: string;
  parsed: DiffLine[];
  /** The patch as hunks, with the stretch that changed in each replaced line. */
  hunks: DiffHunk[];
  words: ReadonlyMap<DiffLine, WordRange>;
  /** The lines of code the patch holds, hunk heads aside. */
  lineCount: number;
  /** The element the lines scroll in, for what steps through them from the info bar. */
  scroller: RefObject<HTMLDivElement | null>;
  /** What the info bar's steppers and the lines tell each other. */
  port: RefObject<DiffPort>;
  noteable: boolean;
  diffKey: string;
  layers: GitLayer[];
  kind: GitChangeKind | undefined;
  /** The diff rendered its lines, so the reader can pin notes and has none yet. */
  invitesNotes: boolean;
  /** Whether the diff that was open is kept on screen while the next is read, and whether this one fades in (`diff-hold`). */
  hold: DiffHold;
};

/** The open diff's file and layer: what its scroll position and its note in progress are kept by. */
export function openDiffKey(snapshot: WorkspaceSnapshot): string {
  return snapshot.diff ? `${snapshot.diff.path}:${snapshot.diffLayer}` : "";
}

export function useDiffView(snapshot: WorkspaceSnapshot): DiffView {
  const capabilities = useCapabilities();
  const diff = snapshot.diff;
  const path = diff?.path || snapshot.detailPath;
  const patch = diff && !diff.binary ? diff.patch : "";
  const shape = useMemo(() => {
    // `diff --git`, `---`/`+++` and `index` lines repeat the header; hunks and code remain.
    const parsed = parseDiffLines(patch).filter((line) => line.kind !== "meta");
    const hunks = diffHunks(parsed);
    const words = new Map<DiffLine, WordRange>();
    for (const hunk of hunks) for (const [line, range] of changedWords(hunk.lines)) words.set(line, range);
    return { parsed, hunks, words, lineCount: hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0) };
  }, [patch]);
  const scroller = useRef<HTMLDivElement>(null);
  const port = useRef<DiffPort>({});
  const noteable = Boolean(diff && !diff.truncated && capabilities.operationCapabilities.prompt_agent);
  const changes = snapshot.status?.changes ?? [];
  const sections = changeSections(changes.filter((change) => change.path === path));
  const step = [...sections.conflict, ...sections.staged, ...sections.worktree].find((item) => item.layer === snapshot.diffLayer);
  const diffKey = openDiffKey(snapshot);
  const hold = useDiffHold(snapshot, diffKey);
  return {
    diff,
    path,
    ...shape,
    scroller,
    port,
    noteable,
    diffKey,
    hold,
    layers: layersFor(changes, path),
    kind: step?.kind,
    invitesNotes: Boolean(diff && noteable && !snapshot.error && shape.lineCount && diff.patch
      && !diffNotesFor(diff.path, snapshot.diffLayer).length),
  };
}

/** `+n −n`, with their room held while the diff is still on its way. */
export function DiffStats({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const diff = snapshot.diff;
  if (diff) {
    return <>
      <span className="workspace-additions">{t("workspace.additions", { count: diff.additions })}</span>
      <span className="workspace-deletions">{t("workspace.deletions", { count: diff.deletions })}</span>
    </>;
  }
  if (!snapshot.loading) return null;
  return <><ReservedStat className="workspace-additions" text={null} /><ReservedStat className="workspace-deletions" text={null} /></>;
}

/** The line at the top of what is read, and how far below the top it stood. */
type TopLine = { at: string; offset: number };

function topLine(box: HTMLElement): TopLine | null {
  const edge = box.getBoundingClientRect().top;
  // A hunk's head is stuck over the first lines of the box.
  const head = box.querySelector<HTMLElement>(".workspace-diff-hunk")?.offsetHeight ?? 0;
  for (const number of box.querySelectorAll<HTMLElement>("[data-at]")) {
    const row = number.closest<HTMLElement>(".workspace-diff-line") ?? number;
    const top = row.getBoundingClientRect().top;
    if (top - edge >= head) return { at: number.dataset.at!, offset: top - edge };
  }
  return null;
}

/**
 * The lines of a patch: each hunk under its head, behind the unchanged stretch
 * that parts it from the one before. A hunk folds at its head; the one a note
 * is being written in stays open, and the note is set aside before its hunk is
 * folded on it. Keyed by the patch's revision, so another patch starts unfolded
 * unless it is the very one the reader just left (`diffShape`).
 */
function DiffLines({ snapshot, view, notes, split, reveal, onSeen }: {
  snapshot: WorkspaceSnapshot; view: DiffView; notes: LineNotes; split: boolean; reveal: boolean; onSeen: () => void;
}) {
  const { hunks, words, diffKey, lineCount, path, layers, port } = view;
  const layer = snapshot.diffLayer;
  // A file of the same name in another pane or repository is another diff, and so is this one after it changed.
  const memory = `${snapshot.descriptor?.root ?? ""}\n${snapshot.paneId}\n${diffKey}`;
  const shapeKey = `${memory}\n${view.diff?.revision ?? ""}`;
  const [shown, setShown] = useState(() => diffShape?.key === shapeKey ? Math.max(diffShape.shown, DIFF_BATCH_LINES) : DIFF_BATCH_LINES);
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => diffShape?.key === shapeKey ? diffShape.folded : NONE);
  useEffect(() => { diffShape = { key: shapeKey, shown, folded }; }, [shapeKey, shown, folded]);

  /** Which hunk each line that can take a note is in, by the note's pin. */
  const hunkOfPin = useMemo(() => {
    const pins = new Map<string, number>();
    if (!notes.noteable) return pins;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        const target = diffNoteTarget(path, layer, line);
        if (target) pins.set(diffNotePinKey(target), hunk.index);
      }
    }
    return pins;
  }, [hunks, path, layer, notes.noteable]);
  const writing = notes.inline?.note ? hunkOfPin.get(diffNotePinKey(notes.inline.note.target)) : undefined;
  const waiting = notes.parked ? hunkOfPin.get(diffNotePinKey(notes.parked.note.target)) : undefined;
  const kept = new Map<number, number>();
  for (const note of notes.noteable ? diffNotesFor(path, layer) : []) {
    const hunk = hunkOfPin.get(diffNotePinKey(note));
    if (hunk !== undefined) kept.set(hunk, (kept.get(hunk) ?? 0) + 1);
  }
  if (waiting !== undefined) kept.set(waiting, (kept.get(waiting) ?? 0) + 1);

  // A note opened on a line of a folded hunk unfolds it, and it stays unfolded after the note is answered.
  useEffect(() => {
    if (writing !== undefined && folded.has(writing)) setFolded((was) => new Set([...was].filter((index) => index !== writing)));
  }, [writing, folded]);
  // The hunk a note is being written in is drawn to its end, however long the patch before it.
  const reach = writing === undefined ? 0 : hunks[writing].offset + hunks[writing].lines.length;
  const limit = Math.min(lineCount, Math.max(shown, reach));
  const more = () => setShown(Math.min(lineCount, limit + DIFF_BATCH_LINES));

  // What the next drawing owes the reader: the hunk they folded brought back into view, the
  // line they were on held in place, the keyboard put on the first line a press drew.
  const justFolded = useRef<number | null>(null);
  const place = useRef<TopLine | null>(null);
  const resume = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const ports = port.current;
    ports.reach = (index) => {
      const hunk = hunks[index];
      if (hunk) setShown((was) => Math.max(was, Math.min(lineCount, hunk.offset + DIFF_BATCH_LINES)));
    };
    ports.keepPlace = () => { place.current = view.scroller.current ? topLine(view.scroller.current) : null; };
    return () => { ports.reach = ports.keepPlace = undefined; };
  }, [port, hunks, lineCount, view.scroller]);

  // A hunk taller than the diff's own window does not travel its whole height when it folds
  // (`.is-tall`): measured as it is folded, guessed by its lines where it was never open here.
  const tall = useRef(new Map<number, boolean>());
  const isTall = (hunk: DiffHunk): boolean => tall.current.get(hunk.index)
    ?? hunk.lines.length * TALL_LINE_PX > (view.scroller.current?.clientHeight || Infinity);
  const toggle = (hunk: DiffHunk, open: boolean) => {
    if (open && writing === hunk.index) notes.inline?.setAside();
    if (open) justFolded.current = hunk.index;
    const box = view.scroller.current;
    const drawn = open ? box?.querySelector<HTMLElement>(`.workspace-diff-group[data-group="${hunk.index}"]`) : null;
    if (box && drawn) tall.current.set(hunk.index, drawn.offsetHeight > box.clientHeight);
    setFolded((was) => {
      const next = new Set(was);
      if (open) next.add(hunk.index);
      else next.delete(hunk.index);
      return next;
    });
  };
  /** The button's own step: the keyboard goes on to the first line it draws. */
  const moreByHand = (button: HTMLElement) => {
    const stops = diffStops(view.scroller.current);
    resume.current = document.activeElement === button ? stops[stops.indexOf(button) - 1] ?? button : null;
    more();
  };
  const content = `${limit}:${[...folded].join(",")}:${split}`;
  useLayoutEffect(() => {
    const box = view.scroller.current;
    if (!box) return;
    // The head was stuck over the middle of its hunk. Folded, it is a line far above: go to it, not past it.
    const hunk = justFolded.current === null ? null : box.querySelector(`.workspace-diff-group[data-group="${justFolded.current}"]`);
    justFolded.current = null;
    if (hunk && topIn(box, hunk) < box.scrollTop) box.scrollTop = topIn(box, hunk);
    const held = place.current;
    place.current = null;
    const line = held ? box.querySelector<HTMLElement>(`[data-at="${held.at}"]`) : null;
    const row = line?.closest<HTMLElement>(".workspace-diff-line") ?? line;
    if (held && row) box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - held.offset;
    const before = resume.current;
    resume.current = null;
    if (before) {
      const stops = diffStops(box);
      (stops[stops.indexOf(before) + 1] ?? (before.isConnected ? before : stops[stops.length - 1]))?.focus();
    }
    port.current.drawn?.();
    // The stepper reads where the hunks stand, and a folding hunk moves the ones after it for a moment yet.
    const settle = motionMs(MOTION_MS.panel);
    if (!settle) return;
    const timer = window.setTimeout(() => port.current.drawn?.(), settle + SETTLE_SLACK_MS);
    return () => window.clearTimeout(timer);
  }, [content, view.scroller, port]);

  // The file on disk is the new side of the working tree's diff, and of the index's while nothing else changed it.
  const kind = view.kind;
  const opens = kind !== "deleted" && (layer === "worktree" || !layers.includes("worktree"));
  const rows = useMemo(() => split ? hunks.map((hunk) => splitRows(hunk.lines)) : null, [split, hunks]);

  return <DiffScroller diffKey={diffKey} memory={memory} scroller={view.scroller} split={split} content={content} reveal={reveal}
    onNear={() => { if (limit < lineCount) more(); }} onEnd={() => { if (limit >= lineCount) onSeen(); }}>
    {hunks.map((hunk) => {
      if (hunk.offset >= limit && hunk.offset > 0) return null;
      const open = !folded.has(hunk.index) || writing === hunk.index;
      // A stretch is counted in the patch's lines either way; the two sides are paired within what is drawn.
      const lines = limit - hunk.offset < hunk.lines.length ? hunk.lines.slice(0, limit - hunk.offset) : hunk.lines;
      const title = hunkTitle(hunk);
      return <div key={hunk.index} className={`workspace-diff-group${open ? "" : " is-folded"}`} role="group" aria-label={title} data-group={hunk.index}>
        <GapRow hunk={hunk} onOpen={opens ? (line) => void loadWorkspaceFile(path, line) : undefined} />
        <HunkHead hunk={hunk} open={open} notes={kept.get(hunk.index) ?? 0} onToggle={() => toggle(hunk, open)} />
        <Fold open={open} lazy className={isTall(hunk) ? "is-tall" : ""}>
          {rows
            ? (lines === hunk.lines ? rows[hunk.index] : splitRows(lines)).map((row, index) => <SplitLineRow key={index} row={row} words={words} notes={notes} />)
            : lines.map((line, index) => <DiffLineRow key={index} line={line} words={words.get(line)} notes={notes} />)}
        </Fold>
      </div>;
    })}
    {limit < lineCount && <Button className="workspace-more workspace-diff-more diff-stop" onClick={(event) => moreByHand(event.currentTarget)}>
      {t("workspace.diffShowMore", { count: lineCount - limit })}
    </Button>}
  </DiffScroller>;
}

/**
 * The invitation to pin a note on a line. A reader with a keyboard is also
 * told how it walks the diff: those keys stand for no control that could say so.
 */
export function DiffHint() {
  const keyboard = useHardwareKeyboard();
  return <p className="workspace-diff-hint">{t("diffNotes.tapHint")}{keyboard ? ` ${t("workspace.diffKeysHint")}` : ""}</p>;
}

/**
 * Everything between the info bar and the footer: what the reader must know
 * first (a conflict, a patch cut short), then the lines or the state that
 * stands in for them. `hint` is the page's invitation to pin a note above the
 * lines; the inspector shows it in its footer instead. `inline` is the note
 * being written on this diff, whose form opens under its line; `parked` is a
 * half-written one set aside, waiting under its line. `split` puts the two
 * sides next to each other.
 *
 * Between one diff and the next the body keeps what it was showing, dimmed
 * and out of reach, as it was last drawn (`diff-hold`): the store has no diff
 * then, and no notes for one.
 */
export function DiffBody({ snapshot, view, onEditNote, hint = true, inline, parked, split = false }: {
  snapshot: WorkspaceSnapshot; view: DiffView; onEditNote: (target: DiffNoteTarget) => void; hint?: boolean; inline?: InlineNote;
  parked?: ParkedNote | null; split?: boolean;
}) {
  const { diff, noteable } = view;
  const root = snapshot.descriptor?.root ?? "";
  const layer = snapshot.diffLayer;
  // Seen as it stands: the mark carries the patch's revision, so a later change withdraws it.
  const seen = useCallback(() => {
    if (diff && root) markReviewed(root, layer, diff.path, diff.revision);
  }, [diff, root, layer]);
  // A diff with no lines to scroll (binary, or empty in this layer) is seen on arrival.
  const nothingToRead = Boolean(diff && !snapshot.error && (diff.binary || !view.lineCount || !diff.patch));
  useEffect(() => {
    if (nothingToRead) seen();
  }, [nothingToRead, seen]);
  const retry = () => {
    if (snapshot.detailPath) void loadGitDiff(snapshot.detailPath, snapshot.diffLayer);
    else void refreshWorkspace();
  };
  const { stale, reveal } = view.hold;
  const body = useRef<HTMLDivElement>(null);
  // The keyboard does not stay on a line of the diff that is being replaced.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (stale && active instanceof HTMLElement && body.current?.contains(active)) active.blur();
  }, [stale]);
  const arrived = reveal ? " workspace-reveal" : "";
  return <div ref={body} className={`workspace-diff-body${stale ? " is-stale" : ""}`} inert={stale}>
    <Still still={stale}>
      {view.kind === "conflict" && <p className="workspace-diff-banner" role="note">{t("workspace.conflictBanner")}</p>}
      {/* Said before the lines, where it is read before the patch is taken for the whole change. */}
      {diff?.truncated && !snapshot.error && <p className="workspace-limit is-lead" role="note">{`${t("workspace.diffTruncated")} ${t("diffNotes.truncated")}`}</p>}
      {snapshot.error ? (
        <div className="workspace-feedback workspace-error workspace-feedback-pane" role="alert">
          <p>{snapshot.error}</p>
          <Button className="btn btn-small" onClick={retry}>{t("ft.retry")}</Button>
        </div>
      ) : !diff ? (
        snapshot.loading && snapshot.pendingReveal ? <DiffPending /> : <div className="workspace-diff-spacer" />
      ) : diff.binary ? (
        <p className={`workspace-empty${arrived}`}>{t("workspace.binary")}</p>
      ) : !view.lineCount || !diff.patch ? (
        <p className={`workspace-empty${arrived}`}>{t("workspace.diffEmpty")}</p>
      ) : (
        <>
          {hint && view.invitesNotes && <DiffHint />}
          <DiffLines key={`${view.diffKey}\n${diff.revision}`} snapshot={snapshot} view={view} split={split} reveal={reveal} onSeen={seen}
            notes={{ noteable, path: diff.path, layer, onEdit: onEditNote, inline, parked }} />
        </>
      )}
    </Still>
  </div>;
}

/**
 * What the info bar offers on an open diff, the same on the page and in the
 * column: from hunk to hunk, the two sides next to each other where the window
 * has the room, and the file itself. They belong to the lines on screen: while
 * the diff that was open is kept for the next one, so are they, out of reach,
 * and nothing beside the stepper comes and goes with each step.
 */
export function DiffTools({ snapshot, view, split }: { snapshot: WorkspaceSnapshot; view: DiffView; split?: { on: boolean } }) {
  const { diff, path, kind } = view;
  const lines = Boolean(diff && !diff.binary && view.lineCount);
  return <span className="workspace-tools" inert={view.hold.stale}>
    <Still still={view.hold.stale}>
      {lines && <HunkNav scroller={view.scroller} port={view.port} total={view.hunks.length} version={`${view.diffKey}\n${diff?.revision ?? ""}\n${snapshot.error}`} />}
      {lines && split && <Button className="icon-btn workspace-tool" aria-pressed={split.on} aria-label={t("workspace.splitView")} title={t("workspace.splitView")}
        onClick={() => { view.port.current.keepPlace?.(); setSplitChosen(!split.on); }}><Columns2 size={16} aria-hidden="true" /></Button>}
      {kind !== "deleted" && <Button className="icon-btn workspace-tool workspace-open-file" aria-label={t("workspace.openFile")} title={t("workspace.openFile")}
        onClick={() => loadWorkspaceFile(path)}><FileText size={16} aria-hidden="true" /></Button>}
    </Still>
  </span>;
}

/**
 * The foot of a diff: what its notes say. It is the open diff's too, and waits
 * with it while the next one is read. One bar for every diff of the pane, so
 * from file to file it stays where it is and only what it says changes.
 */
export function DiffFooter({ view, children }: { view: DiffView; children: ReactNode }) {
  return <div className="workspace-diff-footer" inert={view.hold.stale}>
    <Still still={view.hold.stale}>{children}</Still>
  </div>;
}

/** A diff on the workspace screen. A note is written in place, under its line, as beside the session. */
export function DiffDetail({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const view = useDiffView(snapshot);
  const { diff, path, kind, layers } = view;
  const note = useInlineNote(view.diffKey);
  useScreenNote(note);
  const together = useListBeside();
  const offered = useSplitOffered();
  const chosen = useSplitChosen();
  const split = offered && chosen;
  return <section className="workspace-detail-view workspace-diff-view" aria-label={t("workspace.diff")}
    onKeyDown={(event) => setOpenNoteAside(note, event)}>
    <div className="workspace-detail-head">
      <DetailIdentity path={path} />
      {layers.length > 1 ? <LayerSwitch snapshot={snapshot} layers={layers} />
        : <>
          {kind && <GitMark kind={kind} />}
          <span className="workspace-layer-label">{[kind && changeKindLabel(kind), snapshot.diffLayer === "staged" ? t("workspace.staged") : t("workspace.worktree")].filter(Boolean).join(" · ")}</span>
        </>}
      <DiffStats snapshot={snapshot} />
      <span className="workspace-detail-actions">
        <DiffTools snapshot={snapshot} view={view} split={offered ? { on: chosen } : undefined} />
        {/* Beside the list the header keeps the repository; one screen at a time, the header has the stepper. */}
        {together && <DiffStepper snapshot={snapshot} />}
        <DetailMoreButton />
      </span>
    </div>
    <DiffBody snapshot={snapshot} view={view} onEditNote={note.open} inline={note} parked={note.parked} split={split} />
    <DiffFooter view={view}>
      {diff && !diff.binary && <DiffNotesBar path={diff.path} layer={snapshot.diffLayer} paneId={snapshot.paneId} returnView={snapshot.returnView} />}
    </DiffFooter>
  </section>;
}
