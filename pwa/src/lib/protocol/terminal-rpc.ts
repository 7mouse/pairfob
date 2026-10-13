import { withOperationID } from "../operations.ts";
import {
  encodeTerminalInput,
  parseTerminalCloseResult,
  parseTerminalCommandResult,
  parseTerminalOpenResult,
  type TerminalOpenResult,
} from "./terminal.ts";

/** Complete-terminal control. Each call carries a fresh operation_id and is sent once. */
export class TerminalRPC {
  constructor(private readonly send: (op: string, params: object) => Promise<unknown>) {}

  open = async (paneId: string, cols: number, rows: number, takeover = false): Promise<TerminalOpenResult> => {
    const wire = withOperationID({ pane_id: paneId, cols, rows, takeover });
    return parseTerminalOpenResult(await this.send("TerminalOpen", wire), paneId, wire.operation_id);
  };

  input = (terminalId: string, sequence: number, data: Uint8Array) =>
    this.command("TerminalInput", terminalId, sequence, { data: encodeTerminalInput(data) });

  resize = (terminalId: string, sequence: number, cols: number, rows: number, cellWidthPX = 0, cellHeightPX = 0) =>
    this.command("TerminalResize", terminalId, sequence, {
      cols, rows, cell_width_px: cellWidthPX, cell_height_px: cellHeightPX,
    });

  scroll = (
    terminalId: string,
    sequence: number,
    direction: "up" | "down",
    lines: number,
    source: "wheel" | "page_key" = "wheel",
    at?: { column: number; row: number },
  ) =>
    this.command("TerminalScroll", terminalId, sequence, {
      direction,
      lines,
      source,
      modifiers: 0,
      ...(at ? { column: at.column, row: at.row } : {}),
    });

  close = async (terminalId: string): Promise<void> => {
    const wire = withOperationID({ terminal_id: terminalId });
    parseTerminalCloseResult(await this.send("TerminalClose", wire), wire.operation_id, terminalId);
  };

  private async command(op: string, terminalId: string, sequence: number, params: object): Promise<unknown> {
    const wire = withOperationID({ terminal_id: terminalId, seq: sequence, ...params });
    return parseTerminalCommandResult(await this.send(op, wire), wire.operation_id, terminalId, sequence);
  }
}
