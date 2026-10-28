import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { setLang } from "../../lib/i18n";
import { ProtocolError } from "../../lib/protocol/errors";
import type { LiveSession } from "../../lib/protocol/client";
import type { ActionSheetController } from "../../shared/ui/overlay/action-sheet";
import { DownloadPanel } from "./download-sheet";

const pause = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));
const handle = "dl_" + "a".repeat(32);
const opened = {
  handle, path: "dist/app.zip", kind: "download" as const, mime: "application/zip",
  size: 1024, modified_ms: 1, revision: "b".repeat(64), expires_ms: 2,
  chunk_bytes: 65_536, max_bytes: 1_073_741_824,
};
let root: Root | null = null;
let host: HTMLElement | null = null;

function fakeModal(): ActionSheetController {
  return {
    dismiss: () => undefined,
    close: () => undefined,
  } as unknown as ActionSheetController;
}

function render(session: LiveSession): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<DownloadPanel session={session} paneId="p1" path="dist/app.zip" fallbackSize={1024} modal={fakeModal()} />));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

test("shows the opened file and a save action", async () => {
  const session = {
    workspaceDownloadOpen: async () => opened,
    workspaceDownloadRead: async () => ({ handle, offset: 0, length: 0, bytes: new Uint8Array(), eof: true }),
    workspaceDownloadClose: async () => ({ handle, closed: true as const }),
  } as unknown as LiveSession;
  render(session);
  await act(async () => { await pause(); });
  expect(document.body.textContent).toContain("app.zip");
  expect(document.body.textContent).toContain("1.0 KiB");
  expect(document.body.textContent).toContain("下载");
  expect(document.body.textContent).toContain("只使用 P2P 直连");
});

test("a relay rejection is shown as the P2P requirement", async () => {
  const session = {
    workspaceDownloadOpen: async () => { throw new ProtocolError("p2p_required"); },
    workspaceDownloadRead: async () => { throw new Error("unreachable"); },
    workspaceDownloadClose: async () => ({ handle, closed: true as const }),
  } as unknown as LiveSession;
  render(session);
  await act(async () => { await pause(); });
  expect(document.body.textContent).toContain("文件下载需要 P2P 直连");
  expect(document.body.textContent).toContain("重试");
});

test("closing the sheet releases the daemon handle", async () => {
  let closed = 0;
  const session = {
    workspaceDownloadOpen: async () => opened,
    workspaceDownloadRead: async () => ({ handle, offset: 0, length: 0, bytes: new Uint8Array(), eof: true }),
    workspaceDownloadClose: async () => { closed += 1; return { handle, closed: true as const }; },
  } as unknown as LiveSession;
  render(session);
  await act(async () => { await pause(); });
  await act(async () => {
    root?.unmount();
    root = null;
    await pause();
  });
  expect(closed).toBe(1);
});
