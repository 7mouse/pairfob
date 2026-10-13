import { expectSameNode } from "../../../../test-support/node-identity";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { asThumbnail, chipOf, closeViewer, flightEnd, growFromThumbnail, viewerExitMs, type FlightEnd } from "./viewer-flight";

/**
 * The viewer's picture flying between its thumbnail and its place: where the
 * flight starts, when there is none, and what closing waits for.
 */

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

type Move = { frames: Keyframe[]; duration: number; fill?: string; cancelled: boolean };

function recordMoves(element: HTMLElement, moves: Move[]): void {
  const running: Array<{ cancel: () => void }> = [];
  Object.assign(element, {
    animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const move: Move = { frames, duration: Number(options.duration), fill: options.fill, cancelled: false };
      moves.push(move);
      const handle = { cancel: () => { move.cancelled = true; } };
      running.push(handle);
      return handle;
    },
    getAnimations: () => running,
  });
}

function chipAt(id: string, rect: DOMRect): HTMLElement {
  const chip = document.createElement("button");
  chip.dataset.att = id;
  chip.style.borderRadius = "12px";
  chip.getBoundingClientRect = () => rect;
  document.body.append(chip);
  return chip;
}

/** An open viewer dialog whose picture is laid out at `rect`. */
function viewer(item: string | null, rect: DOMRect): { dialog: HTMLDialogElement; picture: HTMLImageElement | null; moves: Move[] } {
  const dialog = document.createElement("dialog");
  dialog.className = "attach-viewer";
  const moves: Move[] = [];
  let picture: HTMLImageElement | null = null;
  if (item) {
    picture = document.createElement("img");
    picture.className = "attach-viewer-img";
    picture.dataset.item = item;
    picture.getBoundingClientRect = () => rect;
    recordMoves(picture, moves);
    dialog.append(picture);
  }
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, picture, moves };
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

