import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../test-support/dom";
import { moveKeyboardToColumn } from "./column-keys";
import { appRoot } from "./dom-root";

/**
 * F6 from the line that sizes a column. Tab stops at the line, and it is in
 * neither of the columns it parts: on from it is the column after it, back is
 * the one before.
 */

let app: HTMLElement;
let added: Element[];
let classes: string;

beforeEach(async () => {
  await resetBoardTestDOM();
  happy.happyDOM.setWindowSize({ width: 1440, height: 900 });
  app = appRoot();
  classes = app.className;
  app.className = "desk inspector";
  const columns = document.createElement("template");
  columns.innerHTML = `
    <nav class="rail"><button id="row" aria-current="true">row</button></nav>
    <section class="main"><button id="header">header</button></section>
    <div class="column-divider" role="separator" tabindex="0"></div>
    <aside class="inspector"><button id="tab" aria-selected="true">changes</button></aside>`;
  added = [...columns.content.children];
  app.append(...added);
});
afterEach(() => {
  // The page is as it was found: the next file's tests look for these classes too.
  for (const node of added) node.remove();
  app.className = classes;
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

const line = () => app.querySelector<HTMLElement>(":scope > .column-divider")!;
const column = () => (document.activeElement as HTMLElement).closest(".rail, .main, .inspector")?.className;

describe("F6 from the line between two columns", () => {
  test("goes on to the column after the line", () => {
    line().focus();
    moveKeyboardToColumn(1);
    expect(column()).toBe("inspector");
    expect(document.activeElement?.id).toBe("tab");
  });

  test("with Shift goes back to the column before it", () => {
    line().focus();
    moveKeyboardToColumn(-1);
    expect(column()).toBe("main");
  });

  test("from inside a column it still steps column by column", () => {
    app.querySelector<HTMLElement>("#tab")!.focus();
    moveKeyboardToColumn(1);
    expect(column()).toBe("rail");
    moveKeyboardToColumn(-1);
    expect(column()).toBe("inspector");
  });
});
