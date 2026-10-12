import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { setScreen } from "../../app/navigation-store";
import { clearAllDiffNotes } from "../../lib/diff-notes";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { WorkspaceScreen } from "../../pages/workspace/screen";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities } from "../operations/capabilities-store";
import { selectPane } from "../session/session-store";
import { DIFF_BATCH_LINES } from "./diff";
import { setSplitChosen } from "./diff-layout";
import { clearWorkspacePendingReveal, enterWorkspace, loadGitDiff, workspaceModel } from "./index";

/**
 * A diff as it is laid out for reading: hunks under heads that say where in
 * the file they are and fold, the unchanged stretch between them, a long patch
 * drawn a stretch at a time, the words that changed inside a replaced line,
 * and the two sides next to each other where the window has the room.
 */

const seedRestorer = new WorkspaceSnapshotRestorer();
const TWO_HUNKS = [
  "@@ -3,4 +3,5 @@ export function App() {",
  " keep",
  "-const ready = false;",
  "+const ready = true;",
  "+const extra = 1;",
  " tail",
  " end",
  "@@ -40,3 +41,2 @@",
  " before",
  "-gone",
  " after",
  "",
].join("\n");
let patch = TWO_HUNKS;
let changes: Array<{ path: string; index: string; worktree: string }>;
/**
 * The diff's box as the browser would measure it; happy-dom measures nothing.
 * `line` is the height of one drawn line, so the content grows as more is drawn.
 */
let box: { height: number; content?: number; line?: number } | null;
const realHeights = {
  client: Object.getOwnPropertyDescriptor(happy.HTMLElement.prototype, "clientHeight"),
  scroll: Object.getOwnPropertyDescriptor(happy.HTMLElement.prototype, "scrollHeight"),
};
const opened: Array<{ path: string }> = [];

function liveFixture() {
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({ path, entries: [], next_cursor: null, truncated: false, revision: "d".repeat(64) }),
    workspaceRead: async (_pane: string, path: string) => {
      opened.push({ path });
      return { path, kind: "text", content: "a\nb\nc\n", size: 6, modified_ms: 1, truncated: false, revision: "f".repeat(64) };
    },
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: changes.map((change) => ({ ...change, original_path: null })),
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch, additions: 2, deletions: 2, binary: false, truncated: false, revision: "1".repeat(64),
    }),
  };
}

const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};
const all = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

async function boot(width = 390, prompts = false): Promise<void> {
  happy.happyDOM.setWindowSize({ width, height: 844 });
  await act(async () => {
    setLang("zh");
    seedRestorer.capture();
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: prompts }, []);
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "pairfob" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/pairfob", agent: "codex", agent_status: "idle" }],
    });
    attachLiveSession(liveFixture() as never);
    renderReact(<WorkspaceScreen />);
    await enterWorkspace("p1");
  });
  await settle();
}

async function openDiff(path = "src/app.ts", layer: "worktree" | "staged" = "worktree"): Promise<void> {
  await act(async () => { await loadGitDiff(path, layer); });
  await settle();
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  clearAllDiffNotes();
  patch = TWO_HUNKS;
  changes = [{ path: "src/app.ts", index: " ", worktree: "M" }, { path: "src/b.ts", index: " ", worktree: "M" }];
  box = null;
  opened.length = 0;
  const measured = (own: "height" | "content", real: PropertyDescriptor | undefined) => ({
    configurable: true,
    get(this: HTMLElement) {
      if (!box || !this.classList.contains("workspace-diff")) return real?.get?.call(this) ?? 0;
      if (own === "height") return box.height;
      return box.content ?? this.querySelectorAll(".workspace-diff-line").length * (box.line ?? 0);
    },
  });
  Object.defineProperty(happy.HTMLElement.prototype, "clientHeight", measured("height", realHeights.client));
  Object.defineProperty(happy.HTMLElement.prototype, "scrollHeight", measured("content", realHeights.scroll));
});

