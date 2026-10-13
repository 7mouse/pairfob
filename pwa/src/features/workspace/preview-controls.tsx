import { useState, useSyncExternalStore } from "react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import type { WorkspaceSnapshot } from "./model";
import { PREVIEW_WIDTHS, setPreviewWidth, usePreviewWidth, type PreviewWidth } from "./prefs";
import { thumbAt } from "./thumb";

export const isHTMLFile = (path: string) => /\.html?$/i.test(path);
type PreviewMode = "preview" | "source";

/** The info bar and document share one state, scoped to the file being viewed. */
export function usePreviewControls(snapshot: WorkspaceSnapshot) {
  const key = `${snapshot.paneId}:${snapshot.descriptor?.root}:${snapshot.file?.path}:${snapshot.sourceLine}`;
  const initial = { key, mode: snapshot.sourceLine ? "source" as const : "preview" as const, started: !snapshot.sourceLine, reload: 0 };
  const [state, setState] = useState(initial);
  const current = state.key === key ? state : initial;
  if (state.key !== key) setState(initial);
  return {
    ...current,
    select: (mode: PreviewMode) => setState(value => ({ ...value, mode, started: value.started || mode === "preview" })),
    refresh: () => setState(value => ({ ...value, reload: value.reload + 1 })),
  };
}

export type PreviewControls = ReturnType<typeof usePreviewControls>;

/**
 * How wide the preview's stage is, as the preview measures it (`HTMLPreview`);
 * 0 while no preview is on the page. The info bar is drawn apart from the
 * stage, so the measure is shared here.
 */
let stageWidth = 0;
const stageListeners = new Set<() => void>();

export function notePreviewStage(width: number): void {
  const next = Math.max(0, Math.round(width));
  if (next === stageWidth) return;
  stageWidth = next;
  for (const listener of [...stageListeners]) listener();
}

function subscribeStage(listener: () => void): () => void {
  stageListeners.add(listener);
  return () => { stageListeners.delete(listener); };
}

/** The stage has to hold the widest choice with air on both sides, or choosing it would change nothing. */
export const PREVIEW_WIDTH_STAGE_MIN = Math.max(...PREVIEW_WIDTHS) + 32;

/**
 * A page is tried at a phone's or a tablet's width where that is a question:
 * the stage is wider than both. The stage's own width decides, not the window's
 * (the column beside a session is never this wide, whatever the window is) and
 * not what the page is operated with: a large tablet has the room too, and its
 * finger presses the same three buttons a mouse does.
 */
export function previewWidthOffered(stage: number): boolean {
  return stage >= PREVIEW_WIDTH_STAGE_MIN;
}

function usePreviewWidthOffered(): boolean {
  const stage = useSyncExternalStore(subscribeStage, () => stageWidth, () => 0);
  return previewWidthOffered(stage);
}

/** The width the frame is held to, in pixels; null where the choice is not offered or is the room there is. */
export function usePreviewFrameWidth(): number | null {
  const offered = usePreviewWidthOffered();
  const chosen = usePreviewWidth();
  return offered && chosen !== "auto" ? chosen : null;
}

const WIDTH_CHOICES: readonly PreviewWidth[] = [...PREVIEW_WIDTHS, "auto"];

function WidthSwitch() {
  const chosen = usePreviewWidth();
  return <span className="workspace-layer-switch workspace-preview-width" role="group" aria-label={t("preview.width")}
    style={thumbAt(WIDTH_CHOICES.indexOf(chosen), WIDTH_CHOICES.length)}>
    {WIDTH_CHOICES.map((width) => <Button key={width} aria-pressed={chosen === width}
      aria-label={width === "auto" ? undefined : t("preview.widthPx", { width })}
      onClick={() => setPreviewWidth(width)}>{width === "auto" ? t("preview.widthAuto") : String(width)}</Button>)}
  </span>;
}

export function PreviewSwitch({ controls }: { controls: PreviewControls }) {
  const widths = usePreviewWidthOffered() && controls.mode === "preview";
  return <>
    <span className="workspace-layer-switch workspace-preview-switch" role="group" aria-label={t("preview.title")}
      style={thumbAt(controls.mode === "preview" ? 0 : 1, 2)}>
      <Button aria-pressed={controls.mode === "preview"} onClick={() => controls.select("preview")}>{t("preview.preview")}</Button>
      <Button aria-pressed={controls.mode === "source"} onClick={() => controls.select("source")}>{t("preview.source")}</Button>
    </span>
    {widths && <WidthSwitch />}
  </>;
}
