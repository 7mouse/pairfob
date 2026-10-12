import { workspaceBreadcrumbs } from "../../lib/workspace";
import { closeWorkspaceDetail, leaveWorkspace, loadDirectory } from "./actions";
import type { WorkspaceSnapshot } from "./model";

/** The header and browser Back use the same currently displayed hierarchy. */
export function workspaceBackAction(snapshot: WorkspaceSnapshot, beside: boolean): () => void | Promise<void> {
  if (!beside && snapshot.view !== "browser") return closeWorkspaceDetail;
  if (!beside && snapshot.view === "browser" && snapshot.tab === "files" && snapshot.directory) {
    const parent = workspaceBreadcrumbs(snapshot.directory).at(-2)?.path ?? "";
    return () => loadDirectory(parent);
  }
  return leaveWorkspace;
}
