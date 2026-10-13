import { beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { diffStops } from "./diff-line-stops";

beforeEach(async () => { await resetBoardTestDOM(); });

test("the lines of a hunk on its way shut are still drawn and are no stop of the arrows' path", () => {
  const box = document.createElement("div");
  box.innerHTML = `
    <button class="diff-stop">head 1</button>
    <div class="fold is-shut" inert><div class="fold-body"><button class="diff-comment-btn">folding line</button></div></div>
    <button class="diff-stop">head 2</button>
    <div class="fold"><div class="fold-body"><button class="diff-comment-btn">line</button></div></div>`;
  document.body.append(box);
  expect(diffStops(box).map((stop) => stop.textContent)).toEqual(["head 1", "head 2", "line"]);
  expect(diffStops(null)).toEqual([]);
  box.remove();
});
