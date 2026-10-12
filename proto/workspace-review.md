# Workspace review reads

Two additive reads serve the files-and-changes review. Both are read-only and
bound to the pane's live root, like every workspace read.

## Change statistics

`GitStatus` accepts an additive optional param `stats: true`. A client may
send it only when `GetConfig.capabilities.git_change_stats` is true; older
daemons reject unknown params and absence means false.

With `stats: true` each `changes[]` item may carry:

- `stat`: `{ "staged"?: count, "worktree"?: count }` with at least one layer,
  where `count` is `{ "additions": n, "deletions": n, "binary"?: true }`. The
  counts are Git's own (`git diff --numstat`, with `--cached` for `staged`).
  An untracked file has no Git diff: its `worktree` count is its line count,
  as its diff is drawn, for at most 64 untracked files of at most 180 KiB
  each. A layer Git reports nothing for, or a file past those bounds, has no
  count; `binary` stands for a change with no lines to count. A file in
  conflict has no `staged` count: its index holds the sides of the merge, not
  a version of the file.
- `modified_ms`: the file's modification time on the computer, epoch
  milliseconds, never negative. Absent when the file is gone (a deletion) or
  its time is before 1970.

Without the param neither key appears, so existing clients keep validating.

The list comes first. `changes[]` is cut to its share of one reply before the
counts and times are attached, and they are attached in order only while the
reply still fits: in a very large change set the last changes carry neither
key. `truncated` speaks of the list alone, as without `stats`.

Paths in `changes[]`, with or without `stats`, are relative to the pane's
root like every other workspace path, also when that root is a folder inside
the repository; a change outside the root is not listed.

`revision` with `stats: true` also covers the counts and modification times: a
file edited again while it stays "modified" yields a new revision, which the
plain status cannot tell. A client must not compare a revision read with
`stats` against one read without.

## File search

`WorkspaceSearch` finds files of the workspace by name. A client may call it
only when `GetConfig.capabilities.search_files` is true.

Params: `pane_id`, optional `session`, `root`, `query`, optional `limit`.
`root` and `query` are required; a request without either is
`invalid_argument`.

- `root` is mandatory: the canonical root the client is showing, from
  `WorkspaceOpen`. The daemon resolves the pane's live root in the same call
  and answers `conflict` when it differs, so a result never names a file of a
  workspace the reader has left.
- `query` is at most 128 Unicode characters. It is split on white space and
  lowered; a file matches when its path contains every word. An empty query
  matches nothing.
- `limit` is 0–50; 0 or absent means 30.

Result: `{ "query", "items": [{ "path", "name" }], "truncated" }`. `path` is
relative to `root` with `/` separators and `name` is its last segment. Items
are regular files only (no folders, no links, wherever they point), each path
once, best first: a name equal to the last word, a name that starts
with it, a name that contains it, then a path whose folders alone match;
shorter paths first within each. `truncated` says more files matched than were
returned, or the tree was too large to list in full.

Inside a Git repository the candidates are the tracked files plus untracked
files that are not ignored (`git ls-files --cached --others
--exclude-standard`), so ignored build output and dependencies are never
searched; a tracked file deleted from the working tree is left out. The
daemon may keep one listing for a few seconds between the searches of one
stretch of typing, so a file created a moment ago can be missing from the next
answer; a file deleted meanwhile is still left out, and a rename or delete
made through the daemon drops the listing. Elsewhere
the directory is walked for at most 50,000 entries and 3 seconds, skipping
`.git` and `node_modules`. `.git` is never searched.

Opening a result goes through the ordinary bound read, which validates the
path again; a search result grants nothing by itself.
