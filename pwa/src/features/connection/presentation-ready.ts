/** Browser composition gate; headless protocol/controller callers have no presentation. */
import { ProtocolError } from "../../lib/protocol/errors";
import { t } from "../../lib/i18n";
let prepare: () => Promise<void> = () => Promise.resolve();
let ready = () => true;
export function bindSessionPresentation(next: () => Promise<void>, isReady: () => boolean): () => void {
  const previous = { prepare, ready };
  prepare = next;
  ready = isReady;
  return () => {
    if (prepare !== next || ready !== isReady) return;
    prepare = previous.prepare;
    ready = previous.ready;
  };
}
export async function prepareSessionPresentation(): Promise<void> {
  try { await prepare(); }
  catch { throw new ProtocolError("app_load_failed", t("err.appLoad")); }
}
export function sessionPresentationIsReady(): boolean { return ready(); }
