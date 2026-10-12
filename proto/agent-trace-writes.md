# Agent trace writes

`AgentTraceSummary` accepts an additive optional param `writes: true`. A client
may send it only when `GetConfig.capabilities.trace_writes` is true; older
daemons reject unknown params and absence means false. `writes` is independent
of `labels`, `markers` and `times`.

With `writes: true` a summary `tool` item may carry `writes`: 1–16 paths the
call named as the files it writes, in the order the tool named them, each
1–1024 Unicode characters on one line. Without the param `writes` never
appears, so existing clients keep validating. The tool body still comes from
`AgentTraceDetail`.

`writes` is read from the call's input, so it is there whatever came of the
call: an edit that failed or was refused has `state: "error"`, one waiting for
permission has `state: "running"`, and both still name their file. A client
that shows which files a turn wrote counts a path only from an item whose
`state` is `done`.

The daemon reads only tools that declare the file they write:

| tool (case and punctuation ignored) | paths |
| --- | --- |
| `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `StrReplace`, `EditNotebook`, `edit`, `write`, `multiedit`, `edit_file`, `write_file`, `create_file`, `search_replace`, `delete_file`, `Delete` | the first of `file_path`, `filePath`, `path`, `file`, `target_file`, `filename`, `notebook_path`, `target_notebook` |
| `apply_patch`, `patch` (raw text, or JSON `input` / `patch`) | every `*** Update File:`, `*** Add File:`, `*** Delete File:` and `*** Move to:` |
| `str_replace_editor`, `str_replace_based_edit_tool` | `path`, unless `command` is `view` |

A shell command can write anything and names nothing, so it reports no paths:
`writes` is what the agent's edit tools declared, not everything that changed
on disk. Use `GitStatus` for that.

Paths are as the tool wrote them: absolute, or relative to the agent's working
directory. The client resolves them against the workspace root it shows and
ignores the ones outside it. A path that is not one line of valid text, or is
longer than 1024 characters, is left out and never cut, since a clipped path
names another file. A path repeated in one call appears once.

Tool `detail_ref` values and `next_cursor` positions are identical with and
without `writes`. If the extras would push a page past its byte budget, the
oldest labels on that page are dropped first, then the oldest `writes`, then
the oldest `at`.
