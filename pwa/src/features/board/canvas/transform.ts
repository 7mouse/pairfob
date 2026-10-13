/**
 * Board camera DOM writes.
 *
 * The only place that measures a viewport and turns a pure camera transition
 * into a style write. Reading the camera and persisting the next one stay with
 * the caller, so this module never touches application state.
 *
 * A camera reaches the screen in one of two ways. `settleCamera` writes it at
 * once: everything a hand is moving (a pan, two fingers, a wheel) and
 * everything that only keeps the board in place (the first fit, a resized
 * box). `travelCamera` is for a camera asked for with one press (a zoom
 * button, the fit, a double click, a camera key): the stage travels there,
 * and every frame is a whole camera, so the seams, the title bars and the
 * panes' clear room stay in step with the scale on the way. Any camera written
 * meanwhile ends the travel where it is and wins.
 */
import { BOARD_CELL_H, fitBoardCamera, type TabLayout } from "../../../lib/layout";
import { MOTION_EASE_POINTS, MOTION_MS, motionMs } from "../../../shared/ui/dom/motion";
import {
  boardStageSize,
  cameraBetween,
  cameraInView,
  cameraTransform,
  fitCamera,
  sameCameraView,
  stageTallerThanView,
  wheelPanY,
  zoomCameraAt,
  type BoardCamera,
} from "../model/camera";

/** Title bar height on screen: herdr's one border row, kept between these two. */
export const BOARD_TITLE_MIN_PX = 14;
export const BOARD_TITLE_MAX_PX = 24;

/** The camera each stage shows now, which is where a travel starts from. */
const shown = new WeakMap<HTMLElement, BoardCamera>();
/** A stage on its way to a camera, and the frame that takes the next step. */
const travels = new WeakMap<HTMLElement, { to: BoardCamera; frame: number }>();

function endTravel(stage: HTMLElement): void {
  const travel = travels.get(stage);
  if (!travel) return;
  cancelAnimationFrame(travel.frame);
  travels.delete(stage);
}

/**
 * `--ease` as a function of time, 0 to 1, for a camera stepped frame by frame.
 * Solved by halving, which is exact enough for a frame and cannot diverge.
 */
const [EASE_X1, EASE_Y1, EASE_X2, EASE_Y2] = MOTION_EASE_POINTS;
export function easedShare(time: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const at = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (at(middle, EASE_X1, EASE_X2) < time) low = middle;
    else high = middle;
  }
  return at((low + high) / 2, EASE_Y1, EASE_Y2);
}

/**
 * Paint a camera now. The canvas repaints its stage on every commit with the
 * camera the record holds, which during a travel is the one being travelled
 * to: that repaint is not a new camera and leaves the travel alone.
 */
export function applyCameraTransform(stage: HTMLElement, camera: BoardCamera): void {
  const travel = travels.get(stage);
  if (travel && sameCameraView(travel.to, camera)) return;
  endTravel(stage);
  paintCamera(stage, camera);
}

function paintCamera(stage: HTMLElement, camera: BoardCamera): void {
  shown.set(stage, camera);
  stage.style.transform = cameraTransform(camera);
  // Pane screens scale with the stage like herdr's own miniature. Controls
  // (handles, hints) counter-scale to keep their on-screen size at any zoom.
  stage.style.setProperty("--board-control-scale", String(1 / Math.max(0.01, camera.scale)));
  // Pane chrome (title bars) stays readable from the fit upwards, but below the
  // fit it shrinks with the screens, so zooming out never buries them under bars.
  const fit = fitScale(stage);
  const basis = fit > 0 ? Math.max(camera.scale, fit) : camera.scale;
  stage.style.setProperty("--board-chrome-scale", String(1 / Math.max(0.01, basis)));
  // The bar is herdr's border row: one terminal row tall, so it covers as little
  // of the screen under it as it can, but never unreadably thin or oversized.
  const title = Math.min(BOARD_TITLE_MAX_PX, Math.max(BOARD_TITLE_MIN_PX, BOARD_CELL_H * basis));
  stage.style.setProperty("--board-title-h", `${title}px`);
  // The same bar in stage pixels, as a bare number: what a pane's screen keeps
  // clear under it (`.board-pane-buffer`), where a length cannot be divided.
  stage.style.setProperty("--board-title-clear", String(title / Math.max(0.01, basis)));
}

