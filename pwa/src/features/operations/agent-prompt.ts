/**
 * Prompts sent to the selected session's agent: a task typed in a dialog, and
 * the notes written on a diff's lines.
 */
import { commitView } from "../../app/host";
import { captureNoticeScope, noticeScopeIsCurrent, showError } from "../../app/notices-store";
import { canPromptAgent } from "../../lib/dashboard";
import {
  beginDiffNoteSend,
  composeAllDiffNotesPrompt,
  composeDiffNotesPrompt,
  diffNoteScope,
  diffNoteSendOpen,
  diffNotesAt,
  diffNotesFor,
  endDiffNoteSend,
  removeDiffNotes,
  sameDiffNotePlace,
  type ComposedDiffNotes,
  type DiffNote,
  type DiffNoteScope,
} from "../../lib/diff-notes";
import { recordSentDiffNotes } from "../../lib/diff-notes-sent";
import { t } from "../../lib/i18n";
import { messageOf } from "../../lib/notices";
import { type LiveSession } from "../../lib/protocol/client";
import { type AgentCard } from "../../lib/ranking";
import { type GitLayer } from "../../lib/workspace";
import { liveSession } from "../computers/catalog-store";
import { refreshPane } from "../connection/controller";
import { markPaneSubmitted, selectedAgent } from "../dashboard/catalog-store";
import { bumpWorkspaceNotes } from "../workspace/store";
import { capabilityEnabled, operationBusy } from "./capabilities-store";
import { operationOwner, ownsOperationView, runHerdOperation } from "./live-run";
import { askAgentPrompt } from "./operation-ui";

export async function promptSelectedAgent(): Promise<void> {
  const session = liveSession();
  const selected = selectedAgent();
  if (!session || !canPromptAgent(selected) || !capabilityEnabled("prompt_agent")) return;
  const owner = operationOwner(session);
  const text = await askAgentPrompt();
  if (!text || !ownsOperationView(owner) || !capabilityEnabled("prompt_agent")) return;
  const noticeScope = captureNoticeScope();
  await runHerdOperation(
    t("op.sendingTask"),
    t("op.sentTask"),
    () => session.promptAgent({ pane_id: selected.paneId, text }),
    {
      owner, capability: "prompt_agent", noticeScope,
      after: async () => {
        markPaneSubmitted(selected.paneId);
        if (liveSession() === session && noticeScopeIsCurrent(noticeScope)) await refreshPane();
      },
    },
  );
}

/**
 * Batch every diff note for one path/layer into ONE PromptAgent call; never
 * one RPC per comment. Oversize batches are refused, never silently clipped,
 * and mutations are never retried automatically on ambiguous outcomes.
 */
export async function sendDiffNotesToAgent(path: string, layer: GitLayer): Promise<void> {
  const ground = noteSendGround();
  const list = ground && path ? diffNotesFor(path, layer) : [];
  if (ground && list.length) await promptWithNotes(ground, list, composeDiffNotesPrompt(path, layer, list));
}

/**
 * Every pending note of the pane's place, whatever file it is on, as one
 * prompt with a section per file. `prepare` runs first and may read: the files
 * that are not on screen are pinned again on what they read now (the
 * workspace's `settleWaitingNotes`), so nothing is sent by a line number it no
 * longer has. It answers false, or throws, when nothing should be sent.
 */
export async function sendAllDiffNotesToAgent(prepare?: () => Promise<boolean>): Promise<void> {
  const asked = noteSendGround();
  if (!asked) return;
  if (prepare) {
    preparing = true;
    try {
      if (!(await prepare())) return;
    } catch (error) {
      showError(messageOf(error));
      commitView();
      return;
    } finally {
      preparing = false;
    }
  }
  const ground = noteSendGround();
  if (!ground || !sameDiffNotePlace(ground.owner, asked.owner)) return;
  const list = diffNotesAt(ground.owner);
  if (list.length) await promptWithNotes(ground, list, composeAllDiffNotesPrompt(list));
}

/** A send-all is reading the other files: no second send starts under it. */
let preparing = false;

type NoteSendGround = { session: LiveSession; selected: AgentCard; owner: DiffNoteScope };

/** What a send of notes needs to be allowed at all: null when it is not, and nothing is sent. */
function noteSendGround(): NoteSendGround | null {
  const session = liveSession();
  const selected = selectedAgent();
  const owner = diffNoteScope();
  if (!session || !selected || !owner || !canPromptAgent(selected) || !capabilityEnabled("prompt_agent")) return null;
  if (preparing || operationBusy() || diffNoteSendOpen() || !session.isConnected()) return null;
  // The notes on screen are this pane's, on the Herdr session the connection is on now: pane ids repeat across them.
  const here = owner.session === session && owner.paneId === selected.paneId && (owner.herd ?? null) === (session.herdSession?.() ?? null);
  return here ? { session, selected, owner } : null;
}

async function promptWithNotes({ session, selected, owner }: NoteSendGround, list: readonly DiffNote[], composed: ComposedDiffNotes): Promise<void> {
  if (composed.truncated) {
    showError(t("diffNotes.tooBig"));
    commitView();
    return;
  }
  const noticeScope = captureNoticeScope();
  const stillThere = () => liveSession() === session && (session.herdSession?.() ?? null) === (owner.herd ?? null);
  beginDiffNoteSend(list.map((note) => note.id));
  try {
    await runHerdOperation(
      t("diffNotes.sending"),
      t("diffNotes.sent"),
      async () => {
        try {
          const result = await session.promptAgent({ pane_id: selected.paneId, text: composed.text });
          // The agent has them, whatever the reader is looking at by now. Sent is
          // not gone: each stays under its line as a record of what the agent
          // was told, and none is left pending to be sent a second time.
          recordSentDiffNotes(list);
          removeDiffNotes(list);
          if (stillThere()) markPaneSubmitted(selected.paneId);
          return result;
        } finally {
          // Before the runner lets go of its lock and paints: the bar and the cards are free again with it.
          endDiffNoteSend();
          bumpWorkspaceNotes();
        }
      },
      {
        capability: "prompt_agent", noticeScope,
        after: async () => {
          if (liveSession() === session && noticeScopeIsCurrent(noticeScope)) await refreshPane();
        },
      },
    );
  } finally {
    // A send the runner refused never ran the action above.
    if (diffNoteSendOpen()) {
      endDiffNoteSend();
      bumpWorkspaceNotes();
    }
  }
}
