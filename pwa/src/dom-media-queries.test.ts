import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { isolateMediaQueryListeners } from "../test-support/media-query-listeners";

test("shared media-query callbacks release every resize listener after unmount", () => {
  const realm = new Window({ width: 390, height: 844 });
  isolateMediaQueryListeners(realm);
  const resize = new Set<unknown>();
  const add = realm.addEventListener.bind(realm);
  const remove = realm.removeEventListener.bind(realm);
  realm.addEventListener = (type, listener, options) => {
    if (type === "resize") resize.add(listener);
    add(type, listener, options);
  };
  realm.removeEventListener = (type, listener, options) => {
    if (type === "resize") resize.delete(listener);
    remove(type, listener, options);
  };
  const lists = [720, 900, 1200].map(width => realm.matchMedia(`(min-width: ${width}px)`));
  let changes = 0;
  const listener = () => { changes++; };
  for (const list of lists) list.addEventListener("change", listener);
  // Repeated registration is one subscription, as with any EventTarget.
  for (const list of lists) list.addEventListener("change", listener);
  expect(resize.size).toBe(3);
  realm.happyDOM.setWindowSize({ width: 1440, height: 900 });
  expect(changes).toBe(3);
  for (const list of lists) list.removeEventListener("change", listener);
  expect(resize.size).toBe(0);
  realm.happyDOM.setWindowSize({ width: 390, height: 844 });
  expect(changes).toBe(3);
});
