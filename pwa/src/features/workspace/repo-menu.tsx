import { Copy, GitBranch, RefreshCw } from "lucide-react";
import { t } from "../../lib/i18n";
import { showActionSheet, type ActionSheetController } from "../../shared/ui/overlay/action-sheet";
import { MenuGroup, MenuRow } from "../../shared/ui/overlay/menu-controls";
import { useMenuItemRole } from "../../shared/ui/overlay/popover-frame";
import { refreshWorkspace } from "./actions";
import { copyWorkspaceRoot } from "./file-actions";
import { branchParts } from "./header";
import type { WorkspaceSnapshot } from "./model";
import { ownFilesDialog } from "./surface-dialogs";

const ICON = 18;

function RepoMenu({ snapshot, modal, onBranches }: { snapshot: WorkspaceSnapshot; modal: ActionSheetController; onBranches: () => void }) {
  const descriptor = snapshot.descriptor;
  const parts = branchParts(snapshot);
  const menu = useMenuItemRole() !== undefined;
  if (!descriptor) return null;
  const name = descriptor.name || t("workspace.title");
  return <>
    {/* At the button the menu has no title bar: it says here which repository it is. A sheet's own title does. */}
    <div className="workspace-repo-id">
      <strong>{name}</strong>
      <span>{descriptor.root}</span>
    </div>
    {/* The commands alone are the menu; what names the repository above them is not one. */}
    <div role={menu ? "menu" : undefined} aria-label={menu ? name : undefined}>
      <MenuGroup>
        {parts && descriptor.features.git_branches && <MenuRow modal={modal} action={onBranches} icon={<GitBranch size={ICON} />}
          label={t("workspace.overviewBranches")} detail={[parts.branch, parts.sync].filter(Boolean).join(" ")} />}
        <MenuRow modal={modal} action={() => copyWorkspaceRoot()} icon={<Copy size={ICON} />} label={t("workspace.copyRoot")} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow modal={modal} action={() => refreshWorkspace()} icon={<RefreshCw size={ICON} />} label={t("workspace.refresh")} />
      </MenuGroup>
    </div>
  </>;
}

/**
 * The repository the column is showing, as a menu on its head: its name and
 * root, its branch (the way into branches and worktrees where the daemon lists
 * them), the root's path to copy. The files screen has the room to say all of
 * this in its header; the column says it here and keeps its rows for the list.
 */
export function openRepoMenu(snapshot: WorkspaceSnapshot, onBranches: () => void, anchor?: HTMLElement): void {
  const descriptor = snapshot.descriptor;
  if (!descriptor) return;
  const parts = branchParts(snapshot);
  ownFilesDialog(() => showActionSheet(descriptor.name || t("workspace.title"), modal => <RepoMenu snapshot={snapshot} modal={modal} onBranches={onBranches} />,
    { subtitle: parts && !descriptor.features.git_branches ? `${descriptor.root} · ${parts.branch}` : descriptor.root,
      className: "workspace-file-menu workspace-repo-menu", popover: "menu", anchor, menuInside: true }));
}
