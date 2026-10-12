import { ArrowDown, ArrowUp, PenLine } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { t } from "../../lib/i18n";
import { Button, Chevron } from "../../shared/ui/primitives";
import type { DiffHunk } from "./diff-hunks";
import { holdDiffStop } from "./diff-line-stops";

/**
 * What stands between the lines of a diff: each hunk's head, which says where
 * in the file it is and folds it away, the unchanged stretch before it, and
 * the pair of buttons in the info bar that steps from one hunk to the next.
 */

/** "Lines 3–7", "Line 12", or the old file's lines for a hunk that only removes. */
export function hunkTitle(hunk: DiffHunk): string {
  const one = hunk.from === hunk.to;
  if (hunk.side === "old") return t(one ? "workspace.hunkOldLine" : "workspace.hunkOldLines", { from: hunk.from, to: hunk.to });
  return t(one ? "workspace.hunkLine" : "workspace.hunkLines", { from: hunk.from, to: hunk.to });
}

/**
 * The head stays at the top of the diff while its hunk is read. Folded, it
 * says how much it holds and how many notes wait inside.
 */
export function HunkHead({ hunk, open, notes, onToggle }: { hunk: DiffHunk; open: boolean; notes: number; onToggle: () => void }) {
  const title = hunkTitle(hunk);
  const count = t("workspace.lines", { count: hunk.lines.length });
  return <div className="workspace-diff-hunk" data-hunk={hunk.index}>
    <Button className="workspace-hunk-toggle diff-stop" aria-expanded={open}
      aria-label={[title, hunk.context, !open && count, !open && notes ? t("workspace.noteCount", { count: notes }) : ""].filter(Boolean).join(" · ")}
      onClick={onToggle}>
      <Chevron className="group-chev" />
      <span className="workspace-hunk-title">{title}</span>
      {/* What Git names after the range: the enclosing function, by its own rules. */}
      {hunk.context && <code className="workspace-hunk-context">{hunk.context}</code>}
      {!open && <span className="workspace-hunk-count">{count}</span>}
      {!open && notes > 0 && <span className="workspace-hunk-notes" aria-hidden="true"><PenLine size={12} />{String(notes)}</span>}
    </Button>
  </div>;
}

/**
 * The unchanged lines a patch leaves out before a hunk. Git sends none of
 * them, so they cannot unfold here; where the file on disk is what the diff's
 * new side shows, the row opens it at that place instead.
 */
export function GapRow({ hunk, onOpen }: { hunk: DiffHunk; onOpen?: (line: number) => void }) {
  if (hunk.gap < 1) return null;
  const said = t("workspace.unchangedLines", { count: hunk.gap });
  const act = t("workspace.viewInFile");
  return <div className="workspace-diff-gap">
    {onOpen
      ? <Button className="workspace-gap-open diff-stop" aria-label={`${said} · ${act}`} onClick={() => onOpen(hunk.gapLine)}>
        <span>{said}</span><span className="workspace-gap-act">{act}</span>
      </Button>
      : <span className="workspace-gap-open">{said}</span>}
  </div>;
}

/**
 * What the info bar's steppers and the lines of the diff tell each other. Both
 * are drawn from one view of the diff but stand in different places, and the
 * lines alone know how much of a long patch is drawn.
 */
export type DiffPort = {
  /** Draws the patch as far as this hunk. Set by the lines. */
  reach?: (hunk: number) => void;
  /** Notes which line is at the top, to stay there when the two sides are put together or apart. Set by the lines. */
  keepPlace?: () => void;
  /** Hears that what is drawn changed: more of the patch, a hunk folded, the two sides. Set by the stepper. */
  drawn?: () => void;
};

