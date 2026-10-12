import { batch } from "../../shared/model/domain-store";
import { setLastUsedDaemon, setComputers } from "../computers/catalog-store";
import { sortComputers } from "../../lib/computer-catalog";
import { nextCatalogRequest, catalogRequestIsCurrent, establishAttemptIsCurrent } from "./generations";
import type { LifecyclePorts } from "./ports";

export type ReloadCatalogOptions = {
  /** An establish that lost to a newer one drops its catalog completion. */
  attempt?: number;
  /**
   * Caller-owned acceptance (Core boot-generation contract): captured before
   * the read, tested after the awaited catalog read and before any canonical
   * write. Returning false drops the stale completion without a rollback.
   */
  shouldApply?: () => boolean;
};

/**
 * Load the daemon catalog into the computers domain.
 *
 * Overlapping reloads never race: the request generation is captured before
 * the read and checked before any write, so a stale catalog completion cannot
 * overwrite the latest one.
 */
export async function reloadComputers(
  ports: Pick<LifecyclePorts, "loadCatalog" | "origin">,
  options: ReloadCatalogOptions = {},
): Promise<void> {
  const request = nextCatalogRequest();
  const catalog = await ports.loadCatalog(ports.origin());
  if (!catalogRequestIsCurrent(request)) return;
  if (options.attempt !== undefined && !establishAttemptIsCurrent(options.attempt)) return;
  if (options.shouldApply && !options.shouldApply()) return;
  batch(() => {
    setLastUsedDaemon(catalog.lastUsedDaemonId);
    setComputers(sortComputers(catalog.credentials, catalog.lastUsedDaemonId));
  });
}
