/**
 * The mutation runner (`run`) bound to the live app: its ports are the stores
 * and controllers of the running page. Every controller of this feature runs
 * its operations through here, so they share one owner check and one lock.
 */
import { commitView } from "../../app/host";
import { type NoticeScope } from "../../lib/notice-scope";
import { type ListWorktreesInput } from "../../lib/operations";
import { type LiveSession } from "../../lib/protocol/client";
import { currentDaemonId, liveSession } from "../computers/catalog-store";
import { refreshFromSession } from "../connection/controller";
import { liveView } from "../connection/generations";
import { reconcileAmbiguousMutation } from "../connection/mutations";
import { acquirePromptLock, currentViewIncarnation, releasePromptLock } from "../session/drafts/compose-drafts";
import { promptLockHeld } from "../session/drafts/state-drafts";
import { capabilityEnabled, operationBusy } from "./capabilities-store";
import {
  operationOwner as ownedOperation,
  ownsComputer as ownerOwnsComputer,
  ownsOperationView as ownerOwnsView,
  reportOwnedError as reportError,
  runHerdOperation as runOwnedOperation,
  type MutationRunnerPorts,
  type OperationOwner,
} from "./run";

export const mutationPorts: MutationRunnerPorts = {
  currentIncarnation: currentViewIncarnation,
  currentViewVersion: liveView,
  promptLockHeld,
  currentLive: liveSession,
  currentDaemonId: () => currentDaemonId(),
  busy: operationBusy,
  connected: () => liveSession()?.isConnected() === true,
  capabilityEnabled,
  acquirePromptLock,
  releasePromptLock,
  reconcile: reconcileAmbiguousMutation,
  refreshFromSession,
  commitView,
};

export function operationOwner(session: LiveSession): OperationOwner {
  return ownedOperation(session, currentViewIncarnation(), liveView());
}

export function ownsComputer(owner: OperationOwner): boolean {
  return ownerOwnsComputer(owner, liveSession(), currentDaemonId());
}

export function ownsOperationView(owner: OperationOwner): boolean {
  return ownerOwnsView(owner, mutationPorts, liveSession(), currentDaemonId());
}

export async function reportOwnedError(owner: OperationOwner, error: unknown): Promise<void> {
  await reportError(owner, error, mutationPorts);
}

export type HerdOperationOptions<T> = {
  owner?: OperationOwner;
  capability?: Parameters<typeof capabilityEnabled>[0];
  conflictMessage?: string;
  unsupportedMessage?: string;
  after?: (result: T, owner: OperationOwner) => Promise<void>;
  reconcileWorktrees?: ListWorktreesInput;
  noticeScope?: NoticeScope;
};

export async function runHerdOperation<T>(
  pending: string,
  success: string,
  action: () => Promise<T>,
  options: HerdOperationOptions<T> = {},
): Promise<void> {
  await runOwnedOperation(pending, success, action, mutationPorts, options);
}
