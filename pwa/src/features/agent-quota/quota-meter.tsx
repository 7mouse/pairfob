import type { CSSProperties } from "react";
import { Swap } from "../../shared/ui/primitives";
import type { QuotaMeterModel } from "./model";

/**
 * What is left of one allowance, on the trailing edge of its row. Pure: the
 * model resolved kind, tone and label.
 *
 * A share is a bar plus a number, tinted when low. The bar is a length, so a
 * change of the share is told by the bar's own travel (`quota.scss`) and the
 * number is swapped in. A level is five pips and a word, a balance a figure
 * alone, and a meter with nothing current to say a quiet word: three shapes
 * that cannot be mistaken for a percentage.
 *
 * `arrive` is for a meter whose row has just replaced a loading row: its place
 * among those rows, which lets the bar grow from nothing one step after the row
 * before it. A meter drawn with data that was already there is given none and
 * stands still.
 */
export function QuotaMeter({ meter, arrive }: { meter: QuotaMeterModel; arrive?: number }) {
  const arriving = arrive === undefined ? "" : " is-arriving";
  const order = arrive === undefined ? undefined : { "--quota-i": arrive } as CSSProperties;
  switch (meter.kind) {
    case "unlimited":
      return <span className={`quota-meter is-unlimited${arriving}`} style={order} role="img" aria-label={meter.aria} title={meter.hint}>
        <span className="quota-bar" aria-hidden="true"><i /></span><span className="quota-pct" aria-hidden="true">∞</span>
      </span>;
    case "level":
      return <span className={`quota-meter is-level is-${meter.tone}`} role="img" aria-label={meter.aria} title={meter.hint}>
        <span className="quota-pips" aria-hidden="true">{[0, 1, 2, 3, 4].map(pip => <i key={pip} className={pip < meter.pips ? "is-on" : undefined} />)}</span>
        <span className="quota-word" aria-hidden="true">{meter.word}</span>
      </span>;
    case "balance":
      return <span className="quota-meter is-balance" role="img" aria-label={meter.aria} title={meter.hint}>
        <Swap on={meter.text} className="quota-amount" aria-hidden="true">{meter.text}</Swap>
      </span>;
    case "pending":
      return <span className="quota-meter is-pending" role="img" aria-label={meter.aria} title={meter.hint}>
        <span className="quota-word" aria-hidden="true">{meter.text}</span>
      </span>;
    default:
      return <span className={`quota-meter is-${meter.tone}${arriving}`} style={order} role="meter" aria-label={meter.aria} title={meter.hint}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.remaining}>
        <span className="quota-bar" aria-hidden="true"><i style={{ width: `${meter.remaining}%` }} /></span>
        <Swap on={meter.remaining} className="quota-pct" aria-hidden="true">{meter.remaining}%</Swap>
      </span>;
  }
}
