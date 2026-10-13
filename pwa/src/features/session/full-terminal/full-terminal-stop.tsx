import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { useSession } from "../hooks";
import { SendButton, usePaneWorking } from "../guided/compose-controls";
import { cancelStop, sendKind, stopPhaseFor, stopSnapshot, subscribeStop, type SendKind, type StopKey, type StopTarget } from "../guided/session-stop";

/** Esc and Ctrl+C as the bytes a terminal key press writes. */
const STOP_BYTES: Record<StopKey, string> = { esc: "\u001b", "ctrl+c": "\u0003" };

type SendBytes = (text: string, enter: boolean) => boolean;

/** The stop flow's way into the open terminal: a key written into the bridge, exactly what the pad's Esc / Ctrl+C write. */
export function useFullTerminalStopTarget(paneId: string, send: RefObject<SendBytes>): StopTarget | null {
  return useMemo<StopTarget | null>(() => paneId ? {
    paneId,
    sendKey: (key) => { if (!send.current(STOP_BYTES[key], false)) throw new Error("terminal not ready"); },
  } : null, [paneId, send]);
}

/**
 * 停止 beside a live terminal's field, in the dock a mouse drives. Live input
 * has nothing to send, so there is no send button for it to share: it shows
 * while the agent works and for as long as a stop is under way. It runs the
 * same two-step flow as the compose form's button.
 *
 * Its slot is always in the row, at the width of the widest step. Mounted only
 * when there was something to stop, it took that width from the field and
 * pushed 按键 aside every time the agent started or finished; now it fades in
 * and out where it stands (`.full-terminal-live-stop-slot`, compose.scss), and
 * away it is `inert`: no tab stop, no press, nothing for a screen reader.
 */
export function FullTerminalLiveStop({ send }: { send: SendBytes }) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const paneId = useSession().paneId;
  const working = usePaneWorking(paneId);
  const stop = useSyncExternalStore(subscribeStop, stopSnapshot, stopSnapshot);
  const stopTarget = useFullTerminalStopTarget(paneId, sendRef);
  useLayoutEffect(() => () => { cancelStop(); }, [paneId]);
  const kind = sendKind({ hasText: false, ready: 0, submitting: false, waiting: false, live: false, working,
    stop: stopPhaseFor(stop, paneId) });
  const shown = kind === "stop" || kind === "stopping" || kind === "force";
  // Away, it keeps the face it left with, so nothing changes under the fade.
  const face = useRef<SendKind>("stop");
  if (shown) face.current = kind;
  return <span className={shown ? "full-terminal-live-stop-slot" : "full-terminal-live-stop-slot is-away"} inert={!shown}>
    <SendButton kind={face.current} percent={0} className="full-terminal-compose-send full-terminal-live-stop"
      onSend={() => undefined} stopTarget={stopTarget} longPressStops={false} holdWidest />
  </span>;
}
