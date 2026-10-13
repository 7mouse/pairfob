import { ChevronDown, Ellipsis, GitBranch, RefreshCw } from "lucide-react";
import { t } from "../../lib/i18n";
import { workspaceBreadcrumbs } from "../../lib/workspace";
import { BackButton, Button, Swap } from "../../shared/ui/primitives";
import { refreshWorkspace } from "./actions";
import { workspaceBackAction } from "./back";
import { openDetailMenu } from "./detail-menu";
import { DiffStepper } from "./diff-stepper";
import { openPathSheet } from "./files";
import { backLabel } from "./format";
import type { WorkspaceSnapshot } from "./model";
import { changeTotals, reviewProgress, useReviewVersion } from "./review-progress";
import { useListBeside } from "./list-beside";

/** `main ↑2 ↓1`, or `HEAD 1a2b3c4d` when detached. */
export function branchParts(snapshot: WorkspaceSnapshot): { branch: string; sync: string } | null {
  const git = snapshot.descriptor?.git;
  const status = snapshot.status;
  if (!git && !status) return null;
  const name = status ? status.branch : git?.branch ?? null;
  const head = status?.head || git?.head || "";
  const branch = name || `${t("workspace.detached")} ${head.slice(0, 8)}`;
  const sync = [status?.ahead ? `↑${status.ahead}` : "", status?.behind ? `↓${status.behind}` : ""].filter(Boolean).join(" ");
  return { branch, sync };
}

