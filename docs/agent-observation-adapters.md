# Agent titles and execution activity

The new-session catalog is supplied by Herdr. Being launchable does **not**
mean that a native transcript is readable. Pairfob needs both a trusted
pane-to-session binding and a reader for that agent's persisted format.

All catalog entries use the same PWA title and activity rendering. A manually
set pane/workspace label retains precedence. The daemon supplies `tokens.task`
from a native name or the first visible request. `activity` comes from the same
bound session. Native IDs and store paths never enter the phone snapshot.

## Implemented readers

| Agent | Title source | Execution source |
| --- | --- | --- |
| Claude Code | `custom-title`, `ai-title`, first visible request | Bound project JSONL |
| Codex | SQLite `threads.name`, cleaned OSC title, first request | Bound rollout JSONL |
| Pi | `session_info`, first request on active branch | Active session tree |
| Grok | `summary.json.generated_title`, first request | `updates.jsonl` |
| Cursor | First visible request | Bound agent transcript |
| Hermes | SQLite session title, first visible request | SQLite active messages |
| OpenCode | Session title, first visible request | Legacy JSON files; SQLite `session`/`message`/`part`; V2 `session_v2`/`session_message` |
| Kilo | Session title, first visible request | Legacy OpenCode files; SQLite `session`, V1 parts or V2 typed messages |
| Copilot | First displayed user request | `session-state/<id>/events.jsonl` |
| Kimi | Native state title, first displayed request | Python wire log; Kimi Code state v2 and main-agent wire protocol 1.5 |
| Gemini | Session summary, first displayed request | Legacy JSON or JSONL metadata/messages/patches/rewinds |
| Qwen | `custom_title`, first displayed request | Active `parentUuid` branch of project chat JSONL |
| Cline | First visible request | SDK version-1 `<id>.messages.json` with matching `sessionId` |
| Amp | Thread title, first request | Exact `threads/T-<id>.json`, linked tool runs |
| Droid | Session-start title, first request | `sessions/<project>/<id>.jsonl` |
| Maki | Latest `meta.title`, first displayed request | Session JSONL v2/v3; excludes host observations and subagents |
| Muse | Session-index title, first explicit user intent | Durable session stream v1; only user-linked main runs |
| Antigravity (`agy`) | First explicit user request | Exact brain transcript; latest display step per index |
| Letta | First displayed request | Conversation reflection transcript; supports `default:<agent-id>` |
| Qoder CLI | First visible request | Exact project transcript with session-ID validation |
| Kiro | Session title, first visible request | V3 `session.json` / `messages.jsonl` format 1 |
| Devin | SQLite session title, first real request | Only ancestry ending at `sessions.main_chain_id` |


This covers a persisted format for each of the current 22 catalog agents. It
is **reader coverage**, not a claim that all 22 CLIs have been run through a
newly created Pairfob session. Herdr's published matrix lists Gemini, Cline,
Amp and Maki as state-only; those readers need a trusted native binding from
the runtime before they can activate. Never infer that binding from cwd,
recent modification time, a terminal's printed ID, or a client-supplied path.

### Format boundaries

- Copilot marks `session.title_changed` as ephemeral. It is not a reliable
  persisted title source. Read `user.message.content`, never model-transformed
  content; omit skill injection, autopilot continuation and child-agent events.
- Kimi has two distinct implementations. Python Kimi uses `~/.kimi`; current
  Kimi Code uses `KIMI_CODE_HOME` / `~/.kimi-code`, state v2, and protocol 1.5
  under `agents/main`. Read displayed turn/loop events, not duplicate context
  messages, profile/system prompts, or child-agent logs.
- Gemini filenames contain only the first eight ID characters. Verify the
  complete metadata ID, reject ambiguous matches, and exclude subagent paths.
  Replay `$set`, `$patch` and `$rewindTo` before deriving the visible timeline.
- Qwen rewinds re-root the parent chain. Its newer `managed_session_*`
  transaction format is deliberately unavailable until transaction/commit
  projection is implemented; it must not be interpreted as legacy JSONL.
- Cline's old `api_conversation_history.json` format is not covered by the new
  SDK reader. System prompts, synthetic user records and attached file content
  are excluded from the request title.
- SQLite readers open databases read-only, include WAL changes in cache stamps,
  and constrain every message/part query to the bound session. Unsupported
  revert shapes are unavailable rather than showing discarded history.
- Kiro's old SQLite and flat `sessions/cli` formats are not covered by the V3
  reader. Synthetic user messages are hidden; summarization becomes a
  compaction marker, while unknown tombstone semantics fail closed.
- Muse retained-frame replay is not covered. Main chat runs must have a matching
  explicit user intent. Background memory runs are excluded.
