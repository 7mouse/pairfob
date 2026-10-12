import { clearPairingFragment, setPhase } from "../connection/connection-store";
import { computers, liveSession, setAddingComputer } from "./catalog-store";
import { setScreen } from "../../app/navigation-store";
import { clearPairErrorTarget, pairAbortHandle, setPairCodeDraft, setPairManualOpen } from "../pairing/form-store";
import { clearNotice } from "../../app/notices-store";
import { batch } from "../../shared/model/domain-store";
import { retirePairingWork } from "../pairing/work";

let restoreCatalogSession: () => void = () => { throw new Error("Live connection runtime is not installed"); };
export function bindCatalogSessionRestoration(restore: () => void): void { restoreCatalogSession = restore; }

function abortPairingInput(): void {
  pairAbortHandle()?.abort();
  setPairCodeDraft("");
  setPairManualOpen(false);
  clearPairErrorTarget();
}

export function cancelAddComputer(): void {
  retirePairingWork();
  abortPairingInput();
  batch(() => {
    clearPairingFragment();
    setAddingComputer(false);
    clearNotice();
  });
  // Abort and notice publication can retire the session. Read the owner after
  // those side effects, not from a boolean captured before abort.
  if (liveSession() !== null) {
    batch(() => {
      setPhase("live");
      setScreen("computers");
    });
    restoreCatalogSession();
    return;
  }
  batch(() => {
    setPhase(computers().length ? "pick" : "connect");
    setScreen("home");
  });
}
