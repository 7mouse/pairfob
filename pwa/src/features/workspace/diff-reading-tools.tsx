import { ALargeSmall } from "lucide-react";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { t } from "../../lib/i18n";
import { showActionSheet } from "../../shared/ui/overlay/action-sheet";
import { MenuGroup, MenuStepper, MenuSwitch } from "../../shared/ui/overlay/menu-controls";
import { Button } from "../../shared/ui/primitives";
import { usePreferences } from "../settings/hooks";
import { canStepDiffSize, drawnDiffSize, setDiffWrap, stepDiffSize, useDiffSize, useDiffSizeBox, useDiffWrap, type DiffReading } from "./diff-reading";
import { useKeyHint } from "./workspace-keys";

/**
 * The size `lines` are drawn at: read off them once they are on screen, and
 * again whenever the reader's size or the terminal's (which the sheet's own
 * size follows) changes.
 */
function useDrawnSize(lines: RefObject<HTMLElement | null>): number {
  const chosen = useDiffSize();
  usePreferences();
  const [drawn, setDrawn] = useState<number | null>(null);
  useEffect(() => { setDrawn(drawnDiffSize(lines.current)); });
  return chosen ?? drawn ?? drawnDiffSize(null);
}

/** Size and wrap, applied in place: the reader watches the lines behind change. */
function DiffReadingSettings({ split, lines }: { split: boolean; lines: RefObject<HTMLElement | null> }) {
  const drawn = useDrawnSize(lines);
  const wraps = useDiffWrap();
  const wrapKey = useKeyHint("wrap");
  return <MenuGroup label={t("workspace.diffReading")}>
    <MenuStepper label={t("pane.fontSize")} value={t("pane.fontPx", { n: Number(drawn.toFixed(1)) })}
      decrease={t("menu.fontDown")} increase={t("menu.fontUp")}
      onDecrease={() => stepDiffSize(-1, drawnDiffSize(lines.current))} onIncrease={() => stepDiffSize(1, drawnDiffSize(lines.current))}
      canDecrease={canStepDiffSize(-1, drawn)} canIncrease={canStepDiffSize(1, drawn)} />
    {!split && <MenuSwitch label={t("menu.wrap")} hint={wrapKey.shown} keys={wrapKey.keys} checked={wraps} onChange={setDiffWrap} />}
  </MenuGroup>;
}

/**
 * How the open diff's `lines` read, behind one control so the info bar keeps
 * its room on a phone: the panel under it for a mouse, a sheet for a finger.
 * Two fingers on the lines change the size too (`useDiffPinch`), and Alt+Z the
 * wrap (`workspace-keys`).
 */
export function DiffReadingButton({ split, lines }: { split: boolean; lines: RefObject<HTMLElement | null> }) {
  const label = t("workspace.diffReading");
  return <Button className="icon-btn workspace-tool workspace-diff-reading" aria-label={label} title={label} aria-haspopup="dialog"
    onClick={() => showActionSheet(label, () => <DiffReadingSettings split={split} lines={lines} />,
      { className: "diff-reading-sheet", popover: "panel" })}>
    <ALargeSmall size={16} aria-hidden="true" />
  </Button>;
}

/**
 * The scroller's classes and style for how the reader wants the lines: their
 * size, kept whole where wrapping is off (never side by side), and the gutter
 * as wide as the patch's longest line number (`digits`).
 */
export function useDiffReading(split: boolean, digits?: number): DiffReading {
  const box = useDiffSizeBox();
  const wraps = useDiffWrap();
  const className = `${box.className}${!split && !wraps ? " is-nowrap" : ""}`;
  if (digits === undefined) return { className, style: box.style };
  return { className, style: { ...box.style, "--diff-digits": String(digits) } as CSSProperties };
}
