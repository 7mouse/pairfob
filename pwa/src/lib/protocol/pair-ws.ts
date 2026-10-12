import { normalizePairInput, type PairInput, type PairOptions, type PairResult } from "./pair-input";
import { ProtocolError } from "./errors";
export { normalizePairInput, normalizeDeviceLabel, confirmationTagMatches, type PairInput, type PairOptions, type PairResult } from "./pair-input";

/** Load the PAKE implementation only for an actual pairing attempt. */
export async function pairOverWS(
  relayWS: string, rawInput: PairInput, rawCode: string, options: PairOptions,
): Promise<PairResult> {
  // Local failures remain immediate; cancellation while fetching the chunk must
  // never open a socket or consume a one-use pairing ticket.
  const normalized = normalizePairInput(rawInput, rawCode);
  if (options.signal?.aborted) throw new ProtocolError("pairing_cancelled", "已取消配对");
  const handshake = await import("./pair-handshake.ts");
  if (options.signal?.aborted) throw new ProtocolError("pairing_cancelled", "已取消配对");
  return handshake.pairOverWS(relayWS, normalized.input, normalized.code, options);
}
