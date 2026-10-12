import { beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { setCredential } from "../computers/catalog-store";
import {
  RECENT_FILES_LIMIT, RECENT_ROOTS_KEPT, forgetRecentFile, noteRecentFile, recentEntries, recentFiles, recentOpen, rereadRecentFiles,
  resetRecentFiles, setRecentOpen,
} from "./recent-files";

/**
 * The files opened last are kept per repository root of one computer, on this
 * device: newest first, a handful at most, following a rename and letting go
 * of a delete.
 */

const KEY = "pairfob.workspace.recent";
const computer = (daemonId: string | null) => setCredential(daemonId ? { daemonId } as never : null);

const file = (path: string) => ({ path, size: 10, modified_ms: 1 });

beforeEach(async () => {
  await resetBoardTestDOM();
  // No computer, whatever a test before this file left paired: the keys below are this file's own.
  computer(null);
  resetRecentFiles();
});

test("the last file opened leads, and a file opened again moves up instead of doubling", () => {
  noteRecentFile("/work/a", file("src/one.ts"), 1);
  noteRecentFile("/work/a", file("src/two.ts"), 2);
  noteRecentFile("/work/a", file("src/one.ts"), 3);
  expect(recentFiles("/work/a").map((item) => item.path)).toEqual(["src/one.ts", "src/two.ts"]);
});

test("the list is a handful, and each root has its own", () => {
  for (let index = 0; index < RECENT_FILES_LIMIT + 3; index++) noteRecentFile("/work/a", file(`src/${index}.ts`), index);
  noteRecentFile("/work/b", file("lib/b.ts"), 1);
  expect(recentFiles("/work/a")).toHaveLength(RECENT_FILES_LIMIT);
  expect(recentFiles("/work/a")[0].path).toBe(`src/${RECENT_FILES_LIMIT + 2}.ts`);
  expect(recentFiles("/work/b").map((item) => item.path)).toEqual(["lib/b.ts"]);
});

test("a renamed file keeps its place under the new name, and a deleted one leaves", () => {
  noteRecentFile("/work/a", file("src/one.ts"), 1);
  noteRecentFile("/work/a", file("src/two.ts"), 2);
  forgetRecentFile("/work/a", "src/two.ts", "src/renamed.ts");
  expect(recentFiles("/work/a").map((item) => item.path)).toEqual(["src/renamed.ts", "src/one.ts"]);
  forgetRecentFile("/work/a", "src/one.ts");
  expect(recentFiles("/work/a").map((item) => item.path)).toEqual(["src/renamed.ts"]);
});

test("a row drawn from the list is a file with its name, and no revision to mutate it by", () => {
  noteRecentFile("/work/a", file("src/deep/one.ts"), 1);
  const [entry] = recentEntries("/work/a");
  expect(entry).toMatchObject({ name: "one.ts", path: "src/deep/one.ts", kind: "file" });
  expect(entry.revision).toBeUndefined();
});

test("it survives a reload through storage, and the fold is remembered", async () => {
  noteRecentFile("/work/a", file("src/one.ts"), 1);
  setRecentOpen(false);
  expect(JSON.parse(localStorage.getItem(KEY)!)["\n/work/a"][0].path).toBe("src/one.ts");
  expect(localStorage.getItem("pairfob.workspace.recentOpen")).toBe("0");
  expect(recentOpen()).toBeFalse();
});

test("each computer has its own list for the same path", () => {
  computer("studio");
  noteRecentFile("/work/a", file("src/studio.ts"), 1);
  computer("laptop");
  expect(recentFiles("/work/a")).toEqual([]);
  noteRecentFile("/work/a", file("src/laptop.ts"), 2);
  computer("studio");
  expect(recentFiles("/work/a").map((item) => item.path)).toEqual(["src/studio.ts"]);
  computer(null);
});

test("only the roots written last are kept, and a root whose last file left is not kept at all", () => {
  for (let index = 0; index < RECENT_ROOTS_KEPT + 2; index++) noteRecentFile(`/work/r${index}`, file("a.ts"), index);
  expect(recentFiles("/work/r0")).toEqual([]);
  expect(recentFiles("/work/r2")).toHaveLength(1);
  expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!))).toHaveLength(RECENT_ROOTS_KEPT);
  forgetRecentFile("/work/r2", "a.ts");
  expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!))).toHaveLength(RECENT_ROOTS_KEPT - 1);
});

test("what storage holds is checked on the way in: a broken entry is dropped and a broken figure reads as unknown", () => {
  localStorage.setItem(KEY, JSON.stringify({
    "\n/work/a": [
      { path: "src/ok.ts", size: 12, modified_ms: 34, at: 5 },
      { path: "src/odd.ts", size: "big", modified_ms: -1, at: 4 },
      { path: "", size: 1, modified_ms: 1, at: 3 },
      { path: "src/no-time.ts", size: 1, modified_ms: 1 },
      "not an entry",
    ],
    // Not a computer and a root: not this store's.
    "/work/legacy": [{ path: "old.ts", size: 1, modified_ms: 1, at: 1 }],
    "\n/work/b": "not a list",
  }));
  rereadRecentFiles();
  expect(recentFiles("/work/a")).toEqual([
    { path: "src/ok.ts", size: 12, modified_ms: 34, at: 5 },
    { path: "src/odd.ts", size: 0, modified_ms: 0, at: 4 },
  ]);
  expect(recentFiles("/work/b")).toEqual([]);
  localStorage.setItem(KEY, "{ not json");
  rereadRecentFiles();
  expect(recentFiles("/work/a")).toEqual([]);
});

test("storage that throws leaves the list in memory", () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  const broken = { getItem: () => { throw new Error("blocked"); }, removeItem: () => undefined, setItem: () => { throw new Error("quota"); } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: broken });
  try {
    noteRecentFile("/work/a", file("src/one.ts"), 1);
    setRecentOpen(false);
    expect(recentFiles("/work/a").map((item) => item.path)).toEqual(["src/one.ts"]);
    expect(recentOpen()).toBeFalse();
    rereadRecentFiles();
    expect(recentFiles("/work/a")).toEqual([]);
  } finally {
    Object.defineProperty(globalThis, "localStorage", real);
  }
});
