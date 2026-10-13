import { prefersReducedMotion } from "../../../shared/ui/dom/motion";

/**
 * The glide to the latest turn after a send.
 *
 * A reader who was at the tail when they sent stays in one conversation: the
 * transcript scrolls the new prompt in instead of being replaced by a frame
 * that already has it. While that scroll runs the stream is short of its tail
 * by construction, and everything that asks "is the reader at the tail" would
 * read it as the reader having left: the follow would drop, the next poll would
 * keep the old place and the prompt would stop halfway. So the glide is a
 * state the stream's readers can ask about, and anything that pins the tail
 * meanwhile retargets it instead of cutting it short with a jump.
 *
 * The reader's own scroll ends it at once: they are where they chose to be.
 */

/** A browser's smooth scroll states no length; past this it is over, whatever became of it. */
const GLIDE_LIMIT_MS = 1200;

let glide: { stream: HTMLElement; end: () => void; target: number } | null = null;

/** True while `stream` is on its way to the tail by `glideToTail`. */
export function glidingToTail(stream: HTMLElement | null): boolean {
  return glide !== null && glide.stream === stream;
}

export function endTailGlide(): void {
  glide?.end();
}

function begin(stream: HTMLElement): void {
  glide?.end();
  const bound = new AbortController();
  const timer = window.setTimeout(() => end(), GLIDE_LIMIT_MS);
  const end = (): void => {
    window.clearTimeout(timer);
    bound.abort();
    if (glide?.stream === stream) glide = null;
  };
  const options = { signal: bound.signal, passive: true };
  stream.addEventListener("scrollend", end, options);
  // For an engine without `scrollend`: arrived is over. Not sooner, or a pin would jump the last of the way.
  stream.addEventListener("scroll", () => {
    if (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 1) end();
  }, options);
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) stream.addEventListener(type, end, options);
  glide = { stream, end, target: -1 };
}

/**
 * Scroll `stream` to its tail as one move. Under reduced motion, or where the
 * engine cannot scroll smoothly, it is the jump it always was.
 */
export function glideToTail(stream: HTMLElement): void {
  if (prefersReducedMotion() || typeof stream.scrollTo !== "function") {
    endTailGlide();
    stream.scrollTop = stream.scrollHeight;
    return;
  }
  if (!glidingToTail(stream)) begin(stream);
  if (glide) glide.target = stream.scrollHeight;
  stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
  // Nothing to travel (or an engine that moved at once): there is no glide to protect.
  if (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 1) endTailGlide();
}

/**
 * Pin `stream` to its tail: at once, or through the glide already under way.
 * A glide is only sent again when the tail itself moved: starting the same
 * scroll over makes the engine ease in again, and the move would stutter.
 */
export function pinTail(stream: HTMLElement): void {
  if (!glidingToTail(stream)) stream.scrollTop = stream.scrollHeight;
  else if (glide?.target !== stream.scrollHeight) glideToTail(stream);
}
