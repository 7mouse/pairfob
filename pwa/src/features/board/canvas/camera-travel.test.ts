import { resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { boardCamera, cameraTransform, type BoardCamera } from "../model/camera";
import { applyCameraTransform, easedShare, settleCamera, travelCamera } from "./transform";

/**
 * A camera asked for with one press travels: the record has it at once and the
 * stage reaches it over the panel duration, every frame a whole camera. Frames
 * are stepped by hand here so each one can be read.
 */
let frames = new Map<number, (now: number) => void>();
let serial = 0;
let clock = 0;
const real = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, match: globalThis.matchMedia };

/** Run the frame that is waiting, `ms` later. */
function frame(ms: number): void {
  clock += ms;
  const waiting = [...frames.values()];
  frames = new Map();
  for (const step of waiting) step(clock);
}

function rig() {
  const viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientWidth", { value: 800 });
  Object.defineProperty(viewport, "clientHeight", { value: 600 });
  const stage = document.createElement("div");
  stage.style.width = "400px";
  stage.style.height = "300px";
  viewport.append(stage);
  document.body.append(viewport);
  return stage;
}
const scaleOf = (stage: HTMLElement) => Number(stage.style.transform.match(/scale\(([\d.]+)\)/)![1]);

beforeEach(async () => {
  await resetBoardTestDOM();
  frames = new Map();
  serial = 0;
  clock = 1000;
  globalThis.requestAnimationFrame = ((step: (now: number) => void) => { frames.set(++serial, step); return serial; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof cancelAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = real.raf;
  globalThis.cancelAnimationFrame = real.caf;
  globalThis.matchMedia = real.match;
  for (const node of [...document.body.children]) if (node.id !== "app") node.remove();
});

test("the curve is the app's ease: it starts fast, ends level and never runs back", () => {
  expect(easedShare(0)).toBe(0);
  expect(easedShare(1)).toBe(1);
  // cubic-bezier(0.32, 0.72, 0, 1) is well past half way at half time.
  expect(easedShare(0.5)).toBeGreaterThan(0.85);
  expect(easedShare(0.5)).toBeLessThan(1);
  let last = 0;
  for (let step = 1; step <= 20; step++) {
    const share = easedShare(step / 20);
    expect(share).toBeGreaterThanOrEqual(last);
    last = share;
  }
});

test("a stage that shows nothing yet has nowhere to travel from: the camera is painted at once", () => {
  const stage = rig();
  const stored: BoardCamera[] = [];
  const camera = boardCamera(1.5, 10, 20, true);
  travelCamera(stage, camera, (next) => stored.push(next));
  expect(stored).toEqual([camera]);
  expect(stage.style.transform).toBe(cameraTransform(camera));
  expect(frames.size).toBe(0);
});

test("the record has the camera at once; the stage reaches it frame by frame, each frame a whole camera", () => {
  const stage = rig();
  const from = boardCamera(1, 100, 50, true);
  const to = boardCamera(2, 0, 0, true);
  applyCameraTransform(stage, from);
  const stored: BoardCamera[] = [];
  expect(travelCamera(stage, to, (next) => stored.push(next))).toEqual(to);
  expect(stored).toEqual([to]);
  expect(stage.style.transform).toBe(cameraTransform(from));
  frame(0);
  frame(MOTION_MS.panel / 2);
  const mid = scaleOf(stage);
  expect(mid).toBeGreaterThan(1);
  expect(mid).toBeLessThan(2);
  // The seams' counter-scale is that frame's own, not the destination's.
  expect(Number(stage.style.getPropertyValue("--board-control-scale"))).toBeCloseTo(1 / mid, 6);
  // Scale and pan go by the same share, so the point zoomed around holds still.
  const pan = Number(stage.style.transform.match(/translate\(([-\d.]+)px/)![1]);
  expect(pan).toBeCloseTo(100 * (2 - mid), 6);
  frame(MOTION_MS.panel);
  expect(stage.style.transform).toBe(cameraTransform(to));
  expect(frames.size).toBe(0);
});

test("a repaint with the camera being travelled to leaves the travel alone; any other camera ends it and wins", () => {
  const stage = rig();
  applyCameraTransform(stage, boardCamera(1, 0, 0, true));
  // 400×300 at 3 is larger than the 800×600 viewport, so there is room to pan.
  const to = boardCamera(3, 0, 0, true);
  travelCamera(stage, to, () => {});
  frame(0);
  frame(60);
  const onTheWay = stage.style.transform;
  // The canvas repaints with the record on every commit.
  applyCameraTransform(stage, boardCamera(3, 0, 0, true));
  expect(stage.style.transform).toBe(onTheWay);
  expect(frames.size).toBe(1);
  // A hand takes over: a pan is painted where the hand is.
  const panned = settleCamera(stage, boardCamera(3, -30, -10, true), () => {});
  expect(panned).toEqual({ scale: 3, panX: -30, panY: -10, fitted: true });
  expect(stage.style.transform).toBe(cameraTransform(panned));
  expect(frames.size).toBe(0);
  frame(MOTION_MS.panel);
  expect(stage.style.transform).toBe(cameraTransform(panned));
});

test("a second press travels on from where the stage is, not from where the first began", () => {
  const stage = rig();
  applyCameraTransform(stage, boardCamera(1, 0, 0, true));
  travelCamera(stage, boardCamera(2, 0, 0, true), () => {});
  frame(0);
  frame(60);
  const reached = scaleOf(stage);
  travelCamera(stage, boardCamera(1, 0, 0, true), () => {});
  expect(frames.size).toBe(1);
  frame(0);
  expect(scaleOf(stage)).toBeCloseTo(reached, 6);
  frame(MOTION_MS.panel);
  expect(scaleOf(stage)).toBe(1);
});

test("a reader who asked for less motion gets the camera at once", () => {
  globalThis.matchMedia = ((query: string) => ({ matches: query.includes("prefers-reduced-motion: reduce"), media: query,
    addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
  const stage = rig();
  applyCameraTransform(stage, boardCamera(1, 0, 0, true));
  const to = boardCamera(2, 0, 0, true);
  travelCamera(stage, to, () => {});
  expect(stage.style.transform).toBe(cameraTransform(to));
  expect(frames.size).toBe(0);
});
