import { act } from "react";
import { MOTION_MS } from "../src/shared/ui/dom/motion";

/**
 * Wait out an exit. What just left is kept drawn for the length of its exit
 * (`usePresence`, a lazy `Fold`) and is gone after; a test that goes on to say
 * it is gone waits here first.
 */
export async function afterExit(ms: number): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, ms + 40)); });
}

/** A `Fold` shut: its lazy content is drawn until it has, out of reach, and gone after. */
export const foldShut = (): Promise<void> => afterExit(MOTION_MS.panel);
