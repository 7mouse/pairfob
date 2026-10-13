import { useRef, type FocusEvent, type ReactNode } from "react";
import { useSheetHeight } from "../../../shared/ui/overlay/sheet-height";

/** iOS reports the keyboard inset over several frames; look again once it has settled. */
const KEYBOARD_SETTLE_MS = 320;

/**
 * One page of the pane sheet. When a page replaces another (push, pop, or a
 * form swapping in its full agent list) the card eases from the old page's
 * height to the new one instead of jumping (`useSheetHeight`).
 *
 * A focused field is brought into view above the pinned footer once the soft
 * keyboard has finished sliding in.
 */
export function PanePage({ className = "", tall = false, children }: { className?: string; tall?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useSheetHeight(root);
  const reveal = (event: FocusEvent) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    const show = () => { if (document.activeElement === field) field.scrollIntoView?.({ block: "nearest" }); };
    window.setTimeout(show, KEYBOARD_SETTLE_MS);
    window.visualViewport?.addEventListener("resize", show, { once: true });
  };
  return <div ref={root} className={["pane-page", tall && "is-tall", className].filter(Boolean).join(" ")} onFocus={reveal}>
    {children}
  </div>;
}
