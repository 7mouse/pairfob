import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * The indicator of a settings segmented control (`.set-seg`): one thumb that
 * slides to the chosen segment, like the shared bar's.
 *
 * The shared bar places its indicator from an index and a count because its
 * segments are equal shares. These follow their words, so the thumb takes the
 * chosen segment's measured box instead. Render it as the bar's first child, so
 * the labels paint over it.
 *
 * It slides only for a choice. The first placement, and a box that moved
 * without a new choice (another language's words, a wider card), are written
 * still: nothing was chosen, so nothing travels.
 */
export function SegThumb() {
  const ref = useRef<HTMLSpanElement>(null);
  const chosen = useRef(-1);
  const place = useRef(() => {});
  place.current = () => {
    const thumb = ref.current;
    const bar = thumb?.parentElement;
    if (!thumb || !bar) return;
    const segments = [...bar.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("seg-item"));
    const index = segments.findIndex(segment => segment.classList.contains("on"));
    const segment = segments[index];
    // Nothing chosen, or a bar that is not laid out: the segment keeps its own ground.
    if (!segment || segment.offsetWidth <= 0) {
      thumb.classList.remove("is-placed");
      chosen.current = -1;
      return;
    }
    const x = `${segment.offsetLeft}px`;
    const w = `${segment.offsetWidth}px`;
    const slide = chosen.current >= 0 && chosen.current !== index;
    chosen.current = index;
    // The same box drawn again is not a write at all.
    if (thumb.classList.contains("is-placed") && thumb.style.getPropertyValue("--set-seg-x") === x
      && thumb.style.getPropertyValue("--set-seg-w") === w) return;
    thumb.classList.toggle("is-still", !slide);
    thumb.style.setProperty("--set-seg-x", x);
    thumb.style.setProperty("--set-seg-w", w);
    thumb.classList.add("is-placed");
    if (slide) return;
    // Commit the box without its transition before the transition is allowed again.
    void thumb.offsetWidth;
    thumb.classList.remove("is-still");
  };
  // After every render of the bar: the choice is a class the same commit wrote.
  useLayoutEffect(() => place.current());
  useEffect(() => {
    const bar = ref.current?.parentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => place.current());
    watch.observe(bar);
    for (const child of bar.children) if (child !== ref.current) watch.observe(child);
    return () => watch.disconnect();
  }, []);
  return <span ref={ref} className="set-seg-thumb" aria-hidden="true" />;
}
