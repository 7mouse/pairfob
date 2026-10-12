import { t } from "./i18n.ts";
import type { ScanResult } from "./pairing-scanner-view.tsx";

export { PairingScanError } from "./pairing-scan-error";
let latestScan = 0;

/** A browser without camera access still opens the sheet, which explains why and offers the code. */
export async function scanPairingCode(expectedOrigin: string, stillOwned: () => boolean = () => true): Promise<ScanResult> {
  const attempt = ++latestScan;
  const { openPairingScanner } = await import("./pairing-scanner-view.tsx");
  // Loading the camera surface must not resurrect a cancelled/replaced page.
  if (attempt !== latestScan || !stillOwned()) return null;
  const unavailable = !navigator.mediaDevices?.getUserMedia ? t("scan.noCamera") : "";
  return openPairingScanner(expectedOrigin, undefined, unavailable);
}
