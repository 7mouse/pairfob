import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { bindBootRecovery } from "../../app/boot-actions";
import { setLang } from "../../lib/i18n";
import { BootRecovery } from "./boot-recovery";

test("a failed module import offers an explicit refresh and never retries or discards saved computers", async () => {
  await resetBoardTestDOM();
  setLang("en");
  let reloads = 0, retries = 0, pairings = 0;
  const release = bindBootRecovery({ retry: () => retries++, pairAnyway: () => pairings++ });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  try {
    act(() => root.render(<BootRecovery block="assets" reload={() => reloads++} />));
    expect(reloads).toBe(0);
    expect(element.querySelectorAll("button").length).toBe(1);
    expect(element.textContent).toContain("Your saved computers are safe");
    expect(element.querySelector("button")!.textContent).toBe("Refresh page");
    act(() => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(reloads).toBe(1);
    expect(retries).toBe(0);
    expect(pairings).toBe(0);
    act(() => root.render(<BootRecovery block="origin" reload={() => reloads++} />));
    act(() => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(retries).toBe(1);
    expect(reloads).toBe(1);
  } finally { act(() => root.unmount()); element.remove(); release(); }
});
