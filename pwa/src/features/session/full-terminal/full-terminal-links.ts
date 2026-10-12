import type { ILinkProvider, ITerminalOptions, Terminal } from '@xterm/xterm';
import { fileReferencesInText, parseFileReference } from '../../../lib/file-reference';

export function httpUrlsInLine(text: string): Array<{ uri: string; start: number; end: number }> {
  const out: Array<{ uri: string; start: number; end: number }> = [];
  const re = /https?:\/\/[^\s<>"'）】]+/gi;
  for (const match of text.matchAll(re)) {
    let uri = match[0];
    while (uri.length > 8 && /[.,;:!?，。、)\]）]$/.test(uri)) uri = uri.slice(0, -1);
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    const start = match.index ?? 0;
    out.push({ uri, start, end: start + uri.length });
  }
  return out;
}

export function openTerminalLink(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const opened = window.open(parsed.href, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
  return true;
}

export function terminalLinkHandler(openFile?: (value: string) => void): NonNullable<ITerminalOptions["linkHandler"]> {
  return {
    // xterm otherwise discards file: OSC links before our validated handler runs.
    allowNonHttpProtocols: !!openFile,
    activate(event, text) {
      event.preventDefault();
      if (!openTerminalLink(text) && parseFileReference(text)) openFile?.(text);
    },
  };
}

type CellPoint = { x: number; y: number };

/** Join soft wraps only, retaining UTF-16 offsets to terminal cell coordinates. */
function logicalLine(terminal: Terminal, row: number) {
  const buffer = terminal.buffer.active;
  let first = row - 1;
  let last = first;
  // Bound work on hostile output; never link a truncated fragment as a full path.
  const maxRows = 64;
  while (first > 0 && buffer.getLine(first)?.isWrapped) {
    if (last - first >= maxRows) return null;
    first--;
  }
  if (buffer.getLine(first)?.isWrapped) return null;
  while (buffer.getLine(last + 1)?.isWrapped) {
    if (last - first >= maxRows) return null;
    last++;
  }
  let text = '';
  const starts: CellPoint[] = [];
  const ends: CellPoint[] = [];
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y);
    if (!line) return null;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      // A wide glyph at a soft wrap leaves an empty spacer at the previous edge.
      if (x === line.length - 1 && y < last && !cell.getChars()
        && buffer.getLine(y + 1)?.getCell(0)?.getWidth() === 2) continue;
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) {
        starts.push({ x: x + 1, y: y + 1 });
        ends.push({ x: x + cell.getWidth(), y: y + 1 });
      }
      text += chars;
      if (text.length > 16384) return null;
    }
  }
  return { text, starts, ends };
}

/** Shared by all terminal programs; file resolution stays with the owning pane. */
export function terminalLinkProvider(terminal: Terminal, openFile?: (value: string) => void): ILinkProvider {
  return {
    provideLinks(row, callback) {
      const line = logicalLine(terminal, row);
      if (!line) { callback(undefined); return; }
      const urls = httpUrlsInLine(line.text);
      const files = openFile ? fileReferencesInText(line.text).filter(file =>
        !urls.some(url => file.start < url.end && file.end > url.start)) : [];
      const candidates = [
        ...urls.map(url => ({ ...url, activate: () => { openTerminalLink(url.uri); } })),
        ...files.map(file => ({ uri: file.value, start: file.start, end: file.end, activate: () => openFile?.(file.value) })),
      ];
      callback(candidates.flatMap(item => {
        const start = line.starts[item.start], end = line.ends[item.end - 1];
        if (!start || !end || row < start.y || row > end.y) return [];
        return [{ text: item.uri, range: { start, end }, activate: (event: MouseEvent) => {
          event.preventDefault();
          item.activate();
        } }];
      }));
    },
  };
}

export function httpLinkProvider(terminal: Terminal): ILinkProvider {
  return terminalLinkProvider(terminal);
}
