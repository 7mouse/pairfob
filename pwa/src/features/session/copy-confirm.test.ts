import { expectSameNode } from "../../../test-support/node-identity";
import { happy, resetTestDOM } from "../../../test-support/boot-dom";
import { beforeEach, expect, test } from "bun:test";
import { confirmCopyOn, layCopyFaces } from "./copy-confirm";

beforeEach(async () => { await resetTestDOM(); });

function button(): HTMLElement {
  const node = happy.document.createElement("button") as unknown as HTMLElement;
  happy.document.body.append(node as never);
  return node;
}
const state = (node: HTMLElement): unknown[] => [
  node.querySelector(".copy-ack")?.getAttribute("data-state"),
  [...node.querySelectorAll(".copy-ack-face")].map((face) => `${face.className}:${face.textContent}:${face.getAttribute("aria-hidden")}`),
  node.getAttribute("aria-label"),
];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("a button outside React carries both labels from the start, in the markup the shared copy faces use", () => {
  const node = button();
  layCopyFaces(node, "Copy code", "Copied");
  // Both in one cell: the button is as wide as the wider one before any press, so a press resizes nothing.
  expect(state(node)).toEqual(["idle", ["copy-ack-face is-idle:Copy code:false", "copy-ack-face is-copied:Copied:true"], null]);
});

test("a confirmed copy shows the other face for its time and then the button is itself again", async () => {
  const node = button();
  layCopyFaces(node, "Copy code", "Copied");
  const cell = node.querySelector(".copy-ack");
  confirmCopyOn(node, "Copy code", "Copied", "Code copied", 40);
  expect(state(node)).toEqual(["copied", ["copy-ack-face is-idle:Copy code:true", "copy-ack-face is-copied:Copied:false"], "Code copied"]);
  // The faces were not rebuilt: the same nodes cross-fade.
  expectSameNode(node.querySelector(".copy-ack"), cell);
  await wait(70);
  expect(state(node)).toEqual(["idle", ["copy-ack-face is-idle:Copy code:false", "copy-ack-face is-copied:Copied:true"], null]);
});

test("a second press while it still says copied starts the wait again", async () => {
  const node = button();
  layCopyFaces(node, "Copy code", "Copied");
  confirmCopyOn(node, "Copy code", "Copied", "Code copied", 60);
  await wait(40);
  confirmCopyOn(node, "Copy code", "Copied", "Code copied", 60);
  await wait(40);
  expect(state(node)[0]).toBe("copied");
  await wait(50);
  expect(state(node)[0]).toBe("idle");
});

test("a plain button gets its faces on the first confirmation", async () => {
  const node = button();
  node.textContent = "Copy code";
  confirmCopyOn(node, "Copy code", "Copied", "Code copied", 30);
  expect(state(node)).toEqual(["copied", ["copy-ack-face is-idle:Copy code:true", "copy-ack-face is-copied:Copied:false"], "Code copied"]);
  await wait(60);
  expect(state(node)[0]).toBe("idle");
});
