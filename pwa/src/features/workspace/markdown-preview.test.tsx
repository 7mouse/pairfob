import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useSyncExternalStore } from "react";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { renderReact, unmountReact } from "../../../test-support/react-harness";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase, setSessionTransport, setNetworkOnline, setTransportSwitching } from "../connection/connection-store";
import { WorkspaceReadCache } from "../../lib/workspace-cache";
import type { LiveSession } from "../../lib/protocol/session-types";
import { setLang } from "../../lib/i18n";
import { loadWorkspaceFile } from "./actions";
import { FileBody, FileMeta, useFileView } from "./file-detail";
import * as store from "./store";

const revision = "a".repeat(64);
const CONTENT = [
  "# Release notes",
  "",
  "Pairfob **ships**.",
  "",
  "<script>alert(1)</script>",
  "",
  "See [the hub](internal/mux/hub.go).",
  "",
].join("\n");

/** The info bar and the file below it, as the page arranges them. */
function View() {
  const snapshot = useSyncExternalStore(store.subscribeWorkspace, store.getWorkspaceSnapshot);
  const view = useFileView(snapshot);
  return <>
    <div className="workspace-detail-head"><FileMeta snapshot={snapshot} view={view} /></div>
    <FileBody snapshot={snapshot} view={view} />
  </>;
}

const switches = () => [...document.querySelectorAll<HTMLButtonElement>(".workspace-preview-switch button")];
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const all = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
  setPhase("live"); setNetworkOnline(true); setTransportSwitching(false); setSessionTransport("p2p");
  const api = {
    workspaceOpen: async () => ({ name: "work", root: "/work", git: null,
      features: { files: true, git_status: false, git_diff: false, git_branches: false } }),
    workspaceRead: async (_pane: string, path: string) => ({
      path, kind: "text" as const, size: CONTENT.length, modified_ms: 1,
      content: path === "README.md" ? CONTENT : "", revision, truncated: false,
    }),
  };
  const live = api as unknown as LiveSession;
  attachLiveSession(live);
  const { ticket } = store.beginEnter(live, "pane", "agent");
  const scope = await new WorkspaceReadCache(api as never, () => "/work").open("pane");
  store.bindScope(ticket, scope);
  ticket.commit({ descriptor: scope.descriptor, view: "file", detailPath: "README.md",
    file: await api.workspaceRead("pane", "README.md") });
  ticket.finishLoad();
});

afterEach(async () => {
  unmountReact(); store.beginLeave(); attachLiveSession(null);
});

async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }

test("a Markdown file opens as its source, with the rendered document one choice away", async () => {
  renderReact(<View />); await settle();
  expect(query(".workspace-code")).not.toBeNull();
  expect(query(".workspace-markdown")).toBeNull();
  // Preview first, source second: the source is the default that stays.
  expect(switches().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  expect(query(".workspace-preview-switch")!.getAttribute("aria-label")).toBe("Markdown 预览");

  act(() => { switches()[0]!.click(); });
  expect(query(".workspace-code")).toBeNull();
  const body = query(".workspace-markdown .agent-md")!;
  expect(body.querySelector("h1")?.textContent).toBe("Release notes");
  expect(body.querySelector("strong")?.textContent).toBe("ships");
  // The chat's sanitizer is the one that reads the document: no script survives.
  expect(body.querySelector("script")).toBeNull();
  expect(body.textContent).not.toContain("alert(1)");

  // Back to the text that was opened.
  act(() => { switches()[1]!.click(); });
  expect(query(".workspace-code")).not.toBeNull();
  expect(query(".workspace-markdown")).toBeNull();
});

test("a file reference in the document opens in this viewer", async () => {
  renderReact(<View />); await settle();
  act(() => { switches()[0]!.click(); });
  const link = query<HTMLAnchorElement>('.workspace-markdown a[data-file-ref="internal/mux/hub.go"]');
  expect(link).not.toBeNull();
  expect(link!.getAttribute("href")).toBe("#file");
  // A fresh file opens as its source again, as every other file does.
  await act(async () => { link!.click(); });
  await settle();
  expect(store.getWorkspaceSnapshot().detailPath).toBe("internal/mux/hub.go");
  expect(query(".workspace-code")).not.toBeNull();
});

test("a line target is source's own, whatever the file type", async () => {
  await act(async () => { await loadWorkspaceFile("README.md", 3); });
  renderReact(<View />); await settle();
  expect(store.getWorkspaceSnapshot().sourceLine).toBe(3);
  expect(query(".workspace-code")).not.toBeNull();
  expect(query(".workspace-code-line.is-target")).not.toBeNull();
  expect(switches().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
});

test("the switch says which document it previews, in the reader's language", async () => {
  setLang("en");
  renderReact(<View />); await settle();
  expect(query(".workspace-preview-switch")!.getAttribute("aria-label")).toBe("Markdown preview");
  expect(switches().map((button) => button.textContent)).toEqual(["Preview", "Source"]);
  expect(all(".workspace-preview-width").length).toBe(0);
});