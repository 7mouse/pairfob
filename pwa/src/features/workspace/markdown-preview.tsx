import { useMemo, type MouseEvent } from "react";
import { renderMarkdown } from "../../lib/agent-markdown";
import { parseFileReference, workspaceReferencePath } from "../../lib/file-reference";
import { t } from "../../lib/i18n";
import { loadWorkspaceFile } from "./actions";
import "./workspace-markdown.scss";

/**
 * A Markdown file read as the document it is. The sanitizer is the chat's own
 * (`renderMarkdown`), so scripts and event handlers are stripped as they are in
 * a reply; a reference to another file in the text opens here, in this viewer,
 * rather than leaving for a new tab. The type is the shared `.agent-md` face;
 * this file gives it a document's measure and a scroller.
 */
export function MarkdownPreview({ content, root }: { content: string; root: string }) {
  const markup = useMemo(() => ({ __html: renderMarkdown(content, true) }), [content]);
  const open = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest?.("a[data-file-ref]");
    if (!link) return;
    const reference = parseFileReference(link.getAttribute("data-file-ref") || "");
    const target = reference && workspaceReferencePath(reference, root);
    if (!reference || target === null) return;
    event.preventDefault();
    if (target) void loadWorkspaceFile(target, reference.line ?? null);
  };
  return <section className="workspace-markdown" aria-label={t("preview.markdownTitle")}>
    <div className="workspace-markdown-scroll">
      <div className="agent-md workspace-markdown-body" onClick={open} dangerouslySetInnerHTML={markup} />
    </div>
  </section>;
}