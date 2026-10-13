import { useId, useState } from "react";
import { t } from "../../lib/i18n";
import { AgentAvatar, Button, Chevron, Fold, SetGroup, SetItem, SetTag } from "../../shared/ui/primitives";
import type { QuotaCardModel, QuotaRowModel } from "./model";
import { QuotaMeter } from "./quota-meter";

function Rows({ rows, arrive }: { rows: QuotaRowModel[]; arrive?: number }) {
  return rows.map((row, index) => <SetItem key={row.key} className={`quota-item${row.quiet ? " is-quiet-row" : ""}`} label={row.label} sub={row.sub}
    trailing={<QuotaMeter meter={row.meter} arrive={arrive === undefined ? undefined : arrive + index} />} />);
}

/**
 * One account with numbers: a head row (whose it is, its plan, when it was
 * read), then a row per meter that stands for the account. The rest sit under
 * one line that opens, and that says without opening when any of them is low.
 * Pure but for that fold: the model resolved every string. `arrive` marks a
 * card that was read after the page was drawn (see `arrivals`).
 */
export function QuotaCardView({ card, arrive }: { card: QuotaCardModel; arrive?: number }) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  return <SetGroup className={`quota-card${arrive === undefined ? "" : " is-arriving"}`} id={`quota-${card.id}`}>
    <SetItem className="quota-head"
      label={<><AgentAvatar kind={card.provider} size="sm" />{card.title}{card.plan ? <SetTag>{card.plan}</SetTag> : null}</>}
      sub={card.status} subTone={card.troubled ? "warn" : undefined}
      trailing={card.tag ? <SetTag tone={card.tag.tone}>{card.tag.text}</SetTag> : null} />
    {card.stale ? <p className="set-item-note">{t("quota.staleRow")}</p> : <Rows rows={card.rows} arrive={arrive} />}
    {card.more ? <Button className="set-item set-nav quota-fold" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen(shown => !shown)}>
      <span className="set-item-text"><span className="set-item-label">{card.more.label}</span></span>
      {card.more.low ? <span className="set-val is-warn">{card.more.low}</span> : null}
      <Chevron className="chev set-chev" />
    </Button> : null}
    {card.more ? <Fold open={open} id={moreId} bodyClassName="set-list"><Rows rows={card.more.rows} /></Fold> : null}
    {card.notes.length ? <p className="set-item-note">{card.notes.join(" ")}</p> : null}
  </SetGroup>;
}
