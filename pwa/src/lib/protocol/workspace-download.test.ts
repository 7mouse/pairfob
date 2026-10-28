import { describe, expect, test } from "bun:test";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_BYTES,
  parseWorkspaceDownloadChunk,
  parseWorkspaceDownloadClose,
  parseWorkspaceDownloadOpen,
} from "./workspace-download";
import { base64Encode } from "./bytes";

const handle = "dl_" + "a".repeat(32);
const revision = "b".repeat(64);

const open = () => ({
  handle,
  path: "dist/app.zip",
  kind: "download",
  mime: "application/octet-stream",
  size: 1_048_576,
  modified_ms: 1,
  revision,
  expires_ms: 2,
  chunk_bytes: DOWNLOAD_CHUNK_BYTES,
  max_bytes: DOWNLOAD_MAX_BYTES,
});

describe("workspace download protocol", () => {
  test("parses Open, Read and Close results", () => {
    expect(parseWorkspaceDownloadOpen(open())).toEqual(open());
    const bytes = new Uint8Array([1, 2, 3]);
    expect(parseWorkspaceDownloadChunk({
      handle, offset: 0, length: 3, bytes: base64Encode(bytes), eof: false,
    })).toEqual({ handle, offset: 0, length: 3, bytes, eof: false });
    expect(parseWorkspaceDownloadClose({ handle, closed: true })).toEqual({ handle, closed: true });
  });

  test("rejects a non-download handle, extra keys and out-of-range values", () => {
    expect(() => parseWorkspaceDownloadOpen({ ...open(), handle: "media_" + "a".repeat(32) })).toThrow();
    expect(() => parseWorkspaceDownloadOpen({ ...open(), extra: true })).toThrow();
    expect(() => parseWorkspaceDownloadOpen({ ...open(), size: DOWNLOAD_MAX_BYTES + 1 })).toThrow();
    expect(() => parseWorkspaceDownloadOpen({ ...open(), revision: "short" })).toThrow();
    expect(() => parseWorkspaceDownloadOpen({ ...open(), chunk_bytes: 1 })).toThrow();
    expect(() => parseWorkspaceDownloadChunk({
      handle, offset: 0, length: 2, bytes: base64Encode(new Uint8Array([1])), eof: false,
    })).toThrow();
    expect(() => parseWorkspaceDownloadChunk({
      handle, offset: 0, length: 1, bytes: base64Encode(new Uint8Array([1])), eof: false, extra: 1,
    })).toThrow();
    expect(() => parseWorkspaceDownloadClose({ handle, closed: false })).toThrow();
  });
});
