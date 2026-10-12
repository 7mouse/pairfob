import { topDialogBack, subscribeDialogBack } from "../shared/ui/overlay/back";
import { closeWorkspaceDetail } from "../features/workspace/actions";
import { workspaceBackAction } from "../features/workspace/back";
import { closeWorkspaceInspector } from "../features/workspace/inspector";
import { getWorkspaceSnapshot, subscribeWorkspace } from "../features/workspace/store";
import { listBeside } from "../features/workspace/list-beside";
import { leaveComputers } from "../features/computers/actions";
import { computersBackTarget } from "../features/computers/model";
import { openPaneId } from "../features/session/session-store";
import { leaveSettings } from "../features/settings/actions";
import { setSettingsSection, settingsSection, subscribeSettingsSection } from "../features/settings/settings-section";
import { leaveBoardForList } from "../pages/board/board-bridge";
import { goBackFromPane } from "../features/session/pane-actions";
import { currentScreen, computersFrom, goToScreen } from "./navigation-store";
import { getAppFrame, subscribeAppFrame } from "./frame";
import { commitView } from "./host";
import { bindBackHistory } from "./back-history";
import { parseNotificationURL } from "../lib/notification-target";

/** Use existing navigation actions: they own pending reads, drafts, and focus. */
export function systemBackAction(): (() => void | Promise<void>) | null {
  const dialog = topDialogBack();
  if (dialog) return dialog;
  const layout = getAppFrame().layout;
  if (!layout || layout.mode === "boot" || layout.mode === "connect" || layout.mode === "pick") return null;
  const screen = currentScreen();
  if (screen === "workspace" || layout.shell.inspector) {
    const workspace = getWorkspaceSnapshot();
    // A column's detail has its own Close; a wide workspace header leaves the
    // whole screen. A narrow screen uncovers the list, then climbs folders.
    if (workspace.view !== "browser" && (layout.shell.inspector || !listBeside())) return closeWorkspaceDetail;
    return screen === "workspace" ? workspaceBackAction(workspace, listBeside()) : closeWorkspaceInspector;
  }
  if (screen === "pane") return () => goBackFromPane();
  if (screen === "board" && layout.shell.railHidden) return leaveBoardForList;
  if (screen === "settings") {
    if (settingsSection() !== "overview") return () => setSettingsSection("overview");
    return layout.shell.desk ? leaveSettings : null;
  }
  if (screen === "computers") return () => leaveComputers(computersBackTarget({
    computersFrom: computersFrom(), desk: layout.shell.desk, paneId: openPaneId(),
  }));
  if (screen === "quota") return () => {
    goToScreen("settings");
    commitView();
  };
  // Tabs are roots. Back here belongs to the browser/OS.
  return null;
}

export function bindSystemBack(): () => void {
  const owner = bindBackHistory({
    state: () => history.state,
    replace: state => history.replaceState(state, ""),
    push: state => history.pushState(state, ""),
    back: () => history.back(),
    listen(pop) { window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); },
  }, systemBackAction, crypto.randomUUID());
  // Portal cleanup and frame publication can happen in the same React commit.
  // Reconcile after it, once the actual top surface is known.
  let alive = true;
  const sync = () => queueMicrotask(() => { if (alive) owner.sync(); });
  const stops = [subscribeAppFrame(sync), subscribeWorkspace(sync), subscribeDialogBack(sync), subscribeSettingsSection(sync)];
  const hash = (event: HashChangeEvent) => {
    // Notification capture scrubs the hash first. Use the event's original URL;
    // ordinary links and iframe history are not application navigation.
    if (parseNotificationURL(event.newURL, location.origin)) owner.consumeHashEntry();
  };
  window.addEventListener("hashchange", hash);
  return () => {
    alive = false;
    for (const stop of stops) stop();
    window.removeEventListener("hashchange", hash);
    owner.dispose();
  };
}
