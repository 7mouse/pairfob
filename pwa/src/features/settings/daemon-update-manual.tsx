import { ChevronDown } from "lucide-react";
import { lang, t } from "../../lib/i18n";
import { CommandLine } from "../../shared/ui/primitives";

/**
 * The paths that do not go through this page: the commands a reader runs in a
 * terminal on the computer. Pairfob and the Herdr runtime update separately,
 * so each command sits under its own name and neither needs a sentence saying
 * what the other one does not cover.
 */

export const PAIRFOB_UPDATE = "pairfob update";
export const HERDR_UPDATE = "pairfob setup --update-herdr";

const copyLabels = () => ({ copy: t("update.copyCommand"), copied: t("update.copied"), failed: t("update.copyManual") });

export function PairfobCommand() {
  return <CommandLine command={PAIRFOB_UPDATE} labels={copyLabels()} />;
}

/** A section under its name; the only section in a row already named after it keeps just its hint. */
function CommandSection({ label, hint, children }: { label: string | null; hint: string; children: React.ReactNode }) {
  return <div className="daemon-update-command">
    <p className="daemon-update-command-label">{label}<span>{hint}</span></p>
    {children}
  </div>;
}

function PairfobSection() {
  return <CommandSection label={t("update.pairfobLabel")} hint={t("update.pairfobHint")}><PairfobCommand /></CommandSection>;
}

function HerdrSection({ titled = true }: { titled?: boolean }) {
  const doc = `https://pairfob.com/doc/${lang() === "zh" ? "zh/" : ""}install#herdr-runtime`;
  return <CommandSection label={titled ? t("update.herdrLabel") : null} hint={t("update.herdrHint")}>
    <CommandLine command={HERDR_UPDATE} labels={copyLabels()} />
    <a className="daemon-update-doc" href={doc} target="_blank" rel="noreferrer">{t("update.herdrDoc")}</a>
  </CommandSection>;
}

/**
 * The card's last row: shut, one 44px question; open, the commands. When the
 * card already shows the Pairfob command as its answer, only Herdr is left
 * here and the row is named after it. `open` opens it when that prop turns
 * true (a failed update); the reader's own toggles are the element's.
 */
export function ManualUpdate({ withPairfob, open = false }: { withPairfob: boolean; open?: boolean }) {
  return (
    <details className="set-item-block daemon-update-help daemon-update-manual" open={open}>
      <summary>
        <span>{t(withPairfob ? "update.manualTitle" : "update.herdrTitle")}{withPairfob ? <small>{t("update.manualSub")}</small> : null}</span>
        <ChevronDown className="set-disclosure" size={14} aria-hidden="true" />
      </summary>
      <div className="daemon-update-commands">
        {withPairfob ? <PairfobSection /> : null}
        <HerdrSection titled={withPairfob} />
      </div>
    </details>
  );
}

/** `inline` sits inside the computer page's card; the picker footer keeps its own card. */
export function ManualUpdateHelp({ inline = false }: { inline?: boolean }) {
  return (
    <details className={inline ? "set-item-block daemon-update-help" : "set-card daemon-update-help"}>
      <summary>{t("update.helpTitle")}<ChevronDown className="set-disclosure" size={14} aria-hidden="true" /></summary>
      <p className="set-note">{t("update.helpBody")}</p>
      <div className="daemon-update-commands">
        <PairfobSection />
        <HerdrSection />
      </div>
    </details>
  );
}
