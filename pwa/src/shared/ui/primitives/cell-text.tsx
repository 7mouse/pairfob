import type { ReactNode } from "react";
import { cellRuns } from "../fonts/term-glyphs";

/**
 * The text of one run of terminal cells, for a grid the browser lays out.
 *
 * Ordinary text is returned as it is. An icon glyph gets a box one cell wide
 * that it may run out of, and a Powerline separator a shape that fills its
 * cell (`styles/cell-text.scss`). Every character stays in the text, so a
 * selection copies what the terminal holds; a screen reader is spared them,
 * since a private use code point has no name to read.
 */
export function cellText(text: string, shapeInk?: string): ReactNode {
  const runs = cellRuns(text);
  if (!runs) return text;
  return runs.map((run, index) => {
    if (run.kind === "text") return run.text;
    if (run.kind === "shape") {
      // A separator sharing a run with text that was recoloured to be read keeps the colour of its bar.
      return (
        <span key={index} className={`cell-shape cell-shape-${run.shape}`} aria-hidden="true" style={shapeInk ? { color: shapeInk } : undefined}>
          {run.text}
        </span>
      );
    }
    // The cell measures itself in the grid's font; only the glyph inside is set in the icon face.
    return (
      <span key={index} className="cell-icon" aria-hidden="true">
        <span className={run.face === "mdi" ? "cell-glyph cell-glyph-mdi" : "cell-glyph"}>{run.text}</span>
      </span>
    );
  });
}
