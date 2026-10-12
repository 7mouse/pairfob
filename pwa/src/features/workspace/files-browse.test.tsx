import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { expectDifferentNode } from "../../../test-support/node-identity";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../app/dom-root";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { setLang } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { ProtocolError } from "../../lib/protocol/errors";
import { WorkspaceScreen } from "../../pages/workspace/screen";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { replaceAgentsFromSnapshot } from "../dashboard/catalog-store";
import { applyCapabilities } from "../operations/capabilities-store";
import { selectPane } from "../session/session-store";
import { resetFileFilter } from "./file-filter";
import { SEARCH_DELAY_MS, resetFileSearch } from "./file-search";
import { clearWorkspacePendingReveal, enterWorkspace, refreshWorkspace, workspaceModel } from "./index";

/**
 * Browsing files one screen at a time (a phone, or a window under 900px): the
 * header carries the folder and its Back climbs out of it, so the list has no
 * trail of its own; the list starts with its filter, and at the root with the
 * files opened last from below it.
 */

const revision = "a".repeat(64);
const seedRestorer = new WorkspaceSnapshotRestorer();
/** The daemon says it lists files by name (search_files). The session can always ask: only the capability decides. */
let searchable = false;
let searches: Array<[string, string]> = [];
/** Answers held back by query, to land when the test lets them. */
let held: Map<string, () => void> = new Map();
/** How many entries a directory page carries; the root's are then split over pages. */
let pageSize = 0;
/** What the agent's turn wrote, from a daemon with trace_writes. */
let written: string[] | null = null;
/** The search that failed goes through when asked again. */
let mended = false;
/** Files deleted on the computer since they were listed. */
let gone: Set<string> = new Set();

const TREE: Record<string, Array<{ name: string; dir?: boolean }>> = {
  "": [{ name: "src", dir: true }, { name: "README.md" }, { name: "package.json" }],
  "src": [{ name: "lib", dir: true }, { name: "app.ts" }, { name: "App.tsx" }, { name: "styles.scss" }],
  "src/lib": [{ name: "util.ts" }],
};

function liveFixture() {
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: false },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "", cursor = "") => {
      const all = (TREE[path] ?? []).map((item) => ({
        name: item.name, path: path ? `${path}/${item.name}` : item.name, kind: item.dir ? "directory" as const : "file" as const,
        size: 10, modified_ms: 1, hidden: false, ...(item.dir ? {} : { revision }),
      }));
      const from = Number(cursor || 0);
      const to = pageSize ? from + pageSize : all.length;
      return { path, entries: all.slice(from, to), next_cursor: to < all.length ? String(to) : null, truncated: false, revision };
    },
    workspaceRead: async (_pane: string, path: string) => {
      if (gone.has(path)) throw new ProtocolError("workspace_not_found", "workspace target is no longer available");
      return { path, kind: "text" as const, size: 10, modified_ms: 1, content: "export {};\n", truncated: false, revision };
    },
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision,
      changes: [{ path: "src/app.ts", original_path: null, index: " ", worktree: "M" }],
    }),
    workspaceSearch: async (_pane: string, root: string, query: string) => {
      searches.push([root, query]);
      if (query === "boom" && !mended) throw new Error("offline");
      if (query.startsWith("slow")) await new Promise<void>((resolve) => { held.set(query, resolve); });
      const all = Object.entries(TREE).flatMap(([folder, items]) => items.filter((item) => !item.dir).map((item) => folder ? `${folder}/${item.name}` : item.name));
      const needle = query.replace(/^slow-/, "").toLowerCase();
      const hits = all.filter((path) => path.toLowerCase().includes(needle));
      return { query, items: hits.map((path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1) })), truncated: query === "ts" };
    },
    ...(written ? { agentTurnWrites: async () => written } : {}),
  };
}

