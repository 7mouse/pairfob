import type { LiveSession } from "../../lib/protocol/client";

type PushConfig = { push_enabled: boolean; vapid_public: string };
const configs = new WeakMap<object, PushConfig>();

/** Called only after GetConfig validation, bound to that exact session. */
export function rememberPushConfig(session: LiveSession, config: Record<string, unknown>): void {
  configs.set(session, { push_enabled: config.push_enabled === true,
    vapid_public: typeof config.vapid_public === "string" ? config.vapid_public : "" });
}
export const preparedPushConfig = (session: LiveSession) => configs.get(session);

export function subscriptionMatches(subscription: PushSubscription, key: string): boolean {
  const actual = subscription.options?.applicationServerKey;
  if (!actual || !key) return false;
  const encoded = btoa(String.fromCharCode(...new Uint8Array(actual)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return encoded === key;
}
