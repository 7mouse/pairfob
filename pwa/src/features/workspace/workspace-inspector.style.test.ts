import { describe, expect, test } from "bun:test";

const inspector = await Bun.file(new URL("./workspace-inspector.scss", import.meta.url)).text();
const detail = await Bun.file(new URL("./workspace-detail.scss", import.meta.url)).text();
const preview = await Bun.file(new URL("./workspace-preview.scss", import.meta.url)).text();

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(source: string, selector: string): string {
  const start = source.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  return source.slice(start, source.indexOf("}", start));
}

/**
 * How far the review is, in the column's head. The room for it is whatever the
 * tabs and the actions leave, and a count cut at its start reads as another
 * count ("2/14 seen" of "12/14 seen"): what does not fit has to go whole. A
 * test DOM lays nothing out, so these are the rules that make it so.
 */
describe("the review count in the column's head", () => {
  const summary = rule(inspector, ".inspector-summary");

  test("is one line that fills from its end and wraps what finds no room, out of sight", () => {
    expect(summary).toMatch(/flex-flow:\s*row-reverse wrap;/);
    expect(summary).toMatch(/align-content:\s*flex-start;/);
    expect(summary).toMatch(/overflow:\s*hidden;/);
    // One line high: its own line height, and nothing of a second line shows.
    const height = /height:\s*([\d.]+)em;/.exec(summary)?.[1];
    expect(height).toBeDefined();
    expect(summary).toContain(`line-height: ${height};`);
    // Nothing shrinks to fit: an item is whole or on the hidden line.
    expect(inspector).toContain(".inspector-summary > * { flex: none; }");
  });

  test("the count is placed first and the lines after it, so the lines give way first", () => {
    const order = (selector: string) => Number(/order:\s*(-?\d+)/.exec(inspector.slice(inspector.indexOf(`${selector} {`)))![1]);
    expect(order(".inspector-summary::before")).toBeLessThan(order(".inspector-summary .workspace-subline-reviewed"));
    expect(order(".inspector-summary .workspace-subline-reviewed")).toBeLessThan(order(".inspector-summary .workspace-subline-totals"));
  });

  test("an empty first item lets even the count alone wrap away, and takes no room for itself", () => {
    const first = inspector.slice(inspector.indexOf(".inspector-summary::before {"), inspector.indexOf("}", inspector.indexOf(".inspector-summary::before {")));
    expect(first).toContain('content: ""');
    expect(first).toMatch(/width:\s*0;/);
    // It takes back the gap that would otherwise stand between it and the count.
    const gap = /column-gap:\s*(\d+)px;/.exec(summary)![1];
    expect(first).toContain(`margin-left: -${gap}px;`);
  });
});

describe("the preview's width choice under a finger", () => {
  test("each width is a 44px target: as wide by its own rule, as high by the layer switch's", () => {
    expect(preview).toMatch(/\.workspace-preview-width button \{ min-width: 44px;/);
    const coarse = detail.slice(detail.indexOf("@media not all and (hover: hover) and (pointer: fine) {"));
    expect(coarse).toContain('.workspace-layer-switch button::after { content: ""; position: absolute; inset: min(0px, calc(50% - 22px)) 0; }');
  });
});

/**
 * The line that names the open file also holds its layers, its counts and the
 * stepper. Where the layers' names are long (another language) the room runs
 * out, and the file's name is what the reader switches by: the counts are what
 * goes, whole, before the name is cut to a letter.
 */
describe("the counts beside the open file's name", () => {
  const stats = rule(inspector, ".inspector-stats");

  test("take the shortfall before the name does", () => {
    const shrink = (declarations: string) => Number(/flex:\s*\d+\s+(\d+)\s/.exec(declarations)![1]);
    expect(shrink(stats)).toBeGreaterThan(shrink(rule(inspector, ".inspector-switch-file")) * 100);
    expect(stats).toMatch(/min-width:\s*0;/);
  });

  test("go whole: they wrap under a line that is one line high, never cut mid-number", () => {
    expect(stats).toMatch(/flex-wrap:\s*wrap;/);
    expect(stats).toMatch(/overflow:\s*hidden;/);
    const height = /height:\s*([\d.]+)em;/.exec(stats)?.[1];
    expect(height).toBeDefined();
    expect(stats).toContain(`line-height: ${height};`);
    // A lone item never wraps: the nothing before it is what lets it.
    expect(inspector).toContain('.inspector-stats::before { content: ""; width: 0; }');
    expect(inspector).toMatch(/\.inspector-stats-pair \{[^}]*flex:\s*none;[^}]*white-space:\s*nowrap;/);
  });
});
