import { describe, expect, test } from "bun:test";
import { parseGitStatus, parseWorkspaceSearch } from "./workspace";

/**
 * The review reads (proto/workspace-review.md): a status may carry line counts
 * and modification times only when it was asked for them, and a search result
 * is checked like any other workspace read.
 */

const revision = "a".repeat(64);
const status = (changes: unknown[]) => ({
  branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision, changes,
});
const change = (extra: Record<string, unknown> = {}) => ({ path: "src/app.ts", original_path: null, index: "M", worktree: "M", ...extra });

describe("GitStatus with stats", () => {
  test("asked for, a change carries its layers' counts and its modification time", () => {
    const parsed = parseGitStatus(status([
      change({ stat: { staged: { additions: 1, deletions: 2 }, worktree: { additions: 3, deletions: 0 } }, modified_ms: 1_700_000_000_000 }),
      change({ path: "logo.png", stat: { worktree: { additions: 0, deletions: 0, binary: true } } }),
      change({ path: "gone.ts", index: "D", worktree: " " }),
    ]), true);
    expect(parsed.changes[0].stat).toEqual({ staged: { additions: 1, deletions: 2 }, worktree: { additions: 3, deletions: 0 } });
    expect(parsed.changes[0].modified_ms).toBe(1_700_000_000_000);
    expect(parsed.changes[1].stat).toEqual({ worktree: { additions: 0, deletions: 0, binary: true } });
    // A change the daemon had nothing to add to is as before.
    expect(parsed.changes[2]).toEqual({ path: "gone.ts", original_path: null, index: "D", worktree: " " });
  });

  test("not asked for, the same keys are a malformed response, as any unknown key is", () => {
    expect(() => parseGitStatus(status([change({ modified_ms: 1 })]))).toThrow("GitStatus change");
    expect(() => parseGitStatus(status([change({ stat: { worktree: { additions: 1, deletions: 0 } } })]))).toThrow("GitStatus change");
    expect(parseGitStatus(status([change()])).changes[0].stat).toBeUndefined();
  });

  test("malformed stats are rejected", () => {
    const bad = (extra: Record<string, unknown>) => () => parseGitStatus(status([change(extra)]), true);
    expect(bad({ stat: {} })).toThrow();
    expect(bad({ stat: { index: { additions: 1, deletions: 0 } } })).toThrow();
    expect(bad({ stat: { worktree: { additions: -1, deletions: 0 } } })).toThrow();
    expect(bad({ stat: { worktree: { additions: 1 } } })).toThrow();
    expect(bad({ stat: { worktree: { additions: 1, deletions: 0, lines: 3 } } })).toThrow();
    expect(bad({ stat: { worktree: { additions: 1, deletions: 0, binary: "yes" } } })).toThrow();
    expect(bad({ modified_ms: "now" })).toThrow();
    expect(bad({ size: 3 })).toThrow();
  });
});

describe("WorkspaceSearch", () => {
  test("returns relative files with their names", () => {
    expect(parseWorkspaceSearch({ query: "app", truncated: true, items: [{ path: "src/app.ts", name: "app.ts" }, { path: "README.md", name: "README.md" }] }))
      .toEqual({ query: "app", truncated: true, items: [{ path: "src/app.ts", name: "app.ts" }, { path: "README.md", name: "README.md" }] });
    expect(parseWorkspaceSearch({ query: "", truncated: false, items: [] }).items).toEqual([]);
  });

  test("a path outside the workspace, a name that is not the path's, or an unknown key is rejected", () => {
    const page = (items: unknown[], extra: Record<string, unknown> = {}) => () => parseWorkspaceSearch({ query: "a", truncated: false, items, ...extra });
    expect(page([{ path: "../secret", name: "secret" }])).toThrow();
    expect(page([{ path: "/etc/passwd", name: "passwd" }])).toThrow();
    expect(page([{ path: "src/app.ts", name: "other.ts" }])).toThrow();
    expect(page([{ path: "src/app.ts", name: "app.ts", kind: "file" }])).toThrow();
    expect(page([{ path: "src/app.ts" }])).toThrow();
    expect(page([], { root: "/work" })).toThrow();
    expect(page(Array.from({ length: 51 }, (_, index) => ({ path: `f${index}`, name: `f${index}` })))).toThrow();
    expect(() => parseWorkspaceSearch({ query: "a", items: [] })).toThrow();
    // One file, one item.
    expect(page([{ path: "src/app.ts", name: "app.ts" }, { path: "src/app.ts", name: "app.ts" }])).toThrow("WorkspaceSearch.path");
  });

  test("the echoed query is counted by code point, as the daemon counts it, and must be the one sent", () => {
    const reply = (query: string) => ({ query, truncated: false, items: [] });
    // 128 astral characters are 256 UTF-16 units and still 128 characters.
    const astral = "𝒜".repeat(128);
    expect(parseWorkspaceSearch(reply(astral), astral).query).toBe(astral);
    expect(() => parseWorkspaceSearch(reply(`${astral}𝒜`))).toThrow("WorkspaceSearch.query");
    expect(() => parseWorkspaceSearch(reply("a".repeat(129)))).toThrow("WorkspaceSearch.query");
    // An answer to another search is not this one's.
    expect(() => parseWorkspaceSearch(reply("app"), "apple")).toThrow("WorkspaceSearch.query");
    expect(parseWorkspaceSearch(reply("app"), "app").query).toBe("app");
  });
});
