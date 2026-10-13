import { padKind, setPadKind, type PadKind } from "../../settings/preferences-store";
import { clearModifiers } from "../keypad/keypad";

/**
 * How soon after the reader's press a switch drawn anew is that press's doing.
 * The store publishes inside the press, so the new pad is drawn well inside it.
 */
const TURN_MS = 150;

let turned: { from: PadKind; at: number } | null = null;

/** Switch the expanded pad between keys and slash chips. Drops latched modifiers. */
export function selectPadKind(kind: PadKind, repaint: () => void): void {
  const from = padKind();
  if (from === kind) return;
  clearModifiers();
  turned = { from, at: performance.now() };
  setPadKind(kind);
  repaint();
}

/**
 * The kind the reader just turned the pad away from, for a 按键 | 命令 switch
 * that is being drawn because of that turn: turning the pad replaces its whole
 * body, the switch with it, so the new one has to be told where its thumb comes
 * from. Null for a switch drawn for any other reason (the pad opened, a pane
 * shown), which stands still.
 */
export function padKindTurnedFrom(): PadKind | null {
  if (!turned || performance.now() - turned.at > TURN_MS || turned.from === padKind()) return null;
  return turned.from;
}
