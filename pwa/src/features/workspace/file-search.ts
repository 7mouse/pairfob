import { useEffect, useState } from "react";
import { WORKSPACE_SEARCH_QUERY_MAX, type WorkspaceSearchItem } from "../../lib/workspace";
import { liveSession } from "../computers/catalog-store";
import { capabilityEnabled } from "../operations/capabilities-store";
import { currentScreen } from "../../app/navigation-store";
import { openPaneId } from "../session/session-store";
import { loadWorkspaceFile } from "./actions";
import { ProtocolError } from "../../lib/protocol/errors";
import { useFileSearchEpoch } from "./file-filter";
import { captureFileLinkOwner, openChatFile } from "./file-links";
import { activeScope, getWorkspaceSnapshot, readCache } from "./store";
import { workspacePresented } from "./surface";

/**
 * Finding a file of the workspace by name (proto/workspace-review.md).
 *
 * The directory's own filter narrows what is listed; this looks through the
 * whole workspace on the computer. It is offered only while the daemon says it
 * can (`search_files`), and every search names the root that is on screen, so
 * an answer for a workspace the reader has left is refused there.
 */

/** A query shorter than this is the directory filter's alone: two letters match half a repository. */
export const SEARCH_MIN_CHARS = 2;
/** Typing settles for this long before the computer is asked. */
export const SEARCH_DELAY_MS = 180;

export type FileSearch = { root: string; query: string; items: WorkspaceSearchItem[]; truncated: boolean };

export function fileSearchOffered(): boolean {
  return capabilityEnabled("search_files") && typeof liveSession()?.workspaceSearch === "function";
}

/** A query the computer is asked: long enough to mean something, and no longer than it accepts. */
export function searchable(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length >= SEARCH_MIN_CHARS && Array.from(trimmed).length <= WORKSPACE_SEARCH_QUERY_MAX;
}

/**
 * Search `paneId`'s workspace under `root`, the root the asker is showing. The
 * computer checks that root against the pane's own in the same call, so this
 * needs no read of the workspace first. Rejects when the session, the
 * capability or the workspace is gone.
 */
export async function searchFilesAt(paneId: string, root: string, query: string, limit = 30): Promise<FileSearch> {
  const session = liveSession();
  if (!session?.workspaceSearch || !capabilityEnabled("search_files") || !paneId || !root) throw new Error("file search is not available");
  const page = await session.workspaceSearch(paneId, root, query, limit);
  if (liveSession() !== session) throw new Error("the session changed");
  return { root, query, items: page.items, truncated: page.truncated };
}

/**
 * The root of `paneId`'s workspace: the one on screen when this pane's files
 * are what is shown, otherwise asked of the computer. `asked` skips the screen:
 * the root it showed was just refused, so the pane may have moved on.
 */
async function paneRoot(paneId: string, asked = false): Promise<string> {
  const session = liveSession();
  if (!session) throw new Error("file search is not available");
  const shown = !asked && workspacePresented() && getWorkspaceSnapshot().paneId === paneId ? activeScope() : null;
  return (shown ?? await readCache(session).open(paneId)).descriptor.root;
}

/** Answers that say the pane has no workspace to search, however often it is asked. */
const NO_WORKSPACE = new Set(["workspace_not_found", "forbidden", "unsupported", "unknown_op"]);

/**
 * What search-and-jump is given for the session on screen: its workspace's
 * files by name, opened the way a file link in the conversation is (beside the
 * session where there is room, otherwise on the files screen). Null where no
 * session is open or its computer cannot search.
 *
 * The root is found once and named in every search after it. A pane without a
 * workspace is asked once, not at every pause in typing.
 */
export function paneFileSearch(): { search(query: string): Promise<string[]>; open(path: string): void } | null {
  const paneId = currentScreen() === "pane" ? openPaneId() : currentScreen() === "workspace" ? getWorkspaceSnapshot().paneId : "";
  if (!paneId || !fileSearchOffered()) return null;
  let root = "";
  let none = false;
  let refused = false;
  return {
    async search(query) {
      if (none || !searchable(query)) return [];
      if (!root) {
        try {
          root = await paneRoot(paneId, refused);
        } catch (error) {
          none = error instanceof ProtocolError && NO_WORKSPACE.has(error.code);
          if (none) return [];
          throw error;
        }
      }
      try {
        return (await searchFilesAt(paneId, root, query)).items.map((item) => item.path);
      } catch (error) {
        // The pane may have moved to another directory: the next search finds its root again.
        root = "";
        refused = true;
        throw error;
      }
    },
    open(path) {
      if (!root) return;
      // On the files screen the workspace is already the page: the file opens in it.
      if (currentScreen() === "workspace" && getWorkspaceSnapshot().paneId === paneId && getWorkspaceSnapshot().descriptor?.root === root) {
        void loadWorkspaceFile(path);
        return;
      }
      if (currentScreen() === "pane" && openPaneId() === paneId) void openChatFile(`${root}/${path}`, captureFileLinkOwner());
    },
  };
}

export type RepoSearch = {
  /** The search applies to what is typed: the daemon offers it and the query is long enough. */
  active: boolean;
  /** Null until the first answer for this query. */
  result: FileSearch | null;
  failed: boolean;
};

type Answer = { key: string; epoch: number; result: FileSearch | null; failed: boolean };

/** The last answer, kept while the list is away so the reader comes back to it (`file-filter`). */
let lastAnswer: Answer | null = null;

/**
 * The files of the whole workspace that answer `query`, for the files tab: the
 * newest query's answer only, asked once typing has settled, and asked again
 * when the workspace was read again (`renewFileSearch`).
 */
export function useRepoSearch(paneId: string, root: string | undefined, query: string): RepoSearch {
  const trimmed = query.trim();
  const active = Boolean(paneId && root) && searchable(trimmed) && fileSearchOffered();
  const key = active ? `${paneId}\n${root}\n${trimmed}` : "";
  const epoch = useFileSearchEpoch();
  const [answer, setAnswer] = useState<Answer | null>(lastAnswer);
  const settled = answer?.key === key && answer.epoch === epoch;
  useEffect(() => {
    if (!key || settled) return;
    let alive = true;
    const land = (next: Answer): void => {
      if (!alive) return;
      lastAnswer = next;
      setAnswer(next);
    };
    const timer = window.setTimeout(() => {
      searchFilesAt(paneId, root ?? "", trimmed).then(
        (result) => land({ key, epoch, result, failed: false }),
        () => land({ key, epoch, result: null, failed: true }),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key, epoch, settled, paneId, root, trimmed]);
  // An answer of an older reading stays on screen until the new one lands: the rows do not blink away.
  const mine = answer && answer.key === key ? answer : null;
  return { active, result: mine?.result ?? null, failed: mine?.failed ?? false };
}

/** Tests: no answer remembered. */
export function resetFileSearch(): void {
  lastAnswer = null;
}
