export const ACTIVITY_INTERVAL_MS = 5 * 60_000;
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60_000;

export const RECORD_ACTIVITY_SQL = `UPDATE daemons SET
  first_session_at = MIN(COALESCE(first_session_at, ?), ?),
  last_active_at = MAX(COALESCE(last_active_at, ?), ?)
  WHERE daemon_id = ?`;

export async function conversionStats(db: D1Database, now: number): Promise<Record<string, unknown>> {
  const row = await db.prepare(`SELECT COUNT(*) AS installed,
    COUNT(first_session_at) AS paired,
    COALESCE(SUM(CASE WHEN last_active_at >= ? THEN 1 ELSE 0 END), 0) AS active_7d,
    (SELECT started_at FROM conversion_tracking WHERE id = 1) AS tracking_started_at
    FROM daemons`).bind(now - ACTIVE_WINDOW_MS).first();
  if (!row || typeof row.tracking_started_at !== "number") throw new Error("conversion migration missing");
  return { ok: true, ...row, as_of: now, activity_resolution_ms: ACTIVITY_INTERVAL_MS,
    definitions: {
      installed: "Enrolled daemon identities, including subsequently revoked identities; not downloads or physical computers.",
      paired: "Identities with an observed daemon-confirmed authenticated phone session since tracking_started_at.",
      active_7d: "Identities with relay-observed authenticated phone connection activity in the last 7 days, including keepalives; not human interaction. P2P-only activity after relay disconnection is not observed.",
      first_session_at: "First observed authenticated session. For identities enrolled before tracking_started_at, the true first pairing time is unknown.",
    } };
}
