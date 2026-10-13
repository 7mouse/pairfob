import { useId, useState } from "react";
import { t } from "../../lib/i18n";
import { AgentAvatar, Button, Chevron, CommandLine, Fold, SetGroup } from "../../shared/ui/primitives";
import type { QuotaNoticeModel } from "./model";

const copyLabels = () => ({ copy: t("set.copy"), copied: t("set.copied"), failed: t("set.copyFailed") });

/** The way out of one notice: the steps on the computer and the command to run there. */
function Steps({ notice }: { notice: QuotaNoticeModel }) {
  return <div className="quota-steps">
    {notice.steps.map((step, index) => <p key={index}>{step}</p>)}
    {notice.command ? <CommandLine command={notice.command} labels={copyLabels()} /> : null}
  </div>;
}

/** One account that needs the reader: a line saying what is wrong, which opens onto how to fix it. */
function AttentionItem({ notice }: { notice: QuotaNoticeModel }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  return <div className="quota-notice" id={`quota-${notice.id}`}>
    <Button className="set-item set-nav" aria-expanded={open} aria-controls={stepsId} onClick={() => setOpen(shown => !shown)}>
      <AgentAvatar kind={notice.provider} className="quota-mark" />
      <span className="set-item-text">
        <span className="set-item-label">{notice.title}</span>
        <span className="set-item-sub is-warn">{notice.reason}</span>
      </span>
      <Chevron className="chev set-chev" />
    </Button>
    <Fold open={open} id={stepsId}><Steps notice={notice} /></Fold>
  </div>;
}

/**
 * The accounts whose login is there but cannot be read. In a column a few
 * words wide every one is a row; in a wide one (`quota.scss`) they are one
 * strip across the cards until the reader opens it.
 */
export function QuotaAttentionGroup({ notices }: { notices: QuotaNoticeModel[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const title = `${t("quota.group.attention")} · ${notices.length}`;
  // One account is its own summary: a strip over it would only add a press.
  const strip = notices.length > 1;
  return <SetGroup className={`quota-attention${strip ? " has-strip" : ""}${open ? " is-open" : ""}`} label={title} icons>
    <Button className="set-item set-nav quota-strip" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(shown => !shown)}>
      <span className="set-item-text">
        <span className="set-item-label">{title}</span>
        <span className="set-item-sub is-warn">{notices.map(notice => `${notice.title} ${notice.reason}`).join(" · ")}</span>
      </span>
      <Chevron className="chev set-chev" />
    </Button>
    <div className="quota-notices set-list set-list-icons" id={listId}>
      {notices.map(notice => <AttentionItem key={notice.id} notice={notice} />)}
    </div>
  </SetGroup>;
}

/**
 * What this computer has no login for, shut by default: most of it is services
 * the reader never used. Under it, where the agents without a meter went.
 */
export function QuotaOthersGroup({ notices }: { notices: QuotaNoticeModel[] }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const listId = useId();
  const whyId = useId();
  return <SetGroup className="quota-others" label={t("quota.group.others")}>
    {notices.length ? <Button className="set-item set-nav" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(shown => !shown)}>
      <span className="set-item-text">
        <span className="set-item-label">{t("quota.others.count", { n: notices.length })}</span>
        <span className="set-item-sub">{notices.map(notice => notice.title).join("、")}</span>
      </span>
      <Chevron className="chev set-chev" />
    </Button> : null}
    {notices.length ? <Fold open={open} id={listId} bodyClassName="set-list set-list-icons">
      {notices.map(notice => <div key={notice.id} className="set-item quota-other" id={`quota-${notice.id}`}>
        <AgentAvatar kind={notice.provider} className="quota-mark" />
        <span className="set-item-text">
          <span className="set-item-label">{notice.title}</span>
          <span className="set-item-sub">{notice.reason}</span>
          {notice.steps.length || notice.command ? <Steps notice={notice} /> : null}
        </span>
      </div>)}
    </Fold> : null}
    <Button className="set-item set-nav" aria-expanded={why} aria-controls={whyId} onClick={() => setWhy(shown => !shown)}>
      <span className="set-item-text"><span className="set-item-label quota-why">{t("quota.why.title")}</span></span>
      <Chevron className="chev set-chev" />
    </Button>
    <Fold open={why} id={whyId}><p className="set-item-note">{t("quota.why.body")}</p></Fold>
  </SetGroup>;
}
