/** Back asks the top dialog's owner, preserving its nested steps and focus. */
const owners = new Map<HTMLDialogElement, () => void>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function registerDialogBack(element: HTMLDialogElement, back: () => void): () => void {
  owners.set(element, back);
  notify();
  return () => { owners.delete(element); notify(); };
}
export function subscribeDialogBack(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function topDialogBack(): (() => void) | null {
  const top = [...owners.keys()].filter(element => element.open && element.isConnected).at(-1);
  return top ? owners.get(top)! : null;
}
