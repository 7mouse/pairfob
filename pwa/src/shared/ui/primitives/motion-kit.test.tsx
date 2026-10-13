import { resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { compileString } from "sass";
import { fileURLToPath } from "node:url";
import { expectDifferentNode, expectSameNode } from "../../../../test-support/node-identity";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { foldShut } from "../../../../test-support/exit";
import { CopyAck } from "./copy-ack";
import { Fold } from "./fold";
import { Swap } from "./swap";

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => unmountReact());

test("a shut fold keeps its content mounted and takes it out of reach", () => {
  renderReact(<Fold open><button>inside</button></Fold>);
  const fold = document.querySelector(".fold") as HTMLElement;
  const button = document.querySelector("button");
  expect(fold.classList.contains("is-shut")).toBeFalse();
  expect(fold.hasAttribute("inert")).toBeFalse();
  renderReact(<Fold open={false}><button>inside</button></Fold>);
  expectSameNode(document.querySelector(".fold"), fold);
  expectSameNode(document.querySelector("button"), button);
  expect(fold.classList.contains("is-shut")).toBeTrue();
  expect(fold.hasAttribute("inert")).toBeTrue();
});

test("a lazy fold draws its content only while it is open or on its way shut", async () => {
  renderReact(<Fold open={false} lazy><button>inside</button></Fold>);
  expect(document.querySelector("button")).toBeNull();
  // Opened: the content is there in the commit that opens the block.
  renderReact(<Fold open lazy><button>inside</button></Fold>);
  const button = document.querySelector("button");
  expect(button).not.toBeNull();
  expect(document.querySelector(".fold")?.classList.contains("is-shut")).toBeFalse();
  // Shutting: the same content, drawn for the way out and out of reach.
  renderReact(<Fold open={false} lazy><button>inside</button></Fold>);
  expectSameNode(document.querySelector("button"), button);
  expect(document.querySelector(".fold")?.hasAttribute("inert")).toBeTrue();
  await foldShut();
  expect(document.querySelector("button")).toBeNull();
  expect(document.querySelector(".fold")?.classList.contains("is-shut")).toBeTrue();
});

test("a swap marks a changed value and never a first paint or a repeat", () => {
  renderReact(<Swap on="working" className="word">working</Swap>);
  const first = document.querySelector(".word") as HTMLElement;
  expect(first.classList.contains("swap-in")).toBeFalse();
  renderReact(<Swap on="working" className="word">working</Swap>);
  expectSameNode(document.querySelector(".word"), first);
  expect(first.classList.contains("swap-in")).toBeFalse();
  renderReact(<Swap on="blocked" className="word">blocked</Swap>);
  const second = document.querySelector(".word") as HTMLElement;
  expectDifferentNode(second, first);
  expect(second.classList.contains("swap-in")).toBeTrue();
  expect(second.textContent).toBe("blocked");
});

test("a copy face shows one label to assistive technology at a time", () => {
  renderReact(<button><CopyAck state="idle" idle="Copy" copied="Copied" failed="Copy by hand" /></button>);
  const hidden = () => [...document.querySelectorAll(".copy-ack-face")].map((face) => face.getAttribute("aria-hidden"));
  expect(hidden()).toEqual(["false", "true", "true"]);
  renderReact(<button><CopyAck state="copied" idle="Copy" copied="Copied" failed="Copy by hand" /></button>);
  expect(document.querySelector(".copy-ack")?.getAttribute("data-state")).toBe("copied");
  expect(hidden()).toEqual(["true", "false", "true"]);
});

// The kit alone: its own rules, and what the reduced-motion block makes of them.
const kit = (mixin: string) => compileString(`@use "motion-kit" as kit; @include kit.${mixin}();`, {
  loadPaths: [fileURLToPath(new URL("../styles", import.meta.url))], style: "expanded",
}).css;
const rules = kit("motion-kit");
const reduced = kit("motion-kit-reduced");

test("the shared motion rules use the duration tokens and lose travel under reduced motion", () => {
  expect(rules).toContain("grid-template-rows var(--dur-3) var(--ease)");
  expect(rules).not.toMatch(/\d+ms/);
  // One sheen for every placeholder: the keyframes are the kit's, the beat a token's.
  expect(rules).toMatch(/@keyframes skeleton-sheen \{\s*from \{\s*transform: translateX\(-100%\);/);
  expect(reduced).toMatch(/\.pop-in,\s*\.rise-in,[^{]*\{\s*animation-name: fade-in;/);
});
