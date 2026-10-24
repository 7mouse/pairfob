export interface Env {
  DB: D1Database;
  DAEMON_ROOM: DurableObjectNamespace;
  PAIRING_INDEX: DurableObjectNamespace;
  ASSETS?: Fetcher;
  METRICS?: AnalyticsEngineDataset;
  OPERATOR_TOKEN: string;
  IP_HASH_PEPPER: string;
  BUILD?: string;
  P2P_OPEN?: string;
  INTENT_PAD_MS?: string;
  /** Comma-separated exact app origins (for example `https://localhost`). */
  APP_ORIGINS?: string;
  /** Dev only: also accept `http://localhost` as an app origin. */
  ALLOW_HTTP_APP_ORIGINS?: string;
}
