import { deskPresentation } from "../../shared/ui/overlay/popover";

/**
 * The line a note belongs to takes the keyboard back.
 *
 * A note's cards stand under its line, and so does its editor. Answering one
 * can take away the control that was pressed: the card of a half-written note
 * leaves when it is saved, cancelled or opened into the editor; a saved note's
 * card leaves with the note. The pressed control is gone then, so focus falls
 * to <body> and the next Tab starts over from the top of the page.
 *
 * The line is what all of them belong to and it outlives them, so its number,
 * the line's own button, takes focus: the reader goes on from the line they
 * were writing on, with what is left under it one Tab away.
 *
 * Only for a mouse or the keyboard beside the list. A finger leaves focus on
 * <body> as everywhere, and so does a phone: a focused button there would only
 * bring a ring nobody asked for. And only when focus is still lost once the
 * answer has settled: a control that outlived the answer (the line itself, a
 * saved note's Edit) has it back by then and keeps it.
 */

/** What a line's number button is marked with (`DiffLineRow`): the pin a note on it would have. */
const NOTE_LINE = "data-note-line";

/** The number button of the line pinned by `pin`, in the diff that is on screen. */
function noteLine(pin: string): HTMLElement | null {
  // Read off the attribute: a path is not something to build a selector from.
  return [...document.querySelectorAll<HTMLElement>(`[${NOTE_LINE}]`)].find((line) =>
    line.getAttribute(NOTE_LINE) === pin && !line.closest("[inert]")
    && (typeof line.checkVisibility !== "function" || line.checkVisibility())) ?? null;
}

/**
 * Call as the reader answers a note's card, before the answer is committed:
 * what they pressed says whether a mouse or a key did it. `pin` is the note's
 * `diffNotePinKey`.
 */
export function returnToNoteLine(pin: string): void {
  if (!deskPresentation()) return;
  // Behind the commit, and ahead of the surface's keeper (`focus-keeper`),
  // which would rest on its way back. A question still open keeps its focus.
  window.setTimeout(() => {
    const now = document.activeElement;
    // The pressed control may still be on the page, in a card that is folding shut and out of reach.
    const lost = !now || now === document.body || !now.isConnected || now.closest("[inert]") !== null;
    if (!lost || document.querySelector("dialog[open]")) return;
    noteLine(pin)?.focus({ preventScroll: true });
  }, 0);
}
