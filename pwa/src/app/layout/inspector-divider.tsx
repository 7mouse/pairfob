import { t } from "../../lib/i18n";
import { ColumnDivider, remPx, type ColumnBox } from "../../shared/ui/primitives";
import { tryAppRoot } from "../dom-root";
import { INSPECTOR_COLUMN_ID, inspectorBounds, setInspectorWidth, useInspectorWidth } from "./inspector-width";

/** The files-and-changes column as it stands beside the session, and what the two can share. */
function inspectorBox(): ColumnBox | null {
  const app = tryAppRoot();
  const session = app?.querySelector<HTMLElement>(":scope > .main");
  const column = app?.querySelector<HTMLElement>(":scope > .inspector");
  if (!session || !column) return null;
  const width = column.getBoundingClientRect().width;
  const beside = session.getBoundingClientRect().width;
  if (!width || !beside) return null;
  return { ...inspectorBounds(width + beside, remPx()), width };
}

/**
 * The line between the desk session and the files-and-changes column. Dragging
 * it trades width between the two, within the column's 440–720px and the
 * session's own floor.
 *
 * The session may be the complete terminal, whose box sizes the program on the
 * computer. The line previews and the width is written once, when the reader
 * lets go (`ColumnDivider`): one drag is one resize there.
 */
export function InspectorDivider() {
  // A width set anywhere moves the seam: measure again.
  useInspectorWidth();
  return <ColumnDivider className="inspector-divider" side="after" label={t("inspector.resize")}
    hint={t("column.resizeHint")} valueText={(width) => t("column.widthPx", { width })} controls={INSPECTOR_COLUMN_ID}
    measure={inspectorBox} onCommit={setInspectorWidth} onReset={() => setInspectorWidth(null)} />;
}
