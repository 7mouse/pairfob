import { describe, expect, test } from 'bun:test';
import type { IBufferCell, IBufferLine, ILink, Terminal } from '@xterm/xterm';
import { terminalLinkHandler, terminalLinkProvider } from './full-terminal-links';

// Model terminal cells, including wide glyph continuations and combined UTF-16 text.
function line(text: string, isWrapped = false): IBufferLine {
  const cells: Array<{ chars: string; width: number }> = [];
  for (const char of text) {
    if (/\p{M}/u.test(char) && cells.length) { cells[cells.length - 1].chars += char; continue; }
    const width = /[\p{Script=Han}\p{Extended_Pictographic}]/u.test(char) ? 2 : 1;
    cells.push({ chars: char, width });
    if (width === 2) cells.push({ chars: '', width: 0 });
  }
  return {
    isWrapped, length: cells.length,
    getCell(x: number) {
      const cell = cells[x];
      return cell && { getChars: () => cell.chars, getWidth: () => cell.width } as IBufferCell;
    },
  } as IBufferLine;
}
function fixture(lines: IBufferLine[]) {
  const opened: string[] = [];
  const terminal = { buffer: { active: { getLine: (index: number) => lines[index] } } } as unknown as Terminal;
  const provider = terminalLinkProvider(terminal, value => opened.push(value));
  const links = (row: number) => {
    let result: ILink[] = [];
    provider.provideLinks(row, value => { result = value ?? []; });
    return result;
  };
  return { links, opened };
}
const click = { preventDefault() {} } as MouseEvent;

describe('terminal file links for any program', () => {
  test('the screenshot relative path opens from its colored-text-independent range', () => {
    const value = 'docs/reviews/navigation-wake/index.html';
    const f = fixture([line(`打开 HTML 评审页 (${value})`)]);
    const [link] = f.links(1);
    expect(link.text).toBe(value);
    expect(link.range.start).toEqual({ x: 19, y: 1 });
    link.activate(click, link.text);
    expect(f.opened).toEqual([value]);
  });

  test('absolute, home, file URI and line suffixes retain the original reference', () => {
    for (const value of ['/work/src/app.ts:12:3', '~/repo/src/app.ts#L12', 'file:///work/src/app.ts:4']) {
      const f = fixture([line(`(${value})`)]);
      const [link] = f.links(1);
      expect(link.text).toBe(value);
      link.activate(click, link.text);
      expect(f.opened).toEqual([value]);
    }
  });

  test('maps Unicode code units and combining marks to terminal columns', () => {
    const f = fixture([line('中😀e\u0301 (src/页面.ts:2)')]);
    const [link] = f.links(1);
    expect(link.range).toEqual({ start: { x: 8, y: 1 }, end: { x: 20, y: 1 } });
  });

  test('a soft-wrapped path activates its whole reference from either row', () => {
    const f = fixture([line('(docs/reviews/navigation-'), line('wake/index.html:4)', true)]);
    for (const row of [1, 2]) {
      const [link] = f.links(row);
      expect(link.text).toBe('docs/reviews/navigation-wake/index.html:4');
      expect(link.range).toEqual({ start: { x: 2, y: 1 }, end: { x: 17, y: 2 } });
      link.activate(click, link.text);
    }
    expect(f.opened).toHaveLength(2);
  });

  test('hard newlines never join unrelated output', () => {
    const f = fixture([line('docs/reviews/navigation-'), line('wake/index.html')]);
    expect(f.links(1)).toEqual([]);
    expect(f.links(2)[0].text).toBe('wake/index.html');
  });

  test('a wide glyph wraps past an empty spacer without inserting a filename space', () => {
    const first = line('(src/ ');
    const getCell = first.getCell.bind(first);
    first.getCell = x => x === first.length - 1
      ? { getChars: () => '', getWidth: () => 1 } as IBufferCell : getCell(x);
    const f = fixture([first, line('页面.ts)', true)]);
    expect(f.links(2)[0].text).toBe('src/页面.ts');
    expect(f.links(2)[0].range.end).toEqual({ x: 7, y: 2 });
  });

  test('a wrapped prefix that scrolled out cannot become a different relative path', () => {
    expect(fixture([line('src/app.ts', true)]).links(1)).toEqual([]);
  });

  test('HTTP paths are not intercepted as workspace files, and invalid paths stay inert', () => {
    const f = fixture([line('https://example.com/src/app.ts')]);
    expect(f.links(1).map(link => link.text)).toEqual(['https://example.com/src/app.ts']);
    for (const value of ['../src/app.ts', 'src/.git/config.txt', 'ftp://host/src/app.ts', '/work/My Project/report.html']) {
      expect(fixture([line(value)]).links(1)).toEqual([]);
    }
  });

  test('bounded scanning refuses an oversized wrapped logical line', () => {
    const f = fixture(Array.from({ length: 70 }, (_, index) => line('long/', index > 0)));
    expect(f.links(35)).toEqual([]);
  });

  test('explicit OSC hyperlinks support local file targets including spaces, reject remote schemes', () => {
    const opened: string[] = [];
    const handler = terminalLinkHandler(value => opened.push(value));
    expect(handler.allowNonHttpProtocols).toBe(true);
    expect(terminalLinkHandler().allowNonHttpProtocols).toBe(false);
    handler.activate(click, 'file:///work/My%20Project/report.html:4', undefined as never);
    handler.activate(click, 'src/app.ts:2', undefined as never);
    for (const value of ['javascript:alert(1)', 'file://remote/work/app.ts', '../app.ts']) {
      handler.activate(click, value, undefined as never);
    }
    expect(opened).toEqual(['file:///work/My%20Project/report.html:4', 'src/app.ts:2']);
  });
});