- Antigravity's display export identifies called tools but does not reliably
  link result records; this reader does not invent tool completion or output.
- Letta reflection records arrive after captured turns, so their availability
  can lag the live terminal. Never choose a persistent agent's newest conversation.
- Maki legacy `.json` snapshots are not covered by the JSONL reader.
- Mutable file stores are bounded at 32 MiB. Oversized or inconsistent snapshots
  remain unavailable. Unknown formats never fall back to another agent parser.

## Public references used

Sources were inspected on 2026-10-28. Agent formats can change independently of
Pairfob; fixture coverage and a native CLI acceptance run are separate evidence.

- [Herdr supported agents](https://herdr.dev/docs/agents/) and
  [integration/session binding documentation](https://herdr.dev/docs/integrations/).
- [Copilot persisted event types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts)
  and [local session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data).
- [Kimi wire persistence](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/wire/file.py),
  [wire messages](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/wire/types.py),
  [session titles](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/session.py).
- [Gemini recording types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)
  and [recording/replay implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts).
- [Qwen recording implementation](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/services/chatRecordingService.ts).
- [Kilo SQLite schema](https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/session/sql.ts)
  and [typed messages](https://github.com/Kilo-Org/kilocode/blob/main/packages/schema/src/session-message.ts).
- [OpenCode SQLite schema](https://github.com/anomalyco/opencode/blob/main/packages/core/src/session/sql.ts)
  and [typed messages](https://github.com/anomalyco/opencode/blob/main/packages/schema/src/session-message.ts).
- [Cline persisted session payload](https://github.com/cline/cline/blob/main/sdk/packages/core/src/services/session-data.ts),
  [message types](https://github.com/cline/cline/blob/main/sdk/packages/shared/src/llms/messages.ts),
  [user-run filtering](https://github.com/cline/cline/blob/main/sdk/packages/core/src/session/user-run-messages.ts).

## Additional source evidence

Official source defines the open formats. For closed CLIs, the independent
projects below provide original readers and/or sanitized captures from actual
native sessions; they are empirical evidence, not vendor compatibility promises.

- [Amp thread reader](https://github.com/marcus/sidecar/tree/main/internal/adapter/amp)
  and [official thread commands](https://ampcode.com/docs/threads).
- [Droid reader and format fixtures](https://github.com/getagentseal/codeburn/blob/main/src/providers/droid.ts)
  and [official hooks](https://docs.factory.com/harness/hooks).
- [Maki persistence](https://github.com/tontinton/maki/blob/main/maki-storage/src/sessions.rs)
  and [message provenance/types](https://github.com/tontinton/maki/blob/main/maki-providers/src/types.rs).
- [Kimi Code / Muse native capture contracts](https://github.com/xhluca/session-migrate/blob/main/docs/muse-qwen-kimi-formats.md)
  and [sanitized native corpus](https://github.com/xhluca/session-migrate/tree/main/tests/native_corpus/v1/sources).
- [Antigravity CLI display transcript fixture](https://github.com/getagentseal/codeburn/blob/main/tests/fixtures/antigravity-cli-current/brain/fixture-current-cli/.system_generated/logs/transcript.jsonl).
- [Letta reflection projection](https://github.com/letta-ai/letta-code/blob/main/src/cli/helpers/reflection-transcript.ts).
- [Qoder's official session analyzer](https://github.com/QoderAI/better-harness/blob/main/scripts/session-analysis/platforms/qoder.mjs).
- [Kiro V3 reader and native fixtures](https://github.com/apache/skywalking-ai-sessionizer/tree/main/internal/adapters/kiro).
- [Devin native schema and active-chain contract](https://github.com/xhluca/session-migrate/blob/main/docs/devin-format.md).

## Verification

Focused tests cover exact session identity, ambiguous paths, symlink escape,
hidden context, title refresh, failed tools, history rollback and SQLite V1/V2.
The browser fixtures cover all catalog names on phone, tablet and desktop; they
verify rendering, not native session discovery. Run the opt-in local transcript
scan after CLI upgrades, and record zero-session providers as untested rather
than accepted.

`TestPublicNativeCorpus` optionally checks the reviewed upstream Kimi Code
0.38.0, Muse 0.2.1 and Kiro V3 captures. Set `PAIRFOB_PUBLIC_AGENT_CORPUS` to an
explicit directory containing `kimi-current.jsonl`, `kimi-current-state.json`,
`muse-corpus.jsonl`, `kiro-current.jsonl` and `kiro-current-meta.json` downloaded
from the references above. The ordinary test suite stays offline and uses
small behavior fixtures. Local scans and public captures do not replace a
fresh CLI launch with actual Herdr binding and phone transport.
