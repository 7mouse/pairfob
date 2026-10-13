import { resetBoardTestDOM } from "../../../test-support/dom";
import { expectSameNode } from "../../../test-support/node-identity";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { setLang, t } from "../../lib/i18n";
import { PairCommand } from "./pair-command";

const button = () => document.querySelector(".connect-command-copy") as HTMLButtonElement;
const face = () => button().querySelector(".copy-ack") as HTMLElement;
const said = () => button().querySelector("[aria-live]")?.textContent;

beforeEach(async () => { await resetBoardTestDOM(); setLang("zh"); });
afterEach(() => unmountReact());

test("copying the pairing command is confirmed in the button's room and said once", async () => {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { written.push(text); } }, configurable: true });
  renderReact(<PairCommand />);
  const before = button();
  expect(face().dataset.state).toBe("idle");
  expect([...face().children].map(node => node.textContent)).toEqual([t("empty.copy"), t("empty.copied"), t("empty.copyFailed")]);
  expect(said()).toBe("");
  await act(async () => before.click());
  expect(written).toEqual(["pairfob pair"]);
  expectSameNode(button(), before);
  expect(face().dataset.state).toBe("copied");
  expect(face().querySelector(".is-copied svg")).not.toBeNull();
  expect(said()).toBe(t("empty.copied"));
});

test("a refused copy shows the by-hand face", async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
  renderReact(<PairCommand />);
  await act(async () => button().click());
  expect(face().dataset.state).toBe("failed");
  expect(said()).toBe(t("empty.copyFailed"));
});
