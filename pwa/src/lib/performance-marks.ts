/** Local-only milestones: fixed names and timestamps, never session content or identity. */
export type AppMilestone = "boot-start" | "connect-interactive" | "connected-load-start" | "connected-ready"
  | "session-establish-start" | "session-established" | "first-session-data" | "first-terminal-write";
const recorded = new Set<AppMilestone>();

export function markAppPerformance(name: AppMilestone): void {
  if (recorded.has(name)) return;
  try {
    globalThis.performance?.mark(`pairfob:${name}`);
    recorded.add(name);
  } catch { /* Measuring must never gate the product. */ }
}

export function resetAppPerformance(): void {
  for (const name of recorded) {
    try { globalThis.performance?.clearMarks(`pairfob:${name}`); } catch { /* Optional browser API. */ }
  }
  recorded.clear();
}
