import { AArrowDown, AArrowUp, WrapText } from "lucide-react";
import type { CSSProperties } from "react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import { canStepDiffSize, diffWraps, stepDiffSize, useDiffSize } from "./diff-reading";
import { setWorkspaceWrap, useWorkspaceWrapChosen } from "./prefs";

/** Smaller, bigger, and wrap: how the open diff's lines read. */
export function DiffReadingTools({ split }: { split: boolean }) {
  useDiffSize();
  const wraps = diffWraps(useWorkspaceWrapChosen());
  return <>
    <Button className="icon-btn workspace-tool workspace-diff-smaller" aria-label={t("workspace.diffSmaller")} title={t("workspace.diffSmaller")}
      disabled={!canStepDiffSize(-1)} onClick={() => stepDiffSize(-1)}><AArrowDown size={16} aria-hidden="true" /></Button>
    <Button className="icon-btn workspace-tool workspace-diff-bigger" aria-label={t("workspace.diffBigger")} title={t("workspace.diffBigger")}
      disabled={!canStepDiffSize(1)} onClick={() => stepDiffSize(1)}><AArrowUp size={16} aria-hidden="true" /></Button>
    {!split && <Button className="icon-btn workspace-tool workspace-diff-wrap" aria-label={t("workspace.wrap")} title={t("workspace.wrap")}
      aria-pressed={wraps} onClick={() => setWorkspaceWrap(!wraps)}><WrapText size={16} aria-hidden="true" /></Button>}
  </>;
}

/** The scroller's classes and size for how the reader wants the lines. */
export function useDiffReading(split: boolean): { className: string; style?: CSSProperties } {
  const size = useDiffSize();
  const wraps = diffWraps(useWorkspaceWrapChosen());
  const className = `${size === null ? "" : " has-diff-fs"}${!split && !wraps ? " is-nowrap" : ""}`;
  return size === null ? { className } : { className, style: { "--diff-fs": `${size}px` } as CSSProperties };
}
