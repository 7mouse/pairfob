import { beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import type { GitChange, GitLayer } from "../../lib/workspace";
import { reviewOrder } from "./git-marks";
import { setCredential } from "../computers/catalog-store";
import {
  REVIEW_RECHECK_LIMIT, REVIEW_RECHECK_MS, REVIEW_ROOTS_KEPT, REVIEW_VERIFY_LIMIT,
  changeLineCount, changeTotals, diffStat, isReviewed, markReviewed, noteDiffRead, pruneReviewed, resetReviewProgress, reviewProgress,
  setReviewed, verifyReviewed,
} from "./review-progress";

/**
 * A diff is seen at the revision the reader read it at. Reading a newer patch
 * of the file withdraws the mark, their own "unseen" holds against reading it
 * again, and a status load checks the marks it still shows.
 */

const ROOT = "/work/pairfob";
const change = (path: string, index = " ", worktree = "M"): GitChange => ({ path, original_path: null, index, worktree });
const diff = (path: string, revision: string, layer: GitLayer = "worktree", additions = 3, deletions = 1) =>
  ({ path, layer, additions, deletions, revision });
const snapshot = (changes: GitChange[]) => ({ descriptor: { root: ROOT } as never, status: { changes, truncated: false } as never });
const status = (changes: GitChange[], head = "h1") => ({ head, changes });
/** A change as a daemon that counts lines lists it. */
const counted = (path: string, additions: number, modified: number): GitChange =>
  ({ ...change(path), stat: { worktree: { additions, deletions: 0 } }, modified_ms: modified });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const computer = (daemonId: string | null) => setCredential(daemonId ? { daemonId } as never : null);

beforeEach(async () => {
  await resetBoardTestDOM();
  // No computer, whatever a test before this file left paired: the keys below are this file's own.
  computer(null);
  resetReviewProgress();
});

test("a diff read to its end is seen, per layer of its file", () => {
  markReviewed(ROOT, "worktree", "src/app.ts", "r1");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();
  expect(isReviewed(ROOT, "staged", "src/app.ts")).toBeFalse();
  expect(isReviewed("/work/other", "worktree", "src/app.ts")).toBeFalse();
});

test("progress counts in review order and names the first diff not seen", () => {
  const changes = [change("a.ts", "M", "M"), change("b.ts")];
  // a.ts's row and then its staged tag, then b.ts.
  expect(reviewProgress(snapshot(changes))).toMatchObject({ seen: 0, total: 3, next: { path: "a.ts", layer: "worktree" } });
  markReviewed(ROOT, "worktree", "a.ts", "r1");
  markReviewed(ROOT, "worktree", "b.ts", "r1");
  expect(reviewProgress(snapshot(changes))).toMatchObject({ seen: 2, total: 3, next: { path: "a.ts", layer: "staged" } });
  markReviewed(ROOT, "staged", "a.ts", "r1");
  expect(reviewProgress(snapshot(changes)).next).toBeNull();
});

test("a read diff has its size, and a newer patch of a seen file is unseen again", () => {
  noteDiffRead(ROOT, diff("src/app.ts", "r1"));
  expect(diffStat(ROOT, "worktree", "src/app.ts")).toMatchObject({ additions: 3, deletions: 1 });
  markReviewed(ROOT, "worktree", "src/app.ts", "r1");
  // The same patch read again changes nothing.
  noteDiffRead(ROOT, diff("src/app.ts", "r1"));
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();
  noteDiffRead(ROOT, diff("src/app.ts", "r2", "worktree", 9, 4));
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeFalse();
  expect(diffStat(ROOT, "worktree", "src/app.ts")).toMatchObject({ additions: 9, deletions: 4, revision: "r2" });
});

test("the reader's own unseen holds against reading to the end again, until they say seen or the file changes", () => {
  noteDiffRead(ROOT, diff("src/app.ts", "r1"));
  markReviewed(ROOT, "worktree", "src/app.ts", "r1");
  setReviewed(ROOT, "worktree", "src/app.ts", null);
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeFalse();
  markReviewed(ROOT, "worktree", "src/app.ts", "r1");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeFalse();
  setReviewed(ROOT, "worktree", "src/app.ts", "r1");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();

  setReviewed(ROOT, "worktree", "src/app.ts", null);
  noteDiffRead(ROOT, diff("src/app.ts", "r2"));
  markReviewed(ROOT, "worktree", "src/app.ts", "r2");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();
});

test("marks for changes the status no longer lists are dropped", () => {
  markReviewed(ROOT, "worktree", "gone.ts", "r1");
  markReviewed(ROOT, "worktree", "kept.ts", "r1");
  pruneReviewed(ROOT, new Set(["worktree:kept.ts"]));
  expect(isReviewed(ROOT, "worktree", "gone.ts")).toBeFalse();
  expect(isReviewed(ROOT, "worktree", "kept.ts")).toBeTrue();
});

test("a status load re-reads the seen diffs only, and withdraws the marks that no longer match", async () => {
  markReviewed(ROOT, "worktree", "same.ts", "r1");
  markReviewed(ROOT, "worktree", "changed.ts", "r1");
  markReviewed(ROOT, "worktree", "committed.ts", "r1");
  const read: string[] = [];
  verifyReviewed(ROOT, status([change("same.ts"), change("changed.ts"), change("unseen.ts")]), async (path, layer) => {
    read.push(path);
    return diff(path, path === "changed.ts" ? "r2" : "r1", layer);
  });
  await flush();
  expect(read.sort()).toEqual(["changed.ts", "same.ts"]);
  expect(isReviewed(ROOT, "worktree", "same.ts")).toBeTrue();
  expect(isReviewed(ROOT, "worktree", "changed.ts")).toBeFalse();
  expect(isReviewed(ROOT, "worktree", "committed.ts")).toBeFalse();
});

test("a read that fails leaves the mark as it was", async () => {
  markReviewed(ROOT, "worktree", "same.ts", "r1");
  verifyReviewed(ROOT, status([change("same.ts")]), async () => { throw new Error("offline"); });
  await flush();
  expect(isReviewed(ROOT, "worktree", "same.ts")).toBeTrue();
});

test("with counts and times in the status, a seen diff is read again only when its entry changed", async () => {
  markReviewed(ROOT, "worktree", "a.ts", "r1");
  markReviewed(ROOT, "worktree", "b.ts", "r1");
  const read: string[] = [];
  const reader = (revisions: Record<string, string>) => async (path: string, layer: GitLayer) => {
    read.push(path);
    return diff(path, revisions[path] ?? "r1", layer);
  };
  const first = status([counted("a.ts", 1, 100), counted("b.ts", 2, 100)]);
  // Never checked: each is read once.
  verifyReviewed(ROOT, first, reader({}));
  await flush();
  expect(read.sort()).toEqual(["a.ts", "b.ts"]);

  // The same status again, a refresh or a tab switch later: nothing is read.
  read.length = 0;
  verifyReviewed(ROOT, first, reader({}));
  await flush();
  expect(read).toEqual([]);

  // The agent edits b.ts: its entry says so, and only it is read. Its patch is another one, so it is unseen.
  verifyReviewed(ROOT, status([counted("a.ts", 1, 100), counted("b.ts", 5, 200)]), reader({ "b.ts": "r2" }));
  await flush();
  expect(read).toEqual(["b.ts"]);
  expect(isReviewed(ROOT, "worktree", "a.ts")).toBeTrue();
  expect(isReviewed(ROOT, "worktree", "b.ts")).toBeFalse();

  // A commit under the changes makes every diff another one against it.
  read.length = 0;
  verifyReviewed(ROOT, status([counted("a.ts", 1, 100), counted("b.ts", 5, 200)], "h2"), reader({}));
  await flush();
  expect(read).toEqual(["a.ts"]);
});

test("a touched file whose patch is the same keeps its mark and is not read a third time", async () => {
  markReviewed(ROOT, "worktree", "a.ts", "r1");
  let reads = 0;
  const read = async (path: string, layer: GitLayer) => { reads++; return diff(path, "r1", layer); };
  verifyReviewed(ROOT, status([counted("a.ts", 1, 100)]), read);
  await flush();
  verifyReviewed(ROOT, status([counted("a.ts", 1, 999)]), read);
  await flush();
  verifyReviewed(ROOT, status([counted("a.ts", 1, 999)]), read);
  await flush();
  expect(reads).toBe(2);
  expect(isReviewed(ROOT, "worktree", "a.ts")).toBeTrue();
});

test("more changed entries than one load reads are read at the next ones: none is left out", async () => {
  const total = REVIEW_VERIFY_LIMIT + 6;
  const changes = Array.from({ length: total }, (_, index) => counted(`f${index}.ts`, 1, 100));
  for (const item of changes) markReviewed(ROOT, "worktree", item.path, "r1");
  const read = new Set<string>();
  let last = 0;
  const reader = async (path: string, layer: GitLayer) => { read.add(path); last++; return diff(path, "r1", layer); };
  verifyReviewed(ROOT, status(changes), reader);
  await flush();
  expect(last).toBe(REVIEW_VERIFY_LIMIT);
  last = 0;
  verifyReviewed(ROOT, status(changes), reader);
  await flush();
  expect(last).toBe(6);
  expect(read.size).toBe(total);
});

test("a status that cannot say reads a few seen diffs at a time, the least recently checked first, and not again at once", async () => {
  const total = REVIEW_RECHECK_LIMIT * 2 + 3;
  const changes = Array.from({ length: total }, (_, index) => change(`f${index}.ts`));
  for (const item of changes) markReviewed(ROOT, "worktree", item.path, "r1");
  const read: string[] = [];
  const reader = async (path: string, layer: GitLayer) => { read.push(path); return diff(path, "r1", layer); };
  let now = 1_000_000;
  verifyReviewed(ROOT, status(changes), reader, now);
  await flush();
  expect(read).toHaveLength(REVIEW_RECHECK_LIMIT);
  // A refresh a moment later goes on to the ones not yet checked, not back to the same ones.
  verifyReviewed(ROOT, status(changes), reader, now += 1_000);
  await flush();
  verifyReviewed(ROOT, status(changes), reader, now += 1_000);
  await flush();
  expect(new Set(read).size).toBe(total);
  expect(read).toHaveLength(total);
  // All checked within the half minute: the next load reads none.
  verifyReviewed(ROOT, status(changes), reader, now += 1_000);
  await flush();
  expect(read).toHaveLength(total);
  // Later they take their turn again, the oldest check first.
  verifyReviewed(ROOT, status(changes), reader, now + REVIEW_RECHECK_MS);
  await flush();
  expect(read.slice(total)).toEqual(read.slice(0, REVIEW_RECHECK_LIMIT));
});

test("marks belong to one computer: the same path on another has its own, and a load there prunes only its own", () => {
  computer("studio");
  markReviewed(ROOT, "worktree", "src/app.ts", "r1");
  computer("laptop");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeFalse();
  markReviewed(ROOT, "worktree", "src/other.ts", "r1");
  // The laptop's status lists none of the studio's changes.
  pruneReviewed(ROOT, new Set(["worktree:src/other.ts"]));
  computer("studio");
  expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();
  expect(isReviewed(ROOT, "worktree", "src/other.ts")).toBeFalse();
  computer(null);
});

test("a check answered after another computer was switched to does not touch that computer's marks", async () => {
  computer("studio");
  markReviewed(ROOT, "worktree", "a.ts", "r1");
  let answer!: (value: ReturnType<typeof diff>) => void;
  verifyReviewed(ROOT, status([change("a.ts")]), () => new Promise((resolve) => { answer = resolve; }));
  computer("laptop");
  markReviewed(ROOT, "worktree", "a.ts", "r1");
  // The studio's file has changed; the laptop's has not.
  answer(diff("a.ts", "r2"));
  await flush();
  expect(isReviewed(ROOT, "worktree", "a.ts")).toBeTrue();
  computer(null);
});

test("only the roots written last are kept", () => {
  for (let index = 0; index < REVIEW_ROOTS_KEPT + 3; index++) markReviewed(`/work/r${index}`, "worktree", "a.ts", "r1");
  expect(isReviewed("/work/r0", "worktree", "a.ts")).toBeFalse();
  expect(isReviewed("/work/r3", "worktree", "a.ts")).toBeTrue();
  expect(Object.keys(JSON.parse(localStorage.getItem("pairfob.workspace.reviewed")!))).toHaveLength(REVIEW_ROOTS_KEPT);
  // A root with no mark left is not kept at all.
  setReviewed("/work/r3", "worktree", "a.ts", null);
  expect(Object.keys(JSON.parse(localStorage.getItem("pairfob.workspace.reviewed")!))).toHaveLength(REVIEW_ROOTS_KEPT - 1);
});

test("storage that throws leaves the marks in memory", () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  const broken = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error("quota"); } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: broken });
  try {
    markReviewed(ROOT, "worktree", "src/app.ts", "r1");
    expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeTrue();
    setReviewed(ROOT, "worktree", "src/app.ts", null);
    expect(isReviewed(ROOT, "worktree", "src/app.ts")).toBeFalse();
  } finally {
    Object.defineProperty(globalThis, "localStorage", real);
  }
});

