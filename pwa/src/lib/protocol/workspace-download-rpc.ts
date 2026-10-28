import { ProtocolError } from "./errors";
import { scopeHerdSession } from "./herd-sessions";
import { isRecord } from "./session-message";
import { MEDIA_OPEN_RPC_TIMEOUT_MS, type SessionTransport } from "./session-transport";
import {
  parseWorkspaceDownloadChunk,
  parseWorkspaceDownloadClose,
  parseWorkspaceDownloadOpen,
  type WorkspaceDownloadChunk,
  type WorkspaceDownloadClose,
  type WorkspaceDownloadOpen,
} from "./workspace-download";

/**
 * Workspace downloads are P2P-only. Every byte-bearing call captures the
 * current transport and rejects rather than falling back to relay; the daemon
 * enforces the same rule on Open.
 */
export class WorkspaceDownloadRPC {
  constructor(
    private capture: () => Promise<SessionTransport | null>,
    private herdSession: () => string | null,
  ) {}

  private async direct(): Promise<SessionTransport> {
    const transport = await this.capture();
    if (!transport) throw new ProtocolError("reconnecting", "连接正在恢复");
    if (transport.kind !== "p2p") throw new ProtocolError("p2p_required");
    return transport;
  }

  open = async (paneId: string, path: string, root?: string): Promise<WorkspaceDownloadOpen> => {
    const op = root === undefined ? "WorkspaceDownloadOpen" : "WorkspaceDownloadOpenAtRoot";
    const params = scopeHerdSession(op, { pane_id: paneId, path, ...(root === undefined ? {} : { root }) }, this.herdSession());
    const transport = await this.direct();
    return parseWorkspaceDownloadOpen(await transport.rpc(op, params, MEDIA_OPEN_RPC_TIMEOUT_MS, undefined, result => {
      // A malformed Open result must not leak a daemon handle on this epoch.
      if (!isRecord(result) || typeof result.handle !== "string" || !/^dl_[0-9a-f]{32}$/u.test(result.handle)) return;
      void transport.rpc("WorkspaceDownloadClose", { handle: result.handle }).catch(() => undefined);
    }));
  };

  read = async (handle: string, offset: number, length: number): Promise<WorkspaceDownloadChunk> => {
    const transport = await this.direct();
    return parseWorkspaceDownloadChunk(await transport.rpc("WorkspaceDownloadRead", { handle, offset, length }));
  };

  close = async (handle: string): Promise<WorkspaceDownloadClose> => {
    const transport = await this.capture();
    if (!transport) throw new ProtocolError("reconnecting", "连接正在恢复");
    return parseWorkspaceDownloadClose(await transport.rpc("WorkspaceDownloadClose", { handle }));
  };
}
