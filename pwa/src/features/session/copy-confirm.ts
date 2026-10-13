import { COPIED_MS } from "../../shared/react/use-copied";

/**
 * A copy in the session is confirmed on the control that was pressed.
 *
 * A banner above the transcript or the buffer takes its own height from them
 * and pushes every line down for as long as it shows: the next press, aimed at
 * the block below or at the reply's own button, lands on whatever moved under
 * the pointer, and the clipboard keeps the first copy while the banner still
 * says "copied". The pressed control changes instead, where the reader is
 * looking, and nothing else moves. Each press confirms itself again.
 */

export { COPIED_MS, useCopied } from "../../shared/react/use-copied";

const reverting = new WeakMap<HTMLElement, number>();

function show(cell: HTMLElement, state: "idle" | "copied"): void {
  cell.dataset.state = state;
  for (const face of cell.children) face.setAttribute("aria-hidden", String(!face.classList.contains(`is-${state}`)));
}

/**
 * The two faces of a copy button outside React (a code block's own, added to
 * sanitized HTML): the markup `CopyAck` renders, so the same rules draw it. The
 * button is as wide as the wider label from the start, and the line beside it
 * is laid out once.
 */
export function layCopyFaces(button: HTMLElement, label: string, copied: string): HTMLElement {
  const cell = button.ownerDocument.createElement("span");
  cell.className = "copy-ack";
  for (const [name, text] of [["is-idle", label], ["is-copied", copied]]) {
    const face = button.ownerDocument.createElement("span");
    face.className = `copy-ack-face ${name}`;
    face.textContent = text;
    cell.append(face);
  }
  show(cell, "idle");
  button.replaceChildren(cell);
  return cell;
}

/**
 * Confirm a copy on such a button: it shows `copied` for `ms` in the place of
 * `label`, and `announce` is what a screen reader hears. A button that was not
 * laid out with its faces gets them here.
 */
export function confirmCopyOn(button: HTMLElement, label: string, copied: string, announce: string, ms = COPIED_MS): void {
  const pending = reverting.get(button);
  if (pending !== undefined) window.clearTimeout(pending);
  const cell = button.querySelector<HTMLElement>(".copy-ack") ?? layCopyFaces(button, label, copied);
  show(cell, "copied");
  button.setAttribute("aria-label", announce);
  reverting.set(button, window.setTimeout(() => {
    reverting.delete(button);
    show(cell, "idle");
    button.removeAttribute("aria-label");
  }, ms));
}
