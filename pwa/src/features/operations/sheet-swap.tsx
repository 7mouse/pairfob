import { useRef, type ReactNode } from "react";
import { useSheetHeight } from "../../shared/ui/overlay/sheet-height";

/**
 * One of the views a create sheet swaps in place: its form, or the full agent
 * list standing in for it. The list is not a pushed sheet page (the sheet
 * unmounts its root while a page is up, and the form must keep what was
 * chosen), so the card would jump from one view's height to the other's. Each
 * view mounts in one of these, keyed, and the card eases between the two
 * heights as the session panel's pages do.
 */
export function SheetSwap({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useSheetHeight(root);
  return <div ref={root} className="create-swap">{children}</div>;
}
