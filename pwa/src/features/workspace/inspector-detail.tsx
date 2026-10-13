import { ChevronDown, ChevronLeft } from "lucide-react";
import { t } from "../../lib/i18n";
import type { GitChangeKind } from "../../lib/workspace";
import { Button, Swap } from "../../shared/ui/primitives";
import { closeWorkspaceDetail } from "./actions";
import { guardBackPress } from "./back-press";
import { DiffBody, DiffFooter, DiffHint, DiffStats, DiffTools, LayerSwitch, useDiffView } from "./diff";
import { DiffStepper } from "./diff-stepper";
import { DetailMoreButton, FileActions, FileBody, FileMeta, useFileView } from "./file-detail";
import { openFileSwitcher } from "./file-switcher";
import { GitMark } from "./git-mark";
import type { WorkspaceSnapshot } from "./model";
import { setOpenNoteAside, useInlineNote } from "./note-inline";
import { DiffNotesBar } from "./notes";

/**
 * The inspector's one column has no room for the list beside an open file, so
 * the list collapses into this line: a way back to it, then the open item's
 * name, which opens the list as a menu to switch by (`file-switcher`). The
 * full path stays one hover or one ⋯ away. Back brings the list up under the
 * pointer, so a doubled press is guarded as on any way back.
 */
function ListSwitch({ path, mark }: { path: string; mark?: GitChangeKind }) {
  const name = path.split("/").pop() || path;
  return <>
    <Button className="icon-btn workspace-tool inspector-back" aria-label={t("inspector.backToList", { name })} title={t("workspace.switchList")}
      onClick={(event) => {
        guardBackPress(event);
        closeWorkspaceDetail();
      }}>
      <ChevronLeft size={18} aria-hidden="true" />
    </Button>
    <Button className="inspector-switch-file" aria-label={t("inspector.switchFile", { name })} title={path} aria-haspopup="dialog"
      onClick={(event) => openFileSwitcher(event.currentTarget)}>
      <Swap on={path} className="workspace-detail-name">{name}</Swap>
      {mark && <GitMark kind={mark} />}
      <ChevronDown size={14} aria-hidden="true" />
    </Button>
  </>;
}

/** A source file in the inspector: the switcher line, then the same body the page shows. */
export function InspectorFile({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const view = useFileView(snapshot);
  return <section className="workspace-detail-view" aria-label={t("workspace.file")}>
    <div className="workspace-detail-head inspector-switch">
      {/* The changes chip beside it already carries the file's mark. */}
      <ListSwitch path={view.path} />
      <FileMeta snapshot={snapshot} view={view} />
      <FileActions view={view} />
    </div>
    <FileBody snapshot={snapshot} view={view} />
  </section>;
}

/**
 * A diff in the inspector. The switcher line carries what the page spreads over
 * its info bar and footer — layer, counts, previous/next — and the footer is
 * left to notes: the invitation to pin one, then the bar that sends them to the
 * agent in the session next to it. A note is written in place, under its line.
 */
export function InspectorDiff({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const view = useDiffView(snapshot);
  const { diff, layers } = view;
  const note = useInlineNote(view.diffKey);
  return <section className="workspace-detail-view workspace-diff-view" aria-label={t("workspace.diff")}
    onKeyDown={(event) => setOpenNoteAside(note, event)}>
    <div className="workspace-detail-head inspector-switch">
      <ListSwitch path={view.path} mark={view.kind} />
      {layers.length > 1 ? <LayerSwitch snapshot={snapshot} layers={layers} />
        : <span className="workspace-layer-label">{t(snapshot.diffLayer === "staged" ? "workspace.staged" : "workspace.worktree")}</span>}
      {/* What gives way first where the line is short, and whole (`.inspector-stats`). */}
      <span className="inspector-stats"><span className="inspector-stats-pair"><DiffStats snapshot={snapshot} /></span></span>
      <span className="workspace-detail-actions">
        <DiffTools snapshot={snapshot} view={view} />
        <DiffStepper snapshot={snapshot} />
        <DetailMoreButton />
      </span>
    </div>
    <DiffBody snapshot={snapshot} view={view} onEditNote={note.open} hint={false} inline={note} parked={note.parked} />
    <DiffFooter view={view}>
      {diff && !diff.binary && <DiffNotesBar path={diff.path} layer={snapshot.diffLayer} paneId={snapshot.paneId} beside />}
      {view.invitesNotes && <DiffHint />}
    </DiffFooter>
  </section>;
}
