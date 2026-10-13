import { resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { AgentAvatar } from "./agent-avatar";
import { AGENT_ICONS } from "./agent-icons";

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => unmountReact());

test("each kind renders its mark: path markup, a bundled picture, a monogram or the terminal glyph", () => {
  renderReact(<div>
    <AgentAvatar kind="letta-code" />
    <AgentAvatar kind="muse-code" />
    <AgentAvatar kind="droid" />
    <AgentAvatar kind="maki" />
    <AgentAvatar kind="aider" />
    <AgentAvatar kind="" />
  </div>);
  const [letta, muse, droid, maki, aider, terminal] = [...document.querySelectorAll(".agent-avatar")];
  expect(letta.className).toContain("is-mark");
  expect(letta.querySelectorAll("svg path")).toHaveLength(2);
  expect(muse.className).toContain("is-color");
  expect(muse.querySelector("img")!.getAttribute("src")).toBe(AGENT_ICONS.muse.picture!);
  expect(droid.className).toContain("is-mark");
  expect(droid.querySelector("svg path")).not.toBeNull();
  expect(maki.className).toContain("is-color");
  expect(maki.querySelector("svg")).toBeNull();
  const picture = maki.querySelector("img")!;
  expect(picture.getAttribute("src")).toBe(AGENT_ICONS.maki.picture!);
  expect(picture.getAttribute("alt")).toBe("");
  expect(picture.style.transform).toBe(`scale(${8 / 7})`);
  expect(muse.querySelector("img")!.style.transform).toBe("");
  expect(aider.className).toContain("is-monogram");
  expect(aider.textContent).toBe("Ai");
  expect(terminal.className).toContain("is-terminal");
});
