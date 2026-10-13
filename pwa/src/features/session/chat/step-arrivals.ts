import type { AgentTraceItem } from "../../../lib/operations";

/**
 * Which of a card's steps are news.
 *
 * A card is drawn again by every poll, when older history loads in front of
 * it, when the reader filters it and when React remounts it. Only one of those
 * is a step the agent just took: the list the card already showed, with more at
 * its end. Everything else is the same work drawn again and must stay still.
 */

export type StepsSeen = {
  /** What makes two lists different lists: the filter, how much older history stands in front. */
  scope: string;
  count: number;
  first?: AgentTraceItem;
  last?: AgentTraceItem;
};

export function seenSteps(steps: readonly AgentTraceItem[], scope: string): StepsSeen {
  return { scope, count: steps.length, first: steps[0], last: steps[steps.length - 1] };
}

/**
 * The same step a poll later. A tool keeps its call, and its record's time and
 * body reference where the daemon sends them; a note may have grown.
 */
function sameStep(before: AgentTraceItem | undefined, after: AgentTraceItem | undefined): boolean {
  if (!before || !after || before.type !== after.type) return false;
  if (before.type !== "tool") return (after.text || "").startsWith(before.text || "");
  if (before.at !== undefined && after.at !== undefined && before.at !== after.at) return false;
  if (before.detailRef && after.detailRef && before.detailRef !== after.detailRef) return false;
  return before.name === after.name && before.input === after.input && before.label === after.label;
}

/**
 * The index from which `steps` were added to the list last `seen`, or
 * `steps.length` when none were: the same list, a shorter one, another scope,
 * or steps put in front (older history reaching into a turn shifts every
 * index, and its newest step is not new).
 */
export function arrivedFrom(seen: StepsSeen, steps: readonly AgentTraceItem[], scope: string): number {
  if (scope !== seen.scope || steps.length <= seen.count) return steps.length;
  if (seen.count === 0) return 0;
  if (!sameStep(seen.first, steps[0]) || !sameStep(seen.last, steps[seen.count - 1])) return steps.length;
  return seen.count;
}