/** The stage's own size as the canvas wrote it, or null before it has one. */
function stageSize(stage: HTMLElement): { width: number; height: number } | null {
  const width = parseFloat(stage.style.width);
  const height = parseFloat(stage.style.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The scale that fits the whole stage in its viewport, or 0 when it cannot be measured. */
function fitScale(stage: HTMLElement): number {
  const viewport = stage.parentElement;
  const size = stageSize(stage);
  if (!viewport || !size || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return 0;
  return fitBoardCamera(viewport.clientWidth, viewport.clientHeight, size.width, size.height).scale;
}

/** `cameraInView` for the stage on screen. A stage that cannot be measured is left as it is. */
export function cameraWithinViewport(stage: HTMLElement, camera: BoardCamera): BoardCamera {
  const viewport = stage.parentElement;
  const size = stageSize(stage);
  if (!viewport || !size) return camera;
  return cameraInView(camera, viewport.clientWidth, viewport.clientHeight, size);
}

/** `wheelPanY` for the stage on screen. A stage that cannot be measured has nothing to move to. */
export function wheelPanWithinViewport(stage: HTMLElement, camera: BoardCamera, deltaY: number): number {
  const viewport = stage.parentElement;
  const size = stageSize(stage);
  if (!viewport || !size) return 0;
  return wheelPanY(camera, viewport.clientHeight, size.height, deltaY);
}

/** `stageTallerThanView` for the stage on screen. A stage that cannot be measured is taken to fit. */
export function boardTallerThanViewport(stage: HTMLElement, camera: BoardCamera): boolean {
  const viewport = stage.parentElement;
  const size = stageSize(stage);
  if (!viewport || !size) return false;
  return stageTallerThanView(camera, viewport.clientHeight, size.height);
}

/**
 * The one way a camera reaches the screen: bounded to its viewport, handed to
 * `store`, then painted. Every pan, zoom, fit and reveal goes through here, so
 * none of them can slide the board out of sight. Returns what it settled on.
 */
export function settleCamera(stage: HTMLElement, camera: BoardCamera, store: (camera: BoardCamera) => void): BoardCamera {
  const next = cameraWithinViewport(stage, camera);
  store(next);
  applyCameraTransform(stage, next);
  return next;
}

/**
 * `settleCamera` for a camera asked for with one press: bounded and handed to
 * `store` at once, so every reader has it, and painted over `--dur-3`. A stage
 * that shows nothing yet, a reader who asked for less motion and a camera that
 * is already on screen are written straight away.
 */
export function travelCamera(stage: HTMLElement, camera: BoardCamera, store: (camera: BoardCamera) => void): BoardCamera {
  const next = cameraWithinViewport(stage, camera);
  const from = shown.get(stage);
  const duration = motionMs(MOTION_MS.panel);
  if (!from || !duration || sameCameraView(from, next) || typeof requestAnimationFrame !== "function") {
    store(next);
    applyCameraTransform(stage, next);
    return next;
  }
  endTravel(stage);
  let started = -1;
  const step = (now: number) => {
    if (started < 0) started = now;
    const time = (now - started) / duration;
    if (time >= 1 || !stage.isConnected) {
      travels.delete(stage);
      paintCamera(stage, next);
      return;
    }
    paintCamera(stage, cameraBetween(from, next, easedShare(time)));
    travel.frame = requestAnimationFrame(step);
  };
  const travel = { to: next, frame: requestAnimationFrame(step) };
  // Before the store: a subscriber's repaint with this camera must find the travel.
  travels.set(stage, travel);
  store(next);
  return next;
}

/** Fit the whole tab into the viewport; the result is a fitted camera. */
export function fitCameraToViewport(viewport: HTMLElement, layout: TabLayout): BoardCamera {
  return fitCamera(viewport.clientWidth, viewport.clientHeight, boardStageSize(layout));
}

/** Zoom around a client point. Null means the clamp rejected the change. */
export function zoomCameraAtPoint(
  camera: BoardCamera,
  viewport: HTMLElement,
  clientX: number,
  clientY: number,
  nextScale: number,
): BoardCamera | null {
  const rect = viewport.getBoundingClientRect();
  return zoomCameraAt(camera, { left: rect.left, top: rect.top }, clientX, clientY, nextScale);
}

export function viewportCenter(viewport: HTMLElement): { x: number; y: number } {
  const rect = viewport.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
