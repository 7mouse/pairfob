/**
 * Attachment tray shown above the session dock (session page v2).
 *
 * The tray is the only source of attachments: thumbnails in path order, each
 * drawing its own state (processing, uploading, ready, waiting, paused,
 * failed). Tapping one opens an action bar above the tray with only the
 * actions that apply; × removes with undo; a long press drags it to reorder.
 * On send, the compose path reads the tray through attachments-send.ts.
 *
 * What changes in it is shown changing. The tray folds open with its first
 * file and shut after its last (`tray-fold`); a thumbnail joins and leaves by
 * its width, so the ones beside it slide over instead of landing under the
 * finger that just pressed ×; the cover of a file being sent fades off and its
 * done mark pops; the action bar leaves the way it came. None of it runs for a
 * tray drawn with its files already in it.
 */
import { Check, FileText, X } from "lucide-react";
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { useKeptList, usePresence } from "../../../shared/react/use-presence";
import { MOTION_MS } from "../../../shared/ui/dom/motion";
import { Button } from "../../../shared/ui/primitives/button";
import { Fold } from "../../../shared/ui/primitives/fold";
import { haptic } from "../../../lib/dom";
import { computersStore } from "../../computers/catalog-store";
import { connectionStore, p2pEnabled } from "../../connection/connection-store";
import { sessionStore } from "../session-store";
import { composeDraft, composeStore } from "../compose-store";
import { attachT } from "./attach-copy";
import { etaParts, formatBytes, speedParts, type AttachmentItem, type AttachmentScope } from "./attach-model";
import { LOCAL_INTAKE_LIMITS } from "./attachments-admission";
import {
  connectAttachmentP2P,
  connectAttempt,
  subscribeConnectAttempt,
  useAttachmentP2PReady,
} from "./attachments-connection";
import { currentAttachmentScope } from "./attachments-context";
import { hasUploadHandle } from "./attachments-controller";
import { insertPaths, removePathFromDraft } from "./attachments-insertion";
import { restoreAttachmentScope } from "./attachments-recovery";
import {
  attachmentScopeKey,
  attachmentsStore,
  moveAttachment,
  publishedQueue,
  runtimeObjectUrl,
  setQueueNotice,
} from "./attachments-store";
import {
  changeQuality,
  continueAttachment,
  continueBlocked,
  discardAttachments,
  pendingUndo,
  removeWithUndo,
  subscribeTrayState,
  trayStateRevision,
  undoRemove,
  visibleItemsSnapshot,
  watchAutoStart,
} from "./attachments-tray-actions";
import {
  inBody,
  keepsOriginal,
  trayActions,
  trayPercent,
  trayPhase,
  type TrayAction,
  type TrayContext,
  type TrayPhase,
} from "./attachments-tray-model";
import { presentAttachmentViewer } from "./attachment-viewer";
import { useDeskLayout } from "../desk-pointer";
import { useStripOverflow } from "./strip-overflow";
import { useTrayFold, useTrayHeight } from "./tray-fold";

/** Rejection notes fade after this long. */
const NOTE_MS = 3000;
/** Hold before a thumbnail lifts for reordering. */
const DRAG_HOLD_MS = 450;
const DRAG_SLOP_PX = 8;

function currentScopeKey(): string {
  const scope = currentAttachmentScope();
  return scope ? attachmentScopeKey(scope) : "";
}

function subscribeScope(listener: () => void): () => void {
  const stops = [sessionStore.subscribe(listener), computersStore.subscribe(listener), connectionStore.subscribe(listener)];
  return () => stops.forEach((stop) => stop());
}

function subscribeTray(listener: () => void): () => void {
  const stops = [attachmentsStore.subscribe(listener), subscribeTrayState(listener)];
  return () => stops.forEach((stop) => stop());
}

/**
 * `instant` is for a dock whose height is not its own: in the complete terminal
 * the tray's rows are the computer's terminal rows, so it is there or it is
 * not, in one frame, and never folds.
 */