const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = appRoot().querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};
const names = () => [...appRoot().querySelectorAll(".workspace-list .workspace-row:not(.is-recent) .workspace-row-name")].map((node) => node.textContent);
const recentNames = () => [...appRoot().querySelectorAll(".workspace-row.is-recent .workspace-row-name")].map((node) => node.textContent);
const row = (name: string) => [...appRoot().querySelectorAll<HTMLButtonElement>(".workspace-row-main")]
  .find((button) => button.querySelector(".workspace-row-name")?.textContent === name)!;
const back = () => one<HTMLButtonElement>(".workspace-chrome .back");

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

async function type(value: string): Promise<void> {
  const field = one<HTMLInputElement>(".workspace-filter-input");
  await act(async () => {
    // happy-dom has no native `input` support as React tests for it, so React
    // watches the focused field and reads it on a key: focus, set through the
    // prototype (past React's value tracker), then the key.
    field.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new happy.Event("input", { bubbles: true }) as unknown as Event);
    field.dispatchEvent(new happy.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
}

async function boot(width = 390): Promise<void> {
  happy.happyDOM.setWindowSize({ width, height: 844 });
  await act(async () => {
    setLang("zh");
    seedRestorer.capture();
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, search_files: searchable }, []);
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "pairfob" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/work/pairfob", agent: "codex", agent_status: "idle" }],
    });
    attachLiveSession(liveFixture() as never);
    renderReact(<WorkspaceScreen />);
    await enterWorkspace("p1", undefined, false, "files");
  });
  await settle();
}

