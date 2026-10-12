import { expect, test } from "bun:test";
import { bindBackHistory, type BackHistoryPort } from "./back-history";
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function browser(initial: unknown = { other: "preserved" }) {
  const entries: unknown[] = ["outside", initial];
  let index = 1;
  let pop = () => {};
  const tasks: Array<() => void> = [];
  const move = (delta: number) => { tasks.push(() => { index += delta; pop(); }); };
  const port: BackHistoryPort = {
    state: () => entries[index],
    replace: state => { entries[index] = state; },
    push: state => { entries.splice(++index, entries.length, state); },
    back: () => move(-1),
    listen(listener) { pop = listener; return () => { pop = () => {}; }; },
  };
  return { port, entries, index: () => index, forward: () => move(1),
    flush() { let count = 0; while (tasks.length) { if (++count > 20) throw new Error("history loop"); tasks.shift()!(); } },
  };
}

test("Back closes exactly one UI layer; root returns control to browser without growing history", async () => {
  const b = browser();
  let layers = 4;
  const owner = bindBackHistory(b.port, () => layers ? () => { layers--; } : null, "page");
  expect(b.port.state()).toMatchObject({ other: "preserved" });
  for (let left = 3; left >= 0; left--) {
    b.port.back(); b.flush(); await tick(); b.flush();
    expect(layers).toBe(left);
    expect(b.entries.length).toBe(3);
  }
  expect(b.index()).toBe(1);
  b.port.back(); b.flush();
  expect(b.port.state()).toBe("outside");
  owner.dispose();
});

test("UI close retires the guard; Forward does not reopen the old session or strand an extra Back", async () => {
  const b = browser();
  let open = true;
  let calls = 0;
  const owner = bindBackHistory(b.port, () => open ? () => { calls++; open = false; } : null, "page");
  open = false;
  owner.sync(); b.flush();
  expect(b.index()).toBe(1);
  b.forward(); b.flush(); await tick();
  expect(b.index()).toBe(1);
  expect(calls).toBe(0);
  b.port.back(); b.flush();
  expect(b.port.state()).toBe("outside");
  owner.dispose();
});

test("navigation while the guard is retiring re-arms after the traversal", () => {
  const b = browser();
  let open = true;
  const owner = bindBackHistory(b.port, () => open ? () => {} : null, "page");
  open = false; owner.sync();
  open = true; owner.sync();
  b.flush();
  expect(b.index()).toBe(2);
  expect(b.entries.length).toBe(3);
  owner.dispose();
});

test("rapid Back during asynchronous navigation cannot exit or execute it twice", async () => {
  const b = browser();
  let done!: () => void;
  let calls = 0;
  let open = true;
  const owner = bindBackHistory(b.port, () => open ? () => {
    calls++;
    return new Promise<void>(resolve => { done = () => { open = false; resolve(); }; });
  } : null, "page");
  b.port.back(); b.flush();
  b.port.back(); b.flush();
  expect(calls).toBe(1);
  expect(b.index()).toBe(2);
  done(); await tick(); b.flush();
  expect(b.index()).toBe(1);
  owner.dispose();
});

test("iframe same-entry history is not application Back; UI root cleanup retires it", () => {
  const b = browser();
  let open = true;
  let calls = 0;
  const owner = bindBackHistory(b.port, () => open ? () => { calls++; } : null, "page");
  b.port.push(b.port.state());
  b.port.back(); b.flush();
  expect(calls).toBe(0);
  b.port.push(b.port.state());
  open = false; owner.sync(); b.flush();
  expect(b.index()).toBe(1);
  owner.dispose();
});

test("refresh adopts the current guard, preserves other state, and disposal removes the listener", () => {
  const b = browser();
  const first = bindBackHistory(b.port, () => () => {}, "page");
  first.dispose();
  let calls = 0;
  const second = bindBackHistory(b.port, () => () => { calls++; }, "reload");
  expect(b.entries.length).toBe(3);
  expect(b.port.state()).toMatchObject({ other: "preserved" });
  second.dispose();
  b.port.back(); b.flush();
  expect(calls).toBe(0);
});

for (const open of [false, true]) {
  test(`a consumed notification hash creates no empty Back step (${open ? "session" : "root"})`, async () => {
    const b = browser();
    let shown = open;
    let calls = 0;
    const owner = bindBackHistory(b.port, () => shown ? () => { calls++; shown = false; } : null, "page");
    // Browser fragment navigation adds an entry with null state; capture then
    // scrubs its URL before the application receives the notification intent.
    b.port.push(null);
    owner.consumeHashEntry(); b.flush();
    expect(b.index()).toBe(open ? 2 : 1);
    expect(calls).toBe(0);
    if (open) { b.port.back(); b.flush(); await tick(); b.flush(); }
    expect(b.index()).toBe(1);
    b.port.back(); b.flush();
    expect(b.port.state()).toBe("outside");
    owner.dispose();
  });
}

test("a notification during an in-flight Back keeps a boundary until navigation settles", async () => {
  const b = browser();
  let finish!: () => void;
  const owner = bindBackHistory(b.port, () => () => new Promise<void>(resolve => { finish = resolve; }), "page");
  b.port.back(); b.flush();
  b.port.push(null);
  owner.consumeHashEntry(); b.flush();
  expect(b.index()).toBe(2);
  finish(); await tick();
  owner.dispose();
});
