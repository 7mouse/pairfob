import { CheckCheck, ChevronRight, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { t } from "../../../lib/i18n";
import { useKeptList, usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { AgentAvatar, Button, Fold, Swap } from "../../../shared/ui/primitives";
import type { HerdAttentionItem } from "../model/herd-view";

const ticketKey = (item: HerdAttentionItem) => item.paneId;

/** One notch of a line-mode wheel, in pixels. */
const WHEEL_LINE_PX = 16;

/**
 * Turn an up-down wheel over the strip into sideways travel. A sideways wheel
 * (a trackpad, Shift held) already scrolls it natively and is left alone, as is
 * a strip with nothing more to show in that direction.
 */
function wheelSideways(strip: HTMLElement, event: WheelEvent): void {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? strip.clientWidth : 1;
  const max = strip.scrollWidth - strip.clientWidth;
  const next = Math.max(0, Math.min(max, strip.scrollLeft + event.deltaY * unit));
  if (max <= 0 || next === strip.scrollLeft) return;
  event.preventDefault();
  strip.scrollLeft = next;
}

/**
 * The strip's one action, held at its end while the tickets scroll: on the
 * rail "mark all read" while a completion is unread, then for a few seconds its
 * undo. On the phone the action lives in the sheet behind the label and only
 * its undo comes back here. Either one keeps the strip open, so an undo stays
 * in sight even when the last ticket has left.
 */
export type AttentionReadAll = { count: number; onReadAll: () => void };
export type AttentionUndo = { count: number; onUndo: () => void };

/**
 * "Needs you" shortcuts. Each ticket opens its pane directly; the rows stay in
 * their own workspace, so this strip never changes the list's structure.
 *
 * The wrapper is a fold that is shut while nothing waits on the reader and
 * while the header has folded it away: the first ticket opens it and the last
 * one shuts it by height, so the list under it is moved, not jumped. The strip
 * inside is drawn while there is a ticket and for as long as the fold takes to
 * shut over the last one. A ticket that joins a strip already drawn comes in by
 * width and one that goes is kept for its way out (`is-entering` /
 * `is-leaving`); the count marks its own change. Shut, the strip is out of
 * reach, as is a ticket on its way out.
 */
export function AttentionStrip({ items, onOpen, onLocate, onShowAll, hidden = false, wheel = false, readAll = null, undo = null }: {
  items: readonly HerdAttentionItem[];
  /** Offered while a completion is unread; the undo takes its place once pressed. */
  readAll?: AttentionReadAll | null;
  undo?: AttentionUndo | null;
  /** The ticket is handed over so it can grow into the pane it opens. */
  onOpen: (paneId: string, source: HTMLElement) => void;
  /**
   * The desktop rail's label is a button: it walks the list to the next row
   * that needs the reader without opening it.
   */
  onLocate?: () => void;
  /**
   * The phone's label is a button too: it opens every waiting session as a
   * list, with "mark all read" under them (`attention-sheet.tsx`).
   */
  onShowAll?: (anchor: HTMLElement) => void;
  /** Folded away with the header: still laid out for the transition, not reachable. */
  hidden?: boolean;
  /**
   * The rail's frame does not scroll, so an up-down wheel over the strip has
   * nothing else to move: it walks the tickets. On the phone page the same
   * wheel scrolls the list and the strip leaves it alone.
   */
  wheel?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const shown = items.length > 0 || undo !== null;
  const drawn = usePresence(shown, MOTION_MS.panel).mounted;
  const tickets = useKeptList(items, ticketKey, MOTION_MS.element);
  // A strip shutting over its last ticket still says how many there were.
  const count = useRef(items.length);
  if (shown) count.current = items.length;
  // ...and still ends the way it was drawn, not with "needs you 0" or no button.
  const kept = useRef({ readAll, undo });
  if (shown) kept.current = { readAll, undo };
  const ends = kept.current;
  useEffect(() => {
    const node = strip.current;
    if (!wheel || !node) return;
    // Bound natively: React's wheel listeners are passive and cannot keep the page still.
    const onWheel = (event: WheelEvent) => wheelSideways(node, event);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [wheel, drawn]);
  const label = <>
    {t("list.needsYouTitle")}
    <Swap on={count.current} className="attn-count">{count.current}</Swap>
  </>;
  const done = ends.undo ? t("list.readAllDone", { count: String(ends.undo.count) }) : "";
  // One button for both, so the focus a key press gave it survives the swap.
  const { undo: undoing, readAll: reading } = ends;
  const trailing = undoing ? (
    <Button className="attn-read-all is-undo" aria-label={t("list.readAllUndoAria", { count: String(undoing.count) })}
      onClick={undoing.onUndo}>
      <Undo2 size={16} aria-hidden="true" />
      <span className="attn-read-all-label">{t("list.readAllUndo")}</span>
    </Button>
  ) : reading ? (
    <Button className="attn-read-all" aria-label={t("list.readAllAria", { count: String(reading.count) })}
      title={t("list.readAll")} onClick={reading.onReadAll}>
      <CheckCheck size={16} aria-hidden="true" />
      <span className="attn-read-all-label">{t("list.readAll")}</span>
    </Button>
  ) : null;
  return (
    <Fold className="attn-wrap" open={shown && !hidden}>
      {drawn ? <div className={`attn-bar${trailing ? " has-action" : ""}`}><div ref={strip} className="attn-strip" role="group" aria-label={t("list.needsYouAria")}>
        {/* Nothing left to show but the undo: the strip says what was done instead. */}
        {undoing && !items.length ? <span className="attn-strip-note">{done}</span> : onLocate ? (
          <Button className="attn-strip-label" aria-label={t("rail.nextAttention", { count: String(count.current) })}
            onClick={onLocate}>{label}</Button>
        ) : onShowAll ? (
          <Button className="attn-strip-label is-more" aria-haspopup="dialog"
            aria-label={t("list.needsYouAll", { count: String(count.current) })}
            onClick={(event) => onShowAll(event.currentTarget)}>
            {label}<ChevronRight className="attn-strip-more" size={14} aria-hidden="true" />
          </Button>
        ) : <span className="attn-strip-label">{label}</span>}
        {tickets.map(({ item, entering, leaving }) => (
          <Button key={item.paneId} data-pane-id={item.paneId} inert={leaving}
            className={`attn-ticket is-${item.kind}${entering ? " is-entering" : ""}${leaving ? " is-leaving" : ""}`}
            onClick={(event) => onOpen(item.paneId, event.currentTarget)}>
            <AgentAvatar kind={item.agentKind} size="sm" />
            <span className="attn-ticket-name">{item.title}</span>
            {item.workspace ? <span className="attn-ticket-ws">{item.workspace}</span> : null}
            <span className={`attn-ticket-dot is-${item.kind}`} aria-hidden="true" />
          </Button>
        ))}
      </div>{trailing}</div> : null}
      {/* Said once when the reads land; the strip is open then, as the press was on it. */}
      <span className="sr-only" role="status" aria-live="polite">{done}</span>
    </Fold>
  );
}
