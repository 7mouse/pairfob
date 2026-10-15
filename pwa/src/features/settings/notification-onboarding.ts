const PREFIX = "pairfob_notification_prompt:";
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let revision = 0;
export const notificationPromptRevision = () => revision;
export const subscribeNotificationPrompt = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function state(daemonId: string): string | null {
  try { return localStorage.getItem(PREFIX + daemonId) ?? memory.get(daemonId) ?? null; }
  catch { return memory.get(daemonId) ?? null; }
}
function write(daemonId: string, value: string): void {
  memory.set(daemonId, value);
  try { localStorage.setItem(PREFIX + daemonId, value); memory.delete(daemonId); } catch { /* in-memory fallback */ }
  revision++;
  for (const listener of listeners) listener();
}
export function offerNotifications(daemonId: string): void {
  if (!state(daemonId)) write(daemonId, "pending");
}
export const notificationsPending = (daemonId: string) => state(daemonId) === "pending";
export const dismissNotifications = (daemonId: string) => write(daemonId, "dismissed");
