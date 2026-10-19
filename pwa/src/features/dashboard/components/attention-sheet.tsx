import { CheckCheck } from "lucide-react";
import { t } from "../../../lib/i18n";
import { MenuChoice, showActionSheet } from "../../../shared/ui/overlay";
import { SheetFooter } from "../../../shared/ui/overlay/sheet-content";
import { AgentAvatar } from "../../../shared/ui/primitives";
import type { HerdViewModel } from "../model/herd-view";
import type { AttentionReadAll } from "./attention-strip";
import { RowStepText } from "./row-step";

/** From this many sessions the sheet opens at a shorter height and grows on a pull. */
const TALL_FROM = 7;

/**
 * Every session the phone's "needs you" strip holds, behind its label. The
 * strip shows little more than one ticket at a time on a phone; here each
 * session is a row with its status and step, in the strip's order, and "mark
 * all read" is pinned under the list, in reach however long it is. Picking a
 * row opens its session, as its ticket does. The rows are those of the moment
 * it opened: the sheet covers the list, and "mark all read" reads whatever is
 * unread when it is pressed.
 */
export function openAttentionSheet({ view, readAll, onOpen, anchor }: {
  view: HerdViewModel;
  readAll: AttentionReadAll | null;
  onOpen: (paneId: string) => void;
  anchor: HTMLElement;
}): void {
  const cards = new Map(view.groups.flatMap(group => group.cards).map(card => [card.paneId, card]));
  const waiting = view.attention.some(item => item.kind === "blocked");
  showActionSheet(t("list.needsYouTitle"), (modal) => (
    <>
      {view.attention.map((item) => {
        const card = cards.get(item.paneId);
        const tone = card?.statusTone ?? item.kind;
        const facts = card?.step ? <RowStepText step={card.step} /> : card?.line || item.workspace;
        return (
          <MenuChoice key={item.paneId} modal={modal} icon={<AgentAvatar kind={item.agentKind} status={tone} size="sm" />}
            title={item.title}
            detail={<>
              {card?.statusLabel ? <span className={`card-status is-${tone}`}>{card.statusLabel}</span> : null}
              {card?.statusLabel && facts ? <span aria-hidden="true"> · </span> : null}
              {facts}
            </>}
            action={() => onOpen(item.paneId)} />
        );
      })}
      {readAll ? (
        <SheetFooter>
          <div className="attn-sheet-foot">
            <MenuChoice modal={modal} icon={<CheckCheck className="attn-sheet-read" size={18} aria-hidden="true" />}
              title={t("list.readAll")}
              detail={t(waiting ? "list.readAllKeepsWaiting" : "list.readAllAria", { count: String(readAll.count) })}
              action={readAll.onReadAll} />
          </div>
        </SheetFooter>
      ) : null}
    </>
  ), { popover: "menu", anchor, expandable: view.attention.length >= TALL_FROM, className: "attn-sheet" });
}
