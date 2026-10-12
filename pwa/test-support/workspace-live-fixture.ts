/**
 * A computer for tests of the files screen and the column: one repository at
 * `/work/pairfob` with a `src` folder and two Markdown files at its root, and
 * the working tree's changes the test names. Every diff is one replaced line.
 */

export type FixtureChange = { path: string; index: string; worktree: string };

export function workspaceLive(source: {
  /** The changes as they stand when the status is read. */
  changes(): FixtureChange[];
  /** Every query the files were searched by, in order. */
  searched?: string[];
  /** The branch sheet's answer; a repository that lists none has no sheet. */
  branches?: boolean;
  /** Every prompt sent to the pane's agent, in order. */
  prompts?: string[];
}) {
  const entry = (path: string, kind: "file" | "directory") => ({
    name: path.split("/").pop()!, path, kind, size: 10, modified_ms: 1, hidden: false, symlink: false,
  });
  return {
    isConnected: () => true,
    workspaceOpen: async () => ({
      name: "pairfob", root: "/work/pairfob",
      features: { files: true, git_status: true, git_diff: true, git_branches: source.branches === true },
      git: { name: "pairfob", branch: "main", head: "1234567890", detached: false },
    }),
    workspaceList: async (_pane: string, path = "") => ({
      path, next_cursor: null, truncated: false, revision: "d".repeat(64),
      entries: path === "" ? [entry("src", "directory"), entry("a.md", "file"), entry("b.md", "file")] : [entry(`${path}/app.ts`, "file")],
    }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text", content: "one\ntwo\n", size: 8, modified_ms: 1, truncated: false, revision: "f".repeat(64),
    }),
    workspaceSearch: async (_pane: string, _root: string, query: string) => {
      source.searched?.push(query);
      return { query, items: [{ path: "src/app.ts", name: "app.ts" }], truncated: false };
    },
    gitStatus: async () => ({
      branch: "main", head: "1234567890", upstream: null, ahead: 0, behind: 0, truncated: false, revision: "s".repeat(64),
      changes: source.changes().map((change) => ({ ...change, original_path: null })),
    }),
    gitDiff: async (_pane: string, path: string, layer: "worktree" | "staged") => ({
      path, layer, patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, binary: false, truncated: false, revision: "1".repeat(64),
    }),
    promptAgent: async (input: { pane_id: string; text: string }) => {
      source.prompts?.push(input.text);
      return { operation_id: `op-${source.prompts?.length ?? 0}` };
    },
    gitBranches: async () => ({
      items: [{ name: "main", kind: "local", current: true, head: "1234567890", upstream: null }], truncated: false, revision: "b".repeat(64),
    }),
  };
}
