import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { t } from "../../lib/i18n";
import { Button, Fold } from "../../shared/ui/primitives";
import { renewFileSearch } from "./file-filter";
import { FileRow, pathEntry } from "./file-row";
import { useRepoSearch } from "./file-search";
import type { GitMarks } from "./git-marks";
import type { WorkspaceSnapshot } from "./model";
import { setRecentOpen, useRecentFiles } from "./recent-files";
import { useTurnWrites } from "./turn-writes";

/**
 * What the files tab lists beside the directory itself: the files the agent's
 * turn wrote and the ones the reader opened last, over the root; and under a
 * filter, the whole workspace's matches.
 */

/** How many of the turn's files the root lists before it offers the rest. */
const TURN_FILES_SHOWN = 8;

/**
 * The files the agent wrote in its current turn (`turn-writes`), over the root
 * listing: what the reader most likely came to look at. A file the turn
 * deleted is left to the changes tab, where its diff is.
 */
export function TurnFiles({ snapshot, marks }: { snapshot: WorkspaceSnapshot; marks: GitMarks }) {
  const written = useTurnWrites(snapshot.paneId, snapshot.descriptor?.root).filter((path) => marks.files.get(path) !== "deleted");
  // The reader asked for all of them, for this pane: another pane's turn starts short again.
  const [allOf, setAllOf] = useState("");
  if (!written.length) return null;
  const all = allOf === snapshot.paneId;
  const shown = all ? written : written.slice(0, TURN_FILES_SHOWN);
  return <section className="workspace-turn" aria-label={t("workspace.turnWrites")}>
    <h3 className="workspace-section is-static">
      <span className="workspace-section-name">{t("workspace.turnWrites")}</span>
      <span className="workspace-section-count">{String(written.length)}</span>
    </h3>
    {shown.map((path) => <FileRow key={`turn:${path}`} recent="turn" entry={pathEntry(path)} snapshot={snapshot} marks={marks} />)}
    {shown.length < written.length && <Button className="workspace-section-more" onClick={() => setAllOf(snapshot.paneId)}>
      {t("workspace.turnMore", { count: written.length - shown.length })}
    </Button>}
  </section>;
}

/**
 * The files opened last, over the root listing; the reader can fold them away.
 * Only files from below the root are listed: one the root itself lists is
 * already a press away, and a section that grew with every file opened from
 * the list would move the list under the reader when they came back to it.
 */
export function RecentFiles({ snapshot, marks }: { snapshot: WorkspaceSnapshot; marks: GitMarks }) {
  const recent = useRecentFiles(snapshot.descriptor?.root ?? "");
  const entries = recent.entries.filter((entry) => entry.path.includes("/"));
  if (!entries.length) return null;
  return <section className="workspace-recent" aria-label={t("workspace.recent")}>
    <Button className="workspace-section" aria-expanded={recent.open} onClick={() => setRecentOpen(!recent.open)}>
      <span className="workspace-section-name">{t("workspace.recent")}</span>
      <ChevronDown className="workspace-section-chev" size={14} aria-hidden="true" />
    </Button>
    <Fold open={recent.open} lazy>
      {entries.map((entry) => <FileRow key={`recent:${entry.path}`} recent="recent" entry={entry} snapshot={snapshot} marks={marks} />)}
    </Fold>
  </section>;
}

/**
 * The whole workspace's answer to what is typed, under the directory's own
 * matches: the filter narrows what is listed here, and from two letters on the
 * computer is asked for files anywhere below the root (`file-search`).
 */
export function RepoResults({ snapshot, marks, query, listed }: {
  snapshot: WorkspaceSnapshot; marks: GitMarks; query: string; listed: ReadonlySet<string>;
}) {
  const search = useRepoSearch(snapshot.paneId, snapshot.descriptor?.root, query);
  if (!search.active) return null;
  const found = search.result?.items ?? [];
  // A file the directory lists is already among its own matches above.
  const items = found.filter((item) => !listed.has(item.path));
  return <section className="workspace-search" aria-label={t("workspace.searchRepo")}>
    <h3 className="workspace-section is-static"><span className="workspace-section-name">{t("workspace.searchRepo")}</span></h3>
    {items.map((item) => <FileRow key={`search:${item.path}`} recent="search" entry={pathEntry(item.path)} snapshot={snapshot} marks={marks} />)}
    {search.failed ? <p className="workspace-search-note workspace-search-failed" role="status">
        <span>{t("workspace.searchFailed")}</span>
        <Button className="btn btn-small" onClick={renewFileSearch}>{t("ft.retry")}</Button>
      </p>
      : !search.result ? <p className="workspace-search-note" role="status">{t("workspace.searching")}</p>
      // Everything it found is listed above already: the repository has nothing else, which is not "nothing".
      : !items.length ? <p className="workspace-search-note" role="status">{t(found.length ? "workspace.searchNoOther" : "workspace.searchNone")}</p>
      : search.result.truncated ? <p className="workspace-search-note">{t("workspace.searchMore", { count: found.length })}</p>
      : null}
  </section>;
}
