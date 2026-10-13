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
export function AttentionStrip({ items, onOpen, onLocate, hidden = false, wheel = false }: {
  items: readonly HerdAttentionItem[];
  /** The ticket is handed over so it can grow into the pane it opens. */
  onOpen: (paneId: string, source: HTMLElement) => void;
  /**
   * The desktop rail's label is a button: it walks the list to the next row
   * that needs the reader without opening it. The phone label stays plain text.
   */
  onLocate?: () => void;
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
  const shown = items.length > 0;
  const drawn = usePresence(shown, MOTION_MS.panel).mounted;
  const tickets = useKeptList(items, ticketKey, MOTION_MS.element);
  // A strip shutting over its last ticket still says how many there were.
  const count = useRef(items.length);
  if (shown) count.current = items.length;
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
  return (
    <Fold className="attn-wrap" open={shown && !hidden}>
      {drawn ? <div ref={strip} className="attn-strip" role="group" aria-label={t("list.needsYouAria")}>
        {onLocate ? (
          <Button className="attn-strip-label" aria-label={t("rail.nextAttention", { count: String(count.current) })}
            onClick={onLocate}>{label}</Button>
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
      </div> : null}
    </Fold>
  );
}
