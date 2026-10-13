import { resetBoardTestDOM } from "../../../../test-support/dom";
import { expectSameNode } from "../../../../test-support/node-identity";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { COPIED_MS } from "../../react/use-copied";
import { CommandLine } from "./command-line";

const labels = { copy: "Copy", copied: "Copied", failed: "Copy it by hand" };
const face = () => document.querySelector(".command-copy .copy-ack") as HTMLElement;
const shown = () => [...face().querySelectorAll(".copy-ack-face")].filter(node => node.getAttribute("aria-hidden") !== "true").map(node => node.textContent);
function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => unmountReact());

test("a copy is confirmed on the button's own face and the button is itself again afterwards", async () => {
  const written: string[] = [];
  clipboard(async text => { written.push(text); });
  renderReact(<CommandLine command="pairfob service restart" labels={labels} />);
  const button = document.querySelector(".command-copy") as HTMLButtonElement;
  // Every face is in the button from the start, so confirming cannot change its width.
  expect([...face().querySelectorAll(".copy-ack-face")].map(node => node.textContent)).toEqual(["Copy", "Copied", "Copy it by hand"]);
  expect(face().dataset.state).toBe("idle");
  expect(shown()).toEqual(["Copy"]);
  await act(async () => button.click());
  expect(written).toEqual(["pairfob service restart"]);
  expect(face().dataset.state).toBe("copied");
  expect(shown()).toEqual(["Copied"]);
  expectSameNode(document.querySelector(".command-copy"), button);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, COPIED_MS + 80)); });
  expect(face().dataset.state).toBe("idle");
  expect(shown()).toEqual(["Copy"]);
});

test("a refused copy says so on the same face; a missing clipboard is a refusal, not a throw", async () => {
  clipboard(async () => { throw new Error("denied"); });
  renderReact(<CommandLine command="pairfob pair" labels={labels} />);
  await act(async () => (document.querySelector(".command-copy") as HTMLButtonElement).click());
  expect(face().dataset.state).toBe("failed");
  expect(shown()).toEqual(["Copy it by hand"]);
  unmountReact();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  renderReact(<CommandLine command="pairfob pair" labels={labels} />);
  await act(async () => (document.querySelector(".command-copy") as HTMLButtonElement).click());
  expect(face().dataset.state).toBe("failed");
});
