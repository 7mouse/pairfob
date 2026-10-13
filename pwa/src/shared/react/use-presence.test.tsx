import { resetBoardTestDOM } from "../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { useKeptList, usePresence } from "./use-presence";

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => unmountReact());

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));
const marks = () => [...document.querySelectorAll("[data-key]")].map((node) => `${node.getAttribute("data-key")}${node.hasAttribute("data-leaving") ? "-" : ""}${node.hasAttribute("data-entering") ? "+" : ""}`);

function Note({ shown }: { shown: boolean }) {
  const { mounted, leaving } = usePresence(shown, 30);
  return mounted ? <p data-key="note" data-leaving={leaving ? "" : undefined} /> : null;
}

function Row({ ids }: { ids: string[] }) {
  const rows = useKeptList(ids, (id) => id, 30);
  return <ul>{rows.map((row) => <li key={row.key} data-key={row.key} data-leaving={row.leaving ? "" : undefined} data-entering={row.entering ? "" : undefined} />)}</ul>;
}

test("a hidden thing stays mounted as leaving for its exit, then goes", async () => {
  renderReact(<Note shown={false} />);
  expect(marks()).toEqual([]);
  renderReact(<Note shown />);
  expect(marks()).toEqual(["note"]);
  renderReact(<Note shown={false} />);
  expect(marks()).toEqual(["note-"]);
  await wait(60);
  expect(marks()).toEqual([]);
});

test("showing it again during the exit cancels the exit", async () => {
  renderReact(<Note shown />);
  renderReact(<Note shown={false} />);
  renderReact(<Note shown />);
  expect(marks()).toEqual(["note"]);
  await wait(60);
  expect(marks()).toEqual(["note"]);
});

test("the first paint and a repaint with the same keys mark nothing", () => {
  renderReact(<Row ids={["a", "b"]} />);
  expect(marks()).toEqual(["a", "b"]);
  renderReact(<Row ids={["a", "b"]} />);
  expect(marks()).toEqual(["a", "b"]);
});

test("a newcomer is entering and a removed row leaves from the place it had", async () => {
  renderReact(<Row ids={["a", "b", "c"]} />);
  renderReact(<Row ids={["a", "x", "c"]} />);
  expect(marks()).toEqual(["a", "b-", "x+", "c"]);
  await wait(60);
  expect(marks()).toEqual(["a", "x+", "c"]);
});

test("a row that comes back while leaving is simply there again", async () => {
  renderReact(<Row ids={["a", "b"]} />);
  renderReact(<Row ids={["a"]} />);
  expect(marks()).toEqual(["a", "b-"]);
  renderReact(<Row ids={["a", "b"]} />);
  expect(marks()).toEqual(["a", "b"]);
  await wait(60);
  expect(marks()).toEqual(["a", "b"]);
});

test("a reorder with the same keys follows the new order", () => {
  renderReact(<Row ids={["a", "b", "c"]} />);
  renderReact(<Row ids={["c", "a", "b"]} />);
  expect(marks()).toEqual(["c", "a", "b"]);
});
