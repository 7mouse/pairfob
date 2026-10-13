import { resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { useTrayHeight } from "./tray-fold";

/**
 * The open tray following its content's height. The test DOM has no layout, so
 * the height is a stub the test sets, and the move is the `animate` call.
 */
let height = 0;
const moves: Array<{ from: string; to: string; cancelled: boolean }> = [];

function Tray({ still = false }: { still?: boolean }) {
  const ref = useTrayHeight(still);
  return <div ref={(node) => {
    ref.current = node;
    if (!node) return;
    Object.defineProperty(node, "offsetHeight", { configurable: true, get: () => height });
    node.animate = ((frames: Keyframe[]) => {
      const move = { from: String(frames[0].height), to: String(frames[1].height), cancelled: false };
      moves.push(move);
      return { cancel() { move.cancelled = true; } };
    }) as unknown as typeof node.animate;
  }} />;
}

beforeEach(async () => { await resetBoardTestDOM(); height = 68; moves.length = 0; });
afterEach(() => unmountReact());

test("a first paint and a repaint at the same height move nothing", () => {
  renderReact(<Tray />);
  renderReact(<Tray />);
  expect(moves).toEqual([]);
});

test("another height while open eases from the one it had", () => {
  renderReact(<Tray />);
  height = 44;
  renderReact(<Tray />);
  expect(moves.map(({ from, to }) => [from, to])).toEqual([["68px", "44px"]]);
});

test("opening, shutting and the complete terminal are not this move, and the height met afterwards is a start", () => {
  renderReact(<Tray still />);
  height = 44;
  renderReact(<Tray still />);
  expect(moves).toEqual([]);
  // At rest again: what it measures now is where it starts from, not a change.
  renderReact(<Tray />);
  expect(moves).toEqual([]);
  height = 68;
  renderReact(<Tray />);
  expect(moves.map(({ from, to }) => [from, to])).toEqual([["44px", "68px"]]);
});
