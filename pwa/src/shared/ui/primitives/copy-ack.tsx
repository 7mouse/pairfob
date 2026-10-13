import type { ReactNode } from "react";

/**
 * The face of a copy button: its resting label and what it says once pressed,
 * stacked in one cell (`.copy-ack`, shared/ui/styles/motion-kit).
 *
 * The cell is as wide as the wider of the two, so confirming never moves the
 * line beside the button; the labels cross-fade in place and the confirmed one
 * takes the done colour. `state` is the caller's: `useCopied` (shared/react)
 * gives the usual 1.6 s. A failed copy is a third face, shown the same way.
 *
 * Put it inside the button. The face that is not showing is hidden from
 * assistive technology, so the button reads as one label.
 */
export function CopyAck({ state, idle, copied, failed }: {
  state: "idle" | "copied" | "failed";
  idle: ReactNode;
  copied: ReactNode;
  failed?: ReactNode;
}) {
  return <span className="copy-ack" data-state={state}>
    <span className="copy-ack-face is-idle" aria-hidden={state !== "idle"}>{idle}</span>
    <span className="copy-ack-face is-copied" aria-hidden={state !== "copied"}>{copied}</span>
    {failed === undefined ? null : <span className="copy-ack-face is-failed" aria-hidden={state !== "failed"}>{failed}</span>}
  </span>;
}
