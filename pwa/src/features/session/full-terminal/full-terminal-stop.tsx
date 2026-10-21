import { useMemo, type RefObject } from "react";
import type { StopKey, StopTarget } from "../guided/session-stop";

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
