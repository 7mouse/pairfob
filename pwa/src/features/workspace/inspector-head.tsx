import { Ellipsis, Maximize2, RefreshCw, X } from "lucide-react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import { refreshWorkspace } from "./actions";
import { guardBackPress } from "./back-press";
import { ChangesSummary } from "./header";
import { leaveWorkspaceInspector, expandWorkspaceInspector } from "./inspector";
import type { WorkspaceSnapshot } from "./model";
import { openRepoMenu } from "./repo-menu";
import { INSPECTOR_TAB_ORDER } from "./tab-order";
import { WorkspaceTabStrip } from "./tab-strip";

/**
 * Changes and files, how far the review of the changes is, then what the
 * column itself can do: reload, the repository (its name, root and branches,
 * in a menu: the column has no row to spare for them), grow into the workspace
 * screen, close. Changes lead because they are what the reader opens the
 * inspector for (`tab-order`). Close gives its corner to the session header's
 * own actions, so its press is guarded like a way back.
 */
export function InspectorHead({ snapshot, onBranches }: { snapshot: WorkspaceSnapshot; onBranches: () => void }) {
  const descriptor = snapshot.descriptor;
  return <header className="inspector-head">
    {descriptor?.features.git_status
      ? <WorkspaceTabStrip snapshot={snapshot} order={INSPECTOR_TAB_ORDER} kind="inspector" label={t("inspector.label")} />
      // Without Git status there is only the file view, so nothing to choose between.
      : <strong className="inspector-title">{t(descriptor ? "workspace.files" : "inspector.label")}</strong>}
    <span className="inspector-summary"><ChangesSummary snapshot={snapshot} lead={false} /></span>
    <div className="inspector-actions">
      <Button className="icon-btn" aria-label={t("workspace.refresh")} title={t("workspace.refresh")}
        disabled={snapshot.loading} onClick={() => void refreshWorkspace()}>
        <RefreshCw size={16} aria-hidden="true" />
      </Button>
      {descriptor && <Button className="icon-btn inspector-repo" aria-label={t("inspector.repo", { name: descriptor.name || t("workspace.title") })} title={descriptor.root}
        aria-haspopup="dialog" onClick={(event) => openRepoMenu(snapshot, onBranches, event.currentTarget)}>
        <Ellipsis size={18} aria-hidden="true" />
      </Button>}
      <Button className="icon-btn inspector-expand" aria-label={t("inspector.expand")} title={t("inspector.expand")}
        onClick={() => void expandWorkspaceInspector()}>
        <Maximize2 size={16} aria-hidden="true" />
      </Button>
      <Button className="icon-btn inspector-close" aria-label={t("inspector.close")} title={t("inspector.close")}
        onClick={(event) => {
          guardBackPress(event);
          leaveWorkspaceInspector();
        }}>
        <X size={18} aria-hidden="true" />
      </Button>
    </div>
  </header>;
}