beforeEach(async () => {
  await resetBoardTestDOM();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

afterEach(() => {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("body > dialog.attach-viewer")) {
    dialog.close();
    dialog.remove();
  }
  for (const made of document.querySelectorAll("body > [data-att], body > dialog")) made.remove();
});

describe("where a flight ends", () => {
  test("at a thumbnail that is on screen, with its corner", () => {
    expect(flightEnd(chipAt("a", box(20, 700, 56, 56)))).toEqual({ left: 20, top: 700, width: 56, height: 56, radius: 12 });
  });

  test("nowhere for a thumbnail that is not there to be seen", () => {
    expect(flightEnd(null)).toBeNull();
    // Scrolled out of the strip, off either side of the screen.
    expect(flightEnd(chipAt("left", box(-80, 700, 56, 56)))).toBeNull();
    expect(flightEnd(chipAt("below", box(20, 900, 56, 56)))).toBeNull();
    // Not laid out at all.
    expect(flightEnd(chipAt("none", box(0, 0, 0, 0)))).toBeNull();
    const gone = chipAt("gone", box(20, 700, 56, 56));
    gone.remove();
    expect(flightEnd(gone)).toBeNull();
  });

  test("a file's thumbnail is found by its id, and one that left the tray is not", () => {
    const chip = chipAt("id with \"quotes\"", box(20, 700, 56, 56));
    expectSameNode(chipOf(document, "id with \"quotes\""), chip);
    expect(chipOf(document, "other")).toBeNull();
  });
});

describe("the picture drawn as its thumbnail", () => {
  const chip: FlightEnd = { left: 20, top: 700, width: 56, height: 56, radius: 12 };

  test("a wide picture covers the square and is cut to the middle the thumbnail shows", () => {
    // 360x180 centred at (195, 400); the thumbnail's centre is (48, 728).
    const frame = asThumbnail(box(15, 310, 360, 180), chip);
    // Scaled by its short side, so the square is covered: 56 / 180.
    expect(frame.transform).toBe("translate(-147.0px, 328.0px) scale(0.3111)");
    // 180px of its 360 show: 90 cut from each side, none from top and bottom; the corner is the thumbnail's at that scale.
    expect(frame.clipPath).toBe("inset(0.0px 90.0px round 38.6px)");
  });

  test("a tall picture is cut from the top and bottom instead", () => {
    const frame = asThumbnail(box(105, 100, 180, 600), chip);
    expect(frame.transform).toBe("translate(-147.0px, 328.0px) scale(0.3111)");
    expect(frame.clipPath).toBe("inset(210.0px 0.0px round 38.6px)");
  });

  test("opening grows from that to the picture at rest, over a screen's duration", () => {
    const picture = document.createElement("img");
    picture.getBoundingClientRect = () => box(15, 310, 360, 180);
    const moves: Move[] = [];
    recordMoves(picture, moves);
    growFromThumbnail(picture, chip);
    expect(moves).toHaveLength(1);
    expect(moves[0].duration).toBe(320);
    expect(moves[0].frames).toEqual([asThumbnail(box(15, 310, 360, 180), chip), { transform: "none", clipPath: "inset(0px 0px round 0px)" }]);
  });

  test("a picture with no size yet has nothing to grow to", () => {
    const picture = document.createElement("img");
    picture.getBoundingClientRect = () => box(0, 0, 0, 0);
    const moves: Move[] = [];
    recordMoves(picture, moves);
    expect(growFromThumbnail(picture, chip)).toBeNull();
    expect(moves).toEqual([]);
  });
});

describe("closing the viewer", () => {
  test("marks the dialog, sends the picture home, and is done when the exit is over", async () => {
    chipAt("a", box(20, 700, 56, 56));
    const { dialog, moves } = viewer("a", box(15, 310, 360, 180));
    let done = 0;
    closeViewer(dialog, () => { done += 1; });
    expect(dialog.dataset.phase).toBe("closing");
    expect(done).toBe(0);
    expect(moves).toHaveLength(1);
    // Home at an exit's pace, one step shorter than it came, and it stays there until the dialog goes.
    expect([moves[0].duration, moves[0].fill]).toEqual([240, "forwards"]);
    expect(moves[0].frames[0]).toEqual({ transform: "none", clipPath: "inset(0px 0px round 0px)" });
    expect(moves[0].frames[1].transform).toBe("translate(-147.0px, 328.0px) scale(0.3111)");
    await wait(viewerExitMs() + 40);
    expect(done).toBe(1);
  });

  test("a second request while it is closing changes nothing", async () => {
    chipAt("a", box(20, 700, 56, 56));
    const { dialog, moves } = viewer("a", box(15, 310, 360, 180));
    let done = 0;
    closeViewer(dialog, () => { done += 1; });
    closeViewer(dialog, () => { done += 1; });
    expect(moves).toHaveLength(1);
    await wait(viewerExitMs() + 40);
    expect(done).toBe(1);
  });

  test("a picture still arriving is taken off its way in before it is sent home", () => {
    chipAt("a", box(20, 700, 56, 56));
    const { dialog, picture, moves } = viewer("a", box(15, 310, 360, 180));
    growFromThumbnail(picture!, { left: 20, top: 700, width: 56, height: 56, radius: 12 });
    closeViewer(dialog, () => undefined);
    expect(moves.map((move) => move.cancelled)).toEqual([true, false]);
  });

  test("with no thumbnail on screen for the picture shown there is only the fade", async () => {
    chipAt("a", box(-80, 700, 56, 56));
    const { dialog, moves } = viewer("a", box(15, 310, 360, 180));
    let done = 0;
    closeViewer(dialog, () => { done += 1; });
    expect(dialog.dataset.phase).toBe("closing");
    expect(moves).toEqual([]);
    await wait(viewerExitMs() + 40);
    expect(done).toBe(1);
  });

  test("a file with no picture fades the same way", async () => {
    const { dialog } = viewer(null, box(0, 0, 0, 0));
    let done = 0;
    closeViewer(dialog, () => { done += 1; });
    expect(dialog.dataset.phase).toBe("closing");
    await wait(viewerExitMs() + 40);
    expect(done).toBe(1);
  });

  test("a dialog that is not open has no exit to wait for", () => {
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    let done = 0;
    closeViewer(dialog, () => { done += 1; });
    closeViewer(null, () => { done += 1; });
    expect(done).toBe(2);
    expect(dialog.dataset.phase).toBeUndefined();
  });
});
