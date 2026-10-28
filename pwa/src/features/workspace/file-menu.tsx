import { Circle, CircleCheck, Copy, Download, FileDiff, FileText, LogOut, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { t } from "../../lib/i18n";
import type { GitChangeKind } from "../../lib/workspace";
import { showActionSheet, type SheetAction } from "../../shared/ui/overlay/action-sheet";
import { MenuGroup, MenuRow } from "../../shared/ui/overlay/menu-controls";
import { changeKindLabel } from "./format";
import { ownFilesDialog } from "./surface-dialogs";

/**
 * One sheet for every file-level action: a row's ⋯/long-press menu and the
 * detail header menu. Rows run their action after the sheet has closed, so a
 * follow-up rename or delete dialog never stacks on this one.
 */
export type FileMenuSpec = {
  name: string;
  directory: string;
  mark?: GitChangeKind | null;
  viewChanges?: SheetAction;
  openFile?: SheetAction;
  download?: SheetAction;
  downloadDetail?: string;
  copyPath: SheetAction;
  /** A diff's own mark: seen as it stands, or unseen again. */
  review?: { seen: boolean; toggle: SheetAction };
  rename?: SheetAction;
  remove?: SheetAction;
  refresh?: SheetAction;
  closeWorkspace?: SheetAction;
  /** Where closing the workspace lands: "back to the terminal", "back to the chat". */
  closeDetail?: string;
};

const ICON = 18;

export function openFileMenu(spec: FileMenuSpec): void {
  // Owned by the surface it opens from, which closes it when the list leaves the page.
  ownFilesDialog(() => showActionSheet(spec.name, modal => <>
    <MenuGroup>
      {spec.viewChanges && <MenuRow modal={modal} action={spec.viewChanges} icon={<FileDiff size={ICON} />}
        label={t("workspace.viewChanges")} detail={spec.mark ? changeKindLabel(spec.mark) : undefined} />}
      {spec.openFile && <MenuRow modal={modal} action={spec.openFile} icon={<FileText size={ICON} />} label={t("workspace.openFile")} />}
      {spec.download && <MenuRow modal={modal} action={spec.download} icon={<Download size={ICON} />}
        label={t("workspace.download.menu")} detail={spec.downloadDetail} />}
      <MenuRow modal={modal} action={spec.copyPath} icon={<Copy size={ICON} />} label={t("workspace.copyPath")} />
      {spec.review && <MenuRow modal={modal} action={spec.review.toggle}
        icon={spec.review.seen ? <Circle size={ICON} /> : <CircleCheck size={ICON} />}
        label={t(spec.review.seen ? "workspace.markUnreviewed" : "workspace.markReviewed")} />}
    </MenuGroup>
    {(spec.rename || spec.remove) && <MenuGroup>
      {spec.rename && <MenuRow modal={modal} action={spec.rename} icon={<Pencil size={ICON} />} label={t("fileActions.rename")} />}
      {spec.remove && <MenuRow modal={modal} action={spec.remove} icon={<Trash2 size={ICON} />} label={t("fileActions.delete")} danger />}
    </MenuGroup>}
    {(spec.refresh || spec.closeWorkspace) && <MenuGroup>
      {spec.refresh && <MenuRow modal={modal} action={spec.refresh} icon={<RefreshCw size={ICON} />} label={t("workspace.refresh")} />}
      {spec.closeWorkspace && <MenuRow modal={modal} action={spec.closeWorkspace} icon={<LogOut size={ICON} />}
        label={t("workspace.closeWorkspace")} detail={spec.closeDetail} />}
    </MenuGroup>}
  </>, { subtitle: spec.directory, className: "workspace-file-menu", popover: "menu" }));
}
