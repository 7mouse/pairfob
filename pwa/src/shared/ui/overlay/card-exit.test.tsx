import { expectSameNode } from "../../../../test-support/node-identity";
import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { closeTestDialogs } from "../../../../test-support/close-dialogs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { setLang } from "../../../lib/i18n";
import { MOTION_MS } from "../dom/motion";
import { MenuItem, showActionSheet } from "./action-sheet";
import { askConfirm, askText } from "./basic-dialogs";
import { bindOverlayOrigin } from "./origin";

/**
 * A centred card leaves by fading. What closes is what always closed, at the
 * moment it always did: the native dialog, the result, focus. Only the closed
 * dialog's removal from the tree waits out the exit, and only for a card. A
 * bottom sheet and a menu anchored under its trigger are taken down at once.
 */
const pause = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));
const open = () => document.querySelector<HTMLDialogElement>("dialog[open]");
const all = () => [...document.querySelectorAll<HTMLDialogElement>("dialog")];
let release = () => {};
let trigger: HTMLButtonElement;

function press(pointerType: string): void {
  trigger.dispatchEvent(new happy.PointerEvent("pointerdown", { bubbles: true, pointerType, clientX: 40, clientY: 40 }) as unknown as Event);
}

function size(width: number): void {
  happy.happyDOM.setWindowSize({ width, height: 800 });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
  trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  release = bindOverlayOrigin(document);
});

afterEach(async () => {
  await act(async () => { closeTestDialogs(); await pause(MOTION_MS.press + 30); });
  release();
  trigger.remove();
  size(390);
});

describe("a card that closes", () => {
  test("is closed, answered and out of reach at once; it stays in the tree for its exit, then goes", async () => {
    size(1024);
    press("mouse");
    let answer: boolean | undefined;
    act(() => { void askConfirm({ title: "关闭？", confirmLabel: "关闭" }).then((value) => { answer = value; }); });
    const card = open()!;
    expect(card.classList.contains("desk-form")).toBeTrue();
    // What the style sheet draws a closed card by: only a dialog that has opened carries it.
    expect(card.hasAttribute("data-card-exit")).toBeTrue();

    await act(async () => { card.querySelector<HTMLButtonElement>(".desk-close")!.click(); await pause(); });
    expect(answer).toBe(false);
    expect(card.open).toBeFalse();
    expect(open()).toBeNull();
    expectSameNode(document.activeElement, trigger);
    expectSameNode(all()[0], card);
    expect(card.hasAttribute("inert")).toBeTrue();

    await act(async () => { await pause(MOTION_MS.press + 30); });
    expect(all()).toHaveLength(0);
  });

  test("a finger's card from 900px leaves the same way: it is the same card", async () => {
    size(1024);
    press("touch");
    act(() => { void askText({ title: "名称", initial: "a" }); });
    const card = open()!;
    expect(card.classList.contains("desk-form")).toBeFalse();
    await act(async () => { card.close("cancel"); await pause(); });
    expect(all()).toHaveLength(1);
    expect(card.hasAttribute("inert")).toBeTrue();
    await act(async () => { await pause(MOTION_MS.press + 30); });
    expect(all()).toHaveLength(0);
  });

  test("focus still inside the closed card is focus nowhere: it is not left on a control that is leaving", async () => {
    size(1024);
    press("mouse");
    // Nothing to give focus back to: the control that opened it is gone.
    act(() => { void askText({ title: "名称", initial: "a" }); });
    const card = open()!;
    trigger.remove();
    const field = card.querySelector("input")!;
    field.focus();
    await act(async () => { card.close("cancel"); await pause(); });
    expect(card.contains(document.activeElement)).toBeFalse();
  });

  test("the next dialog takes down a card that is only leaving, and is the one dialog on the page", async () => {
    size(1024);
    press("mouse");
    act(() => { void askConfirm({ title: "一", confirmLabel: "好" }); });
    const first = open()!;
    await act(async () => { first.close("cancel"); await pause(); });
    expect(first.isConnected).toBeTrue();
    act(() => { void askConfirm({ title: "二", confirmLabel: "好" }); });
    expect(first.isConnected).toBeFalse();
    expect(all()).toHaveLength(1);
    expect(open()!.querySelector(".modal-title")?.textContent).toBe("二");
  });

  test("a page cleared under a leaving card does not break its removal", async () => {
    size(1024);
    press("mouse");
    act(() => { void askConfirm({ title: "一", confirmLabel: "好" }); });
    const card = open()!;
    await act(async () => { card.close("cancel"); await pause(); });
    card.remove();
    await act(async () => { await pause(MOTION_MS.press + 30); });
    expect(all()).toHaveLength(0);
  });
});

describe("what is not a card closes as it did", () => {
  test("a bottom sheet is removed with its close, on the phone and under a finger beside the list", async () => {
    for (const width of [390, 800]) {
      size(width);
      press("touch");
      act(() => { void askConfirm({ title: "关闭？", confirmLabel: "关闭" }); });
      const sheet = open()!;
      await act(async () => { sheet.close("cancel"); await pause(); });
      expect(all()).toHaveLength(0);
    }
  });

  test("a menu anchored under its trigger is removed with its close, at any width", async () => {
    size(1024);
    press("mouse");
    act(() => showActionSheet("操作", (modal) => <MenuItem modal={modal}>一</MenuItem>, { popover: "menu", anchor: trigger }));
    const menu = open()!;
    expect(menu.classList.contains("popover")).toBeTrue();
    await act(async () => { menu.close("cancel"); await pause(); });
    expect(all()).toHaveLength(0);
  });
});
