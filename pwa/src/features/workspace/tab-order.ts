import type { WorkspaceTab } from "./model";

/**
 * The two tabs stand in one order everywhere: changes first, then files.
 *
 * Files and changes are opened to see what the agent changed, so changes lead,
 * in the inspector's head and on the screen alike, at every width and on every
 * device. The order never follows the window: a tab that swapped sides with a
 * rotation or a resize would move under the pointer, and a reader who changes
 * device would have to find it again. Which tab a pane opens on is a separate
 * question, answered by how it was entered (`enterWorkspace`'s intent).
 */
export const WORKSPACE_TAB_ORDER: readonly WorkspaceTab[] = ["changes", "files"];

/** The inspector only exists beside the list; it shares the one order. */
export const INSPECTOR_TAB_ORDER = WORKSPACE_TAB_ORDER;

export function useTabOrder(): readonly WorkspaceTab[] {
  return WORKSPACE_TAB_ORDER;
}