beforeEach(async () => {
  await resetBoardTestDOM();
  clearWorkspacePendingReveal();
  searchable = false;
  searches = [];
  held = new Map();
  pageSize = 0;
  written = null;
  mended = false;
  gone = new Set();
  resetFileFilter();
  resetFileSearch();
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
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

describe("the header carries the folder", () => {
  test("at the root it is the repository, and Back leaves for the session", async () => {
    await boot();
    expect(one(".workspace-repo-title .workspace-name").textContent).toBe("pairfob");
    expect(appRoot().querySelector(".workspace-breadcrumbs")).toBeNull();
    expect(back().getAttribute("aria-label")).toBe("返回终端");
  });

  test("inside a folder it names the folder over its path, and Back climbs one level at a time", async () => {
    await boot();
    await press(row("src"));
    await press(row("lib"));
    expect(workspaceModel.directory).toBe("src/lib");
    expect(one(".workspace-folder-title .workspace-name").textContent).toBe("lib");
    expect(one(".workspace-folder-title .workspace-root").textContent).toBe("pairfob / src");
    // Its name says the folder it shows, not only what pressing it does.
    expect(one(".workspace-folder-title").getAttribute("aria-label")).toBe("lib，跳转到其他文件夹");
    expect(appRoot().querySelector(".workspace-repo-title")).toBeNull();

    expect(back().getAttribute("aria-label")).toBe("上一级");
    await press(back());
    expect(workspaceModel.directory).toBe("src");
    expect(currentScreen()).toBe("workspace");
    await press(back());
    expect(workspaceModel.directory).toBe("");
    expect(back().getAttribute("aria-label")).toBe("返回终端");
  });

  test("the changes tab keeps the repository whatever folder the files tab is in, and says how much of it is seen", async () => {
    await boot();
    await press(row("src"));
    await press(one(".workspace-tabs [role='tab']:first-child"));
    expect(workspaceModel.tab).toBe("changes");
    expect(one(".workspace-repo-title .workspace-name").textContent).toBe("pairfob");
    expect(one(".workspace-subline-reviewed").textContent).toBe("已看 0/1");
    expect(back().getAttribute("aria-label")).toBe("返回终端");
  });

  test("beside the list the trail stays in the list, inside a folder, and the header keeps the repository", async () => {
    await boot(1280);
    // At the root the title already names the repository: no trail is drawn over the list.
    expect(appRoot().querySelector(".workspace-breadcrumbs")).toBeNull();
    await press(row("src"));
    expect(one(".workspace-breadcrumbs").textContent).toContain("src");
    expect(appRoot().querySelector(".workspace-folder-title")).toBeNull();
    expect(back().getAttribute("aria-label")).toBe("返回终端");
  });
});

describe("the directory's filter", () => {
  test("it narrows the rows to the names that contain what is typed, whatever the case", async () => {
    await boot();
    await press(row("src"));
    expect(names()).toEqual(["lib", "app.ts", "App.tsx", "styles.scss"]);
    await type("APP");
    expect(names()).toEqual(["app.ts", "App.tsx"]);
    await type("zzz");
    expect(names()).toEqual([]);
    expect(one(".workspace-empty").textContent).toBe("没有匹配的文件");
  });

  test("it is named for the folder and never takes focus by itself", async () => {
    await boot();
    expect(one<HTMLInputElement>(".workspace-filter-input").placeholder).toBe("筛选文件");
    await press(row("src"));
    expect(one<HTMLInputElement>(".workspace-filter-input").placeholder).toBe("筛选 src");
    // Focus there would raise the on-screen keyboard over the list the reader came to see.
    expectDifferentNode(document.activeElement, one(".workspace-filter-input"));
  });

  test("another directory starts unfiltered", async () => {
    await boot();
    await press(row("src"));
    await type("app");
    await press(back());
    expect(one<HTMLInputElement>(".workspace-filter-input").value).toBe("");
    expect(names()).toEqual(["src", "README.md", "package.json"]);
  });
});

describe("the files opened last", () => {
  test("a file opened below the root is listed over the root, with the folder it is in", async () => {
    await boot();
    expect(appRoot().querySelector(".workspace-recent")).toBeNull();
    await press(row("src"));
    await press(row("app.ts"));
    expect(workspaceModel.view).toBe("file");
    await press(back());
    // Inside the folder nothing is added above its own rows.
    expect(appRoot().querySelector(".workspace-recent")).toBeNull();
    await press(back());
    expect(recentNames()).toEqual(["app.ts"]);
    expect(one(".workspace-row.is-recent .workspace-row-folder").textContent).toBe("src");
    // It carries the file's mark, and opens it.
    expect(one(".workspace-row.is-recent .workspace-git-mark").textContent).toBe("M");
    await press(one(".workspace-row.is-recent .workspace-row-main"));
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("a file the root itself lists is not repeated above it", async () => {
    await boot();
    await press(row("README.md"));
    await press(back());
    expect(appRoot().querySelector(".workspace-recent")).toBeNull();
    expect(names()).toEqual(["src", "README.md", "package.json"]);
  });

  test("a file that is gone from the computer leaves the list once the reader has found that out", async () => {
    await boot();
    await press(row("src"));
    await press(row("app.ts"));
    await press(back());
    await press(back());
    expect(recentNames()).toEqual(["app.ts"]);
    gone.add("src/app.ts");
    // Past the read cache's few seconds, the file is read again and is not there.
    await act(async () => { await refreshWorkspace(); });
    await press(one(".workspace-row.is-recent .workspace-row-main"));
    expect(workspaceModel.error).not.toBe("");
    await press(back());
    expect(appRoot().querySelector(".workspace-recent")).toBeNull();
  });

  test("the section folds, and a filter puts it away", async () => {
    await boot();
    await press(row("src"));
    await press(row("app.ts"));
    await press(back());
    await press(back());
    await press(one(".workspace-recent button.workspace-section"));
    expect(recentNames()).toEqual([]);
    expect(one(".workspace-recent button.workspace-section").getAttribute("aria-expanded")).toBe("false");
    await press(one(".workspace-recent button.workspace-section"));
    expect(recentNames()).toEqual(["app.ts"]);
    await type("read");
    expect(appRoot().querySelector(".workspace-recent")).toBeNull();
    expect(names()).toEqual(["README.md"]);
  });
});

describe("the whole workspace, from two letters on", () => {
  const found = () => [...appRoot().querySelectorAll(".workspace-row.is-search")].map((node) =>
    `${node.querySelector(".workspace-row-folder")?.textContent}/${node.querySelector(".workspace-row-name")?.textContent}`);
  const note = () => appRoot().querySelector(".workspace-search-note")?.textContent ?? null;
  async function answered(): Promise<void> {
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, SEARCH_DELAY_MS + 30)); });
    await settle();
  }

  test("the computer is asked once typing has settled, and its files are listed under the directory's own, each with its folder", async () => {
    searchable = true;
    await boot();
    await type("a");
    await answered();
    // One letter is the directory's filter alone.
    expect(searches).toEqual([]);
    expect(appRoot().querySelector(".workspace-search")).toBeNull();

    await type("ap");
    expect(note()).toBe("正在搜索…");
    await type("app");
    await answered();
    // Only the query the reader stopped on was sent, for the root on screen.
    expect(searches).toEqual([["/work/pairfob", "app"]]);
    expect(names()).toEqual([]);
    expect(found()).toEqual(["src/app.ts", "src/App.tsx"]);
    expect(note()).toBeNull();
    // The directory has no match of its own, and the section speaks for the rest: no "nothing matches" over results.
    expect(appRoot().querySelector(".workspace-empty")).toBeNull();

    await press(appRoot().querySelector<HTMLElement>(".workspace-row.is-search .workspace-row-main")!);
    expect(workspaceModel.view).toBe("file");
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("a file the directory itself lists is not repeated among the results", async () => {
    searchable = true;
    await boot();
    await type("read");
    await answered();
    expect(names()).toEqual(["README.md"]);
    expect(found()).toEqual([]);
    // The one file it found is the row above: the repository has no other, which is not "none".
    expect(note()).toBe("仓库里没有其他匹配的文件");
    await type("zzzz");
    await answered();
    expect(note()).toBe("仓库里没有匹配的文件");
  });

  test("more matches than fit, and a search that failed, are said under the section", async () => {
    searchable = true;
    await boot();
    await type("ts");
    await answered();
    expect(found()).toEqual(["src/app.ts", "src/App.tsx", "src/lib/util.ts"]);
    expect(note()).toBe("结果较多，只显示前 3 个，再多输入几个字。");
    await type("boom");
    await answered();
    expect(found()).toEqual([]);
    // The section says why it is empty; the list does not also claim that nothing matches.
    expect(one(".workspace-search-failed span").textContent).toBe("这次没搜成。");
    expect(appRoot().querySelector(".workspace-empty")).toBeNull();
    // The same letters are asked again from the note: nothing has to be retyped.
    mended = true;
    await press(one(".workspace-search-failed .btn"));
    await answered();
    expect(searches.filter(([, query]) => query === "boom")).toHaveLength(2);
    expect(appRoot().querySelector(".workspace-search-failed")).toBeNull();
    expect(note()).toBe("仓库里没有匹配的文件");
  });

  test("a daemon that does not say it can search is never asked, though the session could ask", async () => {
    await boot();
    await type("app");
    await answered();
    expect(searches).toEqual([]);
    expect(appRoot().querySelector(".workspace-search")).toBeNull();
    expect(one(".workspace-empty").textContent).toBe("没有匹配的文件");
  });

  test("an answer to letters the reader has typed past never lands over the newer ones", async () => {
    searchable = true;
    await boot();
    await type("slow-app");
    await answered();
    expect(searches.map(([, query]) => query)).toEqual(["slow-app"]);
    // Still unanswered when the reader types on.
    await type("util");
    await answered();
    expect(found()).toEqual(["src/lib/util.ts"]);
    await act(async () => { held.get("slow-app")!(); await Promise.resolve(); });
    await settle();
    expect(found()).toEqual(["src/lib/util.ts"]);
  });

  test("a refresh asks the search on screen again", async () => {
    searchable = true;
    await boot();
    await type("app");
    await answered();
    expect(searches).toHaveLength(1);
    TREE["src"].push({ name: "apply.ts" });
    try {
      await act(async () => { await refreshWorkspace(); });
      // The rows it had stay until the new answer lands.
      expect(found()).toEqual(["src/app.ts", "src/App.tsx"]);
      await answered();
      expect(searches).toHaveLength(2);
      expect(found()).toEqual(["src/app.ts", "src/App.tsx", "src/apply.ts"]);
    } finally {
      TREE["src"].pop();
    }
  });

  test("a query longer than the computer accepts is the directory's filter alone", async () => {
    searchable = true;
    await boot();
    await type("a".repeat(129));
    await answered();
    expect(searches).toEqual([]);
    expect(appRoot().querySelector(".workspace-search")).toBeNull();
  });
});

describe("a directory read in pages", () => {
  const more = () => appRoot().querySelector<HTMLButtonElement>(".workspace-more");

  test("the filter narrows what was loaded, says so, and keeps the way to load the rest", async () => {
    pageSize = 2;
    await boot();
    expect(names()).toEqual(["src", "README.md"]);
    await type("pack");
    // package.json is on the next page: not "no files match", and the rest is one press away.
    expect(names()).toEqual([]);
    expect(appRoot().querySelector(".workspace-empty")).toBeNull();
    expect(one(".workspace-filter-partial").textContent).toBe("只筛选了已加载的文件，这个目录还有更多。");
    await press(more()!);
    expect(names()).toEqual(["package.json"]);
    // Everything is loaded now: nothing more to say or to load.
    expect(appRoot().querySelector(".workspace-filter-partial")).toBeNull();
    expect(more()).toBeNull();
    await type("zzz");
    expect(one(".workspace-empty").textContent).toBe("没有匹配的文件");
  });
});

describe("the files the agent's turn wrote", () => {
  const turn = () => [...appRoot().querySelectorAll(".workspace-row.is-turn")].map((node) =>
    `${node.querySelector(".workspace-row-folder")?.textContent}/${node.querySelector(".workspace-row-name")?.textContent}`);

  test("stand over the root's own rows, which take the repository's name as their heading", async () => {
    written = ["/work/pairfob/src/app.ts", "src/lib/util.ts", "/tmp/elsewhere.ts"];
    await boot();
    expect(one(".workspace-turn .workspace-section-name").textContent).toBe("Agent 本轮改过");
    expect(one(".workspace-turn .workspace-section-count").textContent).toBe("2");
    expect(turn()).toEqual(["src/app.ts", "src/lib/util.ts"]);
    expect(one(".workspace-row.is-turn .workspace-git-mark").textContent).toBe("M");
    expect([...appRoot().querySelectorAll(".workspace-list > h3.workspace-section")].map((node) => node.textContent)).toEqual(["pairfob"]);
    // A row of the turn has no time to show, and opens its file.
    expect(appRoot().querySelector(".workspace-row.is-turn .workspace-row-age")).toBeNull();
    await press(appRoot().querySelector<HTMLElement>(".workspace-row.is-turn .workspace-row-main")!);
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("past its first rows the section offers the rest, and its count is of all of them", async () => {
    written = Array.from({ length: 11 }, (_, index) => `gen/file-${index}.ts`);
    await boot();
    expect(one(".workspace-turn .workspace-section-count").textContent).toBe("11");
    expect(turn()).toHaveLength(8);
    expect(one(".workspace-section-more").textContent).toBe("再显示 3 个");
    await press(one(".workspace-section-more"));
    expect(turn()).toHaveLength(11);
    expect(appRoot().querySelector(".workspace-section-more")).toBeNull();
  });

  test("only at the root, and not while the list is filtered", async () => {
    written = ["src/app.ts"];
    await boot();
    await type("read");
    expect(appRoot().querySelector(".workspace-turn")).toBeNull();
    await type("");
    await press(row("src"));
    expect(appRoot().querySelector(".workspace-turn")).toBeNull();
  });

  test("with none, the root's rows need no heading", async () => {
    await boot();
    expect(appRoot().querySelector(".workspace-turn")).toBeNull();
    expect(appRoot().querySelector(".workspace-list > h3.workspace-section")).toBeNull();
  });
});
