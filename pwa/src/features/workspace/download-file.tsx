import { t } from "../../lib/i18n";
import { showActionSheet } from "../../shared/ui/overlay/action-sheet";
import { liveSession } from "../computers/catalog-store";
import { capabilityEnabled } from "../operations/capabilities-store";
import { DownloadPanel } from "./download-sheet";
import { activeScope, getWorkspaceSnapshot } from "./store";
import { ownFilesDialog } from "./surface-dialogs";

/** Whether this daemon advertises the P2P-only download RPCs. */
export function downloadActionAvailable(): boolean {
  return capabilityEnabled("download_file");
}

/**
 * Open the download sheet for one listed file. The sheet owns the RPC handle;
 * the capability, the live P2P transport and the daemon's size cap are checked
 * again there, so a stale row cannot start a relay download.
 */
export function openWorkspaceDownload(path: string, size: number): void {
  const session = liveSession();
  const paneId = getWorkspaceSnapshot().paneId;
  if (!session || !paneId || !path || !downloadActionAvailable()) return;
  const root = activeScope()?.boundRoot;
  ownFilesDialog(() => showActionSheet(
    t("workspace.download.title"),
    modal => <DownloadPanel session={session} paneId={paneId} path={path} root={root} fallbackSize={size} modal={modal} />,
    { subtitle: path, className: "workspace-download-sheet" },
  ));
}