export function AttachmentTray({ compact = false, instant = false }: { compact?: boolean; instant?: boolean }) {
  const key = useSyncExternalStore(subscribeScope, currentScopeKey);
  // The scope object is rebuilt only when the pane really changes.
  const scope = useMemo(() => key ? currentAttachmentScope() : null, [key]);
  if (!scope) return null;
  return <TrayBody key={key} scope={scope} compact={compact} instant={instant} />;
}

/**
 * The queue notice as a tray note. Insertion and restore confirmations are
 * already visible on the thumbnails; the reorder hint is plain; everything
 * else is a rejection or failure and reads as an error.
 */
function trayNote(notice: string): { text: string; error: boolean } | null {
  if (!notice || notice === attachT("attach.done") || notice === attachT("attach.restoredUnfinished")) return null;
  return { text: notice, error: notice !== attachT("tray.moved") };
}

function stateLabel(item: AttachmentItem, phase: TrayPhase, body: boolean): string {
  switch (phase) {
    case "processing": return attachT("tray.state.processing");
    case "uploading": return attachT("tray.state.uploading", { percent: trayPercent(item) });
    case "ready": return attachT(body ? "tray.state.readyInBody" : "tray.state.ready");
    case "waiting": return attachT("tray.state.waiting");
    case "paused": return attachT(item.restored ? "tray.state.restored" : "tray.state.paused");
    case "failed": return attachT("tray.state.failed");
  }
}

/**
 * Live throughput for an uploading row: measured speed and approximate time
 * left, or the waiting note after a confirmation stall. Nothing for any other
 * state, so a paused or finished row never shows a stale rate.
 */
function meterLine(item: AttachmentItem): string {
  if (item.status !== "uploading") return "";
  if (item.waiting) return attachT("attach.waiting");
  const parts: string[] = [];
  const speed = typeof item.speedBps === "number" ? speedParts(item.speedBps) : null;
  if (speed) parts.push(attachT(speed.unit === "kib" ? "attach.speed.kib" : "attach.speed.mib", { value: speed.value }));
  const eta = typeof item.etaSeconds === "number" ? etaParts(item.etaSeconds) : null;
  if (eta) parts.push(attachT(eta.kind === "seconds" ? "attach.eta.seconds" : "attach.eta.minutes", { value: eta.value }));
  return parts.join(" · ");
}

const RING_R = 12;
const RING_C = 2 * Math.PI * RING_R;

function Ring({ percent, spinning }: { percent: number; spinning: boolean }) {
  const offset = spinning ? RING_C * 0.72 : RING_C * (1 - percent / 100);
  return <svg className={`attach-ring${spinning ? " is-spinning" : ""}`} viewBox="0 0 30 30" aria-hidden="true">
    <circle className="attach-ring-bg" cx="15" cy="15" r={RING_R} />
    <circle className="attach-ring-fg" cx="15" cy="15" r={RING_R} strokeDasharray={RING_C} strokeDashoffset={offset} />
  </svg>;
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : "";
}

