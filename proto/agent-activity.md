# Agent activity

A `Snapshot` result pane may carry an additive optional `activity` object: the
step the agent's current turn is on, so a session list can say what an agent
is doing without opening its chat. Older daemons never send it and older
clients ignore it; a pane without it shows its plain description. It needs no
capability key: it is display data, not an operation.

```json
"activity": {
  "type": "tool",
  "name": "Bash",
  "label": "go test ./internal/journal",
  "state": "running",
  "at": 1792144807000,
  "turn": { "steps": 12, "files": 4, "plan": "3/5", "failed": true, "interrupted": true }
}
```

| field | meaning |
| --- | --- |
| `type` | `tool`, `thinking` or `assistant`: the kind of step |
| `name` | the tool's name as the agent wrote it (tool only), 1–256 bytes |
| `label` | the same one-line label `AgentTraceSummary` gives with `labels: true` (`agent-trace-labels.md`), at most 200 bytes, cut on a character boundary; absent when the tool has none |
| `state` | `running`, `done` or `error` (tool only), as in a trace summary |
| `at` | epoch ms of the newest stamped record in the current turn; absent when the agent stamps none |
| `turn` | the finished turn's outcome; only on a `done` pane, and only when the turn's start is inside the window the daemon read |

`turn` holds `steps` (tool steps in the turn), `files` (distinct paths that
edit tools in the turn wrote and that finished `done`, as in
`agent-trace-writes.md`), `plan` (the latest `n/m` progress of a plan tool),
`failed` (the last tool failed and the agent said nothing after it) and
`interrupted` (the user cancelled the turn). `failed` and `interrupted` appear
only when true.

The current turn is everything after the last user prompt or command. The
step is the turn's last tool, thinking or assistant item; on a `blocked` pane
it is the tool still running (what the agent waits to do), else the last
item. A turn with no step yet has no `activity`.

The daemon adds `activity` only for a pane whose agent is `working`,
`blocked` or `done` (after its own transcript checks) and bound to a trusted
transcript. It reads the newest 200 trace summary items (the most one page holds) with the chat view's
own reader and cache, so `activity` always agrees with `AgentTraceSummary`.
An unreadable transcript is no `activity`, never an error. A runtime cannot
supply it: the daemon replaces whatever the runtime sent.

Privacy: `activity` never carries thinking or reply text, tool input or tool
output; a label is the one-line hint a trace summary already shows to the
same paired device. Push notifications do not include it.

Rate: the daemon's runtime monitor pokes the phone (`agent_status`) when a
pane's step, label, state or turn outcome changes; a newer `at` alone does not
poke. Without runtime events the monitor reconciles every 2 s. With them it
reconciles on each event and otherwise every 10 s, except that while a phone
is connected and an agent is `working` or `blocked` it reconciles every 2 s,
because a transcript step raises no runtime event.
