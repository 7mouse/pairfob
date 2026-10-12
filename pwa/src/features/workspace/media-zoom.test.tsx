import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { expectSameNode } from "../../../test-support/node-identity";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { setLang } from "../../lib/i18n";
import { WorkspaceMedia, actualSizeZoom, zoomReadout } from "./media";
import type { WorkspaceMediaView } from "./media-model";

/**
 * The image viewer's zoom: icon buttons around the picture's real scale, a fit
 * and a 100% that are two different things, and a double press that goes
 * between them, under a mouse and under a finger alike. A zoomed picture pans
 * as far as its own edge, and the toolbar is one Tab stop walked by the arrows.
 *
 * Happy DOM has no pointer capture to give: the stage asks for it and goes on
 * without, as it does for a pointer that is already gone.
 */

const image: WorkspaceMediaView = {
  path: "shots/wide.png", role: "image", status: "ready", kind: "image", mime: "image/png",
  size: 4, loaded: 4, cap: 10 * 1024 * 1024, url: "blob:zoom-image", error: "", width: 2000, height: 1000,
};

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("en");
});

afterEach(async () => {
  unmountReact();
  Reflect.deleteProperty(document, "fullscreenEnabled");
  await happy.happyDOM.abort();
});

const img = () => document.querySelector<HTMLImageElement>("img.workspace-media-image")!;
const stage = () => document.querySelector<HTMLElement>(".workspace-media-viewer")!;
const readout = () => document.querySelector(".workspace-media-scale")!.textContent;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`.workspace-media-toolbar button[aria-label="${label}"]`)!;
const click = (label: string) => act(() => { button(label).click(); });

/** Happy DOM lays nothing out: say how large the picture is and how large it is drawn, then let it load. */
function measured(natural: [number, number], drawn: [number, number]): void {
  const node = img();
  for (const [key, value] of [["naturalWidth", natural[0]], ["naturalHeight", natural[1]], ["offsetWidth", drawn[0]], ["offsetHeight", drawn[1]]] as const) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  act(() => { node.dispatchEvent(new happy.Event("load") as unknown as Event); });
}

function press(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, pointerType = "touch", pointerId = 1): void {
  act(() => {
    stage().dispatchEvent(new happy.PointerEvent(type, { bubbles: true, pointerId, pointerType, clientX: x, clientY: y, button: 0 }) as unknown as Event);
  });
}
const tap = (x: number, y: number, pointerType = "touch") => { press("pointerdown", x, y, pointerType); press("pointerup", x, y, pointerType); };

test("the readout is the picture's real scale, and the fit until that can be measured", () => {
  expect(actualSizeZoom(0)).toBe(1);
  expect(actualSizeZoom(0.25)).toBe(4);
  // A picture smaller than its stage is fitted at its own size already.
  expect(actualSizeZoom(1)).toBe(1);
  expect(zoomReadout(1, 0)).toBe("Fit");
  expect(zoomReadout(2.5, 0)).toBe("×2.5");
  expect(zoomReadout(1, 0.25)).toBe("25%");
  expect(zoomReadout(4, 0.25)).toBe("100%");
});

test("the toolbar is icon buttons, each named, around the scale", () => {
  renderReact(<WorkspaceMedia media={image} />);
  const toolbar = document.querySelector(".workspace-media-toolbar")!;
  expect(toolbar.getAttribute("role")).toBe("toolbar");
  const buttons = [...toolbar.querySelectorAll("button")];
  expect(buttons.map((item) => item.getAttribute("aria-label"))).toEqual(["Zoom out", "Zoom in", "Fit", "Actual size"]);
  for (const item of buttons) {
    expect(item.classList.contains("icon-btn")).toBeTrue();
    expect(item.title).toBe(item.getAttribute("aria-label")!);
  }
  // Between zoom out and zoom in.
  expect([...toolbar.children].map((child) => child.className.split(" ").pop())).toEqual(
    ["icon-btn", "workspace-media-scale", "icon-btn", "workspace-media-toolbar-rule", "icon-btn", "workspace-media-actual"]);
  expect(readout()).toBe("Fit");
  measured([2000, 1000], [500, 250]);
  expect(readout()).toBe("25%");
});

test("fit and 100% are two things: one fills the stage, the other shows a pixel for a pixel", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  expect(button("Fit").getAttribute("aria-pressed")).toBe("true");
  expect(button("Actual size").getAttribute("aria-pressed")).toBe("false");
  expect(button("Zoom out").disabled).toBeTrue();
  await click("Actual size");
  expect(readout()).toBe("100%");
  expect(img().style.transform).toBe("translate(0px, 0px) scale(4)");
  expect(button("Actual size").getAttribute("aria-pressed")).toBe("true");
  expect(button("Fit").getAttribute("aria-pressed")).toBe("false");
  expect(stage().hasAttribute("data-zoomed")).toBeTrue();
  await click("Zoom out");
  expect(readout()).toBe("80%");
  await click("Fit");
  expect(readout()).toBe("25%");
  expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
  expect(stage().hasAttribute("data-enlarges")).toBeTrue();
  await click("Zoom in");
  expect(readout()).toBe("31%");
});

test("100% stays within reach of a picture far larger than its stage", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  // 1/16 at the fit: past the usual eightfold limit.
  measured([8000, 4000], [500, 250]);
  expect(readout()).toBe("6%");
  await click("Actual size");
  expect(readout()).toBe("100%");
  expect(button("Zoom in").disabled).toBeTrue();
});

