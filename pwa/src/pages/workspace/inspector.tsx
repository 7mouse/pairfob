import { useCallback, useEffect, useRef, useState } from "react";
import { INSPECTOR_COLUMN_ID } from "../../app/layout/inspector-width";
import { t } from "../../lib/i18n";
import { ensureBranches, useWorkspace, type WorkspaceSnapshot } from "../../features/workspace";
import { BranchSheet } from "../../features/workspace/branches";
import { WorkspaceBrowser } from "../../features/workspace/browser";
import { escapeFromColumn } from "../../features/workspace/escape";
import { InspectorDiff, InspectorFile } from "../../features/workspace/inspector-detail";
import { useInspectorFocus } from "../../features/workspace/focus-keeper";
import { InspectorHead } from "../../features/workspace/inspector-head";
import { keysFromColumn } from "../../features/workspace/workspace-keys";

/**
 * One column: the list until something is opened, then that file or diff under
 * a one-line switcher. A note is written under its line, inside the diff, so
 * this holds no editor of its own.
 */
function InspectorContent({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return snapshot.view === "file" ? <InspectorFile snapshot={snapshot} />
    : snapshot.view === "diff" ? <InspectorDiff snapshot={snapshot} />
    : <section className="inspector-list"><WorkspaceBrowser snapshot={snapshot} /></section>;
}

/**
 * Files and changes as a column beside the desk session.
 *
 * The session's own column already shows the app notice, so this one does not
 * repeat it the way the workspace screen has to. The column can hold focus
 * itself (`tabIndex`), which is where the keyboard rests when nothing inside
 * it has it: see `useInspectorFocus`. Esc pressed in it closes what is on top:
 * the open file or diff, then the column (`escape`).
 */
export function WorkspaceInspector() {
  const snapshot = useWorkspace();
  const column = useRef<HTMLElement>(null);
  useInspectorFocus(column, snapshot.paneId);
  // The branch sheet belongs to the session it was opened for: another session's column never shows it.
  const [branchesOf, setBranchesOf] = useState<string | null>(null);
  const paneId = snapshot.paneId;
  const shownPane = useRef(paneId);
  shownPane.current = paneId;
  // It does not wait either: a column that showed another session meanwhile comes back without the sheet.
  useEffect(() => { setBranchesOf(null); }, [paneId]);
  const openBranches = useCallback(async () => {
    const branches = await ensureBranches();
    // Asked for one session, answered under another: the sheet is not for this one.
    if (branches && shownPane.current === paneId) setBranchesOf(paneId);
  }, [paneId]);
  return <aside ref={column} id={INSPECTOR_COLUMN_ID} className="inspector workspace-inspector" aria-label={t("inspector.label")} tabIndex={-1}
    onKeyDown={(event) => {
      escapeFromColumn(event);
      keysFromColumn(event);
    }}>
    <InspectorHead snapshot={snapshot} onBranches={() => void openBranches()} />
    <InspectorContent key={paneId} snapshot={snapshot} />
    {branchesOf === paneId && snapshot.branches && <BranchSheet branches={snapshot.branches} onClose={() => setBranchesOf(null)} />}
  </aside>;
}
