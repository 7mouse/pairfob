import type { CSSProperties } from "react";
import { Swap } from "../../shared/ui/primitives";
import type { QuotaMeterModel } from "./model";

/**
 * Remaining share as a bar plus a number, tinted when low. Pure: the model resolved tone and label.
 *
 * The bar is a length, so a change of the share is told by the bar's own
 * travel (`quota.scss`) and the number is swapped in. `arrive` is for a meter
 * whose row has just replaced a loading row: its place among those rows, which
 * lets the bar grow from nothing one step after the row before it. A meter
 * drawn with data that was already there is given none and stands still.
 */
export function QuotaMeter({ meter, arrive }: { meter: QuotaMeterModel; arrive?: number }) {
  const arriving = arrive === undefined ? "" : " is-arriving";
  const order = arrive === undefined ? undefined : { "--quota-i": arrive } as CSSProperties;
  if (meter.kind === "unlimited") {
    return <span className={`quota-meter is-unlimited${arriving}`} style={order} role="img" aria-label={meter.aria}>
      <span className="quota-bar" aria-hidden="true"><i /></span><span className="quota-pct" aria-hidden="true">∞</span>
    </span>;
  }
  return <span className={`quota-meter is-${meter.tone}${arriving}`} style={order} role="meter" aria-label={meter.aria}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.remaining}>
    <span className="quota-bar" aria-hidden="true"><i style={{ width: `${meter.remaining}%` }} /></span>
    <Swap on={meter.remaining} className="quota-pct" aria-hidden="true">{meter.remaining}%</Swap>
  </span>;
}