test("the marks are kept in storage with their revision", () => {
  markReviewed(ROOT, "staged", "src/app.ts", "r7");
  expect(JSON.parse(localStorage.getItem("pairfob.workspace.reviewed")!)[`\n${ROOT}`]["staged:src/app.ts"]).toBe("r7");
});

test("a change's size is what the status counted, and failing that what its opened diff showed", () => {
  const counted: GitChange = { ...change("a.ts", "M", "M"), stat: { staged: { additions: 4, deletions: 0 }, worktree: { additions: 1, deletions: 2 } } };
  const binary: GitChange = { ...change("logo.png"), stat: { worktree: { additions: 0, deletions: 0, binary: true } } };
  const plain = change("b.ts");
  const [worktreeA, stagedA, worktreeLogo, worktreeB] = reviewOrder([counted, binary, plain]);
  expect(changeLineCount(ROOT, stagedA)).toEqual({ additions: 4, deletions: 0, binary: false });
  expect(changeLineCount(ROOT, worktreeA)).toEqual({ additions: 1, deletions: 2, binary: false });
  expect(changeLineCount(ROOT, worktreeLogo)).toEqual({ additions: 0, deletions: 0, binary: true });
  // Nothing counted and never opened: unknown, not zero.
  expect(changeLineCount(ROOT, worktreeB)).toBeNull();
  noteDiffRead(ROOT, diff("b.ts", "r1", "worktree", 7, 3));
  expect(changeLineCount(ROOT, worktreeB)).toEqual({ additions: 7, deletions: 3, binary: false });
  // What the status counted is newer than a diff read earlier.
  noteDiffRead(ROOT, diff("a.ts", "r1", "worktree", 99, 99));
  expect(changeLineCount(ROOT, worktreeA)).toEqual({ additions: 1, deletions: 2, binary: false });
});

test("the totals are the sum of every listed diff, and unknown while any of them is: a part is not shown as the whole", () => {
  expect(changeTotals(snapshot([change("a.ts"), change("b.ts")]))).toBeNull();
  expect(changeTotals(snapshot([]))).toBeNull();
  const both: GitChange = { ...change("a.ts", "M", "M"), stat: { staged: { additions: 4, deletions: 0 }, worktree: { additions: 1, deletions: 2 } } };
  // b.ts has no count yet: what a.ts adds is not the total.
  expect(changeTotals(snapshot([both, change("b.ts")]))).toBeNull();
  noteDiffRead(ROOT, diff("b.ts", "r1", "worktree", 7, 3));
  expect(changeTotals(snapshot([both, change("b.ts")]))).toEqual({ additions: 12, deletions: 5 });
});

test("a conflict's size is what the status counted for the file on disk", () => {
  const conflict: GitChange = { ...change("merge.ts", "U", "U"), stat: { worktree: { additions: 6, deletions: 1 } } };
  expect(changeLineCount(ROOT, reviewOrder([conflict])[0])).toEqual({ additions: 6, deletions: 1, binary: false });
});