function BranchLine({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const parts = branchParts(snapshot);
  if (!parts) return null;
  return <>
    <GitBranch className="workspace-subline-icon" size={12} aria-hidden="true" />
    <span className="workspace-subline-branch">{parts.branch}</span>
    {parts.sync && <span className="workspace-subline-sync">{parts.sync}</span>}
  </>;
}

/**
 * The changes tab's summary, in the subtitle where the board keeps its own
 * ("1 waiting · 1 done"): the lines the changes add and remove, once every
 * one of them is known (a sum of some is not shown as the total), and how many
 * of the diffs have been seen. It counts diffs, as the list's group titles and
 * the stepper do (a file changed in both layers is two); the tab's badge
 * already says how many files changed.
 */
export function ChangesSummary({ snapshot, lead }: { snapshot: WorkspaceSnapshot; lead: boolean }) {
  useReviewVersion();
  if (!snapshot.status || !snapshot.descriptor?.features.git_status) return null;
  const progress = reviewProgress(snapshot);
  if (!progress.total) return null;
  const totals = changeTotals(snapshot);
  return <>
    {lead && <span className="workspace-subline-sep" aria-hidden="true">·</span>}
    {totals && (totals.additions > 0 || totals.deletions > 0) && <span className="workspace-subline-totals">
      {totals.additions > 0 && <span className="workspace-additions">{t("workspace.additions", { count: totals.additions })}</span>}
      {totals.deletions > 0 && <span className="workspace-deletions">{t("workspace.deletions", { count: totals.deletions })}</span>}
    </span>}
    <span className={`workspace-subline-reviewed${progress.seen === progress.total ? " is-done" : ""}`}>
      {t("workspace.reviewedCount", { seen: progress.seen, total: progress.total })}
    </span>
  </>;
}

/**
 * The repository's name over its branch, how much of its changes is seen, and
 * its root (which gives way first where the line is short); a button to the
 * branch sheet when the daemon lists branches.
 */
export function RepoTitle({ snapshot, onBranches }: { snapshot: WorkspaceSnapshot; onBranches: () => void }) {
  const name = snapshot.descriptor?.name || t("workspace.title");
  const root = snapshot.descriptor?.root || "";
  const parts = branchParts(snapshot);
  const line = <span className="workspace-subline">
    <BranchLine snapshot={snapshot} />
    <ChangesSummary snapshot={snapshot} lead={Boolean(parts)} />
    {parts && <span className="workspace-subline-sep" aria-hidden="true">·</span>}
    <span className="workspace-root">{root}</span>
  </span>;
  if (!snapshot.descriptor?.features.git_branches) {
    return <div className="workspace-title workspace-repo-title"><strong className="workspace-name">{name}</strong>{line}</div>;
  }
  return <Button className="workspace-title workspace-repo-title workspace-branch is-button" disabled={snapshot.loadingBranches}
    aria-label={t("workspace.openBranches", { name, branch: parts?.branch ?? "" })} aria-haspopup="dialog" onClick={onBranches}>
    <strong className="workspace-name">{name}</strong>
    <span className="workspace-subline-row">{line}<ChevronDown className="workspace-subline-open" size={12} aria-hidden="true" /></span>
  </Button>;
}

/**
 * The files tab inside a folder, on one screen at a time: the folder's name
 * over its path. The path opens the jump sheet, as the folded trail does
 * beside the list; Back climbs one level (`WorkspaceHeader`).
 */
function FolderTitle({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const rootLabel = snapshot.descriptor?.name || t("workspace.root");
  const crumbs = workspaceBreadcrumbs(snapshot.directory);
  const current = crumbs[crumbs.length - 1];
  const trail = crumbs.slice(0, -1).map((crumb) => crumb.path ? crumb.label : rootLabel).join(" / ");
  // The name it shows is part of what it is called: "src, go to another folder".
  return <Button className="workspace-title workspace-folder-title is-button" aria-label={t("workspace.jumpFrom", { name: current?.label || rootLabel })} aria-haspopup="dialog"
    onClick={() => openPathSheet(snapshot, rootLabel)}>
    <strong className="workspace-name">{current?.label || rootLabel}</strong>
    <span className="workspace-subline-row"><span className="workspace-subline"><span className="workspace-root">{trail}</span></span>
      <ChevronDown className="workspace-subline-open" size={12} aria-hidden="true" /></span>
  </Button>;
}

/** The open file's name over its folder. From one file to the next both mark the change (`Swap`). */
function DetailTitle({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const path = snapshot.file?.path || snapshot.diff?.path || snapshot.detailPath;
  const cut = path.lastIndexOf("/");
  return <div className="workspace-title workspace-detail-title">
    <Swap as="strong" on={path} className="workspace-name">{cut >= 0 ? path.slice(cut + 1) : path}</Swap>
    <Swap on={path} className="workspace-root">{cut >= 0 ? path.slice(0, cut) : t("workspace.repoRoot")}</Swap>
  </div>;
}

/**
 * Browse: back to the session, the repository title (opens branches, and says
 * how much of the changes is seen), refresh. One screen at a time (a window under 900px) the title follows the
 * tab: the changes tab keeps the repository; the files tab inside a folder names the folder, and
 * Back climbs to its parent before it leaves for the session, so the list
 * needs no trail of its own there. Detail, one screen at a time: back to the list, the
 * file's name over its folder, ⋯; an open diff has the stepper from file to
 * file where a file has refresh. Side by side the list never left, so back
 * has only the session to go to; the header keeps the repository and puts ⋯
 * on the detail pane.
 */
export function WorkspaceHeader({ snapshot, onBranches }: { snapshot: WorkspaceSnapshot; onBranches: () => void }) {
  const detail = snapshot.view !== "browser";
  const together = useListBeside();
  /** One pane at a time and the detail is on top: back uncovers the list. */
  const stacked = detail && !together;
  const inFolder = !detail && !together && snapshot.tab === "files" && snapshot.directory !== "";
  const parent = inFolder ? workspaceBreadcrumbs(snapshot.directory).at(-2)?.path ?? "" : null;
  const back = workspaceBackAction(snapshot, together);
  const backTitle = stacked ? t("workspace.closeDetail") : parent !== null ? t("workspace.upDir") : backLabel(snapshot.returnView);
  return <header className={`workspace-chrome${detail ? " is-detail" : ""}${inFolder ? " is-folder" : ""}`}>
    {/* Up stays under the pointer (BackButton guards the tap): a doubled press would climb two folders. */}
    <BackButton onBack={back} label={backTitle} />
    {inFolder ? <FolderTitle snapshot={snapshot} /> : <RepoTitle snapshot={snapshot} onBranches={onBranches} />}
    {detail && <DetailTitle snapshot={snapshot} />}
    <div className="workspace-actions">
      {/* A diff with the page to itself: from file to file here, and refresh waits in ⋯ beside it. */}
      {stacked && snapshot.view === "diff"
        ? <DiffStepper snapshot={snapshot} />
        : <Button className="icon-btn workspace-refresh" aria-label={t("workspace.refresh")} disabled={snapshot.loading} onClick={refreshWorkspace}>
          <RefreshCw size={18} aria-hidden="true" />
        </Button>}
      {detail && <Button className="icon-btn workspace-detail-more" aria-label={t("workspace.moreActions")} aria-haspopup="dialog"
        onClick={() => openDetailMenu()}><Ellipsis size={20} aria-hidden="true" /></Button>}
    </div>
  </header>;
}