function Thumb({ storeKey, item, phase, body }: { storeKey: string; item: AttachmentItem; phase: TrayPhase; body: boolean }) {
  const url = item.kind === "image" ? runtimeObjectUrl(storeKey, item.localId) : "";
  // One cover for a file being read and then sent. When that is over it fades
  // off the thumbnail as it last was, instead of going in the frame the mark arrives.
  const covered = phase === "processing" || phase === "uploading";
  const cover = usePresence(covered, MOTION_MS.element);
  const drawn = useRef<{ dim: boolean; percent: number }>({ dim: false, percent: 0 });
  if (covered) drawn.current = { dim: phase === "uploading", percent: phase === "uploading" ? trayPercent(item) : 0 };
  // The done mark pops when the file finishes under the reader. A thumbnail
  // drawn already done was not waited for.
  const seen = useRef(phase);
  const finished = useRef(false);
  if (seen.current !== phase) {
    finished.current = phase === "ready";
    seen.current = phase;
  }
  return <>
    {url
      ? <img className="attach-chip-img" src={url} alt="" decoding="async" draggable={false} />
      : <span className="attach-chip-file"><FileText size={20} aria-hidden="true" />{extension(item.name)}</span>}
    {cover.mounted && <span className={`attach-chip-cover${drawn.current.dim ? " is-dim" : ""}${cover.leaving ? " is-leaving" : ""}`}>
      <Ring percent={drawn.current.percent} spinning={!drawn.current.dim} />
    </span>}
    {phase === "ready" && <span className={finished.current ? "attach-chip-badge is-ok pop-in" : "attach-chip-badge is-ok"}>
      <Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
    {phase === "ready" && body && <span className="attach-chip-tag">{attachT("tray.badge.inBody")}</span>}
    {phase === "waiting" && <span className="attach-chip-badge is-warn">{attachT("tray.badge.waiting")}</span>}
    {phase === "paused" && <span className="attach-chip-badge is-warn">
      {attachT(item.restored ? "tray.badge.restored" : "tray.badge.paused")}</span>}
    {phase === "failed" && <span className="attach-chip-badge is-bad">!</span>}
  </>;
}

const ACTION_LABEL: Record<TrayAction, Parameters<typeof attachT>[0]> = {
  connect: "tray.act.connect",
  resume: "tray.act.resume",
  retry: "tray.act.retry",
  check: "tray.act.check",
  preview: "tray.act.preview",
  toBody: "tray.act.toBody",
  fromBody: "tray.act.fromBody",
  toOriginal: "tray.act.toOriginal",
  toSmart: "tray.act.toSmart",
  remove: "tray.act.remove",
};

const PRIMARY_ACTIONS: ReadonlySet<TrayAction> = new Set(["connect", "resume", "retry", "check"]);

type Drag = { id: string; pointerId: number; x0: number; y0: number; dx: number; lifted: boolean; timer: number };

/** What the action bar showed, kept so that it can leave with it. */
type OpenActions = { item: AttachmentItem; phase: TrayPhase; index: number; anchorX: number };

function TrayBody({ scope, compact, instant }: { scope: AttachmentScope; compact: boolean; instant: boolean }) {
  const storeKey = attachmentScopeKey(scope);
  const items = useSyncExternalStore(subscribeTray, () => visibleItemsSnapshot(storeKey));
  // A removed thumbnail keeps its place while it closes; one that joins is marked for its entrance.
  const chips = useKeptList(items, (item) => item.localId, MOTION_MS.element);
  const notice = useSyncExternalStore(attachmentsStore.subscribe, () => publishedQueue(storeKey)?.notice ?? "");
  const undoRevision = useSyncExternalStore(subscribeTrayState, trayStateRevision);
  const draft = useSyncExternalStore(composeStore.subscribe, composeDraft);
  const p2pReady = useAttachmentP2PReady();
  // Beside the list the count and the note leave the strip, so a narrow column
  // cannot run them off its edge; a phone scrolls them along with the thumbnails.
  const beside = useDeskLayout();
  const attempt = useSyncExternalStore(subscribeConnectAttempt, connectAttempt);
  const switching = useSyncExternalStore(connectionStore.subscribe, () => connectionStore.get().transportSwitching);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const eatClick = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const [anchorX, setAnchorX] = useState(0);
  const ctx: TrayContext = { p2pReady, draft };
  const undo = useMemo(() => pendingUndo(), [undoRevision]);
  const undoHere = undo && undo.key === storeKey ? undo : null;
  const note = trayNote(notice);

  // Reopening a pane shows what did not finish last time; uploads keep moving
  // while the tray is on screen.
  useEffect(() => {
    void restoreAttachmentScope(scope);
    return watchAutoStart();
  }, [scope]);

  // Over-limit and error notes fade on their own.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setQueueNotice(storeKey, ""), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, storeKey]);

  const selectedItem = selected ? items.find((item) => item.localId === selected) ?? null : null;
  useEffect(() => {
    if (selected && !selectedItem) setSelected(null);
  }, [selected, selectedItem]);

  // Place the action bar's pointer over the tapped thumbnail.
  useLayoutEffect(() => {
    if (!selected) return;
    const chip = [...(strip.current?.querySelectorAll<HTMLElement>("[data-att]") ?? [])]
      .find((candidate) => candidate.dataset.att === selected);
    const box = strip.current?.parentElement?.getBoundingClientRect();
    const rect = chip?.getBoundingClientRect();
    if (box && rect) setAnchorX(Math.max(12, rect.left - box.left + rect.width / 2));
  }, [selected, items]);

  // The strip fades where it continues past its box.
  useStripOverflow(strip);

  // Tapping anywhere else, or Escape, closes the action bar.
  useEffect(() => {
    if (!selected) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".attach-pop, .attach-chip")) return;
      setSelected(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  const shown = items.length > 0 || Boolean(undoHere) || Boolean(note);
  const fold = useTrayFold(shown, instant);
  const foldRef = useTrayHeight(instant || !shown || !fold.rest);
  const actions = usePresence(selectedItem !== null, MOTION_MS.press);
  const opened = useRef<OpenActions | null>(null);
  // What the tray held when it last had anything: it shuts over that.
  const held = useRef<ReactNode>(null);
  if (!fold.mounted) return null;
  // Rest is where nothing may be clipped; an open action bar is never clipped either.
  const unclipped = shown && (fold.rest || selectedItem !== null);
  const foldClass = `attach-fold${unclipped ? " is-rest" : ""}${instant ? " is-instant" : ""}`;
  const trayClass = `attach-tray${compact ? " is-compact" : ""}${beside ? " is-beside" : ""}`;
  if (!shown) return <Fold ref={foldRef} open={false} className={foldClass} bodyClassName={trayClass}>{held.current}</Fold>;

  const waiting = items.some((item) => trayPhase(item, ctx) === "waiting");
  const restored = items.filter((item) => item.restored && item.status !== "committed");
  const connecting = attempt === "connecting" || switching;
  const used = items.reduce((total, item) => total + Math.max(item.originalBytes ?? item.size, item.size), 0);
  const nearLimit = items.length >= LOCAL_INTAKE_LIMITS.maxFiles - 1 || used >= LOCAL_INTAKE_LIMITS.batchBytes * 0.8;
  const attached = items.filter((item) => !inBody(item, draft)).length;
  const allInBody = items.length > 0 && items.every((item) => inBody(item, draft));

  /** The thumbnail a file is drawn as, for what opens out of it. */
  function chipOf(id: string): HTMLElement | null {
    return [...(strip.current?.querySelectorAll<HTMLElement>("[data-att]") ?? [])].find((chip) => chip.dataset.att === id) ?? null;
  }

  function act(item: AttachmentItem, action: TrayAction, index: number): void {
    haptic(2);
    setSelected(null);
    switch (action) {
      case "connect": void connectAttachmentP2P(scope); return;
      case "resume":
      case "retry":
      case "check": void continueAttachment(scope, item.localId); return;
      case "preview": presentAttachmentViewer(scope, index, chipOf(item.localId)); return;
      case "toBody": void insertPaths(scope, [item.localId]); return;
      case "fromBody": removePathFromDraft(scope, item.localId); return;
      case "toOriginal": changeQuality(scope, item.localId, "original"); return;
      case "toSmart": changeQuality(scope, item.localId, "smart"); return;
      case "remove": removeWithUndo(scope, item.localId); return;
    }
  }

  // --- Long-press reorder ------------------------------------------------------------

  function endDrag(current: Drag | null, dropX: number | null): void {
    if (current) window.clearTimeout(current.timer);
    dragRef.current = null;
    setDrag(null);
    if (!current?.lifted || dropX === null) return;
    const others = [...(strip.current?.querySelectorAll<HTMLElement>("[data-att]") ?? [])]
      .filter((chip) => chip.dataset.att !== current.id);
    let to = others.length;
    for (let index = 0; index < others.length; index++) {
      const rect = others[index].getBoundingClientRect();
      if (dropX < rect.left + rect.width / 2) { to = index; break; }
    }
    const from = items.findIndex((item) => item.localId === current.id);
    if (from < 0) return;
    // Hidden rows keep their queue slot; map the visible target back onto it.
    const target = to < others.length ? others[to].dataset.att! : null;
    const all = publishedQueue(storeKey)?.items ?? [];
    let queueIndex = target ? all.findIndex((row) => row.localId === target) : all.length;
    const queueFrom = all.findIndex((row) => row.localId === current.id);
    if (queueFrom < queueIndex) queueIndex -= 1;
    if (to === from) return;
    moveAttachment(storeKey, current.id, queueIndex);
    haptic(4);
    setQueueNotice(storeKey, attachT("tray.moved"));
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string): void {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    eatClick.current = false;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const next: Drag = {
      id, pointerId, x0: event.clientX, y0: event.clientY, dx: 0, lifted: false,
      timer: window.setTimeout(() => {
        const live = dragRef.current;
        if (!live || live.id !== id) return;
        live.lifted = true;
        eatClick.current = true;
        try { target.setPointerCapture(pointerId); } catch { /* released already */ }
        haptic(8);
        setSelected(null);
        setDrag({ ...live });
      }, DRAG_HOLD_MS),
    };
    dragRef.current = next;
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const live = dragRef.current;
    if (!live || event.pointerId !== live.pointerId) return;
    const dx = event.clientX - live.x0;
    if (!live.lifted) {
      if (Math.hypot(dx, event.clientY - live.y0) > DRAG_SLOP_PX) endDrag(live, null);
      return;
    }
    live.dx = dx;
    setDrag({ ...live });
  }

  const lead = waiting && !p2pReady
    ? <div className="attach-lead" role="group" aria-label={attachT("tray.needP2P")}>
      <small>{attachT(!p2pEnabled() ? "tray.p2pOff" : connecting ? "tray.connecting"
        : attempt === "failed" ? "tray.connectFailed" : "tray.needP2P")}</small>
      <Button className="attach-lead-btn" disabled={connecting || !p2pEnabled()}
        onClick={() => { haptic(2); void connectAttachmentP2P(scope); }}>{attachT("tray.connect")}</Button>
    </div>
    : restored.length
      ? <div className="attach-lead" role="group" aria-label={attachT("tray.restored", { n: restored.length })}>
        <small>{attachT("tray.restored", { n: restored.length })}</small>
        <span className="attach-lead-row">
          <Button className="attach-lead-btn" disabled={connecting}
            onClick={() => { haptic(2); void continueBlocked(scope); }}>{attachT("tray.resumeAll")}</Button>
          <Button className="attach-lead-btn is-quiet"
            onClick={() => { haptic(2); discardAttachments(scope, restored.map((item) => item.localId)); }}>{attachT("tray.clear")}</Button>
        </span>
      </div>
      : null;

  const selectedIndex = selectedItem ? items.indexOf(selectedItem) : -1;
  const selectedPhase = selectedItem ? trayPhase(selectedItem, ctx) : null;

  const meta = <div className="attach-meta-col" role="status" aria-live="polite">
    {undoHere
      ? <span className="attach-undo">
        <small>{attachT(undoHere.cancelled ? "tray.removedCancelled" : "tray.removed", { name: undoHere.name })}</small>
        <Button className="attach-undo-btn" onClick={() => { haptic(2); undoRemove(); }}>{attachT("tray.undo")}</Button>
      </span>
      : note
        ? <small className={`attach-note${note.error ? " is-error" : ""}`}>{note.text}</small>
        : items.length > 0 && <>
          <small className={nearLimit ? "is-warn" : undefined}>{attachT("tray.usage", {
            count: items.length, max: LOCAL_INTAKE_LIMITS.maxFiles, size: formatBytes(used),
          })}</small>
          <small className="attach-meta-dim">{allInBody ? attachT("tray.allInBody")
            : attachT("tray.willAttach", { n: attached })}</small>
        </>}
  </div>;

  if (selectedItem && selectedPhase) opened.current = { item: selectedItem, phase: selectedPhase, index: selectedIndex, anchorX };
  // Closed, the bar stays for its exit with what it showed, out of reach.
  const bar = selectedItem && selectedPhase ? opened.current : actions.leaving ? opened.current : null;
  const leaving = !(selectedItem && selectedPhase);

  const content = <>
    {bar && <div className={leaving ? "attach-pop is-leaving" : "attach-pop"} role="menu" aria-label={bar.item.name}
      inert={leaving} style={{ "--attach-pop-x": `${bar.anchorX}px` } as CSSProperties}>
      <div className="attach-pop-head">
        <b>{bar.item.name}</b>
        <small className={bar.phase === "failed" && bar.item.errorText ? "is-error" : undefined}>
          {[
            bar.phase === "failed" && bar.item.errorText ? bar.item.errorText
              : stateLabel(bar.item, bar.phase, inBody(bar.item, draft)),
            meterLine(bar.item),
            formatBytes(bar.item.size),
            bar.item.kind === "image"
              ? attachT(keepsOriginal(bar.item) ? "tray.quality.original" : "tray.quality.smart") : "",
          ].filter(Boolean).join(" · ")}
        </small>
      </div>
      <div className="attach-pop-actions">
        {trayActions(bar.item, ctx, { hasHandle: hasUploadHandle(scope, bar.item.localId) }).map((action) =>
          <Button key={action} role="menuitem"
            className={`attach-pop-act${PRIMARY_ACTIONS.has(action) ? " is-primary" : ""}${action === "remove" ? " is-danger" : ""}`}
            onClick={() => act(bar.item, action, bar.index)}>{attachT(ACTION_LABEL[action])}</Button>)}
      </div>
    </div>}
    <div ref={strip} className="attach-strip" role="list" aria-label={attachT("tray.label")}>
      {lead}
      {chips.map((kept) => {
        const item = kept.item;
        const index = items.indexOf(item);
        const phase = trayPhase(item, ctx);
        const body = inBody(item, draft);
        const lifted = drag?.lifted && drag.id === item.localId;
        const motion = kept.leaving ? " is-leaving" : kept.entering ? " is-entering" : "";
        // One on its way out is no longer a file of the tray: not a tab stop, not a drop target.
        return <div key={kept.key} role="listitem" inert={kept.leaving}
          className={`attach-chip-wrap${selected === item.localId ? " is-selected" : ""}${lifted ? " is-lifted" : ""}${motion}`}
          style={lifted ? { transform: `translateX(${drag!.dx}px) scale(1.06)` } : undefined}>
          <Button className={`attach-chip is-${phase}`} data-att={kept.leaving ? undefined : item.localId}
            aria-label={attachT("tray.chipAria", { name: item.name, state: stateLabel(item, phase, body) })}
            aria-haspopup="menu" aria-expanded={selected === item.localId}
            onPointerDown={(event) => pointerDown(event, item.localId)}
            onPointerMove={pointerMove}
            onPointerUp={(event) => endDrag(dragRef.current, event.clientX)}
            onPointerCancel={() => endDrag(dragRef.current, null)}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={(event) => { setSelected(null); presentAttachmentViewer(scope, index, event.currentTarget); }}
            onClick={(event) => {
              if (eatClick.current) { eatClick.current = false; event.preventDefault(); return; }
              haptic(2);
              setSelected(selected === item.localId ? null : item.localId);
            }}>
            <Thumb storeKey={storeKey} item={item} phase={phase} body={body} />
          </Button>
          <Button className="attach-chip-x" aria-label={attachT("tray.removeOne", { name: item.name })}
            onClick={() => { haptic(4); setSelected(null); removeWithUndo(scope, item.localId); }}>
            <X size={10} strokeWidth={3} aria-hidden="true" />
          </Button>
        </div>;
      })}
      {!beside && meta}
    </div>
    {beside && meta}
  </>;
  held.current = content;

  return <Fold ref={foldRef} open appear={fold.appear} className={foldClass} bodyClassName={trayClass}>{content}</Fold>;
}
