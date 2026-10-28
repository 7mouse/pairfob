import { base64Decode, base64Encode } from "./bytes.ts";
import { bool, digest, exact, integer, invalid, record, relative, text } from "./workspace-media.ts";
import type { WorkspaceMediaKind } from "./workspace-media.ts";

/** P2P-only streaming download of a live workspace file. */
export const DOWNLOAD_CHUNK_BYTES = 65_536;
export const DOWNLOAD_MAX_BYTES = 1_073_741_824;
const MIME = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/u;

export type WorkspaceDownloadOpen = {
  handle: string;
  path: string;
  kind: WorkspaceMediaKind;
  mime: string;
  size: number;
  modified_ms: number;
  /** SHA-256 of the sniffed head, size and mtime; a resume identity, not a whole-file digest. */
  revision: string;
  expires_ms: number;
  chunk_bytes: number;
  max_bytes: number;
};

export type WorkspaceDownloadChunk = {
  handle: string;
  offset: number;
  length: number;
  bytes: Uint8Array;
  eof: boolean;
};

export type WorkspaceDownloadClose = { handle: string; closed: true };

function downloadHandle(value: unknown, label: string): string {
  const result = text(value, label, 38, false);
  if (!/^dl_[0-9a-f]{32}$/u.test(result)) invalid(label);
  return result;
}

export function parseWorkspaceDownloadOpen(value: unknown): WorkspaceDownloadOpen {
  const result = record(value, "WorkspaceDownloadOpen");
  exact(result, ["handle", "path", "kind", "mime", "size", "modified_ms", "revision", "expires_ms", "chunk_bytes", "max_bytes"], "WorkspaceDownloadOpen");
  const kind = text(result.kind, "WorkspaceDownloadOpen.kind", 16, false);
  if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "download") invalid("WorkspaceDownloadOpen.kind");
  const mime = text(result.mime, "WorkspaceDownloadOpen.mime", 128, false);
  if (!MIME.test(mime)) invalid("WorkspaceDownloadOpen.mime");
  return {
    handle: downloadHandle(result.handle, "WorkspaceDownloadOpen.handle"),
    path: relative(result.path, "WorkspaceDownloadOpen.path"),
    kind,
    mime,
    size: integer(result.size, "WorkspaceDownloadOpen.size", 0, DOWNLOAD_MAX_BYTES),
    modified_ms: integer(result.modified_ms, "WorkspaceDownloadOpen.modified_ms", -8_640_000_000_000_000),
    revision: digest(result.revision, "WorkspaceDownloadOpen.revision"),
    expires_ms: integer(result.expires_ms, "WorkspaceDownloadOpen.expires_ms"),
    chunk_bytes: integer(result.chunk_bytes, "WorkspaceDownloadOpen.chunk_bytes", DOWNLOAD_CHUNK_BYTES, DOWNLOAD_CHUNK_BYTES),
    max_bytes: integer(result.max_bytes, "WorkspaceDownloadOpen.max_bytes", 1, DOWNLOAD_MAX_BYTES),
  };
}

export function parseWorkspaceDownloadChunk(value: unknown): WorkspaceDownloadChunk {
  const result = record(value, "WorkspaceDownloadRead");
  exact(result, ["handle", "offset", "length", "bytes", "eof"], "WorkspaceDownloadRead");
  const encoded = text(result.bytes, "WorkspaceDownloadRead.bytes", 87_384);
  let bytes: Uint8Array;
  try {
    bytes = encoded ? base64Decode(encoded) : new Uint8Array();
  } catch {
    return invalid("WorkspaceDownloadRead.bytes");
  }
  if (encoded && base64Encode(bytes) !== encoded) invalid("WorkspaceDownloadRead.bytes");
  const length = integer(result.length, "WorkspaceDownloadRead.length", 0, DOWNLOAD_CHUNK_BYTES);
  if (bytes.length !== length) invalid("WorkspaceDownloadRead.length");
  return {
    handle: downloadHandle(result.handle, "WorkspaceDownloadRead.handle"),
    offset: integer(result.offset, "WorkspaceDownloadRead.offset", 0, DOWNLOAD_MAX_BYTES),
    length,
    bytes,
    eof: bool(result.eof, "WorkspaceDownloadRead.eof"),
  };
}

export function parseWorkspaceDownloadClose(value: unknown): WorkspaceDownloadClose {
  const result = record(value, "WorkspaceDownloadClose");
  exact(result, ["handle", "closed"], "WorkspaceDownloadClose");
  if (result.closed !== true) invalid("WorkspaceDownloadClose.closed");
  return { handle: downloadHandle(result.handle, "WorkspaceDownloadClose.handle"), closed: true };
}
