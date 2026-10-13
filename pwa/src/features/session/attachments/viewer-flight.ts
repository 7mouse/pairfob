import { MOTION_MS, prefersReducedMotion } from "../../../shared/ui/dom/motion";
import { playMove } from "../measured-move";

/**
 * The viewer opening out of a thumbnail and closing back into it.
 *
 * The viewer is a black screen over the session. Cut to in one frame it was a
 * flash in a dark room, and nothing said the large picture was the small one
 * just pressed. So the ground fades in (attachment-viewer.scss) while the
 * picture grows from the thumbnail to its place, and closing plays that back:
 * the picture returns to its thumbnail as the ground fades away.
 *
 * The flight is the picture's own, measured between two boxes: the thumbnail's
 * and the one the viewer lays the picture out in. A thumbnail shows the middle
 * of its picture cropped square, so the picture is cut to that part while it
 * is that size. With no thumbnail on screen to fly from or to (opened another
 * way, scrolled out of the strip, a file with no picture) there is only the
 * fade, and so there is for a reader who asked for less motion.
 */

/** A thumbnail's box on the page and its corner, as the flight needs them. */
export type FlightEnd = { left: number; top: number; width: number; height: number; radius: number };

type Box = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** The end of a flight at `chip`, or null when it is not on screen to be seen. */
export function flightEnd(chip: Element | null | undefined): FlightEnd | null {
  const view = chip?.ownerDocument.defaultView;
  if (!chip || !view || !chip.isConnected) return null;
  const box = chip.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  if (box.right <= 0 || box.bottom <= 0 || box.left >= view.innerWidth || box.top >= view.innerHeight) return null;
  const radius = Number.parseFloat(view.getComputedStyle(chip).borderTopLeftRadius) || 0;
  return { left: box.left, top: box.top, width: box.width, height: box.height, radius };
}

/** The thumbnail a file is drawn as in the tray, wherever the tray is. */
export function chipOf(doc: Document, localId: string): Element | null {
  return [...doc.querySelectorAll<HTMLElement>("[data-att]")].find((chip) => chip.dataset.att === localId) ?? null;
}

const AT_REST: Keyframe = { transform: "none", clipPath: "inset(0px 0px round 0px)" };

/**
 * The picture drawn as its thumbnail: moved onto it, scaled until it covers
 * it, and cut to the part the thumbnail shows. `picture` is the box the viewer
 * lays it out in, with no move on it.
 */
export function asThumbnail(picture: Box, chip: FlightEnd): Keyframe {
  const scale = Math.max(chip.width / picture.width, chip.height / picture.height);
  const dx = chip.left + chip.width / 2 - (picture.left + picture.width / 2);
  const dy = chip.top + chip.height / 2 - (picture.top + picture.height / 2);
  const cutX = Math.max(0, (picture.width - chip.width / scale) / 2);
  const cutY = Math.max(0, (picture.height - chip.height / scale) / 2);
  return {
    transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(4)})`,
    clipPath: `inset(${cutY.toFixed(1)}px ${cutX.toFixed(1)}px round ${(chip.radius / scale).toFixed(1)}px)`,
  };
}

function laidOut(picture: HTMLElement): Box | null {
  const box = picture.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

/** Grow the picture from the thumbnail it was opened from. Null when there is nothing to play. */
export function growFromThumbnail(picture: HTMLElement, from: FlightEnd): Animation | null {
  const box = laidOut(picture);
  return box ? playMove(picture, [asThumbnail(box, from), AT_REST], MOTION_MS.screen) : null;
}

/** How long a closing viewer is kept: its picture's flight home, or the short fade a reduced-motion reader gets. */
export function viewerExitMs(): number {
  return prefersReducedMotion() ? MOTION_MS.press : MOTION_MS.panel;
}

/**
 * Close the viewer: mark the dialog as closing (the ground and the bars fade
 * on that mark), send the picture back to its thumbnail if that is on screen,
 * and call `done` when the exit is over. A second request while it is closing
 * changes nothing.
 */
export function closeViewer(dialog: HTMLDialogElement | null, done: () => void): void {
  if (!dialog?.open) {
    done();
    return;
  }
  if (dialog.dataset.phase === "closing") return;
  dialog.dataset.phase = "closing";
  const picture = dialog.querySelector<HTMLElement>(".attach-viewer-img");
  const home = picture?.dataset.item ? flightEnd(chipOf(dialog.ownerDocument, picture.dataset.item)) : null;
  if (picture && home) {
    // Measured as the viewer lays it out: a picture still arriving is taken off its way in first.
    for (const move of picture.getAnimations?.() ?? []) move.cancel();
    const box = laidOut(picture);
    if (box) playMove(picture, [AT_REST, asThumbnail(box, home)], MOTION_MS.panel, { fill: "forwards" });
  }
  window.setTimeout(done, viewerExitMs());
}
