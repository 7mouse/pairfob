import { describe, expect, test } from "bun:test";
import type { GitChange } from "../../lib/workspace";
import { changeSections, fileNameProblem, foldBreadcrumbs, gitMarks, isConflict, layersFor, listedChanges, reviewOrder, rowSteps } from "./git-marks";

const change = (path: string, index: string, worktree: string): GitChange => ({ path, original_path: null, index, worktree });

const CHANGES = [
  change("pwa/bun.lock", "U", "U"),
  change("pwa/src/lib/workspace.ts", "M", " "),
  change("pwa/src/features/workspace/model.ts", "M", "M"),
  change("pwa/src/features/workspace/files.tsx", " ", "M"),
  change("pwa/src/features/workspace/new.tsx", "?", "?"),
  change("README.md", " ", "D"),
];

describe("git marks", () => {
  test("conflicts include both-added and both-deleted pairs", () => {
    expect(isConflict(change("a", "U", "U"))).toBe(true);
    expect(isConflict(change("a", "A", "A"))).toBe(true);
    expect(isConflict(change("a", "D", "D"))).toBe(true);
    expect(isConflict(change("a", "A", "M"))).toBe(false);
    expect(isConflict(change("a", "?", "?"))).toBe(false);
  });

  test("sections list a conflict once and split staged from worktree", () => {
    const sections = changeSections(CHANGES);
    expect(sections.conflict.map((step) => step.path)).toEqual(["pwa/bun.lock"]);
    expect(sections.staged.map((step) => step.path)).toEqual(["pwa/src/lib/workspace.ts", "pwa/src/features/workspace/model.ts"]);
    expect(sections.worktree.map((step) => `${step.path}:${step.kind}`)).toEqual([
      "pwa/src/features/workspace/model.ts:modified",
      "pwa/src/features/workspace/files.tsx:modified",
      "pwa/src/features/workspace/new.tsx:untracked",
      "README.md:deleted",
    ]);
  });

  test("review order walks conflicts, then the files only staged, then the working tree's, a file's staged tag after its row", () => {
    expect(reviewOrder(CHANGES).map((step) => `${step.layer}:${step.path}`)).toEqual([
      "worktree:pwa/bun.lock",
      "staged:pwa/src/lib/workspace.ts",
      "worktree:pwa/src/features/workspace/model.ts",
      "staged:pwa/src/features/workspace/model.ts",
      "worktree:pwa/src/features/workspace/files.tsx",
      "worktree:pwa/src/features/workspace/new.tsx",
      "worktree:README.md",
    ]);
  });

  /** Every kind of change at once, with the file changed in both layers in the middle of the working tree's rows. */
  const MIXED = [
    change("src/plain.ts", " ", "M"),
    change("merge/both-added.ts", "A", "A"),
    change("src/staged-only.ts", "M", " "),
    { ...change("src/new-name.ts", "R", " "), original_path: "src/old-name.ts" },
    change("src/both.ts", "M", "M"),
    change("src/untracked.ts", "?", "?"),
    change("src/deleted.ts", " ", "D"),
    change("src/staged-delete.ts", "D", " "),
    change("merge/unmerged.ts", "U", "U"),
    change("src/added-then-edited.ts", "A", "M"),
  ];

  test("the list is drawn as groups of rows: a file changed in both layers is one row under the working tree, its staged diff a tag", () => {
    const listed = listedChanges(MIXED);
    expect(listed.groups.map((group) => group.section)).toEqual(["conflict", "staged", "worktree"]);
    const drawn = listed.groups.map((group) => group.rows.map((row) => `${row.step.path}${row.staged ? " [staged]" : ""}`));
    expect(drawn).toEqual([
      ["merge/both-added.ts", "merge/unmerged.ts"],
      ["src/staged-only.ts", "src/new-name.ts", "src/staged-delete.ts"],
      ["src/plain.ts", "src/both.ts [staged]", "src/untracked.ts", "src/deleted.ts", "src/added-then-edited.ts [staged]"],
    ]);
    expect(listed.hidden).toBe(0);
    // A group counts its files: a row with a tag is one.
    expect(listed.groups.map((group) => group.files)).toEqual([2, 3, 5]);
  });

  test("the stepper's order is the rows from top to bottom, each row's own diff and then its tag, as they stand on it", () => {
    const listed = listedChanges(MIXED);
    const order = reviewOrder(MIXED).map((step) => `${step.layer}:${step.path}`);
    expect(order).toEqual([
      "worktree:merge/both-added.ts",
      "worktree:merge/unmerged.ts",
      "staged:src/staged-only.ts",
      "staged:src/new-name.ts",
      "staged:src/staged-delete.ts",
      "worktree:src/plain.ts",
      "worktree:src/both.ts",
      "staged:src/both.ts",
      "worktree:src/untracked.ts",
      "worktree:src/deleted.ts",
      "worktree:src/added-then-edited.ts",
      "staged:src/added-then-edited.ts",
    ]);
    // The two are one derivation: what is drawn, read row by row, is the order.
    expect(listed.groups.flatMap((group) => group.rows.flatMap(rowSteps))).toEqual(listed.order);
    expect(listed.order).toEqual(reviewOrder(MIXED));
    // Each diff is a step once.
    expect(new Set(order).size).toBe(order.length);
  });

  test("a limit cuts the rows down the list across the groups, and the order with them", () => {
    const listed = listedChanges(MIXED, 4);
    expect(listed.groups.map((group) => group.rows.map((row) => row.step.path))).toEqual([
      ["merge/both-added.ts", "merge/unmerged.ts"],
      ["src/staged-only.ts", "src/new-name.ts"],
    ]);
    expect(listed.hidden).toBe(6);
    // Its title still counts the whole group, and the groups not reached are simply not drawn.
    expect(listed.groups.map((group) => group.files)).toEqual([2, 3]);
    expect(listed.order.map((step) => step.path)).toEqual(["merge/both-added.ts", "merge/unmerged.ts", "src/staged-only.ts", "src/new-name.ts"]);
    // The first row drawn is the first step, whatever the status listed first.
    expect(listed.order[0]).toEqual(reviewOrder(MIXED)[0]);
    expect(listedChanges(MIXED, 0)).toEqual({ groups: [], order: [], hidden: 10 });
    expect(listedChanges([])).toEqual({ groups: [], order: [], hidden: 0 });
  });

  test("a path offers the layers it changed in; a conflict only the worktree", () => {
    expect(layersFor(CHANGES, "pwa/src/features/workspace/model.ts")).toEqual(["staged", "worktree"]);
    expect(layersFor(CHANGES, "pwa/bun.lock")).toEqual(["worktree"]);
    expect(layersFor(CHANGES, "missing")).toEqual([]);
  });

  test("files show their worktree mark and every ancestor directory counts them", () => {
    const marks = gitMarks({ changes: CHANGES, truncated: true });
    expect(marks.files.get("pwa/src/features/workspace/model.ts")).toBe("modified");
    expect(marks.files.get("pwa/src/lib/workspace.ts")).toBe("modified");
    expect(marks.files.get("pwa/bun.lock")).toBe("conflict");
    expect(marks.files.get("README.md")).toBe("deleted");
    expect(marks.dirs.get("pwa")).toBe(5);
    expect(marks.dirs.get("pwa/src/features/workspace")).toBe(3);
    expect(marks.dirs.has("README.md")).toBe(false);
    expect(marks.truncated).toBe(true);
    expect(gitMarks(null).files.size).toBe(0);
  });

  test("the same status object reuses its marks", () => {
    const status = { changes: CHANGES, truncated: false };
    expect(gitMarks(status)).toBe(gitMarks(status));
  });
});

