import { type DetailsState } from "./details";

export type { DetailsState } from "./details";
export { chatDetailsState, emptyDetailsState } from "./details";
export type { AgentEmptyKind, AgentEmptySpec } from "./model";

/** Test/legacy DOM snapshot. Production chat must not call this during render. */
export function readDetailsState(stream: HTMLElement | null): DetailsState {
  const open = new Set<string>();
  const closed = new Set<string>();
  if (!stream) return { open, closed };
  for (const card of stream.querySelectorAll<HTMLElement>("[data-key]")) {
    const key = card.dataset.key;
    if (!key) continue;
    if (card.dataset.autoOpen === "1") {
      if (card.dataset.user === "closed") closed.add(key);
      else if (card.dataset.user === "open") open.add(key);
      continue;
    }
    if (card.dataset.user === "closed") closed.add(key);
    else if (card.dataset.user === "open" || card.firstElementChild?.getAttribute("aria-expanded") === "true") open.add(key);
  }
  return { open, closed };
}
