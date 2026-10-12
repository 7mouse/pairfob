import type { CSSProperties, RefObject } from "react";
import { t } from "../../lib/i18n";
import { ColumnDivider, remPx, type ColumnBox } from "../../shared/ui/primitives";
import { setWorkspaceListWidth } from "./prefs";
import { useListBeside } from "./list-beside";

/**
 * The line between the list and the open file on the workspace screen, where
 * it shows both (from 900px). The reader drags it to give the list 300–480px;
 * the open file keeps the width it has in the narrowest such window, so a list
 * widened on a large screen never crowds it on a small one.
 *
 * The bounds are the style sheet's, in rem as it writes them (`workspace.scss`,
 * "The line between the list and the open file"): change both together.
 */
export const LIST_MIN_REM = 18.75;
export const LIST_MAX_REM = 30;
/** The layout's own narrowest list: the upper bound never goes under it, so the default is always allowed. */
export const LIST_FLOOR_REM = 19;
/** 596px at the default text size: the open file's width in a 900px window. */
export const DETAIL_MIN_REM = 37.25;

/** The list column's id, for the line that sizes it to name. */
export const LIST_COLUMN_ID = "workspace-list";

/** What the list may be in a body this wide, in px. */
export function listBounds(bodyWidth: number, rem: number): { min: number; max: number } {
  return { min: LIST_MIN_REM * rem, max: Math.max(LIST_FLOOR_REM * rem, Math.min(LIST_MAX_REM * rem, bodyWidth - DETAIL_MIN_REM * rem)) };
}

function listBox(body: HTMLElement | null): ColumnBox | null {
  const list = body?.querySelector<HTMLElement>(":scope > .workspace-nav");
  if (!body || !list) return null;
  const total = body.getBoundingClientRect().width;
  const width = list.getBoundingClientRect().width;
  if (!total || !width) return null;
  return { ...listBounds(total, remPx()), width };
}

/** The reader's width on the body, for the grid rule to read; nothing until they set one. */
export function listColumnStyle(width: number | null): CSSProperties | undefined {
  return width === null ? undefined : { "--workspace-list-chosen": `${width}px` } as CSSProperties;
}

export function ListDivider({ body }: { body: RefObject<HTMLElement | null> }) {
  // One pane at a time has no line to move.
  if (!useListBeside()) return null;
  return <ColumnDivider className="workspace-list-divider" side="before" label={t("workspace.listResize")}
    hint={t("column.resizeHint")} valueText={(width) => t("column.widthPx", { width })} controls={LIST_COLUMN_ID}
    measure={() => listBox(body.current)} onCommit={setWorkspaceListWidth} onReset={() => setWorkspaceListWidth(null)} />;
}
