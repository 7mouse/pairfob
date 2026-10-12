import { expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../test-support/dom";
import { bindSessionPresentation } from "../connection/presentation-ready";
import { applyPairingFragment, clearPairingFragment, phase, setPhase } from "../connection/connection-store";
import { attachLiveSession, setAddingComputer, setComputers, setCredential } from "../computers/catalog-store";
import { resetPairingInput, pairAbortHandle, pairCodeDraft } from "./form-store";
import { beginPairing, cancelPairing, retirePairingWork } from "./actions";
import { clearNotice } from "../../app/notices-store";

async function loadingAttempt(run: (release: () => void, reject: (error: Error) => void, task: Promise<void>) => Promise<void>) {
  await resetBoardTestDOM();
  retirePairingWork();
  setPhase("connect");
  setAddingComputer(false);
  setComputers([]);
  setCredential(null);
  attachLiveSession(null);
  resetPairingInput();
  applyPairingFragment({ v: 2, code: "ABCDEFGH", pairRef: "a".repeat(32), daemonId: "d_" + "a".repeat(20), fingerprint: "fp" });
  let release!: () => void, reject!: (error: Error) => void;
  const loading = new Promise<void>((yes, no) => { release = yes; reject = no; });
  const unbind = bindSessionPresentation(() => loading, () => false);
  const fetchBefore = globalThis.fetch, socketBefore = globalThis.WebSocket;
  let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error("Unexpected fetch during module load"); }) as typeof fetch;
  globalThis.WebSocket = class { constructor() { network++; throw new Error("Unexpected socket during module load"); } } as typeof WebSocket;
  try {
    const task = beginPairing("ABCDEFGH");
    expect(phase()).toBe("pairing");
    await run(release, reject, task);
    expect(network).toBe(0);
    expect(pairAbortHandle()).toBeNull();
  } finally {
    release();
    unbind();
    globalThis.fetch = fetchBefore;
    globalThis.WebSocket = socketBefore;
    retirePairingWork();
    resetPairingInput();
    clearPairingFragment();
    clearNotice();
    setPhase("boot");
  }
}

test("cancelling a cold feature download opens no transport when the download eventually finishes", async () => {
  await loadingAttempt(async (release, _reject, task) => {
    cancelPairing();
    release();
    await task;
    expect(phase()).toBe("connect");
  });
});

test("a failed feature download leaves the code available without consuming the pairing ticket", async () => {
  await loadingAttempt(async (_release, reject, task) => {
    reject(new Error("Feature download failed"));
    await task;
    expect(phase()).toBe("connect");
    expect(pairCodeDraft()).toBe("ABCDEFGH");
  });
});
