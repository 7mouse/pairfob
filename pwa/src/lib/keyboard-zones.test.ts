import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../test-support/dom";
import { expectSameNode } from "../../test-support/node-identity";
import { bindKeyboardZones, heldKeyboardZone, keyboardMoves } from "./dom";

/**
 * Which column holds the keyboard while focus rests on the page: the one the
 * reader last pressed or focused in. The line that sizes a column lies between
 * two of them, and moving it chooses neither.
 */

let release = () => {};
let page: HTMLElement;

beforeEach(async () => {
  await resetBoardTestDOM();
  // A page of its own, taken away afterwards: the zones are matched under any `#app`.
  page = document.createElement("div");
  page.id = "app";
  page.className = "desk inspector";
  page.innerHTML = `
    <nav class="rail"><button id="row">row</button></nav>
    <section class="main"><button id="send">send</button></section>
    <div class="column-divider" role="separator" tabindex="0"><span class="column-divider-knob"></span></div>
    <aside class="inspector"><p id="line">a diff line</p></aside>`;
  document.body.append(page);
  release = bindKeyboardZones(document);
});
afterEach(() => {
  release();
  page.remove();
});

const at = (selector: string) => page.querySelector<HTMLElement>(selector)!;
const pressOn = (selector: string) => at(selector).dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event);
const focusOn = (selector: string) => at(selector).dispatchEvent(new happy.FocusEvent("focusin", { bubbles: true }) as unknown as Event);

describe("keyboard zones", () => {
  test("a press in a column gives it the keyboard, and a press in the session takes it back", () => {
    pressOn("#line");
    expectSameNode(heldKeyboardZone(), at("aside.inspector"));
    pressOn("#send");
    expect(heldKeyboardZone()).toBeNull();
    pressOn("#row");
    expectSameNode(heldKeyboardZone(), at(".rail"));
  });

  test("pressing or focusing the line that sizes a column leaves the keyboard where it was", () => {
    pressOn("#line");
    const moves = keyboardMoves();
    // The press lands on the line, or on the knob drawn on it.
    pressOn(".column-divider");
    pressOn(".column-divider-knob");
    focusOn(".column-divider");
    expectSameNode(heldKeyboardZone(), at("aside.inspector"));
    // Nor is it a move of the reader's: whatever was handed the keyboard still has it.
    expect(keyboardMoves()).toBe(moves);
  });

  test("with the session holding the keyboard, moving the line gives it to no column either", () => {
    pressOn("#send");
    pressOn(".column-divider");
    expect(heldKeyboardZone()).toBeNull();
  });
});
