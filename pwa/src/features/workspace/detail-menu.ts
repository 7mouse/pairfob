import { t } from "../../lib/i18n";
import { leaveWorkspace, loadWorkspaceFile, refreshWorkspace } from "./actions";
import { downloadActionAvailable, openWorkspaceDownload } from "./download-file";
import { copyWorkspacePath, viewWorkspaceChanges, workspaceFileMutations } from "./file-actions";
import { openFileMenu } from "./file-menu";
import { returnLabel } from "./format";
import { gitMarks } from "./git-marks";
import { isReviewed, setReviewed } from "./review-progress";
import { getWorkspaceSnapshot } from "./store";
import { workspaceBeside } from "./surface";

/**
 * The ⋯ menu of the file preview and the diff. The preview offers rename and
 * delete while its file is still listed in the browsed directory; the diff does
 * not, so reviewing never edits files by accident.
 */
export function openDetailMenu(): void {
  const snap = getWorkspaceSnapshot();
  const path = snap.detailPath;
  if (!path || snap.view === "browser") return;
  const cut = path.lastIndexOf("/");
  const mark = gitMarks(snap.status).files.get(path) ?? null;
  const canDownload = downloadActionAvailable() && Boolean(snap.file);
  const common = {
    name: cut >= 0 ? path.slice(cut + 1) : path,
    directory: cut >= 0 ? path.slice(0, cut) : t("workspace.repoRoot"),
    mark,
    download: canDownload ? () => openWorkspaceDownload(path, snap.file!.size) : undefined,
    downloadDetail: canDownload ? t("workspace.download.p2pShort") : undefined,
    copyPath: () => copyWorkspacePath(path),
    refresh: () => refreshWorkspace(),
    // Beside the session there is no workspace to leave: the column has its own close.
    closeWorkspace: workspaceBeside() ? undefined : () => leaveWorkspace(),
    closeDetail: returnLabel(snap.returnView),
  };
  if (snap.view === "diff") {
    const deleted = snap.diffLayer === "staged"
      ? snap.status?.changes.some((change) => change.path === path && change.index === "D")
      : mark === "deleted";
    const root = snap.descriptor?.root ?? "";
    const layer = snap.diffLayer;
    const revision = snap.diff?.path === path ? snap.diff.revision : "";
    const seen = isReviewed(root, layer, path);
    openFileMenu({
      ...common,
      openFile: deleted ? undefined : () => loadWorkspaceFile(path),
      // The reader's own answer, where reaching the end marked it for them: unseen again, or seen without scrolling.
      review: root && (seen || revision) ? { seen, toggle: () => setReviewed(root, layer, path, seen ? null : revision) } : undefined,
    });
    return;
  }
  const entry = snap.entries.find((item) => item.path === path);
  const mutations = entry ? workspaceFileMutations(entry) : {};
  openFileMenu({ ...common, viewChanges: viewWorkspaceChanges(path), rename: mutations.rename, remove: mutations.remove });
}
