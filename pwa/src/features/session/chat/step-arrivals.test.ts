import { describe, expect, test } from "bun:test";
import type { AgentTraceItem } from "../../../lib/operations";
import { arrivedFrom, seenSteps } from "./step-arrivals";

const read = (file: string, extra: Partial<AgentTraceItem> = {}): AgentTraceItem =>
  ({ type: "tool", name: "Read", input: `{"path":"${file}"}`, toolState: "done", ...extra });
const steps = [read("a.ts"), read("b.ts"), read("c.ts")];

describe("which steps of a card are news", () => {
  test("steps added at the end of the list the card showed are new, from the first of them", () => {
    const seen = seenSteps(steps, "all");
    expect(arrivedFrom(seen, [...steps, read("d.ts")], "all")).toBe(3);
    expect(arrivedFrom(seen, [...steps, read("d.ts"), read("e.ts")], "all")).toBe(3);
    // A card that had no step yet: every step it gets is one the agent just took.
    expect(arrivedFrom(seenSteps([], "all"), steps, "all")).toBe(0);
  });

  test("the same list drawn again is not news, whatever a poll rebuilt", () => {
    const seen = seenSteps(steps, "all");
    // A poll hands back new objects, a result that landed and a note that grew.
    const again = steps.map((step) => ({ ...step, output: "ok" }));
    expect(arrivedFrom(seen, again, "all")).toBe(again.length);
    expect(arrivedFrom(seen, steps.slice(0, 2), "all")).toBe(2);
  });

  test("older history put in front of a turn makes none of its steps new", () => {
    const seen = seenSteps(steps, "all");
    const withOlder = [read("older-1.ts"), read("older-2.ts"), ...steps];
    expect(arrivedFrom(seen, withOlder, "all")).toBe(withOlder.length);
    // Even when the page in front happens to start with the same call: the record's time tells them apart.
    const timed = steps.map((step, index) => ({ ...step, at: 1000 + index }));
    const twin = [{ ...timed[0], at: 10 }, { ...timed[1], at: 11 }, ...timed];
    expect(arrivedFrom(seenSteps(timed, "all"), twin, "all")).toBe(twin.length);
    // And the stream counts history loads into the scope, which settles it without looking at a step.
    expect(arrivedFrom(seenSteps(steps, "all:0"), [...steps, read("d.ts")], "all:1")).toBe(4);
  });

  test("another list in the card's place is not the old one grown", () => {
    const seen = seenSteps(steps, "all");
    const other = [read("x.ts"), read("y.ts"), read("z.ts"), read("w.ts")];
    expect(arrivedFrom(seen, other, "all")).toBe(other.length);
    // A filter is another list too.
    expect(arrivedFrom(seen, [...steps, read("d.ts")], "failed")).toBe(4);
  });

  test("a note that was still being written when the next step came is the same note", () => {
    const before: AgentTraceItem[] = [read("a.ts"), { type: "thinking", text: "Looking at" }];
    const after: AgentTraceItem[] = [read("a.ts"), { type: "thinking", text: "Looking at the layout" }, read("b.ts")];
    expect(arrivedFrom(seenSteps(before, "all"), after, "all")).toBe(2);
  });
});
