import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { bootWorkspaceScreen, settle, teardownWorkspaceScreen } from "../../../test-support/workspace-harness";
import { workspaceLive } from "../../../test-support/workspace-live-fixture";
import { setScreen } from "../../app/navigation-store";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { ProtocolError } from "../../lib/protocol/errors";
import { attachLiveSession } from "../computers/catalog-store";
import { setPhase } from "../connection/connection-store";
import { applyCapabilities } from "../operations/capabilities-store";
import { selectPane } from "../session/session-store";
import { paneFileSearch } from "./file-search";
import { workspaceModel } from "./index";

/** The files search-and-jump is given: the open pane's, by name, where its computer can search. */

const searched: string[] = [];
const live = () => workspaceLive({ changes: () => [{ path: "src/app.ts", index: " ", worktree: "M" }], searched });

/** The session's own screen, with no files screen and no column: the palette opened over a conversation. */
async function onPane(fixture: object): Promise<void> {
  await act(async () => {
    setPhase("live");
    setScreen("pane");
    selectPane("p1");
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, search_files: true }, []);
    attachLiveSession(fixture as never);
  });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  searched.length = 0;
});
afterEach(async () => {
  await teardownWorkspaceScreen();
  await act(async () => { applyCapabilities({ ...NO_OPERATION_CAPABILITIES }, []); });
});

describe("the files search-and-jump is given", () => {
  test("on the files screen: the workspace's files by name, opened in the screen", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { search_files: true } });
    const files = paneFileSearch();
    expect(files).not.toBeNull();
    expect(await files!.search("app")).toEqual(["src/app.ts"]);
    expect(searched).toEqual(["app"]);
    await act(async () => { files!.open("src/app.ts"); });
    await settle();
    expect(workspaceModel.view).toBe("file");
    expect(workspaceModel.detailPath).toBe("src/app.ts");
  });

  test("a computer that cannot search offers none", async () => {
    await bootWorkspaceScreen(live(), { capabilities: { search_files: false } });
    expect(paneFileSearch()).toBeNull();
  });

  test("the workspace on screen is not opened again to be searched, however long the reader types", async () => {
    let opens = 0;
    const fixture = live();
    const open = fixture.workspaceOpen;
    fixture.workspaceOpen = async () => { opens++; return open(); };
    await bootWorkspaceScreen(fixture, { capabilities: { search_files: true } });
    const entered = opens;
    const files = paneFileSearch()!;
    await files.search("app");
    await files.search("apps");
    await files.search("appst");
    expect(searched).toEqual(["app", "apps", "appst"]);
    expect(opens).toBe(entered);
    // Too short, or longer than the computer takes: not asked at all.
    expect(await files.search("a")).toEqual([]);
    expect(await files.search("a".repeat(129))).toEqual([]);
    expect(searched).toHaveLength(3);
  });

  test("beside no files screen the root is asked for once and then named in every search", async () => {
    let opens = 0;
    const roots: string[] = [];
    const fixture = live();
    const open = fixture.workspaceOpen;
    fixture.workspaceOpen = async () => { opens++; return open(); };
    const search = fixture.workspaceSearch;
    fixture.workspaceSearch = async (pane: string, root: string, query: string) => { roots.push(root); return search(pane, root, query); };
    await onPane(fixture);
    const files = paneFileSearch()!;
    expect(await files.search("app")).toEqual(["src/app.ts"]);
    expect(await files.search("apps")).toEqual(["src/app.ts"]);
    expect(opens).toBe(1);
    expect(roots).toEqual(["/work/pairfob", "/work/pairfob"]);
  });

  test("a pane with no workspace is asked once, not at every pause in typing, and simply has no files", async () => {
    let opens = 0;
    const fixture = live();
    fixture.workspaceOpen = async () => { opens++; throw new ProtocolError("workspace_not_found", "gone"); };
    await onPane(fixture);
    const files = paneFileSearch()!;
    expect(await files.search("app")).toEqual([]);
    expect(await files.search("apps")).toEqual([]);
    expect(await files.search("appst")).toEqual([]);
    expect(opens).toBe(1);
    expect(searched).toEqual([]);
  });

  test("a search that fails is said to have failed, and the next one finds the pane's root again", async () => {
    let opens = 0;
    let fail = true;
    const fixture = live();
    const open = fixture.workspaceOpen;
    fixture.workspaceOpen = async () => { opens++; return open(); };
    const search = fixture.workspaceSearch;
    // The pane moved to another directory: the computer refuses the root it was given.
    fixture.workspaceSearch = async (pane: string, root: string, query: string) => {
      if (fail) throw new ProtocolError("conflict", "the pane's workspace changed");
      return search(pane, root, query);
    };
    await onPane(fixture);
    const files = paneFileSearch()!;
    await expect(files.search("app")).rejects.toThrow();
    fail = false;
    // The root is asked for again, of the read cache, which opens the pane anew once its directory has changed.
    expect(await files.search("app")).toEqual(["src/app.ts"]);
    expect(opens).toBeGreaterThanOrEqual(1);
    expect(searched).toEqual(["app"]);
  });
});
