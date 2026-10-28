import { expect, test } from "bun:test";
import { WorkspaceDownloadRPC } from "./workspace-download-rpc";
import type { SessionTransport } from "./session-transport";
import { DOWNLOAD_CHUNK_BYTES, DOWNLOAD_MAX_BYTES } from "./workspace-download";
import { base64Encode } from "./bytes";

const handle = "dl_" + "a".repeat(32);
const revision = "b".repeat(64);

function result(op: string) {
  if (op === "WorkspaceDownloadOpen" || op === "WorkspaceDownloadOpenAtRoot") {
    return {
      handle, path: "dist/app.zip", kind: "download", mime: "application/octet-stream",
      size: 1, modified_ms: 1, revision, expires_ms: 2,
      chunk_bytes: DOWNLOAD_CHUNK_BYTES, max_bytes: DOWNLOAD_MAX_BYTES,
    };
  }
  if (op === "WorkspaceDownloadRead") {
    return { handle, offset: 0, length: 1, bytes: base64Encode(new Uint8Array([7])), eof: true };
  }
  return { handle, closed: true };
}

function transport(kind: "p2p" | "relay", onCall?: () => void) {
  const calls: Array<{ op: string; params: unknown }> = [];
  return {
    calls,
    wire: {
      kind,
      rpc: async (op: string, params: unknown) => {
        calls.push({ op, params });
        onCall?.();
        return result(op);
      },
    } as unknown as SessionTransport,
  };
}

test("downloads reject relay before any RPC reaches the wire", async () => {
  const relay = transport("relay");
  const rpc = new WorkspaceDownloadRPC(async () => relay.wire, () => "work");
  await expect(rpc.open("pane", "dist/app.zip")).rejects.toThrow("p2p_required");
  await expect(rpc.read(handle, 0, 1)).rejects.toThrow("p2p_required");
  expect(relay.calls).toEqual([]);
});

test("downloads use the root-bound op and keep checking the transport per chunk", async () => {
  const direct = transport("p2p");
  let active: SessionTransport = direct.wire;
  const rpc = new WorkspaceDownloadRPC(async () => active, () => "work");
  const opened = await rpc.open("pane", "dist/app.zip", "/root");
  expect(opened.handle).toBe(handle);
  expect(direct.calls[0]).toEqual({
    op: "WorkspaceDownloadOpenAtRoot",
    params: { pane_id: "pane", path: "dist/app.zip", root: "/root", session: "work" },
  });
  await rpc.read(handle, 0, 1);
  expect(direct.calls[1]).toEqual({ op: "WorkspaceDownloadRead", params: { handle, offset: 0, length: 1 } });

  const relay = transport("relay");
  active = relay.wire;
  await expect(rpc.read(handle, 1, 1)).rejects.toThrow("p2p_required");
  expect(relay.calls).toEqual([]);
});

test("close is allowed on whichever transport is current", async () => {
  const relay = transport("relay");
  const rpc = new WorkspaceDownloadRPC(async () => relay.wire, () => null);
  await expect(rpc.close(handle)).resolves.toEqual({ handle, closed: true });
});
