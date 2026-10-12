import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import { stepWorkspaceDiff, workspaceDiffStep } from "./actions";
import type { WorkspaceSnapshot } from "./model";
import { useKeyHint } from "./workspace-keys";

/**
 * Previous / next changed file, in the change list's order (conflicts, staged,
 * worktree): `‹ 3 / 4 ›`. The ends disable rather than wrap. It stands at the
 * head of the diff in every arrangement (the page's header, the info bar
 * beside the list, the column's switcher line), so the foot of the diff is
 * left to the notes.
 */
export function DiffStepper({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const prevKey = useKeyHint("prevFile");
  const nextKey = useKeyHint("nextFile");
  if (!snapshot.status) return null;
  const step = workspaceDiffStep();
  if (step.total < 1) return null;
  return <nav className="workspace-stepper" aria-label={t("workspace.changes")}>
    <Button className="icon-btn workspace-step" aria-label={t("workspace.prevChangeLabel")} title={prevKey.title(t("workspace.prevChangeLabel"))}
      aria-keyshortcuts={prevKey.keys}
      disabled={!step.prev || snapshot.loading} onClick={() => stepWorkspaceDiff(-1)}>
      <ChevronLeft size={18} aria-hidden="true" />
    </Button>
    {step.index >= 0 && <span className="workspace-step-where" aria-live="polite">
      {t("workspace.stepPosition", { index: step.index + 1, total: step.total })}
    </span>}
    <Button className="icon-btn workspace-step" aria-label={t("workspace.nextChangeLabel")} title={nextKey.title(t("workspace.nextChangeLabel"))}
      aria-keyshortcuts={nextKey.keys}
      disabled={!step.next || snapshot.loading} onClick={() => stepWorkspaceDiff(1)}>
      <ChevronRight size={18} aria-hidden="true" />
    </Button>
  </nav>;
}
