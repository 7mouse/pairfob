import { currentScreen } from "../../app/navigation-store";
import { boardStore, focusBoard, selectBoardTab, selectBoardWorkspace } from "../board/layout-store";
import { openPaneWithOwner, refreshFromSession } from "../connection/controller";
import { ownsComputer, ownsOperationView } from "./live-run";
import { type OperationOwner } from "./run";

/** Where the reader lands after an operation made a pane: on it, or on its place on the board. */
export async function selectCreatedPane(result: { pane_id?: string; workspace_id?: string; tab_id?: string }, owner: OperationOwner): Promise<void> {
  const paneId = typeof result.pane_id === "string" && result.pane_id ? result.pane_id : "";
  // Refresh first so the switch below sees the new pane in the snapshot, then
  // reuse the normal open path: it applies the pane's remembered / default
  // view mode and tears down a live full-terminal bridge instead of leaking it.
  if (!ownsOperationView(owner)) return;
  await refreshFromSession();
  if (!ownsOperationView(owner)) return;
  if (currentScreen() === "board") {
    const workspaceId = typeof result.workspace_id === "string" ? result.workspace_id : "";
    const tabId = typeof result.tab_id === "string" ? result.tab_id : "";
    if (workspaceId && tabId) focusBoard(workspaceId, tabId);
    else if (workspaceId) selectBoardWorkspace(workspaceId, boardStore.get().boardTabId);
    else if (tabId) selectBoardTab(tabId);
    return;
  }
  if (paneId) {
    const navigation = await openPaneWithOwner(paneId);
    if (ownsComputer(owner) && navigation?.isCurrent()) {
      owner.scope = navigation.scope;
      owner.incarnation = navigation.incarnation;
    }
  }
}
