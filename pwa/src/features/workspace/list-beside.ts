import { useSyncExternalStore } from "react";
import { ROOMY_QUERY } from "../../app/viewport";

/**
 * The screen shows the list and the open file together from 900px. The style
 * sheet makes that arrangement on the same query (`workspace.scss`), so the
 * header, the list's breadcrumb trail and the layout change together. Not the
 * two sides of a diff next to each other: that is `diff-layout`.
 */

function subscribe(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(ROOMY_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function listBeside(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(ROOMY_QUERY).matches;
}

export function useListBeside(): boolean {
  return useSyncExternalStore(subscribe, listBeside);
}
