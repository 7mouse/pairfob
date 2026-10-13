import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { INSPECTOR_COLUMN_ID } from "../../app/layout/inspector-width";
import { t } from "../../lib/i18n";
import { ensureBranches, useWorkspace, type WorkspaceSnapshot } from "../../features/workspace";
import { takeInspectorEntrance } from "../../features/workspace/inspector";
import { inspectorLeaving, inspectorStore } from "../../features/workspace/inspector-store";
import { MOTION_MS } from "../../shared/ui/dom/motion";
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
 * Which way the column's content just went: `pushing` when the reader opened a
 * file or a diff from the list, `popping` when they came back to it, for as
 * long as that move takes (desk.scss). Going from one file or diff to another
 * is not a move between the two, and neither is another session's column.
 */
function useDrillTravel(snapshot: WorkspaceSnapshot): "" | "pushing" | "popping" {
  const deep = snapshot.view === "file" || snapshot.view === "diff";
  const [travel, setTravel] = useState<"" | "pushing" | "popping">("");
  const was = useRef({ deep, paneId: snapshot.paneId });
  // Decided while drawing, so the content's first frame already has its direction.
  if (was.current.paneId !== snapshot.paneId || was.current.deep !== deep) {
    const next = was.current.paneId === snapshot.paneId ? (deep ? "pushing" : "popping") : "";
    was.current = { deep, paneId: snapshot.paneId };
    if (next !== travel) setTravel(next);
  }
  useEffect(() => {
    if (!travel) return;
    const timer = window.setTimeout(() => setTravel(""), MOTION_MS.panel);
    return () => window.clearTimeout(timer);
  }, [travel]);
  return travel;
}

/**
 * Files and changes as a column beside the desk session.
 *
 * The session's own column already shows the app notice, so this one does not
 * repeat it the way the workspace screen has to. The column can hold focus
 * itself (`tabIndex`), which is where the keyboard rests when nothing inside
 * it has it: see `useInspectorFocus`. Esc pressed in it closes what is on top:
 * the open file or diff, then the column (`escape`).
 *
 * The column takes its width in one step: the session beside it may be the
 * complete terminal, which is resized once. Opened by the reader, its content
 * then walks in from the edge it opened at (`is-entering`, desk.scss), for as
 * long as that takes: content drawn anew later, for another session, is still.
 * Closed by the reader, the content goes first (`is-leaving`) and the column
 * gives its room back after, again in one step. In between, opening a file or
 * a diff from the list and going back to it travel inside the column
 * (`useDrillTravel`); the column itself and its head stay.
 */
export function WorkspaceInspector() {
  const snapshot = useWorkspace();
  const column = useRef<HTMLElement>(null);
  const [entering, setEntering] = useState(takeInspectorEntrance);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), MOTION_MS.panel);
    return () => window.clearTimeout(timer);
  }, [entering]);
  const leaving = useSyncExternalStore(inspectorStore.subscribe, inspectorLeaving);
  const travel = useDrillTravel(snapshot);
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
  return <aside ref={column} id={INSPECTOR_COLUMN_ID} className={`inspector workspace-inspector${leaving ? " is-leaving" : entering ? " is-entering" : travel ? ` is-${travel}` : ""}`} aria-label={t("inspector.label")} tabIndex={-1}
    onKeyDown={(event) => {
      escapeFromColumn(event);
      keysFromColumn(event);
    }}>
    <InspectorHead snapshot={snapshot} onBranches={() => void openBranches()} />
    <InspectorContent key={paneId} snapshot={snapshot} />
    {branchesOf === paneId && snapshot.branches && <BranchSheet branches={snapshot.branches} onClose={() => setBranchesOf(null)} />}
  </aside>;
}