describe("breadcrumb folding", () => {
  const crumbs = (path: string) => ["", ...path.split("/")].map((_, i, all) => ({ path: all.slice(1, i + 1).join("/") }));

  test("three segments or fewer stay whole", () => {
    expect(foldBreadcrumbs(crumbs("pwa/src"))).toHaveLength(3);
  });

  test("deeper paths keep root, parent and current around one fold", () => {
    const shown = foldBreadcrumbs(crumbs("pwa/src/features/workspace"));
    expect(shown.map((crumb) => "fold" in crumb ? "…" : crumb.path)).toEqual(["", "…", "pwa/src/features", "pwa/src/features/workspace"]);
    expect(shown[1].path).toBe("pwa/src");
  });
});

describe("file name rules", () => {
  test("accepts ordinary names and rejects the reserved ones", () => {
    expect(fileNameProblem("notes.md")).toBeNull();
    expect(fileNameProblem("  ")).toBe("empty");
    expect(fileNameProblem("..")).toBe("reserved");
    expect(fileNameProblem(".GIT")).toBe("reserved");
    expect(fileNameProblem("a/b")).toBe("separator");
    expect(fileNameProblem("a\\b")).toBe("separator");
    expect(fileNameProblem("a\u0007")).toBe("separator");
    expect(fileNameProblem("é".repeat(128))).toBe("tooLong");
  });
});