afterEach(async () => {
  await act(async () => { unmountReact(); });
  clearWorkspacePendingReveal();
  await act(async () => { closeTestDialogs(); await Promise.resolve(); });
  await act(async () => {
    seedRestorer.restore();
    attachLiveSession(null);
    setScreen("home");
    selectPane("");
  });
  if (realHeights.client) Object.defineProperty(happy.HTMLElement.prototype, "clientHeight", realHeights.client);
  if (realHeights.scroll) Object.defineProperty(happy.HTMLElement.prototype, "scrollHeight", realHeights.scroll);
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

describe("hunks", () => {
  test("a head says which lines its hunk covers and what Git names them; the raw @@ line is not shown", async () => {
    await boot();
    await openDiff();
    const heads = all(".workspace-diff-hunk");
    expect(heads.map((head) => head.querySelector(".workspace-hunk-title")?.textContent)).toEqual(["第 3–7 行", "第 41–42 行"]);
    expect(heads[0].querySelector(".workspace-hunk-context")?.textContent).toBe("export function App() {");
    expect(heads[1].querySelector(".workspace-hunk-context")).toBeNull();
    expect(one(".workspace-diff").textContent).not.toContain("@@");
    expect(all(".workspace-diff-group").map((group) => group.getAttribute("aria-label"))).toEqual(["第 3–7 行", "第 41–42 行"]);
  });

  test("the unchanged stretch before a hunk is counted, and opens the file there", async () => {
    await boot();
    await openDiff();
    const gaps = all(".workspace-diff-gap");
    expect(gaps.map((gap) => gap.textContent)).toEqual(["未改动 2 行在文件中查看", "未改动 33 行在文件中查看"]);
    await press(gaps[1].querySelector("button")!);
    expect(opened.at(-1)?.path).toBe("src/app.ts");
    expect(workspaceModel.view).toBe("file");
    // The first hunk ends at line 7: the stretch starts on the next one.
    expect(workspaceModel.sourceLine).toBe(8);
  });

  test("the index's diff of a file the working tree changed again cannot say where its lines are on disk", async () => {
    changes = [{ path: "src/app.ts", index: "M", worktree: "M" }];
    await boot();
    await openDiff("src/app.ts", "staged");
    expect(all(".workspace-diff-gap").map((gap) => gap.textContent)).toEqual(["未改动 2 行", "未改动 33 行"]);
    expect(document.querySelector(".workspace-diff-gap button")).toBeNull();
    // The working tree's own diff is the file as it is.
    await openDiff("src/app.ts", "worktree");
    expect(all(".workspace-diff-gap button")).toHaveLength(2);
  });

  test("a hunk folds at its head, says what it holds, and stays folded while the reader is away", async () => {
    await boot();
    await openDiff();
    const head = () => all<HTMLButtonElement>(".workspace-hunk-toggle");
    expect(all(".workspace-diff-line")).toHaveLength(9);
    await press(head()[0]);
    expect(head()[0].getAttribute("aria-expanded")).toBe("false");
    expect(head()[0].querySelector(".workspace-hunk-count")?.textContent).toBe("6 行");
    expect(all(".workspace-diff-line")).toHaveLength(3);
    // Back to the list and in again: the patch is as they left it.
    await press(one(".workspace-chrome .back"));
    expect(workspaceModel.view).toBe("browser");
    await openDiff("src/app.ts");
    expect(head().map((button) => button.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
    // Another file's patch starts unfolded.
    await openDiff("src/b.ts");
    expect(head().map((button) => button.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
  });

  test("folding the hunk a note is being written in sets the note aside; opening the note again unfolds it", async () => {
    await boot(390, true);
    await openDiff();
    await press(one(".diff-add .diff-comment-btn"));
    const field = one<HTMLTextAreaElement>("form.diff-note-inline textarea");
    await act(async () => {
      field.focus();
      Object.getOwnPropertyDescriptor(happy.HTMLTextAreaElement.prototype, "value")!.set!.call(field, "why true");
      field.dispatchEvent(new happy.Event("input", { bubbles: true }) as unknown as Event);
    });
    const head = () => all<HTMLButtonElement>(".workspace-hunk-toggle")[0];
    await press(head());
    expect(document.querySelector("form.diff-note-inline")).toBeNull();
    expect(head().getAttribute("aria-expanded")).toBe("false");
    // The words wait inside, and the folded head counts them.
    expect(head().querySelector(".workspace-hunk-notes")?.textContent).toBe("1");
    expect(head().getAttribute("aria-label")).toContain("1 条批注");
    await press(head());
    expect(one(".workspace-diff-note.is-draft").textContent).toContain("why true");
  });
});

describe("a long patch", () => {
  const long = (lines: number) => `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, index) => `+line ${index + 1}`).join("\n")}\n`;

  test("is drawn a stretch at a time, as the reader nears the end of what is drawn", async () => {
    patch = long(DIFF_BATCH_LINES * 2 + 50);
    // 20px a line: the first stretch is 8000px in a 600px box, nowhere near its end.
    box = { height: 600, line: 20 };
    await boot();
    await openDiff();
    const scroller = one(".workspace-diff");
    expect(all(".workspace-diff-line")).toHaveLength(DIFF_BATCH_LINES);
    expect(one(".workspace-diff-more").textContent).toBe(`再显示 ${DIFF_BATCH_LINES + 50} 行`);
    await act(async () => {
      scroller.scrollTop = 7000;
      scroller.dispatchEvent(new happy.Event("scroll") as unknown as Event);
    });
    // One more stretch, and the end is far again.
    expect(all(".workspace-diff-line")).toHaveLength(DIFF_BATCH_LINES * 2);
    // The button is the same step for a keyboard.
    await press(one(".workspace-diff-more"));
    expect(all(".workspace-diff-line")).toHaveLength(DIFF_BATCH_LINES * 2 + 50);
    expect(document.querySelector(".workspace-diff-more")).toBeNull();
  });

  test("is not seen until its last stretch is drawn and reached", async () => {
    patch = long(DIFF_BATCH_LINES + 10);
    box = { height: 600, line: 20 };
    await boot();
    await openDiff();
    const scroller = one(".workspace-diff");
    const progress = () => one(".workspace-subline-reviewed").textContent;
    const scrollTo = async (top: number) => {
      await act(async () => {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new happy.Event("scroll") as unknown as Event);
      });
      await settle();
    };
    // The end of what is drawn is not the end of the patch: the rest is drawn, 200px further on.
    await scrollTo(7400);
    expect(all(".workspace-diff-line")).toHaveLength(DIFF_BATCH_LINES + 10);
    expect(progress()).toBe("已看 0/2");
    await scrollTo(7600);
    expect(progress()).toBe("已看 1/2");
  });
});

describe("words and sides", () => {
  test("a replaced line marks the words that changed, and its text is still the whole line", async () => {
    await boot();
    await openDiff();
    expect(one(".diff-delete .diff-word").textContent).toBe("false");
    expect(one(".diff-add .diff-word").textContent).toBe("true");
    expect(one(".diff-add .diff-line-text").textContent).toBe("const ready = true;");
    // An added line with nothing in its place is new as a whole.
    expect(all(".diff-add")[1].querySelector(".diff-word")).toBeNull();
  });

  test("an unchanged line carries its old number for the second column; its own text is the one number", async () => {
    await boot();
    await openDiff();
    const numbers = all(".workspace-diff-line").slice(0, 4).map((line) => line.querySelector<HTMLElement>(".diff-line-number")!);
    expect(numbers.map((number) => number.textContent)).toEqual(["3", "4", "4", "5"]);
    expect(numbers.map((number) => number.dataset.old ?? null)).toEqual(["3", null, null, null]);
    const tail = all(".workspace-diff-line")[4].querySelector<HTMLElement>(".diff-line-number")!;
    expect([tail.dataset.old, tail.textContent]).toEqual(["5", "6"]);
  });

  test("two sides are offered from 1200px, shown once chosen, and one column below that whatever was chosen", async () => {
    await boot(1440, true);
    await openDiff();
    const toggle = () => one<HTMLButtonElement>(".workspace-tool[aria-label='并排对比']");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".workspace-diff.is-split")).toBeNull();
    await press(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(one(".workspace-diff").classList.contains("is-split")).toBeTrue();
    const rows = all(".workspace-diff-group")[0].querySelectorAll(".diff-split-row");
    const sides = [...rows].map((row) => [...row.querySelectorAll(".diff-split-cell")].map((cell) =>
      cell.classList.contains("is-blank") ? null : `${cell.querySelector(".diff-line-number")?.textContent}:${cell.querySelector(".diff-line-text")?.textContent}`));
    expect(sides).toEqual([
      ["3:keep", "3:keep"],
      ["4:const ready = false;", "4:const ready = true;"],
      [null, "5:const extra = 1;"],
      ["5:tail", "6:tail"],
      ["6:end", "7:end"],
    ]);
    // An unchanged line is one line: its note is pinned once, on the new side.
    const pins = all(".diff-comment-btn").map((button) => button.dataset.noteLine);
    expect(new Set(pins).size).toBe(pins.length);
    expect(pins.slice(0, 3)).toEqual(["worktree:new:3:src/app.ts", "worktree:old:4:src/app.ts", "worktree:new:4:src/app.ts"]);
    // A note opens under the row, whichever half was pressed.
    await press(one<HTMLElement>(".diff-split-row .diff-split-cell"));
    expect(one("form.diff-note-inline").previousElementSibling?.classList.contains("diff-split-row")).toBeTrue();
  });

  test("below 1200px the choice is neither offered nor applied", async () => {
    setSplitChosen(true);
    await boot(1024);
    await openDiff();
    expect(document.querySelector(".workspace-tool[aria-label='并排对比']")).toBeNull();
    expect(document.querySelector(".workspace-diff.is-split")).toBeNull();
    expect(all(".diff-split-row")).toHaveLength(0);
  });
});

describe("the head of an open diff", () => {
  test("one screen at a time, the header steps from file to file and the foot is left to notes", async () => {
    await boot();
    await openDiff();
    const stepper = one(".workspace-chrome .workspace-stepper");
    expect(stepper.querySelector(".workspace-step-where")?.textContent).toBe("1 / 2");
    expect(document.querySelector(".workspace-diff-footer .workspace-stepper")).toBeNull();
    expect(document.querySelector(".workspace-detail-head .workspace-stepper")).toBeNull();
    // Refresh gave its place to the stepper; it waits in ⋯.
    expect(document.querySelector(".workspace-chrome .workspace-refresh")).toBeNull();
    await press(stepper.querySelector<HTMLButtonElement>("[aria-label='下一个改动文件']")!);
    expect(workspaceModel.detailPath).toBe("src/b.ts");
    expect(one(".workspace-step-where").textContent).toBe("2 / 2");
    expect(one<HTMLButtonElement>("[aria-label='下一个改动文件']").disabled).toBeTrue();
  });

  test("beside the list the info bar has the stepper, and the header keeps refresh", async () => {
    await boot(1024);
    await openDiff();
    expect(document.querySelector(".workspace-chrome .workspace-stepper")).toBeNull();
    expect(one(".workspace-detail-head .workspace-stepper .workspace-step-where").textContent).toBe("1 / 2");
    expect(one(".workspace-chrome .workspace-refresh")).toBeTruthy();
  });

  test("from hunk to hunk: only where there is more than one, and the file opens from an icon", async () => {
    // Each hunk 300px down the diff from the last, in a box too short to show both.
    box = { height: 200, content: 600 };
    const realRect = happy.HTMLElement.prototype.getBoundingClientRect;
    happy.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const scroller = this.closest<HTMLElement>(".workspace-diff");
      const index = this.classList.contains("workspace-diff-group") ? [...this.parentElement!.children].indexOf(this) : -1;
      const top = index >= 0 && scroller ? index * 300 - scroller.scrollTop : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    } as typeof realRect;
    try {
      await boot();
      await openDiff();
      const nav = one(".workspace-hunk-nav");
      const [up, down] = [...nav.querySelectorAll<HTMLButtonElement>("button")];
      const where = () => nav.querySelector(".workspace-hunk-where")?.textContent;
      expect(where()).toBe("1/2 段");
      expect([up.disabled, down.disabled]).toEqual([true, false]);
      await act(async () => { down.click(); });
      await act(async () => { one(".workspace-diff").dispatchEvent(new happy.Event("scroll") as unknown as Event); });
      expect(one(".workspace-diff").scrollTop).toBe(300);
      expect(where()).toBe("2/2 段");
      expect(up.disabled).toBeFalse();
      await act(async () => { up.click(); });
      expect(one(".workspace-diff").scrollTop).toBe(0);
    } finally {
      happy.HTMLElement.prototype.getBoundingClientRect = realRect;
    }
    await press(one(".workspace-open-file"));
    expect(workspaceModel.view).toBe("file");
    patch = "@@ -1 +1 @@\n-a\n+b\n";
    await openDiff("src/b.ts");
    expect(document.querySelector(".workspace-hunk-nav")).toBeNull();
  });
});