test("a double press goes from the fit to 100% where it was pressed, and back", () => {
  for (const pointerType of ["touch", "mouse"]) {
    renderReact(<WorkspaceMedia media={image} />);
    measured([2000, 1000], [500, 250]);
    tap(30, 40, pointerType);
    expect(readout()).toBe("25%");
    tap(32, 41, pointerType);
    expect(readout()).toBe("100%");
    // The stage measures nothing here, so its centre is the origin: the pressed point holds still.
    expect(img().style.transform).toBe("translate(-96px, -123px) scale(4)");
    tap(200, 200, pointerType);
    tap(201, 200, pointerType);
    expect(readout()).toBe("25%");
    expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
    unmountReact();
  }
});

test("two presses apart in place or time, a drag, and a pinch are not a double press", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  tap(30, 40);
  tap(130, 40);
  expect(readout()).toBe("25%");
  await new Promise((resolve) => setTimeout(resolve, 360));
  tap(130, 40);
  expect(readout()).toBe("25%");
  await new Promise((resolve) => setTimeout(resolve, 360));
  // A press that travelled is a drag, so the tap after it is a first tap.
  press("pointerdown", 10, 10);
  press("pointermove", 60, 10);
  press("pointerup", 60, 10);
  tap(60, 10);
  expect(readout()).toBe("25%");
  await new Promise((resolve) => setTimeout(resolve, 360));
  // A second finger makes the press a pinch, whatever came before it.
  tap(20, 20);
  press("pointerdown", 20, 20, "touch", 1);
  press("pointerdown", 90, 20, "touch", 2);
  press("pointerup", 90, 20, "touch", 2);
  press("pointerup", 20, 20, "touch", 1);
  expect(readout()).toBe("25%");
});

test("a picture smaller than its stage is at 100% when fitted: a double press has nowhere to go", () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([200, 100], [200, 100]);
  expect(readout()).toBe("100%");
  expect(stage().hasAttribute("data-enlarges")).toBeFalse();
  tap(30, 40);
  tap(30, 40);
  expect(readout()).toBe("100%");
  expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
});

test("full screen is offered only where the page can show an element full screen", () => {
  renderReact(<WorkspaceMedia media={image} />);
  expect(button("Full screen")).toBeNull();
  unmountReact();
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  renderReact(<WorkspaceMedia media={image} />);
  expect(button("Full screen").classList.contains("workspace-media-fullscreen")).toBeTrue();
});

/** The stage's own box, which Happy DOM does not lay out. */
function staged(width: number, height: number): void {
  for (const [key, value] of [["clientWidth", width], ["clientHeight", height]] as const) {
    Object.defineProperty(stage(), key, { value, configurable: true });
  }
}

test("a zoomed picture pans as far as its own edge and no further", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  staged(500, 400);
  await click("Actual size");
  // 2000 by 1000 drawn over a 500 by 400 stage: 750px to either side, 300px up or down.
  press("pointerdown", 100, 100, "mouse");
  press("pointermove", 5000, 5000, "mouse");
  expect(img().style.transform).toBe("translate(750px, 300px) scale(4)");
  press("pointermove", -5000, -5000, "mouse");
  press("pointerup", -5000, -5000, "mouse");
  expect(img().style.transform).toBe("translate(-750px, -300px) scale(4)");
});

test("a side the picture does not overflow does not pan, and zooming out brings the picture back over the stage", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  staged(500, 400);
  // 625 by 312.5: wider than the stage, not taller.
  await click("Zoom in");
  press("pointerdown", 100, 100, "mouse");
  press("pointermove", 400, 400, "mouse");
  press("pointerup", 400, 400, "mouse");
  expect(img().style.transform).toBe("translate(62.5px, 0px) scale(1.25)");
  await click("Actual size");
  press("pointerdown", 100, 100, "mouse");
  press("pointermove", 5000, 100, "mouse");
  press("pointerup", 5000, 100, "mouse");
  expect(img().style.transform).toBe("translate(750px, 0px) scale(4)");
  // 3.2 times: the edge is at 550px now, and the picture follows it in.
  await click("Zoom out");
  expect(img().style.transform).toBe("translate(550px, 0px) scale(3.2)");
});

test("the toolbar is one Tab stop: the arrows, Home and End move along its controls", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  const toolbar = document.querySelector<HTMLElement>(".workspace-media-toolbar")!;
  const stops = () => [...toolbar.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.tabIndex === 0).map((item) => item.getAttribute("aria-label"));
  const arrow = (name: string) => act(() => {
    document.activeElement!.dispatchEvent(new happy.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }) as unknown as Event);
  });
  // At the fit, zoom out has nothing to do: the first control in use holds the stop.
  expect(stops()).toEqual(["Zoom in"]);
  act(() => { button("Zoom in").focus(); });
  arrow("ArrowRight");
  expectSameNode(document.activeElement, button("Fit"));
  expect(stops()).toEqual(["Fit"]);
  arrow("End");
  expectSameNode(document.activeElement, button("Actual size"));
  arrow("ArrowRight");
  expectSameNode(document.activeElement, button("Actual size"));
  arrow("Home");
  expectSameNode(document.activeElement, button("Zoom in"));
  arrow("ArrowLeft");
  expectSameNode(document.activeElement, button("Zoom in"));
});

test("a control that goes out of use under the reader hands the keyboard to its neighbour", async () => {
  renderReact(<WorkspaceMedia media={image} />);
  measured([2000, 1000], [500, 250]);
  await click("Zoom in");
  act(() => { button("Zoom out").focus(); });
  // Back at the fit, zoom out is disabled while it has focus.
  await click("Zoom out");
  expect(button("Zoom out").disabled).toBeTrue();
  expectSameNode(document.activeElement, button("Zoom in"));
});