/** Where `node` starts in the scroller's own content, whatever is stuck to its top now. */
export function topIn(box: HTMLElement, node: Element): number {
  return node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

const groupOf = (box: HTMLElement, hunk: number): HTMLElement | null =>
  box.querySelector<HTMLElement>(`.workspace-diff-group[data-group="${hunk}"]`);

type Place = { index: number; prev: boolean; next: boolean };
const START: Place = { index: 0, prev: false, next: false };

/**
 * Which hunk is being read: the last one whose start has reached the top, or
 * the one just stepped to (`stepped`), which a short hunk near the end of the
 * diff never brings to the top.
 */
function placeIn(box: HTMLElement, total: number, stepped: number | undefined): Place {
  const groups = [...box.querySelectorAll<HTMLElement>(".workspace-diff-group")];
  const at = box.scrollTop;
  let index = 0;
  for (const group of groups) if (topIn(box, group) <= at + 1) index = Number(group.dataset.group);
  if (stepped !== undefined) index = stepped;
  const first = groups[0] ? topIn(box, groups[0]) : 0;
  return { index, prev: index > 0 || at > first + 1, next: index < total - 1 };
}

/**
 * Previous hunk · which of how many · next hunk. Up goes to the start of the
 * hunk being read before it goes to the one above; down reaches every hunk,
 * drawing a long patch as far as the one it goes to. Nothing for a diff of one
 * hunk: there is nowhere to step to.
 */
export function HunkNav({ scroller, total, version, port }: {
  scroller: RefObject<HTMLElement | null>; total: number; version: string; port: RefObject<DiffPort>;
}) {
  const [place, setPlace] = useState(START);
  // Said when a step lands, not as the position changes under a scroll.
  const [said, setSaid] = useState("");
  // The hunk stepped to, and where the diff stood once there; null until it is drawn. Dropped when the reader scrolls on.
  const stepped = useRef<{ index: number; top: number | null } | null>(null);
  const land = (box: HTMLElement) => {
    const to = stepped.current;
    if (!to) return;
    const group = groupOf(box, to.index);
    if (!group) {
      port.current.reach?.(to.index);
      return;
    }
    box.scrollTop = topIn(box, group);
    to.top = box.scrollTop;
    // Tab into the diff goes where the reader stepped to.
    const head = group.querySelector<HTMLElement>(".workspace-hunk-toggle");
    if (head) holdDiffStop(head);
  };
  const read = (box: HTMLElement) => {
    const to = stepped.current;
    if (to && to.top === null) land(box);
    else if (to && Math.abs(box.scrollTop - to.top!) > 1) stepped.current = null;
    const now = placeIn(box, total, stepped.current?.index);
    setPlace((was) => was.index === now.index && was.prev === now.prev && was.next === now.next ? was : now);
  };
  const reading = useRef(read);
  reading.current = read;
  useEffect(() => {
    const box = scroller.current;
    const ports = port.current;
    stepped.current = null;
    setSaid("");
    if (!box || total < 2) return;
    const hear = () => reading.current(box);
    hear();
    box.addEventListener("scroll", hear, { passive: true });
    window.addEventListener("resize", hear);
    ports.drawn = hear;
    return () => {
      box.removeEventListener("scroll", hear);
      window.removeEventListener("resize", hear);
      if (ports.drawn === hear) ports.drawn = undefined;
    };
  }, [scroller, total, version, port]);
  if (total < 2) return null;
  const step = (direction: -1 | 1) => {
    const box = scroller.current;
    if (!box) return;
    const now = placeIn(box, total, stepped.current?.index);
    const here = groupOf(box, now.index);
    const within = direction < 0 && here !== null && box.scrollTop > topIn(box, here) + 1;
    const index = Math.max(0, Math.min(total - 1, within ? now.index : now.index + direction));
    stepped.current = { index, top: null };
    read(box);
    setSaid(t("workspace.hunkSaid", { index: index + 1, total }));
  };
  return <span className="workspace-hunk-nav" role="group" aria-label={t("workspace.hunkNav")}>
    <Button className="icon-btn workspace-tool" aria-label={t("workspace.prevHunk")} title={t("workspace.prevHunk")} disabled={!place.prev}
      onClick={() => step(-1)}><ArrowUp size={16} aria-hidden="true" /></Button>
    <span className="workspace-hunk-where" aria-hidden="true">{t("workspace.hunkPosition", { index: place.index + 1, total })}</span>
    <Button className="icon-btn workspace-tool" aria-label={t("workspace.nextHunk")} title={t("workspace.nextHunk")} disabled={!place.next}
      onClick={() => step(1)}><ArrowDown size={16} aria-hidden="true" /></Button>
    <span className="sr-only" aria-live="polite">{said}</span>
  </span>;
}
