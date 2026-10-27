# Optional snapshot runtime observations

`Snapshot` pane objects may include the following additive fields. Older daemons
and runtimes omit them; absence means unknown and must not be interpreted as
`false` or zero.

- `terminal_id`: the live Herdr terminal identity.
- `agent_instance_id`: a lowercase SHA-256 value computed by Pairfob from the
  terminal identity and, when available, the trusted native AgentSession
  identity. Native session IDs and paths are never serialized.
- `revision`: a nonnegative JavaScript-safe terminal revision.
- `state_change_seq`: a nonnegative JavaScript-safe agent state sequence.
- `completion_id`: an optional lowercase SHA-256 digest identifying the latest
  task evidence for a `done` pane. The daemon derives it from the terminal,
  opaque agent instance and trusted transcript evidence; it never carries native
  session IDs, paths or transcript contents. It is stable across runtime status
  churn and reconnects, and changes when task evidence or the occupant changes.
  It is absent for other statuses and when transcript evidence is unavailable.
- `interactive_ready`: whether the agent can currently accept interaction.
- `launch_pending`: whether agent launch is still pending.

Pairfob joins Herdr's `snapshot.agents` observations to a pane only when both
`pane_id` and `terminal_id` match. Runtime events are local refresh hints; they
are not transported through Pairfob. Snapshots remain authoritative after
subscription setup, reconnect, overflow, or unsupported subscriptions.

Completion acknowledgements prefer `completion_id` over `state_change_seq`:
the latter counts runtime observations, not completed tasks. A receipt survives
intermediate states and is retired by another completion, a known replacement,
pane removal or an explicit submission. Missing evidence preserves the receipt;
a `done` pane whose stored receipt cannot currently be checked displays unknown
until evidence returns. Older daemons retain sequence-based matching (including
idle/unknown recovery); they cannot distinguish all status churn from new work.
When a terminal revision is available, newly stored fallback receipts also
ignore sequence changes without newer terminal output. This does not substitute
for transcript evidence when the terminal itself is redrawn during status churn.
Existing sequence receipts upgrade only when the same occupant and exact
sequence are observed with a completion ID. Older clients ignore the additive
field. No operation or capability key is added, and envelope/crypto bytes and
RPC request fields remain unchanged.
