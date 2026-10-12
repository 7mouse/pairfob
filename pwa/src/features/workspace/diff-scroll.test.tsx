import { expectSameNode } from "../../../test-support/node-identity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetTestDOM } from "../../../test-support/boot-dom";
import type { WorkspaceSnapshot } from "./model";

await resetTestDOM();
const { DiffDetail, DiffScroller } = await import("./diff");
const { emptyWorkspaceModel } = await import("./model");

function diffSnapshot(path: string): WorkspaceSnapshot {
  return {
    ...emptyWorkspaceModel(),
    pendingReveal: false,
    notesEpoch: 0,
    view: "diff",
    detailPath: path,
    diff: {
      path, layer: "worktree", patch: "@@ -1 +1 @@\n-old\n+new\n",
      additions: 1, deletions: 1, binary: false, truncated: false, revision: "a".repeat(64),
    },
  };
}

describe("DiffScroller key lifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(key: string, child: ReactNode = "body") {
    act(() => {
      root.render(<DiffScroller diffKey={key}>{child}</DiffScroller>);
    });
    return host.querySelector<HTMLElement>(".workspace-diff")!;
  }

  test("changing key on the same mounted node does not restore the previous scroll", () => {
    const el = render("a.ts:worktree");
    el.scrollTop = 99;
    el.scrollLeft = 8;
    const next = render("b.ts:worktree");
    expectSameNode(next, el);
    expect(next.dataset.diffKey).toBe("b.ts:worktree");
    expect(next.scrollTop).toBe(0);
    expect(next.scrollLeft).toBe(0);
  });

  test("same-key updates keep the current scroll", () => {
    const el = render("a.ts:worktree", "one");
    el.scrollTop = 40;
    el.scrollLeft = 6;
    const next = render("a.ts:worktree", "two");
    expectSameNode(next, el);
    expect(next.scrollTop).toBe(40);
    expect(next.scrollLeft).toBe(6);
  });

  test("same-key unmount/remount restores the captured scroll", () => {
    const el = render("a.ts:worktree");
    el.scrollTop = 51;
    el.scrollLeft = 3;
    act(() => { root.render(null); });
    const next = render("a.ts:worktree");
    expect(next.scrollTop).toBe(51);
    expect(next.scrollLeft).toBe(3);
  });

  test("a file of the same name in another pane or repository starts at its own top", () => {
    const show = (memory: string) => {
      act(() => { root.render(<DiffScroller diffKey="README.md:worktree" memory={memory}>body</DiffScroller>); });
      return host.querySelector<HTMLElement>(".workspace-diff")!;
    };
    const el = show("/work/a\np1\nREADME.md:worktree");
    el.scrollTop = 77;
    el.dispatchEvent(new window.Event("scroll"));
    act(() => { root.render(null); });
    expect(show("/work/b\np2\nREADME.md:worktree").scrollTop).toBe(0);
    act(() => { root.render(null); });
    // Its own diff, left a moment ago, is where it was left.
    const back = show("/work/b\np2\nREADME.md:worktree");
    back.scrollTop = 12;
    back.dispatchEvent(new window.Event("scroll"));
    act(() => { root.render(null); });
    expect(show("/work/b\np2\nREADME.md:worktree").scrollTop).toBe(12);
  });

  test("same mounted DiffDetail a.ts to b.ts does not keep scroll under the new key", () => {
    act(() => { root.render(<DiffDetail snapshot={diffSnapshot("a.ts")} />); });
    const before = host.querySelector<HTMLElement>(".workspace-diff")!;
    before.scrollTop = 99;
    before.scrollLeft = 8;
    before.dispatchEvent(new window.Event("scroll"));
    act(() => { root.render(<DiffDetail snapshot={diffSnapshot("b.ts")} />); });
    // Another patch is another list of lines: it starts at its own top, whatever the last one was left at.
    const after = host.querySelector<HTMLElement>(".workspace-diff")!;
    expect(after.dataset.diffKey).toBe("b.ts:worktree");
    expect(after.scrollTop).toBe(0);
    expect(after.scrollLeft).toBe(0);
  });
});
