import { useCallback, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { AppNotice, useAppNotice } from "../../app/notice";
import {
  ensureBranches,
  useWorkspace,
  type WorkspaceSnapshot,
} from "../../features/workspace";
import { BranchSheet } from "../../features/workspace/branches";
import { WorkspaceBrowser } from "../../features/workspace/browser";
import { DiffDetail } from "../../features/workspace/diff";
import { useScreenEscape } from "../../features/workspace/escape";
import { FileDetail } from "../../features/workspace/file-detail";
import { useScreenFocus } from "../../features/workspace/focus-keeper";
import { WorkspaceHeader } from "../../features/workspace/header";
import { LIST_COLUMN_ID, ListDivider, listColumnStyle } from "../../features/workspace/list-divider";
import { WorkspaceOverview } from "../../features/workspace/overview";
import { useWorkspaceListWidth } from "../../features/workspace/prefs";
import { useTabOrder } from "../../features/workspace/tab-order";
import { WorkspaceTabStrip } from "../../features/workspace/tab-strip";
import { useScreenKeys } from "../../features/workspace/workspace-keys";

function WorkspaceTabs({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const order = useTabOrder();
  // Without Git status there is only one view, so no tab strip at all.
  if (!snapshot.descriptor?.features.git_status) return null;
  return <WorkspaceTabStrip snapshot={snapshot} order={order} kind="workspace" label={t("workspace.title")} />;
}

function WorkspaceNotice() {
  const notice = useAppNotice();
  if (!notice) return null;
  return <div className="workspace-app-notice"><AppNotice /></div>;
}

export function WorkspaceScreen() {
  const snapshot = useWorkspace();
  const [branchOpen, setBranchOpen] = useState(false);
  const openBranches = useCallback(async () => {
    const branches = await ensureBranches();
    if (branches) setBranchOpen(true);
  }, []);
  const shell = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const listWidth = useWorkspaceListWidth();
  useScreenFocus(shell);
  useScreenEscape();
  useScreenKeys();

  return <>
    <div ref={shell} className={`workspace-shell${snapshot.view === "browser" ? "" : " detail"}`}>
      <WorkspaceHeader snapshot={snapshot} onBranches={() => void openBranches()} />
      <WorkspaceNotice />
      <div ref={body} className="workspace-body" style={listColumnStyle(listWidth)}>
        <aside id={LIST_COLUMN_ID} className="workspace-nav">
          <WorkspaceTabs snapshot={snapshot} />
          <WorkspaceBrowser snapshot={snapshot} />
        </aside>
        <ListDivider body={body} />
        <main className="workspace-main">
          {snapshot.view === "file" ? <FileDetail snapshot={snapshot} />
            : snapshot.view === "diff" ? <DiffDetail snapshot={snapshot} />
            : <WorkspaceOverview snapshot={snapshot} onBranches={() => void openBranches()} />}
        </main>
      </div>
    </div>
    {branchOpen && snapshot.branches && <BranchSheet branches={snapshot.branches} onClose={() => setBranchOpen(false)} />}
  </>;
}
