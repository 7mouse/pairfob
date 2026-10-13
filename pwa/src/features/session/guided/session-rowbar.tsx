import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../../lib/i18n";
import { bindRowBubble, closeRow, copyRow, placeRowBubble, quoteRow, rowBarContent } from "./rowbar";
import { paneModel } from "./pane-model";
import { sessionStore } from "../session-store";
import { selectTermRow } from "./term";
import { Button, CopyAck } from "../../../shared/ui/primitives";
import { usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { playMove } from "../measured-move";

/** How long the bubble stays to say "copied" on the pressed action before it closes. */
export const ROW_COPIED_MS = 900;

type Copied = { index: number; what: "line" | "path" };

function pickedRow(): number | null {
  return sessionStore.get().paneRow;
}

/**
 * Floating actions for the picked terminal row (`state.paneRow`).
 *
 * DOM: `.row-bubble[role=toolbar] > .row-act`, absolutely positioned in the
 * pane's `.term-stage` above (or below) `.term-line.is-picked`, so opening it
 * never shifts the buffer. Empty rows are discarded by `discardEmptyPaneRow`
 * in a controller, never during render. Returns null when there is no
 * copyable row.
 *
 * A copy is confirmed here, on the action that was pressed, and the bubble
 * then closes by itself. Picking another row meanwhile moves the bubble there
 * with its actions as they were.
 *
 * It leaves as it came: closed, it stays for an exit's length where it stood,
 * with the actions it had (`is-leaving`, inert), and then goes. Sent to another
 * row by the reader it slides there; kept on its row while output moves the
 * buffer, or the reader scrolls, it is simply put where the row is.
 */
export function SessionRowBar() {
  // The picked row is a narrow slice: the bubble follows it without waiting for a pane commit.
  useSyncExternalStore(sessionStore.subscribe, pickedRow, pickedRow);
  const picked = rowBarContent(paneModel());
  const presence = usePresence(picked !== null, MOTION_MS.press);
  const shown = useRef(picked);
  if (picked) shown.current = picked;
  const content = picked ?? (presence.leaving ? shown.current : null);
  const bubble = useRef<HTMLDivElement>(null);
  const index = picked?.index ?? null;
  const stood = useRef<number | null>(null);
  const slide = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = bubble.current;
    if (index === null || !el) {
      stood.current = null;
      return;
    }
    // Another row picked while the bubble is up: it travels from where it is drawn.
    const from = stood.current !== null && stood.current !== index && !("offscreen" in el.dataset)
      ? el.getBoundingClientRect() : null;
    slide.current?.cancel();
    slide.current = null;
    placeRowBubble(el, index);
    stood.current = index;
    if (!from || "offscreen" in el.dataset) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx || dy) slide.current = playMove(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], MOTION_MS.element);
  });
  useEffect(() => {
    if (index === null || !bubble.current) return;
    return bindRowBubble(bubble.current, index);
  }, [index]);
  // A new object for every press, so pressing again restarts the wait.
  const [copied, setCopied] = useState<Copied | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(null);
      if (pickedRow() === copied.index) closeRow();
    }, ROW_COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // The bubble that closes on a copy leaves still saying so.
  const said = useRef<Copied["what"] | null>(null);
  if (picked) said.current = copied?.index === picked.index ? copied.what : null;
  if (!content) return null;
  const { text, path } = content;
  const done = said.current;
  const copy = (value: string, what: Copied["what"]): void => {
    void copyRow(value).then((ok) => { if (ok) setCopied({ index: content.index, what }); });
  };
  return (
    <div ref={bubble} className={presence.leaving ? "row-bubble is-leaving" : "row-bubble"} role="toolbar"
      aria-label={t("rowbar.aria")} data-react-session-rowbar="" inert={presence.leaving}>
      <Button className="row-act" data-copied={done === "line" ? "" : undefined}
        aria-label={t(done === "line" ? "row.copiedLine" : "rowbar.copyAria")} onClick={() => copy(text, "line")}>
        <CopyAck state={done === "line" ? "copied" : "idle"} idle={t("rowbar.copy")} copied={t("rowbar.copied")} />
      </Button>
      {path ? (
        <Button className="row-act" data-copied={done === "path" ? "" : undefined}
          aria-label={done === "path" ? t("row.copiedPath") : t("rowbar.copyPathAria", { path })} title={path}
          onClick={() => copy(path, "path")}>
          <CopyAck state={done === "path" ? "copied" : "idle"} idle={t("rowbar.copyPath")} copied={t("rowbar.copied")} />
        </Button>
      ) : null}
      <Button className="row-act" aria-label={t("rowbar.quoteAria")} onClick={() => quoteRow(text)}>
        {t("rowbar.quote")}
      </Button>
      <Button className="row-act" aria-label={t("rowbar.selectAria")} onClick={() => selectTermRow(content.index)}>
        {t("rowbar.select")}
      </Button>
    </div>
  );
}
