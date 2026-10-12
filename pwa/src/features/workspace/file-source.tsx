import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { t } from '../../lib/i18n';
import { highlightSource } from '../../lib/syntax-highlight';
import type { FoundLines } from './file-find';
import { FileLineBar, pickedRange, pressedLine, quoteFileLine, type NoteLines, type PickedLine } from './file-line-actions';

/**
 * A file's source, one element per line. A press on a line picks it and opens
 * its actions over the code (`file-line-actions`); pressing it again, or
 * anywhere else, puts them away. A pick grows into a run of lines with Shift
 * and a second press, or from the bar under a finger. The code is a stop of
 * the keyboard too: the arrows pick a line, Shift and the arrows a run. A drag
 * that selected text is the browser's own and picks nothing. `notes` are the lines a note can be written on;
 * `found` the lines a find in the file matched, the one the reader is on
 * brought into view.
 */
export function FileSource({ path, content, wrap, line, reveal = false, notes = null, found = null }: {
  path: string; content: string; wrap: boolean; line: number | null; reveal?: boolean; notes?: NoteLines | null; found?: FoundLines | null;
}) {
  const root = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => {
    const out: ReturnType<typeof highlightSource>[] = [[]];
    for (const token of highlightSource(path, content)) {
      const parts = token.text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) out.push([]);
        const text = index < parts.length - 1 ? `${part}\n` : part;
        if (text) out[out.length - 1].push({ ...token, text });
      });
    }
    if (out.length > 1 && !out.at(-1)?.length) out.pop();
    return out;
  }, [path, content]);
  useLayoutEffect(() => {
    if (line) root.current?.querySelector(`[data-source-line="${line}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [line, content]);
  const sought = found?.current ?? null;
  useLayoutEffect(() => {
    if (sought) root.current?.querySelector(`[data-source-line="${sought}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [sought, content]);

  // The pick belongs to this text: another file, or the same one read again, has none.
  const [picked, setPicked] = useState<{ of: string; at: PickedLine } | null>(null);
  const shown = `${path}\n${content.length}`;
  const current = picked?.of === shown ? picked.at : null;
  const range = current ? pickedRange(current) : null;
  const textOf = (from: number, to: number): string => lines.slice(from - 1, to)
    .map((tokens) => tokens.map((token) => token.text).join('').replace(/\n$/, '')).join('\n');
  const pick = (event: MouseEvent<HTMLPreElement>) => {
    const selection = document.getSelection();
    const pressed = pressedLine(event.target, (event.nativeEvent as PointerEvent).pointerType, event.clientX);
    // Shift with a mouse, or the bar's Select under a finger: the pick keeps where it began and reaches the pressed line.
    // Shift and a press is also how a browser stretches a selection of text; here the lines are what is being picked.
    if (pressed && current && (event.shiftKey || current.growing)) {
      if (event.shiftKey) selection?.removeAllRanges();
      return setPicked({ of: shown, at: { ...current, to: pressed.line, x: pressed.x, by: pressed.by } });
    }
    if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
    if (!pressed) return setPicked(null);
    const again = current !== null && current.line === current.to && pressed.line === current.line;
    setPicked(again ? null : { of: shown, at: pressed });
  };
  /** The keyboard's way: the arrows move the pick a line, with Shift they move its end; ⌘/Ctrl+Shift+L quotes it. */
  const onKey = (event: KeyboardEvent<HTMLPreElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l' && range) {
      event.preventDefault();
      quoteFileLine(path, range[0], textOf(range[0], range[1]), range[1]);
      setPicked(null);
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step || mod || event.altKey) return;
    event.preventDefault();
    const from = current ? current.to : line ?? (step > 0 ? 0 : lines.length + 1);
    const next = Math.min(lines.length, Math.max(1, from + step));
    setPicked({ of: shown, at: event.shiftKey && current ? { ...current, to: next, x: null, by: 'keys' } : { line: next, to: next, x: null, by: 'keys' } });
    root.current?.querySelector(`[data-source-line="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };

  return <div className="workspace-code-stage">
    <pre ref={root} className={`workspace-code${wrap ? ' is-wrap' : ''}${reveal ? ' workspace-reveal' : ''}`} tabIndex={0}
      aria-label={t('workspace.sourceOf', { path })} onClick={pick} onKeyDown={onKey}
      onMouseDown={(event) => { if (event.shiftKey && current) event.preventDefault(); }}>
      <code className="workspace-highlight">{lines.map((tokens, index) => <span key={index}
        data-source-line={index + 1}
        className={`workspace-code-line${line === index + 1 ? ' is-target' : ''}${range && index + 1 >= range[0] && index + 1 <= range[1] ? ' is-picked' : ''}${
          found?.lines.has(index + 1) ? (sought === index + 1 ? ' is-found is-found-current' : ' is-found') : ''}`}>
        {tokens.map((token, part) => <Fragment key={part}>{token.kind
          ? <span className={`syntax-${token.kind}`}>{token.text}</span> : token.text}</Fragment>)}
      </span>)}</code>
    </pre>
    {current && range && <FileLineBar code={root} path={path} text={textOf(range[0], range[1])} picked={current} notes={notes}
      onClose={() => setPicked(null)} onGrow={(growing) => setPicked({ of: shown, at: { ...current, growing } })} />}
  </div>;
}
